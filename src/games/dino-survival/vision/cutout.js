// ===========================================================================
// Dino Survival — PLAYER CUTOUT.
// ---------------------------------------------------------------------------
// Segmentation mask -> alpha (erode + feather), composited as a SCENE FIGURE:
// the player renders at a normalised on-screen size derived from their torso
// length (so distance-to-camera doesn't change how big they appear), with hips
// anchored above the trail ground line. Owns its own offscreen canvas.
// ===========================================================================
import { clamp, lerp, vis } from '../util.js';
import { PLAYER_TORSO_FRAC } from '../config.js';

const RIG_BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];

export function createPlayerCutout() {
  const pcv = document.createElement('canvas'); pcv.width = 480; pcv.height = 270;
  const pctx = pcv.getContext('2d', { willReadFrequently: true });
  const W = pcv.width, H = pcv.height; const cfg = { lo: .45, hi: .62, erode: 1, feather: 2 };
  const A = new Float32Array(W * H), Bf = new Float32Array(W * H); let hasFrame = false;

  function build(video, mask) {
    if (!video || video.readyState < 2 || !mask) return hasFrame;
    pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.save(); pctx.translate(W, 0); pctx.scale(-1, 1); pctx.drawImage(video, 0, 0, W, H); pctx.restore();
    const id = pctx.getImageData(0, 0, W, H), d = id.data, mw = mask.width, mh = mask.height, mf = mask.getAsFloat32Array(), inv = 1 / Math.max(1e-3, cfg.hi - cfg.lo);
    for (let y = 0; y < H; y++) { const my = (y * mh / H) | 0, row = my * mw, oy = y * W; for (let x = 0; x < W; x++) { const mx = (((W - 1 - x) * mw / W) | 0); let a = (mf[row + mx] - cfg.lo) * inv; A[oy + x] = a < 0 ? 0 : a > 1 ? 1 : a; } }
    let src = A, dst = Bf; const er = cfg.erode | 0;
    if (er > 0) {
      for (let y = 0; y < H; y++) { const oy = y * W; for (let x = 0; x < W; x++) { let m = src[oy + x]; for (let k = 1; k <= er; k++) { if (x - k >= 0) m = Math.min(m, src[oy + x - k]); if (x + k < W) m = Math.min(m, src[oy + x + k]); } dst[oy + x] = m; } }
      let t = src; src = dst; dst = t;
      for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) { let m = src[y * W + x]; for (let k = 1; k <= er; k++) { if (y - k >= 0) m = Math.min(m, src[(y - k) * W + x]); if (y + k < H) m = Math.min(m, src[(y + k) * W + x]); } dst[y * W + x] = m; } } t = src; src = dst; dst = t;
    }
    const fr = cfg.feather | 0;
    if (fr > 0) {
      for (let y = 0; y < H; y++) { const oy = y * W; for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -fr; k <= fr; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += src[oy + xx]; n++; } } dst[oy + x] = s / n; } }
      let t = src; src = dst; dst = t;
      for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -fr; k <= fr; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += src[yy * W + x]; n++; } } dst[y * W + x] = s / n; } } t = src; src = dst; dst = t;
    }
    for (let i = 0; i < W * H; i++) d[i * 4 + 3] = src[i] * 255;
    pctx.putImageData(id, 0, 0); hasFrame = true; return true;
  }
  // pm = { torso, hipx, hipy } from playerMetrics(); cxFrac centres the figure.
  function draw(ctx, W2, H2, groundY, pm, alpha, cxFrac) {
    if (!hasFrame) return; const cf = cxFrac == null ? 0.5 : cxFrac; ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (pm && pm.torso > 0.02) {
      const TORSO = H2 * PLAYER_TORSO_FRAC;
      const drawH = clamp(TORSO / pm.torso, H2 * 0.28, H2 * 1.5), drawW = drawH * (W / H);
      const figH = TORSO / 0.30;
      const top = (groundY - figH * 0.52) - pm.hipy * drawH;
      ctx.drawImage(pcv, W2 * cf - pm.hipx * drawW, top, drawW, drawH);
    } else { const ih = H2 * 0.5, iw = ih * (W / H); ctx.drawImage(pcv, W2 * cf - iw / 2, groundY - ih, iw, ih); }
    ctx.restore();
  }
  // optional skeleton overlay, aligned to the same normalised transform as draw()
  function drawRig(ctx, W2, H2, groundY, pm, lm) {
    if (!hasFrame || !pm || pm.torso <= 0.02 || !lm) return;
    const TORSO = H2 * PLAYER_TORSO_FRAC;
    const drawH = clamp(TORSO / pm.torso, H2 * 0.28, H2 * 1.5), drawW = drawH * (W / H);
    const figH = TORSO / 0.30; const top = (groundY - figH * 0.52) - pm.hipy * drawH, left = W2 * 0.5 - pm.hipx * drawW;
    const X = i => left + lm[i].x * drawW, Y = i => top + lm[i].y * drawH;
    ctx.save(); ctx.strokeStyle = 'rgba(160,107,255,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.shadowColor = '#a06bff'; ctx.shadowBlur = 8;
    for (const [a, b] of RIG_BONES) { const pa = lm[a], pb = lm[b]; if (!vis(pa) || !vis(pb)) continue; ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffce6b';
    for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) { const p = lm[i]; if (!vis(p)) continue; ctx.beginPath(); ctx.arc(X(i), Y(i), 3.4, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  return { build, draw, drawRig, has: () => hasFrame };
}
