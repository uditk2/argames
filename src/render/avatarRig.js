// ===========================================================================
// AVATAR RIG — a rigged 2D "sleek vector fighter" puppeted by the pose.
// ---------------------------------------------------------------------------
// This module is fully SELF-CONTAINED and decoupled from the scene: it owns a
// single Pixi Container (`root`) and knows how to (re)draw a stylized humanoid
// from MediaPipe Pose landmarks each frame. The scene just:
//
//     const rig = createAvatarRig({ COLOR });
//     playerLayer.addChild(rig.root);
//     // per frame:
//     rig.draw(pose, { px, visible, dims, now, shielding, energetic });
//     const { left, right } = rig.wrists();   // px positions for punch FX
//
// Nothing here reads game state or scene globals — every per-frame input is
// passed in via the `ctx` object, so the rig can be unit-tested or reused in
// another scene without modification.
//
// The character is drawn ENTIRELY with vector Graphics (no art assets): limbs
// are round-capped capsules, the torso is a set of overlapping capsules that
// blob into a smooth trunk, the head is a circle with a visor, and the fists
// are glowing energy gloves. Glow is faked with layered translucent strokes
// (NO blur filters) so it stays cheap on phones.
//
// Coordinate contract: `pose` is the array of (already-mirrored) MediaPipe
// landmarks in normalized 0..1 space; `ctx.px(p)` maps one to {x,y} pixels and
// `ctx.visible(p)` reports whether a landmark is confident enough to use.
// ===========================================================================

import { Container, Graphics } from 'pixi.js';

// MediaPipe Pose landmark indices this rig consumes.
const J = {
  nose: 0,
  leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftFoot: 31, rightFoot: 32,
};

