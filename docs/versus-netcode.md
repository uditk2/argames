# Versus (2P) — Netcode & Combat Design

A **separate game mode** from the solo "Demon Onslaught" (boxer). Two players
duel over a direct **WebRTC peer-to-peer** connection. No server is in the
gameplay path — the only manual step is a one-time copy/paste of connection
codes. Reuses the existing pose tracker, punch/shield detectors, the SVG avatar
rig, theme and SFX.

---

## 1. Goals & threat model

- **Friendly play** (two people sharing connection codes), not ranked/strangers.
  → We do **not** need a cheat-proof referee, so we avoid an authoritative
  server entirely. (If ranked is ever wanted, an authoritative-server transport
  can be added later; the timestamped-packet design below is exactly what it
  would need, so nothing is wasted.)
- **Fast & cheap:** gameplay data is P2P and tiny (pose + events only).
- **Defending must work and feel fair** — blocking is reaction-based.

---

## 2. Transport

- **WebRTC `RTCDataChannel`** (via PeerJS). Gameplay is direct peer-to-peer.
- **Signaling = short room codes via the public PeerJS broker** (`0.peerjs.com`,
  the default — no self-hosted server):
  1. Host clicks *Host a match* → registers a short random code (e.g. `ABC123`)
     with the broker and waits.
  2. Host shares the code (chat, voice, etc.).
  3. Guest types the code → *Connect*; the broker introduces the two peers and a
     direct `DataConnection` opens.
  - The broker only brokers the **handshake**; once connected, no match data
    touches it. PeerJS handles trickle ICE internally, so connecting is fast.
  - **V1 channel:** a single reliable+ordered connection (`{ reliable: true }`)
    so HP/KO packets can't be lost. (A future optimization is a 2nd unreliable
    channel just for pose, to drop head-of-line blocking on lossy links.)
- **NAT note (V1 limitation):** direct connections work on most home networks.
  Strict-NAT/firewall pairs may fail to connect directly; the standard fix is a
  TURN **relay** server (the only place a server can re-enter, and only for the
  handshake-path, not as a referee). Out of scope for V1; documented as a known
  edge case.
- **Security note (V1):** the public broker is a third party that sees handshake
  metadata, and codes are guessable; fine for friendly play. Hardening later =
  self-hosted broker / expiring codes (see §1 threat model).
- **No media tracks. No video is ever sent** (see §6).

### Abstraction: the "data link"

All higher layers talk to a minimal interface so they're transport-agnostic and
testable:

```
DataLink = {
  send(bytes: Uint8Array): void,
  onMessage(cb: (bytes) => void): void,
  onOpen(cb), onClose(cb),
  readyState: 'connecting' | 'open' | 'closed',
  close(): void,
}
```

- `peerLink.js` produces a real `DataLink` backed by a PeerJS `DataConnection`
  (host = `createPeerHost`, guest = `createPeerJoin`).
- `dataLink.js` also exports `createLoopbackPair({ latencyMs, jitterMs, loss })`
  → two linked `DataLink`s for **in-process two-instance tests** (mock the wire,
  including latency/jitter/packet-loss).

---

## 3. Shared match clock

Two browsers don't share a clock (`performance.now()` has a different origin and
drifts). Right after the channel opens we run an **NTP-style sync** over the
data link:

- One side sends `PING(t0)`. Peer replies `PONG(t0, t1=peerNow)`. On return at
  `t2`, we compute `rtt = t2 - t0` and `offset = t1 - (t0 + rtt/2)`.
- Repeat ~7×; keep the sample with the **lowest RTT** (least noisy), use its
  `offset`. Re-sync periodically (every few seconds) with light smoothing to
  track drift.
- `clock.now()` returns the **match time** = `performance.now() + offset` — a
  value both peers agree on. `t=0` is fixed at an agreed `matchStart` time both
  sides receive in the `HELLO`/start handshake.
- Every packet is stamped with `clock.now()`.

