// ===========================================================================
// DODGE / JUMP DETECTOR — REMOVED from the active pipeline.
// ---------------------------------------------------------------------------
// The hip-based jump/dodge signal proved unreliable and was cut. This module
// is intentionally left as a no-op stub (no longer imported anywhere) so any
// stray reference won't crash. A jumping-jack mechanic will be added later via
// its own detector — do NOT revive this one.
// ===========================================================================

/** No-op detector kept for backwards-compat; emits nothing. */
export function createDodgeDetector() {
  return {
    detect() {
      return [];
    },
  };
}
