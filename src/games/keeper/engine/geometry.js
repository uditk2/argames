// ===========================================================================
// Keeper — pure geometry helpers (no DOM, no React). Unit-testable.
// ---------------------------------------------------------------------------
// Goal mouth, the scaled-keeper landmark mapping, and the filled-body shield
// save test (torso polygon OR within radius of any thick limb / glove / head).
// ===========================================================================
import { GOAL, KEEPER, SAVE_CAPS, GLOVE_LM, HEAD_LM, TORSO_POLY } from '../config.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Goal mouth rectangle in screen space for a given stage size + width fraction.
 * Centered horizontally; height from GOAL.Y0_FRAC..Y1_FRAC.
 * @returns {{x0,x1,y0,y1,cx,cy,gw,gh}}
 */
export function goalRect(W, H, widthFrac = GOAL.WIDTH_FRAC_BASE) {
  const wf = clamp(widthFrac, 0.2, GOAL.WIDTH_FRAC_MAX);
  const gw = W * wf, gh = H * (GOAL.Y1_FRAC - GOAL.Y0_FRAC);
  const cx = W / 2, x0 = cx - gw / 2, x1 = cx + gw / 2;
  const y0 = H * GOAL.Y0_FRAC, y1 = H * GOAL.Y1_FRAC, cy = (y0 + y1) / 2;
  return { x0, x1, y0, y1, cx, cy, gw, gh };
}

/**
 * Visibility of a landmark (defaults to visible when MediaPipe omits the field).
 */
export function vis(lm, i) {
  const v = lm && lm[i] && lm[i].visibility;
  return v == null ? 1 : v;
}

/**
 * Map a pose landmark index to a screen point for the keeper that's SCALED to
 * fill the goal, with the hip-lean amplified across the goal (the "dive").
 *
 * `reach` and `leanAmp` are level-driven (they SHRINK with level via
 * levelCurve), so a higher level gives the keeper less coverage.
 *
 * @param {Array} lm        mirrored landmarks (x already 1-x'd by the pose source)
 * @param {number} i        landmark index
 * @param {Object} goal     goalRect()
 * @param {number} leanBase standing hip-x baseline (0..1, mirrored)
 * @param {number} reach    body-extent multiplier (levelCurve.reach; default base)
 * @param {number} leanAmp  hip-lean dive amplitude (levelCurve.leanAmp; default base)
 */
export function keeperPoint(lm, i, goal, leanBase, reach = KEEPER.REACH_SCALE, leanAmp = KEEPER.LEAN_AMP) {
  const mxh = (lm[23].x + lm[24].x) / 2;   // hip mid x (already mirrored)
  const myh = (lm[23].y + lm[24].y) / 2;   // hip mid y
  const centreX = goal.cx + (mxh - leanBase) * leanAmp * goal.gw;
  const px = lm[i].x, py = lm[i].y;
  return {
    x: centreX + (px - mxh) * reach * goal.gw,
    y: goal.cy + (py - myh) * reach * KEEPER.REACH_SCALE_Y * goal.gh,
  };
}

// --- low-level geometry ------------------------------------------------------
export function ptSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Nearest point on segment AB to P, plus the distance. Used for contact cues. */
export function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cy = ay + dy * t;
  return { x: cx, y: cy, dist: Math.hypot(px - cx, py - cy) };
}

export function pointInPoly(px, py, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/**
 * Whole-body shield save test. Builds the keeper's on-screen points then checks
 * whether the ball (bx,by,ballR) is intercepted by the torso polygon or any
 * limb capsule / glove / head within its radius.
 *
 * On a SAVE it also returns the CONTACT POINT — the nearest point on the keeper
 * silhouette/limb to the ball — and a `part` tag for the limb that made contact
 * (so the renderer can flash the impact + flare that limb).
 *
 * @returns {{ saved:boolean, dist:number, contact?:{x,y}, part?:[number,number]|number|'torso' }}
 *          dist = signed clearance to nearest body part (>=0)
 */
export function keeperSave(lm, bx, by, ballR, goal, leanBase, H, reach = KEEPER.REACH_SCALE, leanAmp = KEEPER.LEAN_AMP) {
  if (!lm) return { saved: false, dist: 1e9 };
  const limbR = H * KEEPER.LIMB_R_FRAC;
  const gloveR = H * KEEPER.GLOVE_R_FRAC;
  const headR = H * KEEPER.HEAD_R_FRAC;
  const V = KEEPER.VIS_MIN;
  const kp = (i) => keeperPoint(lm, i, goal, leanBase, reach, leanAmp);

  // torso polygon first (cheap, common). Contact = torso centroid for the cue.
  const torso = TORSO_POLY.map(kp);
  if (pointInPoly(bx, by, torso)) {
    const cx = torso.reduce((s, p) => s + p.x, 0) / torso.length;
    const cy = torso.reduce((s, p) => s + p.y, 0) / torso.length;
    return { saved: true, dist: 0, contact: { x: cx, y: cy }, part: 'torso' };
  }

  let best = 1e9, contact = null, part = null;
  for (const [a, b] of SAVE_CAPS) {
    if (vis(lm, a) < V || vis(lm, b) < V) continue;
    const pa = kp(a), pb = kp(b);
    const c = closestOnSeg(bx, by, pa.x, pa.y, pb.x, pb.y);
    const d = c.dist - limbR;
    if (d < best) { best = d; contact = { x: c.x, y: c.y }; part = [a, b]; }
  }
  for (const i of GLOVE_LM) {
    if (vis(lm, i) < V) continue;
    const p = kp(i);
    const d = Math.hypot(bx - p.x, by - p.y) - gloveR;
    if (d < best) { best = d; contact = { x: p.x, y: p.y }; part = i; }
  }
  if (vis(lm, HEAD_LM) >= V) {
    const p = kp(HEAD_LM);
    const d = Math.hypot(bx - p.x, by - p.y) - headR;
    if (d < best) { best = d; contact = { x: p.x, y: p.y }; part = HEAD_LM; }
  }
  const saved = best < ballR;
  const out = { saved, dist: Math.max(0, best) };
  if (saved && contact) { out.contact = contact; out.part = part; }
  return out;
}
