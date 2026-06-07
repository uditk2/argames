// ===========================================================================
// Demon entity — plain data + tiny helpers. Built FROM the demon registry,
// never hardcoded. Position is in normalized stage space (0..1) so the render
// layer can map to whatever canvas size it has.
// ===========================================================================

let _id = 0;

/**
 * @param {object} type  a demon definition from config/demons.js
 * @param {object} opts  { x, y } normalized spawn position
 */
export function createDemon(type, { x, y }) {
  return {
    uid: `demon_${_id++}`,
    typeId: type.id,
    frames: type.frames,
    size: type.size,
    points: type.points,
    hitsRemaining: type.hitsToKill,
    x, y,                 // normalized 0..1
    vx: (Math.random() - 0.5) * 0.01,
    vy: (Math.random() - 0.5) * 0.006,
    bobPhase: Math.random() * Math.PI * 2,
    frame: 0,
    frameTimer: 0,
    dead: false,
    flashUntil: 0,        // set on hit, render shows a flash
  };
}

/** Advance a demon's float/bob motion and flap animation. */
export function updateDemon(demon, dtMs) {
  demon.x += demon.vx * (dtMs / 16.67);
  demon.bobPhase += dtMs / 600;
  demon.y += Math.sin(demon.bobPhase) * 0.0006;

  // Keep demons loosely on-screen by bouncing horizontally.
  if (demon.x < 0.08 || demon.x > 0.92) demon.vx *= -1;
  demon.x = Math.min(0.95, Math.max(0.05, demon.x));
  demon.y = Math.min(0.7, Math.max(0.08, demon.y));

  demon.frameTimer += dtMs;
  if (demon.frameTimer > 160) {
    demon.frameTimer = 0;
    demon.frame = (demon.frame + 1) % demon.frames.length;
  }
}

/** Apply one hit. Returns true if this hit killed the demon. */
export function hitDemon(demon, now) {
  demon.hitsRemaining -= 1;
  demon.flashUntil = now + 120;
  if (demon.hitsRemaining <= 0) {
    demon.dead = true;
    return true;
  }
  return false;
}