`rtt` is also surfaced to the UI (ping indicator) and used to size the
interpolation buffer.

---

## 4. Packet protocol (binary)

First byte = type tag; the rest is packed with a `DataView`. Pose is the only
high-rate packet, so it's the one we keep compact.

| Type     | Rate     | Payload |
|----------|----------|---------|
| `HELLO`  | once     | protocol version, playerId, agreed `matchStart` |
| `PING`   | sync     | `t0` (f64) |
| `PONG`   | sync     | `t0` (f64), `t1` (f64) |
| `POSE`   | ~20–24Hz | `t` (f64) + **reduced joint set** (15 joints × x,y as **int16**, normalized 0..1 → 0..32767) + a 16-bit visibility bitmask |
| `PUNCH`  | on event | `t`, `side` (L/R), `fx,fy` (int16), `kind` (jab/cross) |
| `GUARD`  | on change| `t`, `up` (0/1) — opponent's guard, for display only |
| `HEALTH` | on change| `t`, `hp` (0..100) — **sender's own** HP (single-writer) |
| `KO`     | once     | `t`, who fell |

**Reduced joint set (15):** nose, L/R shoulder, L/R elbow, L/R wrist, L/R hip,
L/R knee, L/R ankle, L/R ear. This is exactly what the avatar rig consumes, so
we never send the full 33. Budget ≈ 8 (hdr+t) + 15×4 + 2 ≈ **70 bytes/pose** →
at 22Hz ≈ **~1.5 KB/s**. Tiny.

---

## 5. Authority & hit judging (the important part)

**Rule: each peer is the sole authority over its own body & HP** (single writer
per health bar → no disputes are even possible).

Flow when A punches B:

1. A's local `punch` detector fires → A sends `PUNCH{ t, side, fx, fy }`
   (timestamped on the shared clock) and plays its own swing FX.
2. B receives the punch. B checks **its own** guard state at the reconciled time
   `t` (within a ±`GUARD_WINDOW` ≈ 150 ms tolerance):
   - **Guard up →** blocked: chip damage `BLOCK_CHIP` (e.g. 2) + block SFX/spark.
   - **Guard down →** clean hit: `HIT_DMG` (e.g. 10) + hit SFX/shake.
3. B subtracts from **its own** HP, then broadcasts `HEALTH{ t, hp }`. A just
   displays B's bar from that packet. **B never argues about A's HP and vice
   versa.**
4. When B's HP hits 0, B sends `KO`; both screens show the result.

