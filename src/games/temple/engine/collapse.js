// ===========================================================================
// Temple Dash — COLLAPSE TIMER + cinematic (its own module).
// ---------------------------------------------------------------------------
// Owns EVERYTHING about "the temple comes down if you're too slow":
//   • a per-level COUNTDOWN (collapseTime seconds) that starts when the run
//     ACTUALLY begins (after startGrace, the same moment hazards arm) and ticks
//     down each frame. Exposes the remaining seconds for the HUD.
//   • a SHORT FUSE lit when the player is BLOCKED at a beam — if still blocked
//     when the fuse burns out, the temple buries them.
//   • EXPIRY detection (countdown hits 0, or the fuse burns out) -> fires the
//     collapse: the engine flips phase -> 'over' with deathCause 'collapse'.
//   • the blow-apart CINEMATIC, drawn on the 2D fx-canvas (modelled on
//     boulderFx: heavy screen-shake, falling ceiling chunks, dust, darken/rumble,
//     a concussion flash) plus a 3D-camera shake magnitude the engine reads back.
//
// It is framework-free and self-contained: the engine computes nothing about the
// timer itself — it just calls arm()/pause()/tick()/onBlock()/clearBlock(),
// reads remaining()/expired()/collapsing, and calls drawCollapse() each frame.
//
//   createCollapse({ COLLAPSE, budgetS }) -> {
//     reset(),                 // full reset for a new run
//     arm(),                   // start/resume the countdown (call once grace ends)
//     pause(),                 // freeze the countdown (run no longer active)
//     tick(dt, active),        // advance the countdown + fuse; returns true on the
//                              //   frame expiry first fires (engine then kills)
//     onBlock(), clearBlock(), // light / extinguish the beam-block fuse
//     trigger(),               // begin the collapse cinematic (called on death)
//     remaining(),             // seconds left on the countdown (>=0), for the HUD
//     get urgent,              // true when remaining <= urgentS OR the fuse is lit
//     get fuseLit,             // true while the beam-block fuse is burning
//     get collapsing,          // true while the cinematic is playing
//     get shakeX, get shakeY,  // fx-canvas shake offset (engine -> 3D cam shake)
//     drawCollapse(ctx, fxCanvas, dt),  // render the blow-apart cinematic
//   }
// ===========================================================================

