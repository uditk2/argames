// ===========================================================================
// VERSUS SESSION — the orchestrator that ties the netcode together.
// ---------------------------------------------------------------------------
// Wires: DataLink + shared clock + versus engine + remote pose buffer + the
// binary protocol. Encodes outgoing local input (pose/punch/guard) and routes
// incoming packets. Transport-agnostic — works over a real WebRTC DataLink or
// the loopback pair used in tests. See docs/versus-netcode.md §3,§5,§9.
//
// Clock model: the HOST is the time reference (offset 0). The GUEST pings and
// adjusts its offset so both share the host's clock. matchStart is chosen by
// the host and sent in HELLO.
// ===========================================================================

import {
  T, decode,
  encodeHello, encodePing, encodePong, encodePose, encodePunch, encodeGuard, encodeHealth, encodeKO,
} from '../net/protocol.js';
import { createClock } from '../net/clock.js';
import { createPoseBuffer } from './poseBuffer.js';
import { createVersusEngine } from './versusEngine.js';

const POSE_SEND_HZ = 22;
const START_DELAY_MS = 3000;   // countdown after both ready (host-chosen)

export function createVersusSession({
  link,
  isHost,
  playerId = isHost ? 1 : 2,
  engine = createVersusEngine(),
  clock = createClock(),
  hooks = {},
  timers = { setInterval, clearInterval, setTimeout },
} = {}) {
  const poseBuf = createPoseBuffer();

  let peerHello = null;       // { matchStart, ... }
  let matchStart = null;      // shared-clock time the round begins
  let synced = false;
  let oppGuard = false;
  let lastPoseSentLocal = 0;
  let pingTimer = null;
  let syncCount = 0;
  let destroyed = false;

  const fire = (name, ...a) => { try { hooks[name] && hooks[name](...a); } catch (e) { /* hook errors never break the loop */ } };

  // ---- outgoing -----------------------------------------------------------
  function sendPose(landmarks) {
    if (!link || link.readyState !== 'open' || !landmarks) return;
    const t = clock.localNow();
    if (t - lastPoseSentLocal < 1000 / POSE_SEND_HZ) return; // throttle
    lastPoseSentLocal = t;
    link.send(encodePose(clock.now(), landmarks));
  }

  function sendPunch({ side, x = 0.5, y = 0.5, kind = 0 } = {}) {
    if (!link || link.readyState !== 'open') return;
    link.send(encodePunch(clock.now(), side, x, y, kind));
    fire('onLocalPunch', { side, x, y });
  }

  function setLocalGuard(up) {
    engine.registerLocalGuard(up, clock.now());
    if (link && link.readyState === 'open') link.send(encodeGuard(clock.now(), up));
  }

  // ---- incoming -----------------------------------------------------------
  function onMessage(bytes) {
    let m;
    try { m = decode(bytes); } catch { return; }
    switch (m.type) {
      case T.PING:
        link.send(encodePong(m.t0, clock.stampForPong()));
        break;
      case T.PONG:
        if (!isHost) clock.onPong(m.t0, m.t1); // only guest adjusts to host
        if (!synced && clock.samples.length >= 4) { synced = true; fire('onSynced', clock.getRtt()); }
        break;
      case T.HELLO:
        peerHello = m;
        if (m.matchStart != null) matchStart = m.matchStart;
        fire('onPeerHello', m);
        break;
      case T.POSE:
        poseBuf.push(m.t, m.landmarks);
        break;
      case T.PUNCH: {
        const res = engine.onIncomingPunch(m);
        if (!res.ignored) {
          link.send(encodeHealth(clock.now(), res.selfHp));
          fire('onHitTaken', res);
          if (res.ko) { link.send(encodeKO(clock.now(), playerId)); fire('onMatchOver', engine.state().winner); }
        }
        break;
      }
      case T.GUARD:
        oppGuard = m.up;
        fire('onOppGuard', m.up);
        break;
      case T.HEALTH:
        engine.setOppHp(m.hp);
        fire('onOppHealth', m.hp);
        if (engine.state().over) fire('onMatchOver', engine.state().winner);
        break;
      case T.KO:
        if (!engine.state().over) engine.forceOver('self');
        fire('onMatchOver', engine.state().winner);
        break;
      default:
        break;
    }
  }

  // ---- lifecycle ----------------------------------------------------------
  function onOpen() {
    if (isHost) {
      matchStart = clock.now() + START_DELAY_MS;
      link.send(encodeHello(playerId, matchStart));
    } else {
      // Guest drives clock sync: rapid pings, then settle.
      const ping = () => {
        if (destroyed || link.readyState !== 'open') return;
        link.send(encodePing(clock.localNow()));
        syncCount++;
        if (syncCount === 8 && pingTimer) {
          timers.clearInterval(pingTimer);
          pingTimer = timers.setInterval(ping, 3000); // slow keep-alive resync
        }
      };
      pingTimer = timers.setInterval(ping, 150);
      ping();
    }
    fire('onOpen');
  }

  function start() {
    link.onMessage(onMessage);
    link.onOpen(onOpen);
    link.onClose(() => fire('onClose'));
    if (link.readyState === 'open') onOpen();
    return api;
  }

  function destroy() {
    destroyed = true;
    if (pingTimer) timers.clearInterval(pingTimer);
    try { link.close(); } catch {}
  }

  const api = {
    start,
    destroy,
    // per-frame local input
    sendPose,
    sendPunch,
    setLocalGuard,
    // remote read for rendering
    remotePoseAt: (rt) => poseBuf.sampleAt(rt),
    poseBufferSize: () => poseBuf.size,
    // status
    clock,
    engine,
    isSynced: () => synced,
    matchStart: () => matchStart,
    oppGuard: () => oppGuard,
    rtt: () => clock.getRtt(),
    state: () => ({ ...engine.state(), synced, rtt: clock.getRtt(), oppGuard, matchStart }),
  };
  return api;
}
