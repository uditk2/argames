// ===========================================================================
// Keeper — CANVAS RENDERER (draws stadium + goal + keeper silhouette + ball).
// ---------------------------------------------------------------------------
// Thin adapter over the self-contained theme-pack painters in
// `../theme/background.js` (procedural night-stadium, goal frame + net, ball,
// keeper aura), parameterized by the current LEVEL for the intensity ramp.
//
// Background art preference order, all with safe fallbacks:
//   1. OpenAI-generated stadium PNG (theme/assets/bg/stadium-*.png), preferred
//      via KEEPER_THEME.bgForLevel(level) → getBackgroundUrl() (null if absent).
//   2. Legacy `assets/bg-stadium.*` slot via getAsset('bg').
//   3. Procedural night-stadium art in theme/background.js (always available).
// A null bgImage falls through to procedural art inside drawBackground().
//
// The keeper silhouette stays here (it's driven by live pose geometry); the
// optional `glove` sprite slot is still honored, else drawKeeperGlow + a gold
// disc are used. Function names mirror the previous renderer so the host
// (ui/Keeper.jsx) call sites are unchanged apart from passing `level`.
// ===========================================================================
import {
  KEEPER_THEME, getAsset, getBackgroundUrl,
  getShooterManifest, getShooterFrameUrls,
} from '../theme.js';
import {
  drawBackground as paintBackground,
  drawGoalFrame as paintGoalFrame,
  drawBall as paintBall,
  drawKeeperGlow as paintKeeperGlow,
  loadBackgroundImage,
} from '../theme/background.js';
import { KSEG, GLOVE_LM, HEAD_LM, TORSO_POLY, KEEPER } from '../config.js';
import { vis } from '../engine/geometry.js';

const R = KEEPER_THEME.roles;

// Lazy-loaded optional sprites/backgrounds (null until decoded; fallbacks until
// then). bgByPath caches per generated-PNG path so a level change that swaps the
// finals backdrop loads once.
let gloveImg = null;
const bgByPath = {};      // resolvedUrl -> Image | null (in-flight = undefined)
let legacyBgImg = null;   // optional assets/bg-stadium.* slot

// Optional SHOOTER kick-cycle sprite (see assets/shooter/). Null until decoded;
// `shooterReady` flips true only when every frame + the manifest are loaded, so
// drawShooter() falls back to the procedural silhouette until the sprite is whole.
let shooterFrames = null;     // [Image,...] in cycle order
let shooterManifest = null;   // { frames, fps, w, h, contactFrame }
let shooterReady = false;
let shooterTried = false;

// Load the shooter sprite (manifest + frames) once, if present. Idempotent.
function ensureShooterSprite() {
  if (shooterTried || typeof Image === 'undefined') return;
  shooterTried = true;
  const man = getShooterManifest();                          // parsed JSON module (no fetch)
  if (!man) return;                                          // no sprite -> stay procedural
  const n = Math.max(1, man.frames | 0);
  const urls = getShooterFrameUrls(n);
  if (urls.length < n) return;                               // incomplete -> stay procedural
  const imgs = new Array(n);
  let loaded = 0;
  urls.forEach((src, i) => {
    const im = new Image();
    im.onload = () => { imgs[i] = im; if (++loaded === n) { shooterFrames = imgs; shooterManifest = man; shooterReady = true; } };
    im.onerror = () => {};
    im.src = src;
  });
}

export function preloadAssets() {
  // Optional glove sprite slot.
  const gUrl = getAsset('glove');
  if (gUrl && typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { gloveImg = im; }; im.src = gUrl; }
  // Optional legacy full-bleed background slot (used if no generated PNG).
  const bgUrl = getAsset('bg');
  if (bgUrl && typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { legacyBgImg = im; }; im.src = bgUrl; }
  // Optional footballer kick-cycle sprite (else procedural silhouette).
  ensureShooterSprite();
  // Warm the generated stadium PNGs for each time-of-day tier (day/night/finals).
  ensureBgForLevel(1);   // day  (levels 1–3)
  ensureBgForLevel(4);   // night (levels 4–8)
  ensureBgForLevel(9);   // finals (levels 9+)
}

