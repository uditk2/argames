// ===========================================================================
// SCORING — score, combo and calorie accumulation. Pure.
// ===========================================================================

/**
 * Register a demon kill: bump combo (respecting the combo window), add
 * weighted score, increment slain count.
 * @returns {number} points awarded
 */
export function registerKill(state, demon, now) {
  const { combo: comboCfg } = state.config;

  // Maintain the combo chain only if we're inside the window.
  if (now - state.lastKillAt <= comboCfg.windowMs) {
    state.combo = Math.min(state.combo + 1, comboCfg.maxMultiplier);
  } else {
    state.combo = 1;
  }
  state.lastKillAt = now;
  state.bestCombo = Math.max(state.bestCombo, state.combo);

  const points = Math.round(demon.points * state.combo);
  state.score += points;
  state.slain += 1;
  return points;
}

/** Break the combo chain (currently unused; kept for future penalties). */
export function breakCombo(state) {
  state.combo = 0;
}

/** Expire the combo if the window has lapsed (called each tick). */
export function tickCombo(state, now) {
  if (state.combo > 0 && now - state.lastKillAt > state.config.combo.windowMs) {
    state.combo = 0;
  }
}

/**
 * Accumulate calories using the MET formula, blending baseline and active MET
 * based on the player's recent move rate.
 *   kcal/min = MET * 3.5 * weightKg / 200
 */
export function tickCalories(state, dtMs, now) {
  const { calories, bodyweightKg } = state.config;

  // Recent move rate over the last 10s -> 0..1 intensity.
  const windowMs = 10000;
  state.moveTimestamps = state.moveTimestamps.filter((t) => now - t <= windowMs);
  const movesPerSec = state.moveTimestamps.length / (windowMs / 1000);
  const intensity = Math.min(1, movesPerSec / 1.5); // ~1.5 moves/s = full intensity

  const met = calories.baseMET + (calories.activeMET - calories.baseMET) * intensity;
  const kcalPerMin = (met * 3.5 * bodyweightKg) / 200;
  state.kcal += kcalPerMin * (dtMs / 60000);
}

/** Record that the player performed an effortful move (drives calories). */
export function recordMove(state, now) {
  state.moveTimestamps.push(now);
}
