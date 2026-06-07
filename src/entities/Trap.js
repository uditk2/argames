// ===========================================================================
// Trap entity — a ground hazard the player must JUMP or DODGE before it fires.
// No health system: an un-dodged trap breaks combo + briefly stuns.
// ===========================================================================

let _id = 0;

/**
 * @param {object} opts { x } normalized horizontal position; trap sits on ground
 * @param {object} trapCfg  config.trap (timing)
 * @param {number} now
 */
export function createTrap({ x }, trapCfg, now) {
  return {
    uid: `trap_${_id++}`,
    x,                       // normalized 0..1
    y: 0.9,                  // near the ground
    armedAt: now,
    firesAt: now + trapCfg.activeWindowMs,
    state: 'arming',         // 'arming' | 'fired' | 'cleared'
    resolved: false,
  };
}

/**
 * Update trap; if its window elapses without being dodged it "fires".
 * @returns {'fired'|null} 'fired' when it just punished the player this tick
 */
export function updateTrap(trap, now) {
  if (trap.state !== 'arming') return null;
  if (now >= trap.firesAt) {
    trap.state = 'fired';
    return 'fired';
  }
  return null;
}

/** Player successfully dodged/jumped this trap. */
export function clearTrap(trap) {
  if (trap.state === 'arming') trap.state = 'cleared';
  trap.resolved = true;
}
