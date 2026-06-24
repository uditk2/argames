// ===========================================================================
// Keeper (AR goalkeeping) — CONFIG (single source of tunables).
// ---------------------------------------------------------------------------
// Everything that tunes feel lives here so the engine + UI stay declarative.
// The engine (engine/) is framework-free and reads ONLY these numbers; the UI
// renders engine state and feeds it pose landmarks.
//
// LEVEL-CLEARANCE MODEL (no lives)
//   Each level presents a FIXED number of shots (SHOTS_PER_LEVEL).
//   To CLEAR a level you must save at least 60% of that level's shots
//     (threshold = ceil(0.6 * SHOTS_PER_LEVEL)). Clear → advance to the next.
//   If you fall below the threshold by the end of the level — or it becomes
//   mathematically impossible to reach it in the remaining shots — the run ENDS.
//   SCORE = number of levels CLEARED (higher is better, leaderboard metric).
//   Each level makes the ball (a) FASTER (shorter flight), (b) CURVE more, and
//   the GOAL WIDER while the KEEPER's reach/size SHRINKS — so it ramps up.
//
// KEEPER REACH (the player must MOVE — conservative on purpose)
//   The standing skeleton is scaled to a FRACTION of the goal so a still pose
//   can't blanket it; you have to reach and lean-dive to cover the corners.
//   Reach + lean shrink with level (see levelCurve) so corners get harder.
// ===========================================================================

// Single global board (no difficulty buckets) — like Monster Punch.
export const KEEPER_LEVEL = 'DEFAULT';

// --- keeper reach / dive (DELIBERATELY conservative — player must move) ------
export const KEEPER = {
  // How far the scaled skeleton spans vs. the goal mouth. <1 means a standing
  // pose does NOT fill the goal, so corners require an active reach/dive.
  // NOTE: REACH_SCALE / LEAN_AMP here are the LEVEL-1 BASE values. The engine /
  // geometry consume levelCurve(level).reach + .leanAmp, which SHRINK with level.
  REACH_SCALE: 0.82,        // body-extent multiplier across the goal (BASE_REACH; shrinks per level) — standing leaves a gap from the posts
  REACH_SCALE_Y: 0.82,      // vertical extent multiplier (legs/torso reach down) — gap from crossbar/ground too
  LEAN_AMP: 2.0,            // how far a hip-lean dives across the goal (BASE_LEAN; shrinks per level) — bigger so you can still reach corners by diving
  LEAN_RECENTER: 0.05,      // per-frame recentre toward your standing base between shots (0..1)

  // Save hit radii as a FRACTION of stage height (limbs are capsules, the torso
  // is a filled polygon). Smaller = you must be more precise.
  LIMB_R_FRAC: 0.040,
  GLOVE_R_FRAC: 0.046,
  HEAD_R_FRAC: 0.050,

  // Visibility floor for a landmark to count toward a save / to be drawn.
  VIS_MIN: 0.2,
};

// --- goal geometry (fractions of stage) --------------------------------------
// The goal is centered. Its WIDTH grows with level (see levelCurve). Height is
// fixed; x-span is derived from the current width fraction.
export const GOAL = {
  WIDTH_FRAC_BASE: 0.52,    // goal-mouth width as a fraction of stage width at level 1
  WIDTH_FRAC_MAX: 0.90,     // cap so it never exceeds the frame
  Y0_FRAC: 0.12,            // crossbar
  Y1_FRAC: 0.90,            // goal line (where saves are judged)
  BALL_START_Y_FRAC: 0.42,  // ball spawns mid-goal (far away) and grows toward the line
};

// --- ball physics ------------------------------------------------------------
export const BALL = {
  R0_FRAC: 0.012,           // far (spawn) radius as a fraction of stage height
  R1_FRAC: 0.050,           // near (at-line) radius
  WINDUP_S: [0.45, 0.75],   // telegraph time range before the ball flies
  RESOLVE_HOLD_MS: 850,     // banner hold after a save/goal before the next shot
  NEXT_DELAY_MS: 650,       // gap between shots
  // On a SAVE the ball ricochets off the keeper for a brief, readable beat so
  // contact is visible before the next shot. Kept short so pacing barely moves.
  DEFLECT_S: 0.42,          // duration of the ball-bounces-off-body deflect state
  DEFLECT_SPEED_FRAC: 0.55, // initial deflect speed as a fraction of stage height / sec
  DEFLECT_GRAVITY_FRAC: 0.9,// downward pull during the deflect (fraction of H / sec^2)
};

