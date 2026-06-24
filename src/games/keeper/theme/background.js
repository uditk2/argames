// ===========================================================================
// KEEPER AR — BACKGROUND PAINTER + ARENA FURNITURE
// ---------------------------------------------------------------------------
// Dependency-free procedural art for a floodlit night stadium, drawn on a 2D
// canvas. All colors come from theme.js, so it stays in the SlayFit palette
// (molten-gold sky bloom, deep-realm sky, gold floodlights).
//
// Exports
//   drawBackground(ctx, {w,h,level,intensity,time,bgImage})
//       Paints the full backdrop: sky → floodlights+beams → crowd bowl →
//       pitch with perspective stripes. If `bgImage` (an already-loaded
//       HTMLImageElement / ImageBitmap, e.g. an OpenAI-generated PNG) is
//       provided it is drawn cover-fit instead of the procedural sky+crowd,
//       and only the live pitch/light flicker is layered on top.
//   drawGoalFrame(ctx, rect, {intensity})        posts + crossbar + net
//   drawBall(ctx, {x,y,r,spin})                   stylized panelled ball
//   drawKeeperGlow(ctx, rect, {intensity})        soft aura behind keeper
//   loadBackgroundImage(src)                       Promise<Image|null>
//   makeBackgroundPainter(theme?)                  bound convenience factory
//
// The painter is intentionally `time`-aware (ms) so floodlight flicker, crowd
// shimmer and beam pulse animate; pass performance.now().
// ===========================================================================

import KEEPER_THEME from '../theme.js';

// Small deterministic PRNG so the crowd/star layout is stable across frames.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Sky — vertical gradient from near-black zenith to the realm horizon, plus a
// warm gold bloom over the stadium bowl that grows with intensity.
// ---------------------------------------------------------------------------
function paintSky(ctx, w, h, T, R, intensity) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, R.skyTop);
  g.addColorStop(0.55, R.skyHorizon);
  g.addColorStop(1, R.skyHorizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Gold bowl-glow centered low, intensifies with level (finals = fiery).
  const cx = w / 2;
  const cy = h * T.layout.horizon;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * (0.7 + intensity * 0.2));
  glow.addColorStop(0, T.rgba.magic(0.12 + intensity * 0.14));
  glow.addColorStop(0.5, T.rgba.fire(0.04 + intensity * 0.06));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Floodlights — three masts above the bowl with glowing lamp banks + soft
// volumetric beams that pulse subtly. Brighter and warmer at higher levels.
// ---------------------------------------------------------------------------
function paintFloodlights(ctx, w, h, T, R, intensity, time) {
  const horizon = h * T.layout.horizon;
  const beamA = 0.06 + intensity * 0.08;
  for (const fx of T.layout.floodlights) {
    const x = w * fx;
    const mastTop = h * 0.06;
    const flick = 0.9 + 0.1 * Math.sin(time * 0.004 + fx * 30);

    // Beam cone down onto the pitch.
    ctx.save();
    const beam = ctx.createLinearGradient(x, mastTop, x, horizon + h * 0.18);
    beam.addColorStop(0, T.rgba.gold(beamA * flick));
    beam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.012, mastTop);
    ctx.lineTo(x + w * 0.012, mastTop);
    ctx.lineTo(x + w * 0.16, horizon + h * 0.18);
    ctx.lineTo(x - w * 0.16, horizon + h * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Lamp bank glow.
    const lampR = Math.max(10, h * 0.02);
    const lamp = ctx.createRadialGradient(x, mastTop, 0, x, mastTop, lampR * 4);
    lamp.addColorStop(0, T.rgba.fireBright(0.95 * flick));
    lamp.addColorStop(0.3, T.rgba.gold(0.6 * flick));
    lamp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(x, mastTop, lampR * 4, 0, 7);
    ctx.fill();

    // Lamp core dots.
    ctx.fillStyle = T.roles.floodlight;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(x + i * lampR * 1.1, mastTop, lampR * 0.4, 0, 7);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Crowd bowl — a dark silhouette band of tiered stands with a speckle of
// phone-lights / camera flashes that twinkle. The tier rises toward the back.
// ---------------------------------------------------------------------------
function paintCrowd(ctx, w, h, T, R, intensity, time) {
  const horizon = h * T.layout.horizon;
  const top = horizon - h * 0.22;
  // Bowl mass.
  const grad = ctx.createLinearGradient(0, top, 0, horizon);
  grad.addColorStop(0, 'rgb(6,5,12)');
  grad.addColorStop(1, R.crowd);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  // Gentle bowl curve dipping in the middle.
  ctx.quadraticCurveTo(w * 0.5, top - h * 0.04, w, horizon);
  ctx.lineTo(w, horizon);
  ctx.lineTo(0, horizon);
  ctx.closePath();
  ctx.fill();

  // Tier separators.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let t = 0.35; t < 1; t += 0.32) {
    const y = lerp(top, horizon, t);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(w * 0.5, y - h * 0.02, w, y);
    ctx.stroke();
  }

  // Twinkling crowd sparks (stable layout, animated brightness).
  const rnd = mulberry32(1337);
  const n = Math.round(160 + intensity * 140);
  for (let i = 0; i < n; i++) {
    const fx = rnd();
    const fy = rnd();
    const x = fx * w;
    const y = lerp(top + h * 0.02, horizon - h * 0.01, fy);
    // Brightness twinkle; finals get warmer/brighter sparks.
    const tw = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(time * 0.003 + i * 12.9)), 6);
    const warm = rnd() < 0.5 + intensity * 0.3;
    ctx.fillStyle = warm ? T.rgba.gold(tw * (0.5 + intensity * 0.4)) : T.rgba.ink(tw * 0.5);
    const s = 0.6 + tw * 1.4;
    ctx.fillRect(x, y, s, s);
  }
}

