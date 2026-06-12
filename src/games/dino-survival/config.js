// ===========================================================================
// Dino Survival — CONFIG (single source of tunables).
// ---------------------------------------------------------------------------
// Difficulty = how fast the dino ramps (d0, r) + how small your starting lead
// is (g0) + race length (goal). Tuned from an offline survival simulation.
// (Score is escape TIME + personal best — no tier badges.)
// ===========================================================================

export const LEVELS = {
  EASY:       { key: 'EASY',       label: 'Easy',       goal: 38, d0: 0.38, r: 0.0030, kGain: 0.06, g0: 0.62 },
  MEDIUM:     { key: 'MEDIUM',     label: 'Medium',     goal: 42, d0: 0.45, r: 0.0040, kGain: 0.06, g0: 0.50 },
  HARD:       { key: 'HARD',       label: 'Hard',       goal: 46, d0: 0.55, r: 0.0052, kGain: 0.06, g0: 0.40 },
  IMPOSSIBLE: { key: 'IMPOSSIBLE', label: 'Impossible', goal: 50, d0: 0.66, r: 0.0065, kGain: 0.06, g0: 0.30 },
};
export const DEFAULT_LEVEL = 'MEDIUM';

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

// Asset URLs (served from /public). The keyed, dust-free, checker-free cut-outs.
export const ASSET_SRC = {
  bgTrail:   '/assets/dino-survival/bg/trail.png',
  dinoLunge: '/assets/dino-survival/cut/dino_front_lunge.png',
  jeep:      '/assets/dino-survival/cut/jeep.png',
  jeepSeated:'/assets/dino-survival/cut/jeep_driver_seated.png',
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

// MediaPipe (loaded from CDN at runtime, same as the app's poseTracker).
export const MP = {
  TV:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35',
  POSE: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  SEG:  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
};