// --- level-clearance model + difficulty ramp ---------------------------------
// Each level is a fixed block of SHOTS_PER_LEVEL shots; clear it by saving
// >= 60% of them. Difficulty climbs gently every level (see levelCurve).
export const RAMP = {
  SHOTS_PER_LEVEL: 6,       // fixed number of shots presented each level
  CLEAR_FRAC: 0.6,          // fraction of a level's shots you must save to clear

  // Flight time (seconds) shrinks with level -> faster shots.
  //   flightT = max(FLIGHT_MIN, FLIGHT_BASE - FLIGHT_STEP*n),  n = level-1
  FLIGHT_BASE: 1.00,
  FLIGHT_STEP: 0.06,
  FLIGHT_MIN: 0.50,

  // Lateral curve (swerve) grows with level. Expressed as a fraction of goal
  // width the ball drifts sideways across its flight (sinusoidal mid-flight bow).
  //   curve = min(CURVE_MAX, CURVE_BASE + CURVE_STEP*n)
  CURVE_BASE: 0.05,
  CURVE_STEP: 0.05,
  CURVE_MAX: 0.45,

  // Goal width fraction grows with level -> more area to cover.
  //   widthFrac = min(WIDTH_MAX, WIDTH_BASE + WIDTH_STEP*n)
  WIDTH_BASE: 0.52,
  WIDTH_STEP: 0.04,
  WIDTH_MAX: 0.90,

  // Keeper reach/size + lean SHRINK with level (the player's coverage shrinks).
  //   reach   = max(REACH_MIN, BASE_REACH - REACH_STEP*n)
  //   leanAmp = max(LEAN_MIN,  BASE_LEAN  - LEAN_STEP*n)
  REACH_STEP: 0.025,
  REACH_MIN: 0.80,
  LEAN_STEP: 0.04,
  LEAN_MIN: 1.30,

  // Aim: probability the shooter targets a CORNER (vs. a softer central shot).
  // Climbs with level so higher levels punish a standing keeper harder.
  CORNER_BASE: 0.40,
  CORNER_STEP: 0.06,
  CORNER_MAX: 0.90,
};

/** Saves required to clear a level (60% of its shots, rounded up). */
export const CLEAR_THRESHOLD = Math.ceil(RAMP.CLEAR_FRAC * RAMP.SHOTS_PER_LEVEL);

/**
 * Pure level-curve resolver. Given a 1-based level, returns the tuned shot +
 * keeper parameters. No DOM, no randomness — unit-testable. Progressive, gentle,
 * with caps. n = level - 1.
 *
 *   widthFrac  = min(0.90, 0.52 + 0.04*n)   goal mouth expands a little each level
 *   reach      = max(0.80, BASE_REACH - 0.025*n)  keeper body/reach shrinks
 *   leanAmp    = max(1.30, BASE_LEAN  - 0.04*n)   dive amplitude shrinks
 *   flightT    = max(0.50, 1.00 - 0.06*n)    ball flies faster each level
 *   curve      = min(0.45, 0.05 + 0.05*n)    ball swerves more
 *   cornerProb = min(0.90, 0.40 + 0.06*n)    aims at corners more
 *
 * @param {number} level 1-based current level
 * @returns {{ level:number, flightT:number, curve:number, widthFrac:number,
 *            reach:number, leanAmp:number, cornerProb:number }}
 */
export function levelCurve(level) {
  const L = Math.max(1, Math.floor(level));
  const n = L - 1;
  const flightT = Math.max(RAMP.FLIGHT_MIN, RAMP.FLIGHT_BASE - RAMP.FLIGHT_STEP * n);
  const curve = Math.min(RAMP.CURVE_MAX, RAMP.CURVE_BASE + RAMP.CURVE_STEP * n);
  const widthFrac = Math.min(RAMP.WIDTH_MAX, RAMP.WIDTH_BASE + RAMP.WIDTH_STEP * n);
  const reach = Math.max(RAMP.REACH_MIN, KEEPER.REACH_SCALE - RAMP.REACH_STEP * n);
  const leanAmp = Math.max(RAMP.LEAN_MIN, KEEPER.LEAN_AMP - RAMP.LEAN_STEP * n);
  const cornerProb = Math.min(RAMP.CORNER_MAX, RAMP.CORNER_BASE + RAMP.CORNER_STEP * n);
  return { level: L, flightT, curve, widthFrac, reach, leanAmp, cornerProb };
}

// MediaPipe Pose (loaded from CDN at runtime) — same bundle the other games use.
export const MP = {
  TV:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35',
  POSE: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

// Pose skeleton wiring (MediaPipe indices) used to scale the keeper to the goal.
export const KSEG = [
  [16, 14], [14, 12], [15, 13], [13, 11],            // arms
  [12, 11], [24, 23], [12, 24], [11, 23],            // torso box
  [24, 26], [26, 28], [28, 32], [23, 25], [25, 27], [27, 31], // legs
];
// Capsules used for save detection (limbs + torso edges).
export const SAVE_CAPS = [
  [16, 14], [14, 12], [15, 13], [13, 11],
  [24, 26], [26, 28], [28, 32], [23, 25], [25, 27], [27, 31],
  [12, 11], [24, 23],
];
export const GLOVE_LM = [15, 16];   // wrists
export const HEAD_LM = 0;
export const TORSO_POLY = [11, 12, 24, 23];   // shoulders -> hips quad

export default {
  KEEPER_LEVEL, KEEPER, GOAL, BALL, RAMP, CLEAR_THRESHOLD, levelCurve, MP,
  KSEG, SAVE_CAPS, GLOVE_LM, HEAD_LM, TORSO_POLY,
};