export function createCollapse({ COLLAPSE, budgetS } = {}) {
  const C = COLLAPSE;
  const BUDGET = (budgetS != null && isFinite(budgetS) && budgetS > 0) ? budgetS : 60;

  // ---- countdown / fuse state -----------------------------------------------
  let left = BUDGET;          // seconds remaining on the level countdown
  let armed = false;          // countdown is running (grace over, run active)
  let expiredFired = false;   // one-shot: tick() returns true exactly once
  let fuseLit = false;        // beam-block fuse burning
  let fuse = 0;               // seconds remaining on the block fuse

  // ---- cinematic state (owned here) -----------------------------------------
  let collapsing = false;     // cinematic playing
  let collapseT = 0;          // seconds since trigger()
  let shakeX = 0, shakeY = 0; // fx-canvas shake offset (decays to 0)
  let chunks = [];            // falling ceiling chunks { x,y,vx,vy,rot,vr,w,h,col }
  let dust = [];              // dust puffs { x,y,vx,vy,life,age,rad,col }
  let spawned = false;        // one-shot debris/dust spawn guard
  let impactTime = -1;        // tnow at the first slam (flash timing)

  function reset() {
    left = BUDGET; armed = false; expiredFired = false;
    fuseLit = false; fuse = 0;
    collapsing = false; collapseT = 0; shakeX = 0; shakeY = 0;
    chunks = []; dust = []; spawned = false; impactTime = -1;
  }
  function arm() { armed = true; }
  function pause() { armed = false; }

  // light the beam-block fuse (a couple of seconds to live unless un-blocked).
  function onBlock() { if (!fuseLit) { fuseLit = true; fuse = C.blockFuseS; } }
  function clearBlock() { fuseLit = false; fuse = 0; }

  // tick(dt, active): advance the countdown (only while armed & active) and the
  // fuse. Returns TRUE on the single frame expiry first fires (engine reacts by
  // flipping to the collapse death). After that it stays false.
  function tick(dt, active) {
    if (expiredFired) return false;
    if (armed && active) {
      left = Math.max(0, left - dt);
      if (fuseLit) fuse = Math.max(0, fuse - dt);
    }
    const out = (left <= 0) || (fuseLit && fuse <= 0);
    if (out) { expiredFired = true; return true; }
    return false;
  }

  function remaining() { return Math.max(0, left); }
  // begin the cinematic (idempotent). Called by the engine when a collapse death
  // happens (timer expiry OR fuse burnout).
  function trigger() {
    if (collapsing) return;
    collapsing = true; collapseT = 0; spawned = false; impactTime = -1;
  }

  // ---- debris / dust spawn (2D, capped) -------------------------------------
  function spawnDebris(W2, H2) {
    // falling ceiling chunks: drop from the top across the width, tumbling.
    for (let i = 0; i < C.chunkCount; i++) {
      const w = 18 + Math.random() * 64;
      const h = 14 + Math.random() * 50;
      const ochre = Math.random() < 0.6;
      chunks.push({
        x: Math.random() * W2,
        y: -h - Math.random() * H2 * 0.6,          // staggered above the screen
        vx: (Math.random() - 0.5) * 120,
        vy: 240 + Math.random() * 520,             // fall speed
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 6,
        w, h,
        col: ochre ? [150, 116, 70] : [96, 88, 80],
      });
    }
    // dust puffs kicked up low + mid-screen.
    for (let i = 0; i < C.dustCount; i++) {
      const ochre = Math.random() < 0.6;
      dust.push({
        x: Math.random() * W2,
        y: H2 * (0.4 + Math.random() * 0.6),
        vx: (Math.random() - 0.5) * 260,
        vy: -Math.random() * 220,
        life: 0.6 + Math.random() * 1.2, age: 0,
        rad: 8 + Math.random() * 30,
        col: ochre ? [180, 142, 88] : [120, 112, 104],
      });
    }
  }
  function updateDebris(dt, W2, H2) {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      c.vy += 1100 * dt;                            // gravity
      c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.age += dt;
      if (p.age >= p.life) { dust.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - 1.4 * dt);
      p.vx *= drag; p.vy = p.vy * drag + 120 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rad += 24 * dt;                             // billow outward
    }
  }

  // ---- the blow-apart cinematic (2D fx-canvas) ------------------------------
  // Modelled on boulderFx.draw: clears nothing (the engine clears the fx canvas;
  // collapse draws ON TOP after the boulder overlay has cleared it). The engine
  // only calls this when collapsing, so we always advance collapseT here.
  function drawCollapse(fc, fxCanvas, dt) {
    if (!fc || !collapsing) return;
    const W2 = fxCanvas.width, H2 = fxCanvas.height;
    const tnow = performance.now() * 0.001;
    collapseT += dt;

    if (!spawned) { spawned = true; impactTime = tnow; spawnDebris(W2, H2); }
    updateDebris(dt, W2, H2);

    const prog = Math.min(1, collapseT / C.durS);  // 0..1 over the cinematic
    // ---- heavy screen shake: spikes at the first slam, decays across the clip.
    const sinceImpact = impactTime >= 0 ? (tnow - impactTime) : 1e9;
    const env = Math.exp(-sinceImpact * 2.2) * 0.8 + (1 - prog) * 0.4;  // big at start
    const mag = C.shakeAmp * Math.max(0, env);
    const sx = Math.sin(tnow * 88.0) * mag;
    const sy = Math.cos(tnow * 71.0) * mag * 0.85;
    shakeX += (sx - shakeX) * Math.min(1, dt * 30);
    shakeY += (sy - shakeY) * Math.min(1, dt * 30);

    fc.save();
    fc.translate(shakeX, shakeY);

    // dust band first (behind the chunks).
    for (let i = 0; i < dust.length; i++) {
      const p = dust[i];
      const a = Math.max(0, 1 - p.age / p.life) * 0.6;
      fc.globalAlpha = a;
      fc.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`;
      fc.beginPath(); fc.arc(p.x, p.y, p.rad, 0, 7); fc.fill();
    }
    fc.globalAlpha = 1;

    // falling chunks on top.
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      fc.save();
      fc.translate(c.x, c.y); fc.rotate(c.rot);
      fc.fillStyle = `rgb(${c.col[0]},${c.col[1]},${c.col[2]})`;
      fc.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      fc.fillStyle = 'rgba(0,0,0,0.28)';           // simple shaded edge
      fc.fillRect(-c.w / 2, c.h / 2 - c.h * 0.3, c.w, c.h * 0.3);
      fc.restore();
    }
    fc.restore();   // end shake transform

    // ---- darken / rumble: the temple buries the view as the clip completes.
    const ease = prog * prog * (3 - 2 * prog);     // smoothstep
    fc.fillStyle = `rgba(6,3,2,${C.rumbleAlpha * ease})`;
    fc.fillRect(0, 0, W2, H2);

    // ---- concussion flash at the first slam.
    const f = Math.max(0, 1 - sinceImpact / C.flashDur);
    if (f > 0) { fc.fillStyle = `rgba(255,244,232,${0.55 * f * f})`; fc.fillRect(0, 0, W2, H2); }

    // settle the shake to 0 as the clip winds down.
    if (prog >= 1) { shakeX *= Math.max(0, 1 - dt * 10); shakeY *= Math.max(0, 1 - dt * 10); }
  }

  return {
    reset, arm, pause, tick, onBlock, clearBlock, trigger, remaining, drawCollapse,
    get urgent() { return fuseLit || left <= C.urgentS; },
    get fuseLit() { return fuseLit; },
    get collapsing() { return collapsing; },
    get shakeX() { return shakeX; },
    get shakeY() { return shakeY; },
  };
}

export default createCollapse;
