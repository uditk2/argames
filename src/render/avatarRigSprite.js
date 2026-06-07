// ===========================================================================
// AVATAR RIG (SVG CUTOUT) — a segmented 2D fighter puppeted by the pose.
// ---------------------------------------------------------------------------
// This is the "good-looking" rig: instead of drawing capsules, it loads a set
// of SVG body-part textures (public/assets/avatar/*.svg) and positions /
// rotates / scales each one onto the matching bone from the MediaPipe pose, so
// the character bends at the elbows, knees, shoulders and hips and tracks your
// movement as a proper cutout puppet.
//
// SAME PUBLIC INTERFACE as render/avatarRig.js (the vector fallback):
//     const rig = await createAvatarRigSprite({ COLOR });
//     playerLayer.addChild(rig.root);
//     rig.draw(pose, { px, visible, dims, now, shielding, energetic });
//     const { left, right } = rig.wrists();
//
// >>> SWAPPING THE ART: drop replacement SVGs into public/assets/avatar/ with
//     the same filenames, OR edit PART_CFG below (each part declares its pivot
//     anchor as a texture fraction + the bone-length fraction). Nothing in the
//     scene changes. <<<
//
// Decoupled: every per-frame input arrives via the `ctx` object; the module
// never reads scene or game globals. Fully null-safe — any missing landmark
// just hides that body part.
// ===========================================================================

import { Assets, Container, Sprite } from 'pixi.js';

const ASSET_DIR = '/assets/avatar';

// MediaPipe Pose landmark indices.
const J = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

// Per-part rig config. `anchor` = [x,y] fraction of the texture where the
// PROXIMAL joint sits (the part rotates/positions about this). `lenFrac` = the
// proximal→distal bone length as a fraction of the texture HEIGHT (so the part
// scales to the live bone length). These MUST match the art in *.svg.
const PART_CFG = {
  torso:    { file: 'torso.svg',    anchor: [0.5, 0.11], lenFrac: 0.80, shoulderFrac: 0.80 },
  head:     { file: 'head.svg',     anchor: [0.5, 0.42] },
  upperarm: { file: 'upperarm.svg', anchor: [0.5, 0.16], lenFrac: 0.74 },
  forearm:  { file: 'forearm.svg',  anchor: [0.5, 0.15], lenFrac: 0.62 },
  thigh:    { file: 'thigh.svg',    anchor: [0.5, 0.13], lenFrac: 0.78 },
  shin:     { file: 'shin.svg',     anchor: [0.5, 0.12], lenFrac: 0.71 },
};

// Load an SVG as a crisp texture (try a higher rasterization resolution, fall
// back to the default loader if the data option isn't supported).
async function loadSvg(url) {
  try {
    const t = await Assets.load({ src: url, data: { resolution: 3 } });
    if (t) return t;
  } catch { /* fall through */ }
  return Assets.load(url);
}

/**
 * @param {{ COLOR?: Record<string, number> }} opts
 * @returns {Promise<object>} rig with the shared interface
 */
