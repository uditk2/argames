// ===========================================================================
// SCORING — score, combo and calorie accumulation. Pure.
// ===========================================================================

/**
 * Register a single CONNECT (a fist landing on a demon). Bumps the combo
 * chain (+1 per connect, capped, resets to 1 after a forgiving window lapses),
 * then awards score = demon.points × current combo. This is the heart of the
 * "every punch counts" loop — combo grows on hits, not only kills.
 * @returns {number} points awarded for this connect
 */
export function registerConnect(state, demon, now) {
  const { combo: comboCfg } = state.config;

  // Keep the chain alive only if we're inside the forgiving window.
  if (state.combo > 0 && now - state.lastConnectAt <= comboCfg.windowMs) {
    state.combo = Math.min(state.combo + 1, comboCfg.maxMultiplier);
  } else {
    state.combo = 1;
  }
  state.lastConnectAt = now;
  state.bestCombo = Math.max(state.bestCombo, state.combo);

  // Per-connect score: a fraction of the demon's value per hit so a 7-hit
  // brute still totals roughly its `points`, scaled by the live combo.
  const perHit = demon.points / Math.max(1, demon.hitsToKill);
  const points = Math.round(perHit * state.combo);
  state.score += points;
  return points;
}

/**
 * Register a demon KILL: bookkeeping only (combo/score already accrued on the
 * killing CONNECT). Bumps slain count and stamps lastKillAt for kill-only FX.
 */
export function registerKill(state, demon, now) {
  state.lastKillAt = now;
  state.slain += 1;
}

/** Break the combo chain (currently unused; kept for future penalties). */
export function breakCombo(state) {
  state.combo = 0;
}

/** Expire the combo if the window has lapsed (called each tick). */
export function tickCombo(state, now) {
  if (state.combo > 0 && now - state.lastConnectAt > state.config.combo.windowMs) {
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
