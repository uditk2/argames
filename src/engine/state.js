// ===========================================================================
// GAME STATE  (pure data, NO DOM / React)
// ---------------------------------------------------------------------------
// A single mutable snapshot the engine updates each tick. The render layer and
// React read it; they never write game logic into it. This keeps the data flow
// one-directional: vision -> moves -> engine -> render/ui.
// ===========================================================================

/** @typedef {'idle'|'running'|'finished'} Phase */

export function createInitialState(runConfig) {
  return {
    phase: /** @type {Phase} */ ('idle'),
    config: runConfig,

    // Timer
    timeLeftMs: runConfig.durationSec * 1000,
    elapsedMs: 0,

    // Scoring
    score: 0,
    slain: 0,
    kcal: 0,
    combo: 0,
    bestCombo: 0,
    lastKillAt: 0,            // ms timestamp of last KILL (legacy sprite FX)
    lastConnectAt: 0,         // ms timestamp of last CONNECT (drives combo window)

    // Player condition (timed game: no health system)
    stunnedUntil: 0,         // retained as a harmless 0 for the legacy sprite path
    shielding: false,

    // Live fist positions (normalized 0..1, mirrored/display space) fed in each
    // tick by the host. Collision tests a *punching* fist against demon hitboxes.
    // null when that wrist isn't tracked. `*Punching` is set true for a short
    // window when the punch detector fires for that side (see gameLoop).
    fists: {
      left: null,            // {x,y} | null
      right: null,           // {x,y} | null
      leftPunchingUntil: 0,  // ms timestamp; left fist is "live" until then
      rightPunchingUntil: 0,
    },

    // Live entities (plain objects; see entities/*)
    demons: [],

    // FX events queued for the render layer to consume each frame.
    // Each: { type:'hit'|'kill', uid, x, y, kill, demonSize, hitsRemaining,
    //         hitsToKill, t } | { type:'shield', x, y, t }
    fxQueue: [],

    // Activity tracking for the calorie model (rolling move timestamps).
    moveTimestamps: [],

    // Stats for the results screen
    punches: 0,
    blocks: 0,
  };
}

/**
 * Update the live fist positions the collision system reads each tick.
 * Null-safe: pass null for an untracked wrist. (Called by the host every frame.)
 * @param {object} state
 * @param {{x:number,y:number}|null} left
 * @param {{x:number,y:number}|null} right
 */
export function setFists(state, left, right) {
  state.fists.left = left || null;
  state.fists.right = right || null;
}

/** Push an FX event for the renderer to pick up. */
export function emitFx(state, fx) {
  state.fxQueue.push({ ...fx, t: fx.t ?? performance.now() });
  // Keep the queue bounded so a stalled renderer can't leak memory.
  if (state.fxQueue.length > 64) state.fxQueue.splice(0, state.fxQueue.length - 64);
}

/** Drain and return all queued FX (renderer calls this once per frame). */
export function drainFx(state) {
  const out = state.fxQueue;
  state.fxQueue = [];
  return out;
}
