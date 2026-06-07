// ===========================================================================
// GAME LOOP — the pure engine update. NO DOM, NO React, NO rendering.
// ---------------------------------------------------------------------------
// Consumes detected MOVES (from moves/moveBus.js) and advances the simulation.
// The host (GameScreen) calls `step(dtMs)` each animation frame and reads the
// resulting state to render. This keeps the engine fully testable.
// ===========================================================================

import { createInitialState, emitFx } from './state.js';
import { tickTimer } from './timer.js';
import {
  registerKill,
  tickCombo,
  tickCalories,
  recordMove,
} from './scoring.js';
import { createSpawnerState, tickSpawner } from './spawner.js';
import { updateDemon, hitDemon } from '../entities/Demon.js';

/**
 * Create an engine instance.
 * @param {object} runConfig from config/game.config.js makeRunConfig()
 */
export function createGame(runConfig) {
  const state = createInitialState(runConfig);
  const spawner = createSpawnerState();

  // Pending move intents fed in between ticks (drained each step).
  /** @type {Array<{type:string, payload?:any}>} */
  let moveQueue = [];

  function start() {
    state.phase = 'running';
  }

  /** Feed a detected move into the engine (called by the moveBus subscriber). */
  function enqueueMove(move) {
    moveQueue.push(move);
  }

  /** Find the nearest live demon to a normalized point (for punch targeting). */
  function nearestDemon(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const d of state.demons) {
      if (d.dead) continue;
      const dx = d.x - x;
      const dy = d.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  /** Resolve a punch against the demon field. */
  function resolvePunch(payload, now) {
    state.punches += 1;
    recordMove(state, now);
    // Target: explicit (demo click) or nearest demon to the punching side.
    const tx = payload?.x ?? 0.5;
    const ty = payload?.y ?? 0.35;
    const target = payload?.uid
      ? state.demons.find((d) => d.uid === payload.uid && !d.dead)
      : nearestDemon(tx, ty);
    if (!target) return;
    const killed = hitDemon(target, now);
    emitFx(state, { type: 'hit', x: target.x, y: target.y });
    if (killed) {
      registerKill(state, target, now);
      emitFx(state, { type: 'kill', x: target.x, y: target.y });
    }
  }

  function drainMoves(now) {
    for (const move of moveQueue) {
      if (state.phase !== 'running') break;
      switch (move.type) {
        case 'punch':
          resolvePunch(move.payload, now);
          break;
        case 'shield':
          state.shielding = true;
          state.blocks += 1;
          recordMove(state, now);
          emitFx(state, { type: 'shield', x: 0.5, y: 0.2 });
          break;
        case 'shield-end':
          state.shielding = false;
          break;
        default:
          break;
      }
    }
    moveQueue = [];
  }

  /**
   * Advance the simulation one tick.
   * @param {number} dtMs delta since last step (clamped by caller)
   * @returns {boolean} true on the frame the game finishes
   */
  function step(dtMs) {
    const now = performance.now();
    if (state.phase !== 'running') return false;

    drainMoves(now);

    // Spawning + entity motion
    tickSpawner(state, spawner, dtMs, now);
    for (const d of state.demons) updateDemon(d, dtMs);

    // Cull dead demons
    state.demons = state.demons.filter((d) => !d.dead);

    // Scoring upkeep
    tickCombo(state, now);
    tickCalories(state, dtMs, now);

    // Timer last so the finish flag is fresh for the caller
    return tickTimer(state, dtMs);
  }

  return { state, start, step, enqueueMove };
}
