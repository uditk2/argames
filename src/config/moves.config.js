// ===========================================================================
// MOVE DETECTION CONFIG
// ---------------------------------------------------------------------------
// Tunable thresholds for the pure pose-move detectors in src/moves/*.
// All detectors take normalized MediaPipe landmarks (x,y in 0..1) and these
// thresholds — keeping the detectors themselves free of magic numbers.
//
// MediaPipe Pose landmark indices used:
//   0 nose, 11 L-shoulder, 12 R-shoulder, 13 L-elbow, 14 R-elbow,
//   15 L-wrist, 16 R-wrist, 23 L-hip, 24 R-hip, 25 L-knee, 26 R-knee
// ===========================================================================

export const MOVE_THRESHOLDS = {
  // Minimum landmark visibility to trust a point (MediaPipe `visibility`).
  minVisibility: 0.5,

  punch: {
    // A punch = wrist velocity (normalized units / sec) crossing the shoulder
    // line outward fast enough, then retracting.
    minExtension: 0.18,     // wrist must be this far from shoulder (x or y)
    minVelocity: 1.2,       // normalized units per second
    cooldownMs: 280,        // per-arm debounce
  },

  shield: {
    // Shield = both wrists raised above shoulders and roughly in front (arms up).
    wristAboveShoulderBy: 0.04,   // wrist.y must be this much above shoulder.y
    bothArms: true,
    holdMs: 120,            // must hold briefly to register
  },
};
