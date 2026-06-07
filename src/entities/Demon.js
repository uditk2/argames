// ===========================================================================
// Demon entity — plain data + tiny helpers. Built FROM the demon registry,
// never hardcoded. Position is in normalized stage space (0..1) so the render
// layer can map to whatever canvas size it has.
// ===========================================================================

let _id = 0;

// Map a sprite diameter (px) to a normalized hit radius (fraction of stage
// width). The reference stage is ~900px wide; bigger demons get bigger
// hitboxes. A small floor keeps tiny imps still hittable, and a generous
// multiplier makes "connecting" forgiving (combat should feel good, not fiddly).
export const HIT_REF_WIDTH = 900;
export function radiusForSize(size) {
  return Math.max(0.06, (size / HIT_REF_WIDTH) * 0.78);
}

/**
 * @param {object} type  a demon definition from config/demons.js
 * @param {object} opts  { x, y } normalized spawn position
 * @param {number} speedScale  drift-speed multiplier (ramps with session time)
 */
export function createDemon(type, { x, y }, speedScale = 1) {
  return {
    uid: `demon_${_id++}`,
    typeId: type.id,
    frames: type.frames,
    hitFrame: type.hitFrame || null,
    size: type.size,
    points: type.points,
    hitsToKill: type.hitsToKill,           // immutable max (for HP pips)
    hitsRemaining: type.hitsToKill,
    // Normalized circular hitbox radius (explicit override or derived from size).
    radius: type.radius != null ? type.radius : radiusForSize(type.size),
    x, y,                 // normalized 0..1
    // Bigger demons drift slower; speedScale ramps with session time.
    vx: (Math.random() - 0.5) * 0.01 * speedScale * (70 / type.size),
    vy: (Math.random() - 0.5) * 0.006 * speedScale * (70 / type.size),
    bobPhase: Math.random() * Math.PI * 2,
    frame: 0,
    frameTimer: 0,
    dead: false,
    flashUntil: 0,        // set on connect; render shows a white flash + hit frame
    // Per-demon connect cooldown: a single fist thrust can't register dozens of
    // hits. `connectCooldownUntil` is a timestamp; the engine checks it.
    connectCooldownUntil: 0,
    // Knockback impulse applied on connect (normalized units), decays in update.
    kbx: 0,
    kby: 0,
  };
}

/** Advance a demon's float/bob motion, knockback decay, and flap animation. */
export function updateDemon(demon, dtMs) {
  const f = dtMs / 16.67;
  demon.x += demon.vx * f;
  demon.bobPhase += dtMs / 600;
  demon.y += Math.sin(demon.bobPhase) * 0.0006;

  // Apply + decay knockback impulse (the visible recoil from a connect).
  if (demon.kbx || demon.kby) {
    demon.x += demon.kbx * f;
    demon.y += demon.kby * f;
    const decay = Math.pow(0.86, f);
    demon.kbx *= decay;
    demon.kby *= decay;
    if (Math.abs(demon.kbx) < 1e-5) demon.kbx = 0;
    if (Math.abs(demon.kby) < 1e-5) demon.kby = 0;
  }

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

/**
 * Apply one CONNECT. Sets the flash window and a knockback impulse pointing
 * away from the contact point. Returns true if this connect killed the demon.
 * @param {object} demon
 * @param {number} now
 * @param {object} [contact] {x,y} normalized contact point (for knockback dir)
 */
export function hitDemon(demon, now, contact) {
  demon.hitsRemaining -= 1;
  demon.flashUntil = now + 130;
  // Knockback: shove the demon away from the fist, lighter for heavier demons.
  const mass = Math.max(1, demon.size / 70);
  const power = 0.06 / mass;
  let dx = 0, dy = -0.6;
  if (contact) {
    dx = demon.x - contact.x;
    dy = demon.y - contact.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
  }
  demon.kbx += dx * power;
  demon.kby += dy * power * 0.6;
  if (demon.hitsRemaining <= 0) {
    demon.dead = true;
    return true;
  }
  return false;
}
