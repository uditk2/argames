// ===========================================================================
// TIMER — countdown from the configured duration. Pure.
// ===========================================================================

/**
 * Advance the countdown. Returns true once the timer has just reached zero.
 * @param {object} state
 * @param {number} dtMs delta time for this tick
 */
export function tickTimer(state, dtMs) {
  if (state.phase !== 'running') return false;
  state.elapsedMs += dtMs;
  state.timeLeftMs = Math.max(0, state.timeLeftMs - dtMs);
  if (state.timeLeftMs <= 0) {
    state.phase = 'finished';
    return true;
  }
  return false;
}

/** Format ms as M:SS for the HUD. */
export function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Progress 0..1 of how much time has elapsed (for the timer bar). */
export function timerProgress(state) {
  const totalMs = state.config.durationSec * 1000;
  return totalMs ? state.elapsedMs / totalMs : 0;
}
