// ===========================================================================
// GAME CONFIG
// ---------------------------------------------------------------------------
// Central tunables. The game is TIMED, not lives-based: no health system.
//
// >>> TO CHANGE WORKOUT DURATIONS: edit DURATION_PRESETS / DEFAULT_DURATION <<<
// ===========================================================================

/** Selectable workout durations (seconds) shown on the StartScreen. */
export const DURATION_PRESETS = [60, 120, 180, 300];

/** Default selected duration (seconds). 180 = the "3-minute onslaught". */
export const DEFAULT_DURATION = 180;

/** Default bodyweight (kg) used for the kcal estimate. */
export const DEFAULT_BODYWEIGHT_KG = 70;

// --- Player render mode (PLUGGABLE) ---------------------------------------
// How the *player* is drawn. The render layer (render/pixiScene.js) branches
// on this so the live look can be swapped without rewriting the scene.
//
//   'webcam-fx' (DEFAULT) — the live, mirrored webcam fills the stage and the
//                glowing energy effects (fist orbs, live pose-skeleton overlay,
//                aura, punch bursts, shield arc) are tracked to the pose
//                landmarks. This
//                is the "it's really me" look. In demo mode (no camera) it
//                shows a dim silhouette placeholder + simulated moving fists.
//   'skeleton'  — draws the live stick-figure straight from the landmarks over
//                the webcam (debug / minimalist look).
//   'sprite'    — the legacy static boxer-sprite path (a "skin" not rigged to
//                pose). Kept for reference; no longer the default fighter.
export const PLAYER_RENDER_MODES = ['webcam-fx', 'skeleton', 'sprite'];

/** Active player render mode. Change this one value to switch the look. */
export const PLAYER_RENDER_MODE = 'webcam-fx';

// --- Calorie model ---------------------------------------------------------
// kcal = MET * 3.5 * weightKg / 200 (per minute), accumulated over elapsed time.
// We blend a baseline MET with a bonus driven by recent activity (moves/min).
export const CALORIES = {
  baseMET: 6.0,        // moderate boxing-style activity
  activeMET: 9.0,      // sustained vigorous bursts
  // Fraction of activeMET applied scales with normalized recent move rate.
};

// --- Spawn pacing + DIFFICULTY RAMP ----------------------------------------
// The session ramps from a slow start to a frantic finish. Both spawn RATE and
// demon SPEED interpolate by progress = min(1, elapsed / (rampSeconds*1000)):
//   interval = initialIntervalMs -> minIntervalMs   (faster spawns)
//   speed    = initialSpeedScale -> maxSpeedScale   (faster demons)
export const SPAWN = {
  initialIntervalMs: 1700,   // gap between spawns at game start (slow)
  minIntervalMs: 520,        // hardest pacing late game (frantic)
  rampSeconds: 110,          // time over which difficulty ramps to max
  maxConcurrentDemons: 8,    // soft cap on demons alive at once
  initialSpeedScale: 0.7,    // demon drift speed multiplier at start
  maxSpeedScale: 2.1,        // demon drift speed multiplier at peak
};

// --- Collision / hit feel --------------------------------------------------
// A CONNECT requires a *punching* fist to overlap a demon's circular hitbox.
export const COLLISION = {
  fistRadius: 0.05,          // normalized radius of the fist's strike zone
  punchWindowMs: 170,        // how long a fist stays "live" after a punch fires
  perDemonCooldownMs: 300,   // one thrust = at most one connect per demon
};

// --- Combo rules -----------------------------------------------------------
export const COMBO = {
  windowMs: 2500,            // forgiving time after a CONNECT to keep the chain
  maxMultiplier: 12,         // matches the mockup "×8..×12" feel
  // score per connect = (demon.points / demon.hitsToKill) * min(combo, max)
};

// --- Instant-replay capture ------------------------------------------------
// Rolling buffer that composites the live webcam + the transparent Pixi canvas
// into a single offscreen canvas, recorded via MediaRecorder. See
// recording/replayBuffer.js. Sharing is handled by the separate src/sharing/.
export const REPLAY = {
  windowMs: 10000,        // keep ~the last 10 seconds
  timesliceMs: 1000,      // MediaRecorder emits one chunk per second
  fps: 30,                // captureStream frame rate
  mirror: true,           // mirror the webcam frame to match the on-screen selfie
};

/** Resolve a runtime config object for a given chosen duration. */
export function makeRunConfig({ durationSec = DEFAULT_DURATION, bodyweightKg = DEFAULT_BODYWEIGHT_KG } = {}) {
  return {
    durationSec,
    bodyweightKg,
    calories: CALORIES,
    spawn: SPAWN,
    collision: COLLISION,
    combo: COMBO,
    playerRenderMode: PLAYER_RENDER_MODE,
  };
}
