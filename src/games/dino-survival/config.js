// ===========================================================================
// Dino Survival — CONFIG (single source of tunables).
// ---------------------------------------------------------------------------
// Difficulty = how fast the dino ramps (d0, r) + how small your starting lead
// is (g0) + race length (goal). Tuned from an offline survival simulation.
// (Score is escape TIME + personal best — no tier badges.)
// ===========================================================================

// Single difficulty — Impossible. (Easy/Medium/Hard removed.)
export const LEVELS = {
  IMPOSSIBLE: { key: 'IMPOSSIBLE', label: 'Impossible', goal: 50, d0: 0.66, r: 0.0065, kGain: 0.06, g0: 0.30 },
};
export const DEFAULT_LEVEL = 'IMPOSSIBLE';

// Global dino-speed multiplier — the single knob to tune the whole chase up/down
// across all levels (1 = as tuned; >1 = faster/harder dino, <1 = slower/easier).
export const DINO_SPEED_SCALE = 1.0;

// Ground-plane fractions of stage height, tuned to the trail backdrop: where
// the trail's front (your feet) and far/vanishing point sit.
export const GROUND_FRAC = 0.90;
export const TRAIL_TOP_FRAC = 0.48;

// World/feel tunables.
export const SCROLL_SPEED = 0.007;     // how fast the ground flows per unit pace
export const PLAYER_TORSO_FRAC = 0.14; // target on-screen torso height (player size normalisation)

// Asset URLs (served from /public). trail.png is the intro/ambient image + a
// fallback if the bg loop frames haven't loaded. (Jeep + dino-lunge stills are
// gone — escape/catch are video cutscenes now.)
export const ASSET_SRC = {
  bgTrail: '/assets/dino-survival/bg/trail.png',
};

// Real gallop frames extracted from a Grok image-to-video clip (green-keyed,
// watermark-stripped, registered). Temporally consistent => smooth cycling.
export const DINO_RUN_FRAMES = Array.from({ length: 16 }, (_, i) =>
  `/assets/dino-survival/cut/dino_run_${String(i).padStart(2, '0')}.png`);

// Seamless forward-dolly trail loop (Grok), extracted to frames. We index INTO
// these by accumulated distance so the world freezes when you stop and advances
// as you run — no <video> (lighter on mobile, exact stop-on-stop).
export const BG_LOOP_FRAMES = Array.from({ length: 40 }, (_, i) =>
  `/assets/dino-survival/bg/trail_loop_seq/bg_${String(i + 1).padStart(3, '0')}.jpg`);

// Player avatar: one dense run-cycle stride cut from a runner clip (rembg), plus
// its per-frame MediaPipe rig (rig.json). Played by cadence; replaces the live
// segmentation cutout (much lighter on mobile — no per-frame ML segmentation).
export const RUNNER_FRAMES = Array.from({ length: 40 }, (_, i) =>
  `/assets/dino-survival/cut/runner/run_${String(i).padStart(2, '0')}.png`);
export const RUNNER_RIG_URL = '/assets/dino-survival/cut/runner/rig.json';
export const RUNNER_IDLE_FRAME = 29;   // most 'standing' frame (feet together) — shown when idle / off-pose
export const RUNNER_OFF_DIST = 5.0;    // pose-match distance above which we treat you as 'off-pose' (not running) -> stand
// Clean single-stride loop inside the library (frames 5..11 match endpoints) — used
// for the timer-driven run cycle so it loops SEAMLESSLY (the full 40 frames span
// several strides and would jump at the wrap). Pose-matching still uses all frames.
export const RUNNER_RUN_START = 5;
export const RUNNER_RUN_LEN = 7;

// MediaPipe Pose (loaded from CDN at runtime). Segmentation removed — the avatar
// is a baked sprite now, so we only run pose for control/cadence.
export const MP = {
  TV:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35',
  POSE: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