// ---------------------------------------------------------------------------
// Pitch — perspective mown stripes receding to the horizon, with subtle
// floodlight sheen and the penalty-area arc/lines painted near the goal.
// ---------------------------------------------------------------------------
function paintPitch(ctx, w, h, T, R, intensity, time) {
  const horizon = h * T.layout.horizon;
  // Base grass.
  const grad = ctx.createLinearGradient(0, horizon, 0, h);
  grad.addColorStop(0, R.pitch);
  grad.addColorStop(1, 'rgb(9,18,11)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Perspective mown stripes: vertical bands that widen toward the camera.
  const cx = w / 2;
  const vanish = horizon - h * 0.05; // vanishing point just above horizon
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, w, h - horizon);
  ctx.clip();
  const STRIPES = 10;
  for (let i = -STRIPES; i <= STRIPES; i++) {
    if (((i % 2) + 2) % 2 !== 0) continue; // every other stripe
    const topX = cx + i * (w * 0.012);
    const botX = cx + i * (w * 0.13);
    const botX2 = cx + (i + 2) * (w * 0.13);
    const topX2 = cx + (i + 2) * (w * 0.012);
    ctx.fillStyle = R.pitchStripe;
    ctx.beginPath();
    ctx.moveTo(topX, vanish);
    ctx.lineTo(topX2, vanish);
    ctx.lineTo(botX2, h);
    ctx.lineTo(botX, h);
    ctx.closePath();
    ctx.fill();
  }

  // Floodlight sheen pooled center-pitch.
  const sheen = ctx.createRadialGradient(cx, h * 0.86, 0, cx, h * 0.86, w * 0.5);
  sheen.addColorStop(0, T.rgba.gold(0.07 + intensity * 0.05));
  sheen.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Penalty box + arc (painted lines), in perspective.
  ctx.strokeStyle = R.pitchLine;
  ctx.lineWidth = Math.max(1.5, h * 0.003);
  // Six-yard-ish box around the goal mouth.
  const boxTop = lerp(horizon, h, 0.18);
  const boxBot = lerp(horizon, h, 0.55);
  const boxTL = cx - w * 0.16;
  const boxTR = cx + w * 0.16;
  const boxBL = cx - w * 0.3;
  const boxBR = cx + w * 0.3;
  ctx.beginPath();
  ctx.moveTo(boxTL, boxTop);
  ctx.lineTo(boxTR, boxTop);
  ctx.moveTo(boxTL, boxTop);
  ctx.lineTo(boxBL, boxBot);
  ctx.moveTo(boxTR, boxTop);
  ctx.lineTo(boxBR, boxBot);
  ctx.stroke();
  // Penalty arc.
  ctx.beginPath();
  ctx.ellipse(cx, boxBot, w * 0.12, h * 0.03, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// Resolve theme roles + helpers up front for a draw call.
function resolve(theme) {
  const T = theme || KEEPER_THEME;
  return { T, R: T.roles };
}

/**
 * Paint the full stadium backdrop.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{w:number,h:number,level?:number,intensity?:number,time?:number,bgImage?:CanvasImageSource,theme?:object}} opts
 */
export function drawBackground(ctx, opts = {}) {
  const { w, h } = opts;
  const { T, R } = resolve(opts.theme);
  const level = opts.level ?? 1;
  const intensity = opts.intensity ?? T.intensity(level);
  const time = opts.time ?? 0;

  if (opts.bgImage) {
    // Cover-fit a generated PNG, then layer live light pooling + pitch sheen.
    drawCover(ctx, opts.bgImage, w, h);
    // Re-pool floodlight sheen + crowd twinkle so the static image feels alive.
    const cx = w / 2;
    const sheen = ctx.createRadialGradient(cx, h * 0.86, 0, cx, h * 0.86, w * 0.5);
    sheen.addColorStop(0, T.rgba.gold(0.06 + intensity * 0.05));
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    paintFloodlights(ctx, w, h, T, R, intensity, time);
    return;
  }

  paintSky(ctx, w, h, T, R, intensity);
  paintFloodlights(ctx, w, h, T, R, intensity, time);
  paintCrowd(ctx, w, h, T, R, intensity, time);
  paintPitch(ctx, w, h, T, R, intensity, time);
}

function drawCover(ctx, img, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Draw the goal posts, crossbar and net into a screen-space rect.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x0:number,x1:number,y0:number,y1:number}} g
 */
export function drawGoalFrame(ctx, g, opts = {}) {
  const { T, R } = resolve(opts.theme);
  const intensity = opts.intensity ?? 0;
  const w = g.x1 - g.x0;
  const h = g.y1 - g.y0;

  // Net mesh (drawn first, behind the frame). Slight gold tint at higher lvl.
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.x0, g.y0, w, h);
  ctx.clip();
  ctx.lineWidth = 1;
  ctx.strokeStyle = R.net;
  const cell = T.layout.netCell;
  for (let x = g.x0; x <= g.x1; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, g.y0);
    ctx.lineTo(x, g.y1);
    ctx.stroke();
  }
  for (let y = g.y0; y <= g.y1; y += cell) {
    ctx.beginPath();
    ctx.moveTo(g.x0, y);
    ctx.lineTo(g.x1, y);
    ctx.stroke();
  }
  // Net catches a little floodlight glow.
  const ng = ctx.createLinearGradient(0, g.y0, 0, g.y1);
  ng.addColorStop(0, T.rgba.magic(0.06 + intensity * 0.04));
  ng.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ng;
  ctx.fillRect(g.x0, g.y0, w, h);
  ctx.restore();

  // Frame — painted-white posts/crossbar with a drop shadow + gold rim glow.
  const post = Math.max(8, Math.min(w, h) * (T.layout.frameWidth * 2.2));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Shadow pass.
  ctx.strokeStyle = R.frameShadow;
  ctx.lineWidth = post + 4;
  ctx.beginPath();
  ctx.moveTo(g.x0, g.y1);
  ctx.lineTo(g.x0, g.y0);
  ctx.lineTo(g.x1, g.y0);
  ctx.lineTo(g.x1, g.y1);
  ctx.stroke();
  // Gold rim glow (intensifies at finals).
  ctx.shadowColor = T.rgba.magic(0.6 + intensity * 0.3);
  ctx.shadowBlur = 14 + intensity * 12;
  ctx.strokeStyle = R.frame;
  ctx.lineWidth = post;
  ctx.beginPath();
  ctx.moveTo(g.x0, g.y1);
  ctx.lineTo(g.x0, g.y0);
  ctx.lineTo(g.x1, g.y0);
  ctx.lineTo(g.x1, g.y1);
  ctx.stroke();
  ctx.restore();
}