// Kick off (once) the async load of the generated PNG for a level's bg, if any.
function ensureBgForLevel(level) {
  const url = getBackgroundUrl(KEEPER_THEME.bgForLevel(level));
  if (!url || bgByPath[url] !== undefined) return;
  bgByPath[url] = null;                 // mark in-flight (null = not ready yet)
  loadBackgroundImage(url).then((img) => { bgByPath[url] = img || null; });
}

/** Resolve the best-available bg image for a level (generated PNG > legacy slot > null). */
function bgImageForLevel(level) {
  const url = getBackgroundUrl(KEEPER_THEME.bgForLevel(level));
  if (url) { ensureBgForLevel(level); if (bgByPath[url]) return bgByPath[url]; }
  return legacyBgImg || null;
}

/**
 * Background: generated/loaded stadium image (cover) if present, else the
 * procedural floodlit night-stadium. Intensity ramps with level.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {number} [level=1]
 * @param {number} [time=0] performance.now() for live flicker/twinkle
 */
export function drawBackground(ctx, W, H, level = 1, time = 0) {
  paintBackground(ctx, { w: W, h: H, level, time, bgImage: bgImageForLevel(level) });
}

/** Goal net + frame (theme-pack painter), with a soft keeper aura behind it. */
export function drawGoal(ctx, goal, level = 1) {
  const intensity = KEEPER_THEME.intensity(level);
  const rect = { x0: goal.x0, x1: goal.x1, y0: goal.y0, y1: goal.y1 };
  paintKeeperGlow(ctx, rect, { intensity });
  paintGoalFrame(ctx, rect, { intensity });
}

/**
 * Keeper as a FILLED silhouette (no wireframe gaps), scaled to the goal.
 * Driven by live pose geometry, so it stays in the renderer (not the theme pack).
 * @param kp     (i) => {x,y} keeper screen point for landmark i
 * @param lm     landmarks (for visibility gating)
 * @param flare  optional { part, k } — limb (segment [a,b] | index | 'torso')
 *               that just made a save + k (0..1 fade). Briefly flared gold/white.
 */
export function drawKeeper(ctx, lm, kp, H, flare = null) {
  if (!lm) return;
  const V = KEEPER.VIS_MIN;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = R.keeperGlow; ctx.shadowBlur = 16;
  const fk = flare ? Math.max(0, Math.min(1, flare.k)) : 0;
  const isSegFlare = (a, b) => flare && Array.isArray(flare.part) && ((flare.part[0] === a && flare.part[1] === b) || (flare.part[0] === b && flare.part[1] === a));
  // filled torso quad
  const poly = TORSO_POLY.map(kp);
  ctx.fillStyle = (flare && flare.part === 'torso' && fk > 0) ? KEEPER_THEME.rgba.gold(0.55 + 0.4 * fk) : R.keeper;
  ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y); ctx.closePath(); ctx.fill();
  // thick limb capsules (flare the one that made contact)
  const baseLW = Math.max(16, H * 0.05);
  for (const [a, b] of KSEG) {
    if (vis(lm, a) < V || vis(lm, b) < V) continue;
    const pa = kp(a), pb = kp(b);
    const hot = isSegFlare(a, b) && fk > 0;
    ctx.strokeStyle = hot ? KEEPER_THEME.rgba.gold(0.7 + 0.3 * fk) : R.keeperLimb;
    ctx.lineWidth = hot ? baseLW * (1 + 0.5 * fk) : baseLW;
    if (hot) { ctx.shadowColor = KEEPER_THEME.rgba.gold(0.95); ctx.shadowBlur = 26 + 24 * fk; }
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    if (hot) { ctx.shadowColor = R.keeperGlow; ctx.shadowBlur = 16; }
  }
  // head
  if (vis(lm, HEAD_LM) >= V) {
    const p = kp(HEAD_LM); const hot = flare && flare.part === HEAD_LM && fk > 0;
    ctx.fillStyle = hot ? KEEPER_THEME.rgba.gold(0.7 + 0.3 * fk) : R.keeperLimb;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(18, H * 0.05), 0, 7); ctx.fill();
  }
  // gloves (sprite slot or gold disc)
  ctx.shadowColor = KEEPER_THEME.rgba.gold(0.9); ctx.shadowBlur = 18;
  for (const i of GLOVE_LM) {
    if (vis(lm, i) < V) continue;
    const p = kp(i); const hot = flare && flare.part === i && fk > 0;
    const r = Math.max(16, H * 0.034) * (hot ? 1 + 0.4 * fk : 1);
    if (hot) { ctx.shadowColor = KEEPER_THEME.rgba.gold(0.95); ctx.shadowBlur = 24 + 20 * fk; }
    if (gloveImg && gloveImg.naturalWidth) { ctx.drawImage(gloveImg, p.x - r, p.y - r, r * 2, r * 2); }
    else { ctx.fillStyle = R.keeperGlove; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); }
  }
  ctx.shadowBlur = 0;
}

