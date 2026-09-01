# Relic Hunter — CrazyGames Submission

Standalone single-game build of **Relic Hunter: Temple Collapse** (route `/temple-collapse`
on SlayFit) with the CrazyGames SDK v3 integrated. This doc covers the manual portal steps
that can't be automated, plus what the build already satisfies.

**Last verified:** 2026-08-30, against a real `npm run build:crazygames` served locally and
played in a browser, and against the current CrazyGames docs
(`/requirements/technical|gameplay|ads|quality`, `/sdk/game`, `/sdk/intro`).

## Build the upload artifact

```bash
npm run build:crazygames
```

Output: `dist-crazygames/` — `index.html` + `assets/`, all paths relative. The build prints
its own size report and **hard-fails if a listed asset is missing** (see
`vite.crazygames.config.js`), so a stale asset list can no longer ship as silent 404s.

Zip the **contents** of `dist-crazygames/` (not the folder itself — `index.html` must sit at
the zip root):

```bash
cd dist-crazygames && zip -qr ../relic-hunter-crazygames.zip . && cd ..
```

The build renames Vite's `crazygames.html` output to `index.html` automatically, so no manual
rename step is needed any more.

## Manual portal steps (cannot be automated)

1. **Register / sign in** at https://developer.crazygames.com.
2. **Create the game** → "Add game" → HTML5. Name: *Relic Hunter* (subtitle *Temple Collapse*).
   Category: Adventure / Runner. Tags: runner, 3D, maze, temple, adventure.
3. **Upload the build**: `relic-hunter-crazygames.zip`. The portal unzips and serves it in a
   QA iframe. Confirm it loads to the ▶ Play intro.
4. **Covers / screenshots / video** — ready under `marketing/crazygames/` and
   `store-assets/crazygames/`:
   - Covers: `landscape_1920x1080.png`, `portrait_800x1200.png`, `square_800x800.png`
     (all three carry the RELIC HUNTER wordmark and match the in-game brand).
   - Preview videos: `store-assets/crazygames/videos/relic-hunter_preview_*.mp4` —
     landscape 1920×1080 (17.3 s, 26 MB) and portrait 1080×1620 (17.7 s, 18 MB).
     Both open on the matching static cover, then cut to a real recorded L5 run
     ending on the Syamantaka gem claim. No audio track, no cursor, no black bars,
     no fast-forward, no promo text — captured headless at the target aspect so the
     game genuinely fills the portrait frame rather than being letterboxed.
     The earlier `temple-collapse_preview_*` pair is in `videos/superseded/`: shot
     2026-07-02, before the rename and the art pass, and it shows the old avatar and
     a visible mouse cursor (explicitly disallowed).
   - Screenshots: `store-assets/crazygames/screenshots/` (6).
   - Note: the older `store-assets/crazygames/covers/temple-collapse_cover_*.png` set is
     superseded by `marketing/crazygames/` — upload the marketing set.
5. **Controls / instructions**: Desktop ← → turn, ↑ jump, ↓ duck (WASD + Space also work),
   hold M to peek at the map. Mobile: swipe up/down/left/right, tap = jump.
6. **Billing**: complete **Tipalti** setup, or choose **"Hold Payments"** to submit without it.
7. **Submit for QA** → **Basic Launch** → (after metrics) **Full Launch**.

## Requirements — status

### Verified in the packaged build
- ✅ **SDK v3 installed and initialised** — `crazygames.html` loads
  `https://sdk.crazygames.com/crazygames-sdk-v3.js`; `initSdk()` awaits `SDK.init()`.
  Confirmed live in the served build: `CrazyGames HTML SDK initialized {version: 3.8.0}`.
- ✅ **Gameplay events** — `gameplayStart()` in `loadLevel()` (first start + every level and
  after a revive); `gameplayStop()` on the `over` edge, the `won` edge, and `backToMenu()`.
  Confirmed live: "Requesting gameplay start (local)".
- ✅ **Midgame ad between levels** — `await midgameAd()` in `nextLevel()`, after
  `gameplayStop()`. Never fires during active play. Frequency is left to the SDK, as the
  docs require.
- ✅ **Rewarded revive is opt-in** — bound only to the "▶ Continue — watch ad" button on
  Game Over, once per run, never to the Enter/Space primary (which stays Restart). Rewards
  only on `adFinished`.
- ✅ **Muted during video ads** — both ad call sites pass `onStart`/`onStop`, which mute on
  `adStarted` and unmute on `adFinished`/`adError` — i.e. only while the video is on screen,
  not for the whole request window.
- ✅ **`game.settings.muteAudio` honoured** — read on init and followed via
  `addSettingsChangeListener`. It takes priority over the in-game 🔊 toggle, which is
  disabled while the portal setting is on, per the Game-module docs.
- ✅ **Adblock-safe** — every SDK call is feature-detected and try/caught; both ad helpers
  resolve on `adError`/absent/timeout so play always continues, with no penalty.
- ✅ **Relative paths only** — Vite `base:'./'` plus `assetUrl()` for every runtime asset;
  no absolute `/assets/...` refs remain in `src/games/temple/`.
- ✅ **Complete asset set** — the build ships all 6 level maps, both playable hunters
  (Mira incl. the L5 `lift` set, Vikram), the SFX + music bed, the bilingual VO, and the
  gem-claim clip. Verified over HTTP: all requests 200, no console errors.
