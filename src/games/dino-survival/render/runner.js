// ===========================================================================
// Dino Survival — PLAYER AVATAR (pose-matched run sprite).
// ---------------------------------------------------------------------------
// A library of baked run-cycle frames (cut with rembg) + their per-frame
// MediaPipe rig (rig.json). Instead of a timer, we show the frame whose baked
// pose best matches your LIVE skeleton — so your arms AND legs drive the avatar,
// using the photoreal frames. A match-quality score lets us detect "off-pose"
// (e.g. ducking / arbitrary motion the library doesn't cover) and gracefully
// fall back to standing instead of snapping to a wrong run frame.
// ===========================================================================

// Joints used for matching, with weights (arms weighted up so they read clearly).
const J = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const W = [1.2, 1.2, 1.5, 1.5, 1.7, 1.7, 1.0, 1.0, 1.1, 1.1, 1.2, 1.2];
// readable skeleton for the rig overlay
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];

// torso-normalised feature vector from a landmark accessor get(i)->{x,y}|null.
function featFrom(get) {
  const h1 = get(23), h2 = get(24), s1 = get(11), s2 = get(12);
  if (!h1 || !h2 || !s1 || !s2) return null;
  const hcx = (h1.x + h2.x) / 2, hcy = (h1.y + h2.y) / 2, scx = (s1.x + s2.x) / 2, scy = (s1.y + s2.y) / 2;
  const scale = Math.hypot(scx - hcx, scy - hcy) || 0.2;
  const v = new Array(J.length * 2);
  for (let k = 0; k < J.length; k++) { const p = get(J[k]); if (!p) return null; v[k * 2] = (p.x - hcx) / scale; v[k * 2 + 1] = (p.y - hcy) / scale; }
  return v;
}
function wdist(a, b) { let s = 0; for (let k = 0; k < W.length; k++) { const i = k * 2, dx = a[i] - b[i], dy = a[i + 1] - b[i + 1]; s += W[k] * (dx * dx + dy * dy); } return s; }

export function createRunner(assets, idleFrame = 0) {
  const RUN_FRAC = 0.50;                       // avatar height as a fraction of stage height
  const rig = assets.runnerRig || [];
  const lib = rig.map((f) => (f ? featFrom((i) => (f[i] ? { x: f[i][0], y: f[i][1] } : null)) : null));
  let smooth = null, curIdx = idleFrame, lastDist = 0;

  // Pick the library frame best matching the live landmarks (smoothed + sticky).
  function pickFrame(lm) {
    const f = featFrom((i) => lm[i]);
    if (!f) { lastDist = 1e9; return curIdx; }
    if (!smooth) smooth = f.slice(); else for (let k = 0; k < f.length; k++) smooth[k] += (f[k] - smooth[k]) * 0.45;
    let best = -1, bd = 1e9;
    for (let i = 0; i < lib.length; i++) { if (!lib[i]) continue; const d = wdist(smooth, lib[i]); if (d < bd) { bd = d; best = i; } }
    if (best < 0) { lastDist = 1e9; return curIdx; }
    if (curIdx >= 0 && lib[curIdx] && best !== curIdx && bd > wdist(smooth, lib[curIdx]) * 0.9) best = curIdx;  // hysteresis -> no flicker
    curIdx = best; lastDist = bd; return best;
  }
  const matchDist = () => lastDist;
  const reset = () => { smooth = null; curIdx = idleFrame; lastDist = 0; };

  // pos may be an integer frame index (pose-matched) or a float (timer/demo -> crossfade).
  function draw(ctx, Wd, Hd, groundY, pos, showRig) {
    const frames = assets.runnerFrames;
    if (!frames || !frames.length) return;
    const N = frames.length, i0 = ((Math.floor(pos) % N) + N) % N, frac = pos - Math.floor(pos);
    const im = frames[i0]; if (!im) return;
    const h = Hd * RUN_FRAC, ar = im.naturalWidth / im.naturalHeight, w = h * ar;
    const dx = Wd * 0.5 - w / 2, dy = groundY - h;
    ctx.drawImage(im, dx, dy, w, h);
    if (frac > 0.02 && frames[(i0 + 1) % N]) { ctx.save(); ctx.globalAlpha = frac; ctx.drawImage(frames[(i0 + 1) % N], dx, dy, w, h); ctx.restore(); }
    if (showRig && rig[i0]) {
      const lm = rig[i0], P = (i) => [dx + lm[i][0] * w, dy + lm[i][1] * h];
      ctx.save(); ctx.lineWidth = Math.max(2, w * 0.012); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(167,107,255,.95)';
      for (const [a, b] of BONES) { if (lm[a] && lm[b]) { const [ax, ay] = P(a), [bx, by] = P(b); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); } }
      ctx.fillStyle = 'rgba(255,210,120,.95)';
      for (let i = 11; i <= 32; i++) { if (lm[i] && lm[i][2] > 0.3) { const [px, py] = P(i); ctx.beginPath(); ctx.arc(px, py, ctx.lineWidth * 1.25, 0, 7); ctx.fill(); } }
      ctx.restore();
    }
  }
  return { pickFrame, matchDist, reset, draw };
}