/**
 * Quick impact cue at the contact point of a save: an expanding white/gold flash
 * ring that fades over the deflect window. `k` is 0..1 progress (0=fresh).
 * @param {{x:number,y:number}} pt contact point
 * @param {number} k  0..1 deflect progress
 * @param {number} H  stage height (for sizing)
 */
export function drawImpact(ctx, pt, k, H) {
  if (!pt) return;
  const kk = Math.max(0, Math.min(1, k));
  const a = 1 - kk;                            // fade out
  const baseR = H * 0.045;
  const r = baseR * (0.4 + kk * 2.4);          // expand outward
  ctx.save();
  // outer gold ring
  ctx.strokeStyle = KEEPER_THEME.rgba.gold(0.85 * a);
  ctx.lineWidth = Math.max(3, H * 0.012) * a + 1;
  ctx.shadowColor = KEEPER_THEME.rgba.gold(0.9 * a); ctx.shadowBlur = 24 * a;
  ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, 7); ctx.stroke();
  // inner white burst (brief)
  if (kk < 0.5) {
    const ia = (1 - kk * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.65 * ia})`;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, baseR * (0.5 + kk) , 0, 7); ctx.fill();
  }
  ctx.restore();
}

/**
 * The SHOOTER — a stylized dark silhouette (theme keeper colors, NOT a photo)
 * standing at the far end of the pitch where the ball spawns. It runs up + winds
 * its kicking leg during the shot's WIND-UP, then plants & swings at the moment
 * of the kick so the ball visibly originates from its foot.
 *
 * Drawn small (it's far away, in perspective). `sh` is the engine shooterState():
 *   { st, x, y, windK, kicked, kickK?, dir, tx }
 * The figure is anchored so its KICKING FOOT sits at (sh.x, sh.y) == ball spawn,
 * so the ball leaves the foot cleanly.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} sh  engine shooter state (or null)
 * @param {number} H   stage height (for perspective sizing)
 * @param {number} now performance.now()
 */
export function drawShooter(ctx, sh, H, now) {
  if (!sh) return;
  ensureShooterSprite();
  if (shooterReady) { drawShooterSprite(ctx, sh, H, now); return; }
  drawShooterProcedural(ctx, sh, H, now);
}

/**
 * SPRITE shooter — plays the extracted footballer kick-cycle frames synced to the
 * engine's wind-up / kick, anchored so the CONTACT frame's boot meets the ball
 * spawn point (sh.x, sh.y). Used only when the full sprite is loaded; otherwise
 * drawShooter() falls back to drawShooterProcedural() below.
 *
 * Frame timeline (manifest.frames = N, manifest.contactFrame = C):
 *   • st 'wind'  → scrub frames 0..C over windK   (stance → back-swing → pre-strike)
 *   • kicked     → scrub frames C..N-1 over kickK  (strike → follow-through → settle)
 * The boot of frame C sits at (sh.x, sh.y), so the ball leaves the foot at contact.
 */
function drawShooterSprite(ctx, sh, H, now) {
  const N = shooterFrames.length;
  const C = Math.max(0, Math.min(N - 1, (shooterManifest.contactFrame | 0) || Math.floor(N / 2)));
  const wk = Math.max(0, Math.min(1, sh.windK || 0));
  const kickK = sh.kicked ? Math.max(0, Math.min(1, sh.kickK != null ? sh.kickK : 1)) : 0;

  // Pick the frame: wind-up loads 0..C (eased so the back-swing reads late), then
  // the strike/follow-through scrubs C..N-1 over kickK and holds the last frame.
  let idx;
  if (!sh.kicked) {
    idx = Math.round((wk * wk) * C);             // ease-in: slow load, late surge
  } else {
    idx = C + Math.round(kickK * (N - 1 - C));
  }
  idx = Math.max(0, Math.min(N - 1, idx));
  const im = shooterFrames[idx];
  if (!im || !im.naturalWidth) { drawShooterProcedural(ctx, sh, H, now); return; }

  // Perspective size: a slim figure a few ball-widths tall (matches the silhouette).
  const fh0 = Math.max(40, H * 0.16);            // on-screen figure height at the ball
  const ar = im.naturalWidth / im.naturalHeight;

  // --- RUN-UP TRANSLATION -------------------------------------------------
  // At the START of the wind-up the figure stands a couple of steps BEHIND the
  // ball (further UP-pitch, away from the camera) and a touch SMALLER in
  // perspective; it slides ONTO the ball-spawn point and grows to full size by
  // the contact frame, so the kicking boot meets the ball exactly at the strike.
  // After the kick it holds in place at the spawn (follow-through / settle).
  //   approach = 0 at wind start  → 1 at contact (and stays 1 after the kick).
  // windK eases the run; we square it so the player accelerates into the strike.
  const approach = sh.kicked ? 1 : (wk * wk);
  const stepBack = fh0 * 0.16;                   // tiny vertical — he stays on the ground (no sky-dive)
  const persp = 0.92 + 0.08 * approach;          // barely changes size — he runs ACROSS, not in from depth
  const fh = fh0 * persp;
  const fw = fh * ar;

  // Anchor the CONTACT frame's boot at the ball spawn (sh.x, sh.y). Frames are
  // foot-anchored bottom-centre by the extractor, so the boot ≈ bottom-centre;
  // we pin bottom-centre to the spawn point and lift the figure up from there.
  // "Behind" = up-pitch (smaller y) AND slightly to the back-foot side so the
  // run-up reads as a diagonal approach onto the ball.
  const dir = sh.dir || 1;                       // +1 aim right, -1 aim left
  const backY = stepBack * (1 - approach);       // small vertical, gone by contact
  const backX = fh0 * 1.4 * (1 - approach) * dir;  // strong HORIZONTAL run-in — diagonal approach along the ground
  const footX = sh.x - backX;                    // mirror flips the visual side below
  const footY = sh.y - backY;
  const dx = footX - fw / 2;
  const dy = footY - fh;

  ctx.save();
  // mirror horizontally when aiming left so the kick reads toward that side.
  if (dir < 0) {
    ctx.translate(sh.x, 0); ctx.scale(-1, 1); ctx.translate(-sh.x, 0);
  }
  ctx.shadowColor = R.keeperGlow; ctx.shadowBlur = 8;
  ctx.drawImage(im, dx, dy, fw, fh);
  ctx.restore();

  // run-up dust ticks during the wind-up (mirrors the silhouette's motion tell).
  if (sh.st === 'wind' && wk > 0.05) {
    ctx.save();
    ctx.strokeStyle = KEEPER_THEME.rgba.gold(0.25 * wk);
    ctx.lineWidth = Math.max(1.5, fh * 0.03);
    const s = fh * 0.5;
    for (let i = 1; i <= 3; i++) {
      const ddx = -dir * s * (0.3 + i * 0.22);
      ctx.beginPath(); ctx.moveTo(footX + ddx, footY); ctx.lineTo(footX + ddx + dir * s * 0.12, footY); ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * PROCEDURAL silhouette shooter (fallback when no kick sprite is present).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} sh  engine shooter state
 * @param {number} H   stage height (for perspective sizing)
 * @param {number} now performance.now()
 */
function drawShooterProcedural(ctx, sh, H, now) {
  // Perspective scale: small (far). Height ~ a slim figure a few ball-widths tall.
  const s = Math.max(26, H * 0.085);            // overall figure height (px)
  const dir = sh.dir || 1;                      // +1 aim right, -1 aim left
  // Wind-up brings the body back/coiled; the kick swings the leg through.
  const wk = Math.max(0, Math.min(1, sh.windK || 0));
  // ease the run-up coil so the tell reads (slow load, late surge).
  const coil = wk * wk;
  const kickK = sh.kicked ? Math.max(0, Math.min(1, sh.kickK != null ? sh.kickK : 1)) : 0;

  // Anchor: the ball spawns at (sh.x, sh.y) and must come OFF the kicking foot,
  // so we place the planted (standing) foot a touch behind, and draw the body up
  // from there. The kicking foot reaches toward (sh.x, sh.y) at contact.
  const footX = sh.x, footY = sh.y;             // where the ball launches from
  const standX = footX - dir * s * 0.34;        // planted foot, slightly behind
  const hipX = standX + dir * s * 0.05;
  const hipY = footY - s * 0.52;                // hips above the planted foot
  const shY = hipY - s * 0.40;                  // shoulders
  const headY = shY - s * 0.18;

  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = R.keeperLimb;               // theme gold-ish limbs (silhouette)
  ctx.fillStyle = R.keeper;                     // molten-gold torso fill
  ctx.shadowColor = R.keeperGlow; ctx.shadowBlur = 8;
  const lw = Math.max(3, s * 0.13);
  ctx.lineWidth = lw;

  // --- torso (lean: coils back during wind, snaps forward through the kick) ---
  const leanBack = (1 - kickK) * coil;          // peaks at end of wind, gone after kick
  const lean = (-0.18 * leanBack + 0.22 * kickK) * dir;   // radians-ish body tilt
  const txS = Math.sin(lean) * s * 0.22;        // horizontal shoulder offset
  const shX = hipX + txS;
  // torso capsule
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
  // head
  ctx.beginPath(); ctx.arc(shX + Math.sin(lean) * s * 0.04, headY, s * 0.13, 0, 7); ctx.fill();

  // --- planted (standing) leg: hip -> knee -> planted foot ---
  const skneeX = hipX - dir * s * 0.04, skneeY = hipY + s * 0.26;
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(skneeX, skneeY); ctx.lineTo(standX, footY); ctx.stroke();

  // --- kicking leg: swings from coiled-back (wind) through the ball (kick) ---
  // angle 0 = straight down. Back-swing during wind (negative w.r.t. dir), then
  // swings forward to reach the ball at contact and follows through.
  const back = -0.9 * coil * (1 - kickK);       // coiled back at end of wind
  const through = 1.15 * kickK;                 // swings through on the kick
  const swing = (back + through) * dir;
  const thighLen = s * 0.32, shinLen = s * 0.30;
  const kkneeX = hipX + Math.sin(swing) * thighLen;
  const kkneeY = hipY + Math.cos(swing) * thighLen;
  // shin extends further on the follow-through (leg straightens through the ball)
  const shinAng = swing + dir * (0.25 - 0.45 * kickK);
  let kfootX = kkneeX + Math.sin(shinAng) * shinLen;
  let kfootY = kkneeY + Math.cos(shinAng) * shinLen;
  // at/after contact, snap the kicking foot onto the ball-launch point so the
  // ball reads as coming straight off the boot.
  if (kickK > 0.15) {
    const t = Math.min(1, (kickK - 0.15) / 0.5);
    kfootX += (footX - kfootX) * t;
    kfootY += (footY - kfootY) * t;
  }
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kkneeX, kkneeY); ctx.lineTo(kfootX, kfootY); ctx.stroke();

  // --- arms (counter-balance: opposite arm out on the kick) ---
  const armSwing = (0.5 - kickK) * dir;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(shX, shY + s * 0.04);
  ctx.lineTo(shX - dir * s * 0.20 - Math.sin(armSwing) * s * 0.12, shY + s * 0.20);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shX, shY + s * 0.04);
  ctx.lineTo(shX + dir * s * 0.18 + Math.sin(armSwing) * s * 0.10, shY + s * 0.22);
  ctx.stroke();

  // --- run-up dust / motion ticks behind the shooter during the wind-up ---
  if (sh.st === 'wind' && wk > 0.05) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = KEEPER_THEME.rgba.gold(0.25 * wk);
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    for (let i = 1; i <= 3; i++) {
      const dx = -dir * s * (0.3 + i * 0.22);
      ctx.beginPath(); ctx.moveTo(standX + dx, footY); ctx.lineTo(standX + dx + dir * s * 0.12, footY); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Ball: telegraph ring during wind-up, then the stylized panelled flying ball. */
export function drawBall(ctx, ball, now) {
  if (!ball) return;
  if (ball.st === 'wind') {
    // The shooter now carries the wind-up tell; the ball sits AT ITS FOOT ready
    // to be struck. Draw the resting ball plus a tightening charge ring that
    // pulses to the kick (still a clear reaction-window timing cue).
    const spin = (now * 0.004) % (Math.PI * 2);
    paintBall(ctx, { x: ball.x, y: ball.y, r: ball.r, spin });
    const pulse = 0.35 + 0.45 * Math.sin(now * 0.02);
    // ring shrinks toward the ball as the wind-up completes -> imminent strike.
    const ringR = ball.r * (2.4 - ball.windK * 1.2);
    ctx.strokeStyle = KEEPER_THEME.rgba.gold((0.3 + 0.5 * ball.windK) * pulse);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ringR, 0, 7); ctx.stroke();
    return;
  }
  if (ball.st === 'deflect') {
    // ball ricocheting off the keeper: a short motion trail behind it along the
    // deflection vector, then the spinning ball (spin faster from the impact).
    const vl = Math.hypot(ball.vx || 0, ball.vy || 0) || 1;
    const ux = (ball.vx || 0) / vl, uy = (ball.vy || 0) / vl;
    const trail = ball.r * 2.6 * (1 - ball.k);
    ctx.save();
    const grd = ctx.createLinearGradient(ball.x - ux * trail, ball.y - uy * trail, ball.x, ball.y);
    grd.addColorStop(0, KEEPER_THEME.rgba.gold(0));
    grd.addColorStop(1, KEEPER_THEME.rgba.gold(0.5 * (1 - ball.k)));
    ctx.strokeStyle = grd; ctx.lineWidth = ball.r * 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ball.x - ux * trail, ball.y - uy * trail); ctx.lineTo(ball.x, ball.y); ctx.stroke();
    ctx.restore();
    const spin = (now * 0.04) % (Math.PI * 2);   // faster spin after the strike
    paintBall(ctx, { x: ball.x, y: ball.y, r: ball.r, spin });
    return;
  }
  // spin from horizontal flight progress so the panels rotate as it flies.
  const spin = (now * 0.01) % (Math.PI * 2);
  paintBall(ctx, { x: ball.x, y: ball.y, r: ball.r, spin });
}