/**
 * Stylized soccer ball with rotating pentagon panels + motion-aware shading.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,r:number,spin?:number,theme?:object}} o
 */
export function drawBall(ctx, o) {
  const { T, R } = resolve(o.theme);
  const { x, y, r } = o;
  const spin = o.spin ?? 0;

  ctx.save();
  // Soft ground/contact shadow.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = r * 0.6;
  ctx.shadowOffsetY = r * 0.25;

  // Body with a light-from-upper-left gradient.
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.7, R.ball);
  grad.addColorStop(1, 'rgb(196,190,178)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Rotating panels (a central pentagon + spokes).
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.fillStyle = R.ballPanel;
  // Center pentagon.
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px = Math.cos(a) * r * 0.34;
    const py = Math.sin(a) * r * 0.34;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // Outer hex hints (short dark spokes).
  ctx.strokeStyle = R.ballPanel;
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34);
    ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    ctx.stroke();
  }
  ctx.restore();

  // Specular highlight.
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.34, r * 0.18, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** Soft gold aura behind the keeper silhouette for separation from the net. */
export function drawKeeperGlow(ctx, g, opts = {}) {
  const { T } = resolve(opts.theme);
  const intensity = opts.intensity ?? 0;
  const cx = (g.x0 + g.x1) / 2;
  const cy = (g.y0 + g.y1) / 2;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, (g.x1 - g.x0) * 0.55);
  rg.addColorStop(0, T.rgba.magic(0.16 + intensity * 0.08));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(g.x0 - 40, g.y0 - 40, g.x1 - g.x0 + 80, g.y1 - g.y0 + 80);
}

/** Async-load a background PNG; resolves null on failure (browser only). */
export function loadBackgroundImage(src) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || !src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Convenience: bind a theme once and get all painters. */
export function makeBackgroundPainter(theme = KEEPER_THEME) {
  return {
    drawBackground: (ctx, o) => drawBackground(ctx, { ...o, theme }),
    drawGoalFrame: (ctx, g, o) => drawGoalFrame(ctx, g, { ...o, theme }),
    drawBall: (ctx, o) => drawBall(ctx, { ...o, theme }),
    drawKeeperGlow: (ctx, g, o) => drawKeeperGlow(ctx, g, { ...o, theme }),
    loadBackgroundImage,
  };
}

export default drawBackground;