/**
 * @param {object} opts
 * @param {Record<string, number>} opts.COLOR  numeric 0xRRGGBB theme palette
 * @returns {{
 *   root: Container,
 *   draw: (pose: Array|null, ctx: object) => void,
 *   wrists: () => {left: {x,y}|null, right: {x,y}|null},
 *   setVisible: (v: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createAvatarRig({ COLOR } = {}) {
  const C = COLOR || {};

  // --- Palette (sleek vector fighter) ------------------------------------
  const BODY = 0x232a4d;        // deep indigo-steel limbs / trunk
  const BODY_LIGHT = 0x49579a;  // sheen highlight down each tube
  const RIM = C.shield ?? 0x57e3ff;   // crisp cyan energy edge
  const GLOVE = C.fire ?? 0xff7a3c;   // hot energy gloves
  const GLOVE_CORE = 0xffe7a8;        // white-gold glove core
  const VISOR = C.shield ?? 0x57e3ff; // helmet visor

  // --- Layers (back -> front), all inside one root container -------------
  const root = new Container();
  const glow = new Graphics();      // soft additive outer halo
  glow.blendMode = 'add';
  const body = new Graphics();      // rim + solid limbs/torso/head
  const detail = new Graphics();    // sheen, visor, glove bodies
  const gloveGlow = new Graphics(); // additive glove halos (front)
  gloveGlow.blendMode = 'add';
  root.addChild(glow, body, detail, gloveGlow);

  // Last computed wrist pixel positions (for the scene's punch-burst FX).
  let lastWrists = { left: null, right: null };

  // ----- small geometry helpers -----
  function mid(a, b) {
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return a || b || null;
  }
  // A capsule = a thick, round-capped line segment.
  function capsule(g, a, b, w, color, alpha = 1) {
    if (!a || !b || w <= 0) return;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      .stroke({ color, width: w, alpha, cap: 'round', join: 'round' });
  }

  /**
   * Redraw the whole avatar for this frame. Null-safe end to end: any missing
   * or low-confidence landmark simply omits that body part (never throws).
   */
  function draw(pose, ctx) {
    glow.clear();
    body.clear();
    detail.clear();
    gloveGlow.clear();
    lastWrists = { left: null, right: null };
    if (!pose) return;

    const { px, visible, dims, now = 0, shielding = false, energetic = false } = ctx;

    // Resolve a landmark to pixels only if it's confidently tracked.
    const P = (i) => {
      const p = pose[i];
      return p && visible(p) ? px(p) : null;
    };

    const Lsh = P(J.leftShoulder), Rsh = P(J.rightShoulder);
    const Lel = P(J.leftElbow), Rel = P(J.rightElbow);
    const Lwr = P(J.leftWrist), Rwr = P(J.rightWrist);
    const Lhip = P(J.leftHip), Rhip = P(J.rightHip);
    const Lkn = P(J.leftKnee), Rkn = P(J.rightKnee);
    const Lank = P(J.leftAnkle), Rank = P(J.rightAnkle);
    const Lft = P(J.leftFoot), Rft = P(J.rightFoot);
    const nose = P(J.nose), Lear = P(J.leftEar), Rear = P(J.rightEar);

    lastWrists = { left: Lwr, right: Rwr };

    const shMid = mid(Lsh, Rsh);
    const hipMid = mid(Lhip, Rhip);

    // Body scale unit — derive from shoulder width, fall back to hips, then to
    // a fraction of the canvas so the rig still reads if the torso is partial.
    let unit;
    if (Lsh && Rsh) unit = Math.hypot(Rsh.x - Lsh.x, Rsh.y - Lsh.y);
    else if (Lhip && Rhip) unit = Math.hypot(Rhip.x - Lhip.x, Rhip.y - Lhip.y) * 1.3;
    else unit = dims.H * 0.12;
    unit = Math.max(unit, dims.H * 0.045);   // floor so it never collapses

    // Derived limb thicknesses + sizes.
    const wUpperArm = unit * 0.30;
    const wForearm = unit * 0.25;
    const wThigh = unit * 0.38;
    const wShin = unit * 0.30;
    const wNeck = unit * 0.30;
    const wFoot = unit * 0.26;
    const headR = unit * 0.50;
    const gloveR = unit * 0.30 * (energetic ? 1.18 : 1);
    const rimW = unit * 0.07;              // crisp accent edge thickness
    const pulse = 0.82 + 0.18 * Math.sin(now / 500);
    const accent = shielding ? VISOR : RIM;

    // Limb segments: [a, b, width].
    const limbs = [
      [Lsh, Lel, wUpperArm], [Lel, Lwr, wForearm],
      [Rsh, Rel, wUpperArm], [Rel, Rwr, wForearm],
      [Lhip, Lkn, wThigh], [Lkn, Lank, wShin],
      [Rhip, Rkn, wThigh], [Rkn, Rank, wShin],
    ];

    // Feet (toward foot landmark, else a short stub below the ankle).
    const feet = [
      [Lank, Lft || (Lank && { x: Lank.x, y: Lank.y + unit * 0.16 }), wFoot],
      [Rank, Rft || (Rank && { x: Rank.x, y: Rank.y + unit * 0.16 }), wFoot],
    ];

    // Torso as overlapping capsules (shoulder bar + spine + hip bar) — blobs
    // into a smooth, slightly tapered trunk and survives a missing hip.
    const torso = [];
    if (Lsh && Rsh) torso.push([Lsh, Rsh, unit * 0.46]);
    if (shMid && hipMid) torso.push([shMid, hipMid, unit * 0.60]);
    if (Lhip && Rhip) torso.push([Lhip, Rhip, unit * 0.42]);

    // Neck.
    const headC0 = (Lear && Rear) ? mid(Lear, Rear) : nose;
    const headR2 = (Lear && Rear)
      ? Math.max(headR, Math.hypot(Rear.x - Lear.x, Rear.y - Lear.y) * 0.72)
      : headR;
    const headC = headC0 || (shMid ? { x: shMid.x, y: shMid.y - unit * 0.7 } : null);

    // ---- PASS 1: soft additive outer glow (cheap fake bloom) -------------
    const gA = 0.11 * pulse;
    for (const [a, b, w] of [...torso, ...limbs, ...feet]) {
      capsule(glow, a, b, w + rimW * 2.2, accent, gA);
    }
    if (headC) glow.circle(headC.x, headC.y, headR2 + rimW * 2.4).fill({ color: accent, alpha: gA });

    // ---- PASS 2: crisp accent RIM, then solid BODY fill -----------------
    // Rim first (slightly wider) so the fill leaves a clean energy edge.
    if (headC && shMid) capsule(body, shMid, headC, wNeck + rimW * 1.6, accent, 0.95);
    for (const [a, b, w] of [...torso, ...feet, ...limbs]) {
      capsule(body, a, b, w + rimW * 1.6, accent, 0.95);
    }
    if (headC) body.circle(headC.x, headC.y, headR2 + rimW * 1.4).fill({ color: accent, alpha: 0.95 });

    // Solid body fill on top of the rim.
    if (headC && shMid) capsule(body, shMid, headC, wNeck, BODY, 1);
    for (const [a, b, w] of [...torso, ...feet, ...limbs]) {
      capsule(body, a, b, w, BODY, 1);
    }
    if (headC) body.circle(headC.x, headC.y, headR2).fill({ color: BODY, alpha: 1 });

    // ---- PASS 3: detail — sheen highlights, chest seam, helmet visor ----
    // A thin lighter tube down the center of each limb gives a rounded sheen.
    for (const [a, b, w] of limbs) {
      capsule(detail, a, b, w * 0.34, BODY_LIGHT, 0.5);
    }
    if (shMid && hipMid) capsule(detail, shMid, hipMid, unit * 0.18, BODY_LIGHT, 0.4); // chest seam
    if (headC) {
      // Visor band across the helmet.
      detail.ellipse(headC.x, headC.y - headR2 * 0.04, headR2 * 0.72, headR2 * 0.34)
        .fill({ color: VISOR, alpha: 0.85 });
      detail.ellipse(headC.x, headC.y - headR2 * 0.04, headR2 * 0.72, headR2 * 0.34)
        .fill({ color: 0x081226, alpha: 0.45 });
      // bright eye glints
      detail.circle(headC.x - headR2 * 0.28, headC.y - headR2 * 0.04, headR2 * 0.10)
        .fill({ color: 0xeafcff, alpha: 0.9 });
      detail.circle(headC.x + headR2 * 0.28, headC.y - headR2 * 0.04, headR2 * 0.10)
        .fill({ color: 0xeafcff, alpha: 0.9 });
    }

    // ---- PASS 4: glowing energy gloves at both wrists -------------------
    for (const w of [Lwr, Rwr]) {
      if (!w) continue;
      // additive halo
      gloveGlow.circle(w.x, w.y, gloveR * 2.1).fill({ color: GLOVE, alpha: 0.18 * pulse });
      gloveGlow.circle(w.x, w.y, gloveR * 1.3).fill({ color: GLOVE, alpha: 0.22 * pulse });
      // glove body (dark rim -> fire -> hot core)
      detail.circle(w.x, w.y, gloveR + rimW).fill({ color: BODY, alpha: 1 });
      detail.circle(w.x, w.y, gloveR).fill({ color: GLOVE, alpha: 1 });
      detail.circle(w.x, w.y, gloveR * 0.5).fill({ color: GLOVE_CORE, alpha: 0.95 });
    }
  }

  return {
    root,
    draw,
    wrists: () => lastWrists,
    setVisible: (v) => { root.visible = !!v; },
    destroy: () => { try { root.destroy({ children: true }); } catch {} },
  };
}
