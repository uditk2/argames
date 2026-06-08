// ===========================================================================
// VERSUS SCENE — Pixi arena for 2-player mode. Renders TWO rigged fighters
// side by side (reusing render/avatarRigSprite.js): YOU on the left from your
// local pose, the OPPONENT on the right from the interpolated remote pose. HP
// bars / status are React HUD (VersusScreen). Lightweight impact flashes only.
// See docs/versus-netcode.md §8. Reuses theme + the SVG avatar rig.
// ===========================================================================

import { Application, Assets, Container, Sprite, Graphics, Texture } from 'pixi.js';
import { COLOR } from '../config/theme.js';
import { createAvatarRigSprite } from './avatarRigSprite.js';
import { createAvatarRig } from './avatarRig.js';

const BG_URL = '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png';
const MIN_VIS = 0.4;
const visible = (p) => p && (p.visibility == null || p.visibility >= MIN_VIS);

export async function createVersusScene(mount, { demo = false } = {}) {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0, resizeTo: mount, antialias: true,
    autoDensity: true, resolution: window.devicePixelRatio || 1,
  });
  mount.appendChild(app.canvas);

  const world = new Container();
  const bgLayer = new Container();
  const fightLayer = new Container();
  const fxLayer = new Container();
  world.addChild(bgLayer, fightLayer, fxLayer);
  app.stage.addChild(world);

  let bgTex = Texture.WHITE;
  try { bgTex = await Assets.load(BG_URL); } catch {}
  const bg = new Sprite(bgTex);
  bgLayer.addChild(bg);
  const tint = new Graphics();
  bgLayer.addChild(tint);
  const divider = new Graphics();
  bgLayer.addChild(divider);

  // Two rigs. Fall back to the vector rig if the SVG art fails.
  async function makeRig() {
    try { return await createAvatarRigSprite({ COLOR }); }
    catch (e) { console.warn('[versusScene] SVG rig failed, vector fallback', e); return createAvatarRig({ COLOR }); }
  }
  const selfRig = await makeRig();
  const oppRig = await makeRig();
  fightLayer.addChild(selfRig.root, oppRig.root);

  const flashes = [];

  function layout() {
    const W = app.screen.width, H = app.screen.height;
    const scale = Math.max(W / bg.texture.width, H / bg.texture.height);
    bg.scale.set(scale);
    bg.x = (W - bg.texture.width * scale) / 2;
    bg.y = (H - bg.texture.height * scale) / 2;
    bg.alpha = 0.5;
    tint.clear();
    tint.rect(0, 0, W, H).fill({ color: COLOR.realm, alpha: 0.45 });
    tint.rect(0, 0, W, H).fill({ color: COLOR.realmTint, alpha: 0.12 });
    tint.rect(0, H * 0.78, W, H * 0.22).fill({ color: 0x3a0a1e, alpha: 0.25 });
    // center divider glow
    divider.clear();
    divider.rect(W * 0.5 - 1.5, H * 0.1, 3, H * 0.8).fill({ color: COLOR.magic, alpha: 0.18 });
    return { W, H };
  }
  let dims = layout();
  app.renderer.on('resize', () => { dims = layout(); });

  // Column mapping: each fighter lives in a ~46% column. The opponent is
  // mirrored horizontally so the two face the center.
  function cols() {
    const W = dims.W, H = dims.H;
    const colW = W * 0.46;
    return {
      H,
      selfPx: (p) => ({ x: W * 0.02 + p.x * colW, y: p.y * H }),
      oppPx: (p) => ({ x: W * 0.52 + (1 - p.x) * colW, y: p.y * H }),
      colW,
    };
  }

  function spawnFlash(x, y, color) {
    const g = new Graphics();
    g.circle(0, 0, 1).fill({ color, alpha: 0.9 });
    g.position.set(x, y);
    g._life = 0; g._max = 360; g._color = color;
    fxLayer.addChild(g);
    flashes.push(g);
  }

  /**
   * @param {Array|null} selfLm local landmarks (mirrored display space)
   * @param {Array|null} oppLm  remote interpolated landmarks
   * @param {object} o { now, selfGuard, oppGuard, dtMs }
   */
  function render(selfLm, oppLm, o = {}) {
    const { now = performance.now(), selfGuard = false, oppGuard = false, dtMs = 16 } = o;
    const c = cols();
    selfRig.draw(selfLm, { px: c.selfPx, visible, dims: { W: c.colW, H: c.H }, now, shielding: selfGuard });
    oppRig.draw(oppLm, { px: c.oppPx, visible, dims: { W: c.colW, H: c.H }, now, shielding: oppGuard });

    for (let i = flashes.length - 1; i >= 0; i--) {
      const g = flashes[i];
      g._life += dtMs;
      const t = g._life / g._max;
      g.clear();
      const r = 14 + t * 60;
      g.circle(0, 0, r).fill({ color: g._color, alpha: Math.max(0, 0.8 * (1 - t)) });
      g.blendMode = 'add';
      if (t >= 1) { g.destroy(); flashes.splice(i, 1); }
    }
  }

  // Spawn an impact flash at a fighter's fist (who: 'self' | 'opp').
  function impact(who, kind = 'hit') {
    const rig = who === 'self' ? selfRig : oppRig;
    const w = rig.wrists ? rig.wrists() : null;
    const pos = (w && (w.right || w.left)) || null;
    const color = kind === 'block' ? COLOR.shield : COLOR.fire;
    if (pos) spawnFlash(pos.x, pos.y, color);
    else spawnFlash(dims.W * (who === 'self' ? 0.25 : 0.75), dims.H * 0.45, color);
  }

  function destroy() { try { app.destroy(true, { children: true }); } catch {} }

  return { app, render, impact, layout, destroy };
}
