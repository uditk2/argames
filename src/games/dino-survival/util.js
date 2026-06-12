// ===========================================================================
// Dino Survival — tiny shared math/landmark helpers (pure, no deps).
// ===========================================================================
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const vis = (p, m = 0.5) => p && (p.visibility == null || p.visibility >= m);
export const mid = (a, b) => (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;

// MediaPipe Pose landmark indices used by the detector.
export const LM = { lSh: 11, rSh: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28 };
