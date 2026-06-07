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
    lastKillAt: 0,            // ms timestamp for combo window

    // Player condition (timed game: no health system)
    stunnedUntil: 0,         // retained as a harmless 0 for the legacy sprite path
    shielding: false,

    // Live entities (plain objects; see entities/*)
    demons: [],

    // FX events queued for the render layer to consume each frame.
    // Each: { type:'hit'|'kill'|'shield', x, y, t }
    fxQueue: [],

    // Activity tracking for the calorie model (rolling move timestamps).
    moveTimestamps: [],

    // Stats for the results screen
    punches: 0,
    blocks: 0,
  };
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