**Why this feels fair (where the latency goes):** a defender only ever reacts to
what's on *their* screen. The opponent is rendered slightly in the past (§7), so
B reacts to A's incoming fist with B's *full, real* reaction time against the
image B saw. Latency is not stolen from the defender's reaction window; it shows
up only as A briefly seeing B's block land a hair "late" before B's `HEALTH`
packet arrives. This deliberately **favors the defender** — the kinder, more
natural feel. (The alternative — attacker's screen is truth — makes defenders
feel they "blocked but got hit"; we don't want that.)

Guard state itself is the existing **shield detector** (both wrists above
shoulders). We also send `GUARD` so the opponent's avatar can *show* a guard
pose, but the authoritative block check uses the **defender's local** guard, not
the received one.

### Combat constants (tunable)
```
HP_MAX = 100
HIT_DMG = 10          // clean hit
BLOCK_CHIP = 2        // damage through a block
GUARD_WINDOW_MS = 150 // reaction tolerance around punch time
PUNCH_COOLDOWN_MS = 300 (per arm, reuse punch detector cooldown)
```

---

## 6. Video & bandwidth decision

**Decision: do NOT stream any video.** The opponent is represented entirely by
their **rigged avatar**, driven from the ~1.5 KB/s pose stream. This is the
lowest-bandwidth option and it's exactly what the avatar work was for.

Optional, **zero network cost:** show **your own** local webcam *dimmed* behind
your side of the arena (same trick as the boxer mode) so you can self-align.
That feed is local only — it is never transmitted — so it gives the "dim video"
feel the user asked about without spending any bandwidth.

(If a faint "ghost" of the *real* opponent is ever wanted, a heavily
down-scaled, low-FPS WebRTC video track is the future option — but it costs
~100–300 kbps vs the avatar's ~1.5 KB/s, so it stays off by default.)

---

## 7. Remote pose interpolation

- Incoming `POSE` packets go into a small **timestamped buffer** (`poseBuffer`).
- The remote avatar is rendered at `renderTime = clock.now() - RENDER_DELAY`,
  where `RENDER_DELAY ≈ max(80ms, ~1.5 × oneWayLatency)`. We **interpolate**
  between the two buffered samples bracketing `renderTime` → smooth motion, no
  teleporting, hides jitter.
- If the buffer runs dry (stall), we hold the last pose briefly, then fade.

---

## 8. Scene & UI

- **Arena layout:** side-by-side, both avatars **front-facing** (reusing the
  existing front-view rig). "You" on the left, opponent on the right; HP bars in
  the top corners (yours left, theirs right), a centered `VS` + round timer, and
  a ping indicator.
- **Your avatar** is driven by your **local** pose in real time; the **opponent
  avatar** by the interpolated remote pose.
- Your own webcam optionally dim behind your half (§6).
- Punch/block/KO reuse the existing **SFX** and energy-burst FX.

### Connection UI (room codes)
A small lobby panel: *Host a match* (shows a short room code + "waiting for
opponent" spinner) or *Join a match* (type the host's code → Connect). A status
line shows: creating room → waiting/connecting → connected (ping ms) → FIGHT.

---

## 9. Module layout (all new; existing boxer untouched)

```
src/net/
  protocol.js     # binary encode/decode for every packet type
  clock.js        # NTP-style sync; clock.now() shared match time
  dataLink.js     # DataLink interface + createLoopbackPair() for tests
  peerLink.js     # PeerJS room-code signaling -> DataLink (host/join);
                  #   uses the public broker, PeerImpl injectable for tests
src/versus/
  poseBuffer.js   # timestamped remote-pose buffer + interpolation
  versusEngine.js # match state: HP, KO, defender-authoritative hit judging
  versusSession.js# wires dataLink + clock + engine + local pose/move input;
                  #   encodes outgoing packets, routes incoming ones
src/render/
  versusScene.js  # Pixi arena; two avatar rigs (reuse avatarRigSprite), FX
src/ui/screens/
  VersusScreen.jsx# lobby (room codes) + arena; owns the per-frame loop
  HomeScreen.jsx  # mode select: Demon Onslaught (existing) | Versus (2P)
```

**Reused as-is:** `vision/poseTracker.js`, `moves/punch.js`, `moves/shield.js`,
`render/avatarRigSprite.js`, `config/theme.js`, `render/sfx.js`.

---

## 10. Test plan (two instances, mocked fight)

A Node harness (`tests/versus.fight.test.mjs`) that:

1. Builds **two sessions** linked by `createLoopbackPair({ latencyMs: 60,
   jitterMs: 20, loss: 0.02 })` — simulating a real wire.
2. Runs the **clock sync** and asserts the recovered offset ≈ injected offset
   and RTT ≈ injected latency.
3. **Mocks pose streams** for both players and **scripted jabs**, including
   cases where the defender's guard is up vs down at the punch time.
4. Asserts: blocked punches deal `BLOCK_CHIP`, clean punches deal `HIT_DMG`,
   HP decreases on the **defender's** side and replicates to the attacker via
   `HEALTH`, and a scripted sequence drives one player to **KO** → both
   sessions agree on the winner.

The loopback test covers all transport-agnostic logic (protocol, clock, engine,
session). The PeerJS broker layer (`peerLink.js`) is a thin DataLink adapter
that can't be exercised headlessly (it needs a browser WebRTC stack + network to
the broker); it's validated by live play between two browser tabs/devices.