export async function createAvatarRigSprite({ COLOR } = {}) {
  // Load all part textures up front; if ANY fail, throw so the scene can fall
  // back to the vector rig (we never want a half-drawn character).
  const tex = {};
  await Promise.all(
    Object.entries(PART_CFG).map(async ([key, cfg]) => {
      const t = await loadSvg(`${ASSET_DIR}/${cfg.file}`);
      if (!t || !t.width) throw new Error(`avatar part failed: ${cfg.file}`);
      tex[key] = t;
    })
  );

  const root = new Container();

  // Build a sprite for a part with its proximal-joint anchor pre-set.
  function makeSprite(key) {
    const s = new Sprite(tex[key]);
    const [ax, ay] = PART_CFG[key].anchor;
    s.anchor.set(ax, ay);
    s.visible = false;
    root.addChild(s);
    return s;
  }

  // Add back -> front so closer parts overlay farther ones.
  const sp = {
    thighL: makeSprite('thigh'), thighR: makeSprite('thigh'),
    shinL: makeSprite('shin'), shinR: makeSprite('shin'),
    torso: makeSprite('torso'),
    upperL: makeSprite('upperarm'), upperR: makeSprite('upperarm'),
    foreL: makeSprite('forearm'), foreR: makeSprite('forearm'),
    head: makeSprite('head'),
  };

  let lastWrists = { left: null, right: null };

  function hideAll() {
    for (const s of Object.values(sp)) s.visible = false;
  }
  function mid(a, b) {
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return a || b || null;
  }

  // Place a limb sprite so its proximal anchor sits at P and its art "down"
  // axis points toward D, scaled to the bone length. `flip` mirrors shading.
  function placeBone(s, key, P, D, { flip = false, widthK = 1 } = {}) {
    if (!P || !D) { s.visible = false; return; }
    const dx = D.x - P.x, dy = D.y - P.y;
    const L = Math.hypot(dx, dy) || 1;
    const artLen = PART_CFG[key].lenFrac * s.texture.height;
    const sc = L / artLen;
    s.visible = true;
    s.position.set(P.x, P.y);
    // Pixi (y-down): align local +y with (dx,dy) -> rotation = atan2(-dx, dy).
    s.rotation = Math.atan2(-dx, dy);
    s.scale.set(sc * widthK * (flip ? -1 : 1), sc);
  }

  /**
   * Redraw the rig for this frame. `ctx`: { px, visible, dims, now, shielding,
   * energetic }. Null-safe throughout.
   */
  function draw(pose, ctx) {
    lastWrists = { left: null, right: null };
    if (!pose) { hideAll(); return; }
    const { px, visible } = ctx;

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
    const nose = P(J.nose), Lear = P(J.leftEar), Rear = P(J.rightEar);

    lastWrists = { left: Lwr, right: Rwr };

    const shMid = mid(Lsh, Rsh);
    const hipMid = mid(Lhip, Rhip);

    // Legs (behind).
    placeBone(sp.thighL, 'thigh', Lhip, Lkn);
    placeBone(sp.thighR, 'thigh', Rhip, Rkn, { flip: true });
    placeBone(sp.shinL, 'shin', Lkn, Lank);
    placeBone(sp.shinR, 'shin', Rkn, Rank, { flip: true });

    // Torso: scale.x by live shoulder width, scale.y by torso length.
    if (shMid && hipMid && Lsh && Rsh) {
      const cfg = PART_CFG.torso;
      const t = sp.torso;
      const shoulderW = Math.hypot(Rsh.x - Lsh.x, Rsh.y - Lsh.y);
      const torsoLen = Math.hypot(hipMid.x - shMid.x, hipMid.y - shMid.y) || 1;
      const sy = torsoLen / (cfg.lenFrac * t.texture.height);
      const sx = shoulderW / (cfg.shoulderFrac * t.texture.width);
      t.visible = true;
      t.position.set(shMid.x, shMid.y);
      const dx = hipMid.x - shMid.x, dy = hipMid.y - shMid.y;
      t.rotation = Math.atan2(-dx, dy);
      t.scale.set(sx, sy);
    } else {
      sp.torso.visible = false;
    }

    // Arms (front of torso).
    placeBone(sp.upperL, 'upperarm', Lsh, Lel);
    placeBone(sp.upperR, 'upperarm', Rsh, Rel, { flip: true });
    placeBone(sp.foreL, 'forearm', Lel, Lwr);
    placeBone(sp.foreR, 'forearm', Rel, Rwr, { flip: true });

    // Head: position at head center, lean with the torso.
    const headC = (Lear && Rear) ? mid(Lear, Rear)
      : nose ? nose
      : shMid ? { x: shMid.x, y: shMid.y - (shMid && hipMid ? Math.hypot(hipMid.x - shMid.x, hipMid.y - shMid.y) * 0.5 : 60) }
      : null;
    if (headC) {
      const h = sp.head;
      // head height: from ear span, else from shoulder width, else fallback.
      let headH;
      if (Lear && Rear) headH = Math.hypot(Rear.x - Lear.x, Rear.y - Lear.y) * 2.4;
      else if (Lsh && Rsh) headH = Math.hypot(Rsh.x - Lsh.x, Rsh.y - Lsh.y) * 1.5;
      else headH = (ctx.dims ? ctx.dims.H * 0.14 : 120);
      const sc = headH / h.texture.height;
      h.visible = true;
      h.position.set(headC.x, headC.y);
      // lean: align art-up with body-up (shMid - hipMid).
      if (shMid && hipMid) {
        const ux = shMid.x - hipMid.x, uy = shMid.y - hipMid.y;
        h.rotation = Math.atan2(ux, -uy);
      } else {
        h.rotation = 0;
      }
      h.scale.set(sc, sc);
    } else {
      sp.head.visible = false;
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
