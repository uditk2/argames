// ===========================================================================
// Dino Survival — SCENE RENDERER (canvas 2D).
// ---------------------------------------------------------------------------
// Distance-indexed trail-loop background + car-cam + the galloping, grounded
// dino + kicked-up dust. Pure drawing; reads the engine snapshot. No game logic.
// (Catch/escape are fullscreen video cutscenes handled in the UI, not here.)
// ===========================================================================
import { clamp, lerp } from '../util.js';
import { GROUND_FRAC, TRAIL_TOP_FRAC } from '../config.js';

export function createScene(assets) {
  let nearDisp = 0;   // smoothed closeness for rendering (damps fast gap changes so the dino never snaps in size)
  // tunable (debug-adjustable) ground geometry — fixes "floating in the sky" by
  // matching the engine's ground line + vanishing point to the actual bg art.
  let gFrac = 0.88;     // near ground (feet when close) as a fraction of H
  let tFrac = 0.58;     // vanishing point (feet when far) — kept low so a far dino stays on the
                        //   visible trail strip, not up in this bg's high canopy
  let bgAnchor = 0.72;  // vertical anchor for the portrait bg cover-fit (toward 1 = show foreground trail)
  let debug = false;
  let dust = [], dustAcc = 0;   // sand/dust particles kicked up behind the runner

  // Distance-indexed BACKGROUND LOOP — the seamless forward-dolly trail frames.
  // `pos` (a float) is driven by accumulated distance: holding still freezes the
  // world, running advances it. We crossfade between consecutive frames by the
  // fractional part, which smooths the 10fps steps AND blends the loop wrap
  // (frame N-1 -> 0) for a seamless transition. Frames are colour-normalised so
  // the ground tone stays constant across the loop.
  function drawBgSeq(ctx, W, H, pos) {
    const frames = assets.bgLoop;
    if (!frames || !frames.length) return drawBackdrop(ctx, W, H);
    const N = frames.length, i0 = ((Math.floor(pos) % N) + N) % N, frac = pos - Math.floor(pos);
    const blit = (im) => { if (!im) return; const s = Math.max(W / im.naturalWidth, H / im.naturalHeight) * 1.06;
      const dw = im.naturalWidth * s, dh = im.naturalHeight * s; ctx.drawImage(im, (W - dw) / 2, (H - dh) * bgAnchor, dw, dh); };
    blit(frames[i0]);                                                       // base frame
    if (frac > 0.02) { ctx.save(); ctx.globalAlpha = frac; blit(frames[(i0 + 1) % N]); ctx.restore(); }  // crossfade
    return H * gFrac;
  }

  function drawBackdrop(ctx, W, H) {
    const im = assets.bgTrail;
    if (!im) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#caa06a'); g.addColorStop(1, '#234a2a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return H * gFrac; }
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight) * 1.06, dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    ctx.drawImage(im, (W - dw) / 2, (H - dh) * bgAnchor, dw, dh);
    return H * gFrac;
  }

  // Dino: ONE consistent image, animated procedurally (bound + squash-stretch +
  // gentle rock) so there's no frame-to-frame shimmer — smooth at any speed/size.
  // (Multi-frame cycling boiled worse as it sped up/scaled up; this fixes that.)
  function drawDino(ctx, W, H, groundY, gap, now) {
    const nearTrue = clamp(1 - gap, 0, 1);
    nearDisp += (nearTrue - nearDisp) * 0.18;          // ease toward target -> no size/position snapping
    const near = nearDisp;                              // smoothed value drives size + position
    const frames = (assets.dinoRunFrames && assets.dinoRunFrames.length) ? assets.dinoRunFrames : [];
    // cycle the real gallop frames at a CONSTANT cadence — only size/position change
    // with distance (speeding the gait up as it neared looked weird).
    const mspf = 60;
    const runIm = frames.length ? frames[Math.floor(now / mspf) % frames.length] : null;
    // The dino just GALLOPS (growing) all the way to the catch — the lunge now lives
    // entirely in the catch cutscene.
    const im = runIm;
    if (!im) return nearTrue;
    const hy = H * tFrac;
    const f = Math.pow(near, 1.5);
    const feetY = hy + f * (groundY - hy);
    const h = lerp(H * 0.10, H * 1.05, f), ar = im.naturalWidth / im.naturalHeight, w = h * ar;
    const cx = W * 0.5 + (1 - near) * W * 0.12 + Math.sin(now / 600) * W * 0.008;   // slight off-shoulder approach
    ctx.save(); ctx.globalAlpha = 0.30 * f + 0.06; ctx.fillStyle = '#241404'; ctx.beginPath(); ctx.ellipse(cx, feetY, w * 0.32, h * 0.035, 0, 0, 7); ctx.fill(); ctx.restore();
    ctx.drawImage(im, cx - w / 2, feetY - h, w, h);     // video frames carry the gait — no extra squash/bob
    if (debug) { ctx.save(); ctx.fillStyle = '#00ff66'; ctx.beginPath(); ctx.arc(cx, feetY, 5, 0, 7); ctx.fill(); ctx.restore(); }
    return nearTrue;
  }

  // DEBUG GUIDES — draws the ground line (where close feet plant) and the vanishing
  // point (where far feet sit), with their current fractions. Lets us see whether
  // the dino floats vs the actual trail, and tune live.
  function drawGuides(ctx, W, H) {
    ctx.save(); ctx.lineWidth = 2; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    const gy = H * gFrac, vy = H * tFrac;
    ctx.strokeStyle = 'rgba(0,255,102,.9)'; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    ctx.fillStyle = 'rgba(0,255,102,.95)'; ctx.fillText('ground  gFrac=' + gFrac.toFixed(2) + '   [↑/↓]', 10, gy - 6);
    ctx.strokeStyle = 'rgba(0,210,255,.9)'; ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(W, vy); ctx.stroke();
    ctx.fillStyle = 'rgba(0,210,255,.95)'; ctx.fillText('vanish  tFrac=' + tFrac.toFixed(2) + '   [←/→]', 10, vy + 16);
    ctx.restore();
  }
  // SAND/DUST — puffs kicked up at the runner's feet, drifting down + outward and
  // fading; spawn rate scales with pace. Cheap (a few dozen circles). Draw behind
  // the runner so it reads as dust at/behind the feet.
  function drawDust(ctx, Wd, Hd, groundY, pace, now, dt) {
    if (pace > 0.04 && dust.length < 90) {
      dustAcc += pace * dt * 0.05;
      while (dustAcc >= 1) {
        dustAcc -= 1; const side = Math.random() < 0.5 ? -1 : 1;
        dust.push({ x: Wd * 0.5 + side * Wd * 0.03 * Math.random(), y: groundY - Hd * 0.005,
          vx: side * (0.2 + Math.random() * 0.6), vy: 0.15 + Math.random() * 0.45,
          r: Hd * 0.008 * (1 + Math.random() * 1.5), life: 1 });
      }
    }
    ctx.save();
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i]; p.life -= dt * 0.0018;
      if (p.life <= 0) { dust.splice(i, 1); continue; }
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06; p.r += dt * 0.018;
      ctx.fillStyle = `rgba(150,112,72,${0.20 * p.life})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function setGround(g, t) { gFrac = Math.max(0.5, Math.min(1.15, g)); tFrac = Math.max(0.15, Math.min(0.9, t)); }
  function setBgAnchor(a) { bgAnchor = Math.max(0, Math.min(1, a)); }
  function getGround() { return { gFrac, tFrac, bgAnchor }; }
  function setDebug(d) { debug = !!d; }

  // GLOBAL CAMERA — mounted on the jeep driving AHEAD, looking back at you (so you
  // and the dino both face it). It moves like a *vehicle*, not a runner: a slow
  // suspension heave + road vibration + gentle drift, a zoom-punch as the dino
  // closes, and an impact shake near capture. Wrap ALL scene drawing between
  // beginCamera()/endCamera() so the whole frame moves together.
  function beginCamera(ctx, W, H, { pace = 0, near = 0, now = 0 }) {
    const susp = Math.sin(now * 0.0042) * (2 + pace * 4);                       // slow suspension heave
    const vib  = (Math.sin(now * 0.05) + Math.sin(now * 0.083)) * 0.5 * pace * 2.6; // engine/road buzz (scales with speed)
    const sway = Math.sin(now * 0.0017) * (3 + pace * 5);                       // gentle lateral drift on the trail
    const roll = Math.sin(now * 0.0017) * pace * 0.010;                         // matching slight roll
    const zoom = 1.05 + pace * 0.04 + Math.pow(near, 1.6) * 0.12;               // push in as the dino closes
    const sAmt = Math.max(0, near - 0.55) * 16;                                 // hard shake only as capture nears
    const shx  = (Math.sin(now * 0.09) + Math.sin(now * 0.17)) * 0.5 * sAmt;
    const shy  = (Math.sin(now * 0.11) + Math.sin(now * 0.23)) * 0.5 * sAmt;
    ctx.save();
    ctx.translate(W / 2 + sway + shx, H / 2 + susp + vib + shy);
    ctx.rotate(roll);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);
  }
  function endCamera(ctx) { ctx.restore(); }

  // RADIAL SPEED LINES: streaks rushing outward from the vanishing point past the
  // edges — the front-facing-friendly "I'm moving fast" cue (anime/runner trick).
  // Sparse at centre (never over the subjects), dense + long toward the edges;
  // density, length and brightness all scale with pace. Drawn in screen space.
  function drawSpeedLines(ctx, W, H, pace, now) {
    if (pace < 0.35) return;                                     // only a top-speed accent now (parallax carries the rest)
    const cx = W * 0.5, cy = H * TRAIL_TOP_FRAC, diag = Math.hypot(W, H);
    const n = Math.floor(10 + pace * 26), spd = 0.00045 + pace * 0.0011;
    const rMin = diag * 0.18, rMax = diag * 0.72, len = diag * (0.05 + pace * 0.14);
    const boost = clamp((pace - 0.35) / 0.65, 0, 1);             // ramp in above the threshold
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const ang = (i * 2.39996) % (Math.PI * 2);                 // golden-angle spread, even but non-repeating
      const t = ((now * spd) + i * 0.6180339) % 1;               // travels out then wraps
      const r0 = lerp(rMin, rMax, t), r1 = r0 + len * (0.5 + t);
      const fade = Math.sin(t * Math.PI);                        // fade in near centre, out at the edge
      const ca = Math.cos(ang), sa = Math.sin(ang);
      ctx.strokeStyle = `rgba(255,243,214,${0.10 * boost * fade})`;
      ctx.lineWidth = (1 + pace * 1.8) * (0.6 + t);
      ctx.beginPath(); ctx.moveTo(cx + ca * r0, cy + sa * r0); ctx.lineTo(cx + ca * r1, cy + sa * r1); ctx.stroke();
    }
    ctx.restore();
  }

  return { beginCamera, endCamera, drawSpeedLines, drawBgSeq, drawBackdrop, drawDino, drawDust, drawGuides, setGround, setBgAnchor, getGround, setDebug };
}
