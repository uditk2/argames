// ===========================================================================
// Dino Survival — SCENE RENDERER (canvas 2D).
// ---------------------------------------------------------------------------
// Static trail backdrop + perspective scrolling ground (the forward-motion) +
// the galloping, grounded dino + the jeep escape cutscene. Pure drawing; reads
// the engine snapshot + the player cutout. No game logic here.
// ===========================================================================
import { clamp, lerp } from '../util.js';
import { GROUND_FRAC, TRAIL_TOP_FRAC } from '../config.js';

export function createScene(assets) {
  let escEnd = 0;
  let nearDisp = 0;   // smoothed closeness for rendering (damps fast gap changes so the dino never snaps in size)
  let gtex = null;    // offscreen canvas for the feathered scrolling ground
  // tunable (debug-adjustable) ground geometry — fixes "floating in the sky" by
  // matching the engine's ground line + vanishing point to the actual bg art.
  let gFrac = 0.88;     // near ground (feet when close) as a fraction of H
  let tFrac = 0.58;     // vanishing point (feet when far) — kept low so a far dino stays on the
                        //   visible trail strip, not up in this bg's high canopy
  let bgAnchor = 0.72;  // vertical anchor for the portrait bg cover-fit (toward 1 = show foreground trail)
  let debug = false;

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

  // perspective scrolling ground (mode-7 style): a dirt texture flows toward you.
  function drawGround(ctx, W, H, scroll) {
    const tex = assets.groundTex; if (!tex) return;
    if (!gtex || gtex.width !== W || gtex.height !== H) { gtex = document.createElement('canvas'); gtex.width = W; gtex.height = H; }
    const g = gtex.getContext('2d'); g.clearRect(0, 0, W, H);
    const hy = H * TRAIL_TOP_FRAC, vx = W * 0.5, tw = tex.naturalWidth, th = tex.naturalHeight;
    // mode-7 scroll: a dirt texture flowing toward the viewer (faster near you)
    for (let y = Math.ceil(hy); y < H; y += 2) {
      const f = (y - hy) / (H - hy);
      const worldZ = 0.32 / Math.max(0.04, f);
      const V = ((scroll * 0.55 + worldZ) % 1 + 1) % 1;
      const w = lerp(W * 0.05, W * 0.78, f * f);          // stays on-screen (no overflow)
      g.drawImage(tex, 0, V * th, tw, 1, vx - w / 2, y, w, 2);
    }
    // FEATHER edges so the moving ground blends into the painted trail (kills the
    // hard wedge seam): fade alpha to 0 near the vanishing point and at the sides.
    g.globalCompositeOperation = 'destination-in';
    const vg = g.createLinearGradient(0, hy, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.18, 'rgba(0,0,0,.85)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = vg; g.fillRect(0, hy, W, H - hy);
    const hg = g.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.24, 'rgba(0,0,0,1)'); hg.addColorStop(0.76, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, hy, W, H - hy);
    g.globalCompositeOperation = 'source-over';
    // soft-light: the flowing texture modulates the painted trail's light/shadow
    // (keeps its exact colour) instead of pasting a differently-toned patch.
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.9; ctx.drawImage(gtex, 0, 0); ctx.restore();
  }

  // Dino: ONE consistent image, animated procedurally (bound + squash-stretch +
  // gentle rock) so there's no frame-to-frame shimmer — smooth at any speed/size.
  // (Multi-frame cycling boiled worse as it sped up/scaled up; this fixes that.)
  function drawDino(ctx, W, H, groundY, gap, now) {
    const nearTrue = clamp(1 - gap, 0, 1);
    nearDisp += (nearTrue - nearDisp) * 0.18;          // ease toward target -> no size/position snapping
    const near = nearDisp;                              // smoothed value drives size + position
    const frames = (assets.dinoRunFrames && assets.dinoRunFrames.length) ? assets.dinoRunFrames : [];
    // cycle the real (consistent) gallop frames — playback eases faster as it nears
    const mspf = lerp(72, 46, clamp(near, 0, 1));
    const runIm = frames.length ? frames[Math.floor(now / mspf) % frames.length] : null;
    const im = (nearTrue > 0.82 && assets.dinoLunge) ? assets.dinoLunge : (runIm || assets.dinoLunge);
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

  // demo-mode placeholder when there's no camera cutout.
  function drawSilhouette(ctx, W, H, groundY, pace, now) {
    const x = W * 0.5, h = H * 0.46, bob = Math.abs(Math.sin(now / (180 - pace * 100))) * h * 0.05 * (0.4 + pace); const y = groundY - bob;
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = 'rgba(18,10,28,.92)'; ctx.strokeStyle = 'rgba(18,10,28,.92)'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -h * 0.86, h * 0.12, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-h * 0.1, -h * 0.74); ctx.lineTo(h * 0.1, -h * 0.74); ctx.lineTo(h * 0.08, -h * 0.3); ctx.lineTo(-h * 0.08, -h * 0.3); ctx.closePath(); ctx.fill();
    const sw = Math.sin(now / 120) * h * 0.18; ctx.lineWidth = h * 0.1;
    ctx.beginPath(); ctx.moveTo(0, -h * 0.32); ctx.lineTo(sw, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -h * 0.32); ctx.lineTo(-sw, 0); ctx.stroke();
    ctx.restore();
  }

  function beginEscape(now) { escEnd = now + 3600; }
  // returns true once the cutscene is done. player/pm composite "you" getting in.
  function drawEscape(ctx, W, H, groundY, now, player, pm) {
    if (!escEnd) escEnd = now + 3600;
    const p = clamp(1 - (escEnd - now) / 3600, 0, 1);
    const parked = (p > 0.18 && p < 0.78), seated = assets.jeepSeated;
    const jeep = parked ? (seated || assets.jeep) : assets.jeep;
    const jh = H * 0.42, jar = jeep ? jeep.naturalWidth / jeep.naturalHeight : 2, jw = jh * jar;
    let jx; if (p < 0.18) jx = lerp(-jw, W * 0.56, p / 0.18); else if (p < 0.78) jx = W * 0.56; else jx = lerp(W * 0.56, W * 1.3, (p - 0.78) / 0.22);
    const jy = groundY + H * 0.03;
    if (p < 0.6) {
      const a = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.15; const cx = lerp(W * 0.5, jx - jw * 0.05, clamp(p / 0.5, 0, 1));
      if (player && player.has()) player.draw(ctx, W, H, groundY, pm, clamp(a, 0, 1), cx / W);
      else { ctx.save(); ctx.globalAlpha = clamp(a, 0, 1); drawSilhouette(ctx, W, H, groundY, 1, now); ctx.restore(); }
    }
    if (jeep) ctx.drawImage(jeep, jx - jw / 2, jy - jh, jw, jh);
    return p >= 1;
  }

  return { beginCamera, endCamera, drawSpeedLines, drawBgSeq, drawBackdrop, drawGround, drawDino, drawSilhouette, drawGuides, setGround, setBgAnchor, getGround, setDebug, beginEscape, drawEscape };
}
