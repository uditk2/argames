# Demon Realm — 3-Minute Workout Brawler

A webcam fitness game: stand in front of your camera and **punch demons**, **raise
both arms to shield**, and **jump/squat to dodge ground traps**. It's a *timed*
workout (no health/lives) — survive the onslaught until the countdown hits zero.

Built with **Vite + React + Tailwind**, rendered with **PixiJS**, pose tracking via
**MediaPipe Tasks Vision (Pose Landmarker)**.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build -> dist/
npm run preview  # serve the built bundle
```

**Camera note:** browsers only grant `getUserMedia` over **HTTPS or `localhost`**.
`npm run dev` on localhost works; if you deploy, serve over HTTPS.

**No camera? Use Demo mode.** The StartScreen has a **"Demo mode (no camera)"**
button that drives the game with simulated input — timer, spawning, scoring, combo,
and all visuals run with no webcam. This is what makes the project verifiable on
machines without a camera.

## Architecture (one-directional data flow)

```
vision  ->  moves  ->  engine  ->  render / ui
(pose)     (detect)   (pure sim)    (Pixi + React HUD)
```

The **engine has no DOM/React dependency** — it's pure and testable. React only
mirrors engine state into the HUD each frame.

```
src/
  vision/      poseTracker.js (MediaPipe wrapper -> landmarks), segmenter.js (bg-swap STUB)
  moves/       punch.js, shield.js, dodge.js (pure detectors), moveBus.js (pub/sub)
  engine/      gameLoop.js, spawner.js, scoring.js, timer.js, state.js   (NO DOM)
  entities/    Demon.js, Trap.js
  render/      pixiScene.js, layers/index.js
  recording/   replayBuffer.js (rolling 10s canvas capture; export = TODO)
  analytics/   ga.js (GA4 wrapper; game_started event)
  ui/          App.jsx, screens/{Start,Game,Results}Screen.jsx, hud/{Timer,ScorePanel,ComboMeter,SelfView,ReplayCard}.jsx
  config/      avatars.js, demons.js, game.config.js, moves.config.js
  main.jsx
```

## Customizing (all config-driven — no logic changes needed)

### Swap the avatar
Edit **`src/config/avatars.js`**. Each avatar is `{ id, name, sprites:{idle,punch,block}, scale }`.
Add a new object to the `AVATARS` array (and drop the art into `public/assets/sprites/`),
or change `DEFAULT_AVATAR_ID`. The render layer reads the active avatar from this
registry — no sprite path is hardcoded anywhere else. If you add more than one,
the StartScreen automatically shows an avatar picker.

### Add a demon
Edit **`src/config/demons.js`**. Each type is
`{ id, name, frames:[...], size, hitsToKill, spawnWeight, points }`. Append an object
to `DEMONS`. The spawner picks types weighted by `spawnWeight`; `size` + `hitsToKill`
convey toughness (no numbers shown on demons).

### Change workout durations
Edit **`src/config/game.config.js`**: `DURATION_PRESETS` (the buttons on the
StartScreen) and `DEFAULT_DURATION`. Spawn pacing, combo rules, calorie MET values,
and trap behavior live here too.

### Tune move detection
Edit **`src/config/moves.config.js`** — punch velocity/extension, shield arm-height,
jump/squat thresholds, cooldowns. The detectors in `src/moves/` are pure and read
all thresholds from here.

## Analytics (GA4)
Put your Measurement ID in **`src/analytics/ga.js`** (`MEASUREMENT_ID`, currently the
placeholder `G-XXXXXXXXXX`). Until then events just log to the console. A
`game_started` event fires on every run with `{ duration_sec, mode, avatar_id }`.

## Assets
Served, curated files live in `public/assets/` (referenced by `/assets/...` URLs).
The full raw CC0 library remains in `assets/` and is not bundled. `design-mockup.html`
is the visual reference for the look.

## Known limitations / TODO
- **Background segmentation** (`src/vision/segmenter.js`) is a stub — the player is
  not yet cut out and composited over the realm. Interface is in place.
- **Replay export/share** (`src/recording/replayBuffer.js`) captures a rolling 10s
  clip but `exportClip()` is a TODO; the Results "Share" button is a placeholder.
- The webcam + pose path can't be tested in a headless/no-camera environment — use
  Demo mode there.