- ✅ **Size / file count** — 25.7 MB across 299 files (limits: 250 MB, 1500 files).
- ✅ **One click to gameplay** — the standalone renders only `<TempleDash />`; the intro
  panel is character-select + ▶ Play.
- ✅ **`user-select:none` on `body`** — in `crazygames.html`.
- ✅ **Privacy notice** — `src/ui/ConsentNotice.jsx` is mounted in the standalone entry,
  required because PostHog collects data beyond the SDK events.
- ✅ **No custom fullscreen button, no cross-promotion** — neither exists in this build.

### End-to-end playthrough (packaged build, all six endings)

Every level was played to its ending in the **packaged `dist-crazygames/` build** served
over HTTP, driven headlessly through the real UI (no game code modified, no engine hooks
added — navigation came from the deterministic maze solution, hazards from the engine's own
JUMP!/DUCK! cue window):

| Level | Ending type | Result | Win cue |
|---|---|---|---|
| 1 · The Winding Halls | `door` | LEVEL COMPLETE | ESCAPE! |
| 2 · Whispering Blades | `door` | LEVEL COMPLETE | ESCAPE! |
| 3 · The Sunken Deep | `door` | LEVEL COMPLETE | ESCAPE! |
| 4 · The Lion's Maw | `door` | LEVEL COMPLETE | ESCAPE! |
| 5 · The Syamantaka Gem | `artifact` | THE GEM IS YOURS | THE SYAMANTAKA GEM! |
| 6 · Into Daylight | `exit` | YOU ESCAPED THE TEMPLE (campaign complete) | DAYLIGHT! |

No HTTP 4xx/5xx and no page errors in any run. The L5 gem-claim beat (relic prop, sunburst
clip, Mira's `lift` animation, chamber seal) and the L6 daylight escape both render — these
are exactly the paths that were broken before, since every asset they need was missing from
the old build manifest.

### Small-iframe layout (desktop non-fullscreen)

The intro panel is taller than the smallest iframes CrazyGames serves, and it had no
scroll container — so at **821×462 and 907×510 (both listed desktop non-fullscreen sizes)
the ▶ Play button rendered entirely below the fold**, and at 1077×606 the consent banner
covered it. A reviewer at those sizes had no way to start the game: a direct fail of
"land new users in gameplay — max 1 click".

Fixed by capping the panel to the viewport (less a gutter for the fixed consent banner),
scrolling only the story block, and pinning the CTA as a footer. Verified — the primary
button is both on-screen and hit-testable at every size:

| Size | Intro ▶ Play | Study GO |
|---|---|---|
| 821×462 · 907×510 · 1077×606 · 1216×684 · 1280×720 · 800×450 | on-screen + clickable | on-screen + clickable |

Intro → study → running gameplay smoke-tested at 821×462 and 1280×720: no page errors,
no 4xx/5xx.

### Open items
- ⚠️ **Mobile-homepage tier (≤20 MB initial download)** — currently 25.7 MB, so the game
  qualifies for launch (≤50 MB) but **not** for the mobile homepage. Largest items:
  `audio/music_chase.mp3` 5.1 MB (256 kb/s stereo, 2:14 — re-encoding to ~112 kb/s saves
  ~3 MB with no audible loss on a background loop), `gem_claim.webm` 1.2 MB +
  `gem_claim.mp4` 1.1 MB (both kept for codec coverage), then the wall/floor textures.
  Getting under 20 MB needs the music re-encode **and** a texture pass.
- ⚠️ **Cover art review** — the blue gem on the covers reads as a generic stock/emoji icon
  against the photoreal art. Cover guidelines ask for consistent visuals and no store/app
  icons; worth redrawing before upload.
- ✅ **Refresh-rate consistency** — the frame loop is delta-timed
  (`dt = Math.min(50, rawMs) / 1000`) and every sim step integrates `dt`, so 144/165 Hz
  monitors run the same pacing. (Camera smoothing uses `Math.min(1, dt*k)` lerps, which
  are approximate at extreme rates — cosmetic only, no effect on physics or the timer.)
- ⚠️ **Still needs a human** — frame rate on a 4 GB Chromebook, and a Safari pass.
- ℹ️ **AZERTY** — WASD is not mapped to ZQSD. Arrow keys work, so this is a quality
  guideline rather than a blocker.
- ℹ️ **Sitelock** — not implemented. The docs describe it as optional ("you *might*
  implement a sitelock").
- ℹ️ **Bundle split** — PostHog is bundled into the single 761 KB (218 KB gzip) JS chunk.
  Dynamic-importing it would shorten the path to first frame.

## Key files
- `src/games/temple/crazygames/sdk.js` — guarded SDK v3 wrapper: `initSdk` / `whenReady` /
  `gameplayStart` / `gameplayStop` / `midgameAd` / `rewardedAd` / `getSettings` /
  `onSettingsChange` / `happytime`.
- `src/games/temple/ui/TempleDash.jsx` — event wiring + the mute policy
  (player toggle ∨ portal `muteAudio` ∨ ad-playing).
- `src/crazygames-main.jsx` — standalone entry: renders only `<TempleDash />` + `<ConsentNotice />`.
- `crazygames.html` — sets `window.__CRAZYGAMES__`, loads the SDK, `user-select:none`.
- `vite.crazygames.config.js` — `base:'./'`, curated asset allowlist (fails the build on a
  missing file), `index.html` rename, size report.
