// ===========================================================================
// SPAWNER — continuous demon stream. Pure.
// Reads demon TYPES from config/demons.js (weighted), respects pacing config.
// ===========================================================================

import { pickDemonType } from '../config/demons.js';
import { createDemon } from '../entities/Demon.js';

/** Internal spawner clock state, kept on the engine (not global). */
export function createSpawnerState() {
  return {
    sinceDemonMs: 0,
    nextDemonInMs: 0,
  };
}

/** Current demon spawn interval, tightening as the run progresses. */
/** Difficulty progress 0..1 over the configured ramp window. */
function rampT(state) {
  const { rampSeconds } = state.config.spawn;
  return Math.min(1, state.elapsedMs / (rampSeconds * 1000));
}

function currentInterval(state) {
  const { initialIntervalMs, minIntervalMs } = state.config.spawn;
  const t = rampT(state);
  return initialIntervalMs + (minIntervalMs - initialIntervalMs) * t;
}

/** Demon drift-speed multiplier, ramping slow start -> frantic finish. */
function currentSpeedScale(state) {
  const { initialSpeedScale = 1, maxSpeedScale = 1 } = state.config.spawn;
  const t = rampT(state);
  return initialSpeedScale + (maxSpeedScale - initialSpeedScale) * t;
}

/**
 * Advance spawning. Mutates state.demons.
 * @param {object} state engine state
 * @param {object} sp spawner state from createSpawnerState()
 * @param {number} dtMs
 * @param {number} now
 */
export function tickSpawner(state, sp, dtMs, now) {
  const { spawn } = state.config;

  // --- Demons ---
  sp.sinceDemonMs += dtMs;
  if (
    sp.sinceDemonMs >= sp.nextDemonInMs &&
    state.demons.length < spawn.maxConcurrentDemons
  ) {
    const type = pickDemonType();
    const demon = createDemon(type, {
      x: 0.15 + Math.random() * 0.7,
      y: 0.12 + Math.random() * 0.4,
    }, currentSpeedScale(state));
    state.demons.push(demon);
    sp.sinceDemonMs = 0;
    sp.nextDemonInMs = currentInterval(state) * (0.8 + Math.random() * 0.4);
  }
}
