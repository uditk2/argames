// ===========================================================================
// GAME LOOP — the pure engine update. NO DOM, NO React, NO rendering.
// ---------------------------------------------------------------------------
// Consumes detected MOVES (from moves/moveBus.js) and advances the simulation.
// The host (GameScreen) calls `step(dtMs)` each animation frame and reads the
// resulting state to render. This keeps the engine fully testable.
// ===========================================================================

import { createInitialState, emitFx, setFists } from './state.js';
import { tickTimer } from './timer.js';
import {
  registerKill,
  registerConnect,
  tickCombo,
  tickCalories,
  recordMove,
} from './scoring.js';
import { createSpawnerState, tickSpawner } from './spawner.js';
import { updateDemon, hitDemon } from '../entities/Demon.js';
import { COLLISION } from '../config/game.config.js';

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

  /**
   * Apply a CONNECT to one demon at a contact point: damage it (knockback +
   * flash), bump combo + score, emit a rich `hit` event, and on death emit a
   * `kill` event. Sets the per-demon connect cooldown so one thrust = one hit
   * per demon. Returns true if a connect happened.
   */
  function connect(demon, now, cx, cy) {
    if (!demon || demon.dead) return false;
    if (now < demon.connectCooldownUntil) return false;
    demon.connectCooldownUntil = now + COLLISION.perDemonCooldownMs;

    const contact = { x: cx, y: cy };
    const killed = hitDemon(demon, now, contact);
    const points = registerConnect(state, demon, now);
    recordMove(state, now);

    emitFx(state, {
      type: 'hit',
      uid: demon.uid,
      x: cx, y: cy,
      kill: killed,
      points,
      combo: state.combo,
      demonSize: demon.size,
      hitsRemaining: demon.hitsRemaining,
      hitsToKill: demon.hitsToKill,
    });
    if (killed) {
      registerKill(state, demon, now);
      emitFx(state, {
        type: 'kill',
        uid: demon.uid,
        x: demon.x, y: demon.y,
        points,
        demonSize: demon.size,
      });
    }
    return true;
  }

  /**
   * A `punch` move marks that arm's fist "live" for a short window. The actual
   * damage happens in resolveCollisions() only if a live fist OVERLAPS a demon.
   * Backwards-compat: a payload with an explicit `uid` (demo click-to-punch)
   * connects that demon directly so click testing still works.
   */
  function handlePunch(payload, now) {
    state.punches += 1;
    const side = payload?.side;
    if (side === 'left') state.fists.leftPunchingUntil = now + COLLISION.punchWindowMs;
    else if (side === 'right') state.fists.rightPunchingUntil = now + COLLISION.punchWindowMs;
    else {
      // Unknown side: arm both so a payload-targeted/collision hit can land.
      state.fists.leftPunchingUntil = now + COLLISION.punchWindowMs;
      state.fists.rightPunchingUntil = now + COLLISION.punchWindowMs;
    }
    // Direct-target fallback (demo click): connect the named demon immediately.
    if (payload?.uid) {
      const target = state.demons.find((d) => d.uid === payload.uid && !d.dead);
      if (target) connect(target, now, target.x, target.y);
    }
  }

  /**
   * SPATIAL COLLISION: each live (punching) fist is tested against every demon.
   * A connect requires the fist to be inside the demon's circular hitbox.
   * Per-demon cooldown (inside connect()) prevents multi-registration.
   */
  function resolveCollisions(now) {
    const f = state.fists;
    const sides = [
      { pos: f.left, live: now < f.leftPunchingUntil },
      { pos: f.right, live: now < f.rightPunchingUntil },
    ];
    for (const { pos, live } of sides) {
      if (!live || !pos) continue;
      for (const d of state.demons) {
        if (d.dead) continue;
        const dx = d.x - pos.x;
        const dy = d.y - pos.y;
        const reach = d.radius + COLLISION.fistRadius;
        if (dx * dx + dy * dy <= reach * reach) {
          // Contact point: bias toward the fist so the burst reads "on impact".
          const cx = (pos.x + d.x) / 2;
          const cy = (pos.y + d.y) / 2;
          connect(d, now, cx, cy);
        }
      }
    }
  }

  function drainMoves(now) {
    for (const move of moveQueue) {
      if (state.phase !== 'running') break;
      switch (move.type) {
        case 'punch':
          handlePunch(move.payload, now);
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

    // Arm fists from punch moves (and apply demo click-to-punch).
    drainMoves(now);

    // Spawning + entity motion BEFORE collision so fists test current positions.
    tickSpawner(state, spawner, dtMs, now);
    for (const d of state.demons) updateDemon(d, dtMs);

    // SPATIAL COLLISION: live fists vs demon hitboxes -> connects.
    resolveCollisions(now);

    // Cull dead demons
    state.demons = state.demons.filter((d) => !d.dead);

    // Scoring upkeep
    tickCombo(state, now);
    tickCalories(state, dtMs, now);

    // Timer last so the finish flag is fresh for the caller
    return tickTimer(state, dtMs);
  }

  /** Host pushes the latest (mirrored, normalized) wrist positions each frame. */
  function updateFists(left, right) {
    setFists(state, left, right);
  }

  return { state, start, step, enqueueMove, setFists: updateFists };
}
