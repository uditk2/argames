// ===========================================================================
// PIXI SCENE — the 2D render layer. Draws background, demons (from the demon
// registry data on each entity), the PLAYER (see "player render mode" below),
// the shield ward, and FX. It READS engine state; it never mutates game logic.
// PixiJS v8 async init.
// ---------------------------------------------------------------------------
// Coordinates: engine entities use normalized 0..1 positions; this layer maps
// them to the live canvas size, so resizing Just Works.
//
// PLAYER RENDER MODE (pluggable — see config/game.config.js PLAYER_RENDER_MODE):
//   'webcam-fx' (default) — the live mirrored webcam fills the stage (rendered
//        as a DOM <video> behind this transparent canvas by GameScreen). This
//        layer overlays glowing, pose-tracked effects: energy fist orbs at both
//        wrists, a live pose-skeleton overlay (neon magic wireframe so you can
//        SEE the tracked points on your body), a torso aura, punch bursts/trails,
//        and a shield arc above the head. All pose-driven drawing is null-safe.
//   'skeleton' — draws the live stick-figure straight from the landmarks.
//   'sprite'   — the legacy static boxer-sprite path (a non-rigged "skin").
//
// Pose contract: GameScreen pushes ALREADY-MIRRORED landmarks (selfie space,
// x flipped to match the mirrored video) via scene.setPose(landmarks). So this
// layer maps landmark (x,y) -> (x*W, y*H) directly; mirroring stays consistent
// with the video and the move detectors (which also run on mirrored landmarks).
// ===========================================================================

import { Application, Assets, Container, Sprite, Graphics, Texture, Text } from 'pixi.js';
import { getAvatar } from '../config/avatars.js';
import { PLAYER_RENDER_MODE } from '../config/game.config.js';
import { drainFx } from '../engine/state.js';
import { createSfx } from './sfx.js';

const BG_URL = '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png';

// Generic demon/world FX (engine-driven hits/kills/etc.)
const FX_TEXTURES = {
  hit: '/assets/effects/spark_01.png',
  kill: '/assets/effects/flame_05.png',
  shield: '/assets/effects/magic_01.png',
};
// Extra impact textures for the meaty connect burst.
const IMPACT_FLASH_TEX = '/assets/effects/light_01.png';
const IMPACT_FIRE_TEX = '/assets/effects/fire_01.png';
const IMPACT_FLARE_TEX = '/assets/effects/flare_01.png';

// Player energy FX (Kenney additive glow sprites).
const FIST_TEX = '/assets/effects/fire_01.png';     // glowing energy fist orb
const FIST_CORE_TEX = '/assets/effects/light_01.png'; // bright core flicker
const AURA_TEX = '/assets/effects/flare_01.png';     // soft body aura
const TRAIL_TEX = '/assets/effects/light_01.png';     // punch motion trail
const BURST_TEX = '/assets/effects/spark_01.png';     // punch impact burst
const SHIELD_FX_TEX = '/assets/effects/magic_01.png'; // shield arc shimmer

// Pose landmark indices (MediaPipe Pose).
const LM = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
};
// Edges for the skeleton render mode (and the webcam-fx live overlay).
const SKELETON_EDGES = [
  // arms
  [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  // shoulders / torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // legs
  [23, 25], [25, 27], [27, 29], [27, 31], [24, 26], [26, 28], [28, 30], [28, 32],
  // face (subtle)
  [0, 2], [0, 5], [2, 7], [5, 8],
];

// All 33 MediaPipe Pose landmark indices (for drawing the point cloud).
const ALL_LANDMARKS = Array.from({ length: 33 }, (_, i) => i);

const MIN_VIS = 0.4;
function visible(p) {
  return p && (p.visibility == null || p.visibility >= MIN_VIS);
}

/**
 * @param {HTMLElement} mount  DOM node to attach the canvas to
 * @param {object} opts { avatarId, playerRenderMode, demo }
 */
export async function createPixiScene(mount, { avatarId, playerRenderMode, demo = false } = {}) {
  const mode = playerRenderMode || PLAYER_RENDER_MODE;

  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    resizeTo: mount,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    // The instant-replay compositor (recording/replayBuffer.js) reads this
    // canvas via drawImage() from its OWN rAF loop, outside Pixi's render tick.
    // A WebGL canvas only yields pixels to drawImage() outside its draw cycle
    // when the drawing buffer is preserved — without this the replay captures a
    // blank FX layer (demons/energy never appear in the clip).
    preserveDrawingBuffer: true,
  });
  mount.appendChild(app.canvas);

  const avatar = getAvatar(avatarId);

  // --- Layered containers (back -> front) ---
  // A `world` container holds everything that should shake on impact; the HUD
  // FX (score popups) sit in `overlay` so they stay rock-steady. Screen shake
  // is applied by offsetting `world`.
  const world = new Container();
  const bgLayer = new Container();
  const demonLayer = new Container();
  const playerLayer = new Container();   // pose-tracked energy FX live here
  const fxLayer = new Container();
  const overlay = new Container();        // score popups (not shaken)
  world.addChild(bgLayer, demonLayer, playerLayer, fxLayer);
  app.stage.addChild(world, overlay);

  // Combat SFX (modular WebAudio helper). Lazy/null-safe.
  const sfx = createSfx();
  sfx.init();

  // --- Preload textures (graceful if any fail) ---
  const urls = [
    BG_URL,
    avatar.sprites.idle,
    avatar.sprites.punch,
    avatar.sprites.block,
    FIST_TEX, FIST_CORE_TEX, AURA_TEX, TRAIL_TEX, BURST_TEX, SHIELD_FX_TEX,
    IMPACT_FLASH_TEX, IMPACT_FIRE_TEX, IMPACT_FLARE_TEX,
    ...Object.values(FX_TEXTURES),
  ];
  const tex = {};
  await Promise.all(
    [...new Set(urls)].map(async (u) => {
      try {
        tex[u] = await Assets.load(u);
      } catch (e) {
        console.warn('[pixiScene] failed to load', u, e);
        tex[u] = Texture.WHITE;
      }
    })
  );

  // --- Background (cover-fit) ---
  // In 'webcam-fx' the live video shows THROUGH the transparent canvas, so we
  // keep the bg dim (it only frames the edges / fills the demo silhouette).
  const bg = new Sprite(tex[BG_URL]);
  bgLayer.addChild(bg);
  const tint = new Graphics();
  bgLayer.addChild(tint);
  // In webcam-fx we mostly want the video to read through; dim the bg hard so
  // the night-sky doesn't paint over the live person.
  bg.alpha = mode === 'webcam-fx' ? (demo ? 0.55 : 0.0) : 1;

  // === PLAYER: 'sprite' (legacy static boxer) ============================
  let player = null;
  if (mode === 'sprite') {
    player = new Sprite(tex[avatar.sprites.idle]);
    player.anchor.set(0.5, 1);
    playerLayer.addChild(player);
  }

  // === PLAYER: pose-tracked energy FX (webcam-fx + a few in skeleton) =====
  // Soft body aura (additive). Follows torso center.
  const aura = new Sprite(tex[AURA_TEX] || Texture.WHITE);
  aura.anchor.set(0.5);
  aura.blendMode = 'add';
  aura.tint = 0x9a4cff;       // purple magic
  aura.alpha = 0;
  aura.visible = mode === 'webcam-fx';
  playerLayer.addChild(aura);

  // Energy fist orbs (one per wrist), each = glow + bright core.
  function makeFist() {
    const c = new Container();
    const glow = new Sprite(tex[FIST_TEX] || Texture.WHITE);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = 0xff7a3c;     // fire-orange
    const core = new Sprite(tex[FIST_CORE_TEX] || Texture.WHITE);
    core.anchor.set(0.5);
    core.blendMode = 'add';
    core.tint = 0xffe7a8;     // hot white-gold core
    core.scale.set(0.55);
    c.addChild(glow, core);
    c.visible = false;
    c._glow = glow;
    c._core = core;
    playerLayer.addChild(c);
    return c;
  }
  const fists = (mode === 'webcam-fx') ? { left: makeFist(), right: makeFist() } : null;

  // Skeleton graphics (skeleton mode).
  const skeleton = new Graphics();
  skeleton.visible = mode === 'skeleton';
  playerLayer.addChild(skeleton);

  // Live pose overlay (webcam-fx mode). Inserted LOW in the player layer (just
  // above the aura, below the fist orbs) so the glowing fists still pop on top.
  // Two graphics: an additive glow pass (thick, soft) + a crisp top pass, which
  // together give the magic/tech wireframe a neon feel.
  const poseGlow = new Graphics();
  poseGlow.blendMode = 'add';
  poseGlow.visible = mode === 'webcam-fx';
  const poseLines = new Graphics();
  poseLines.visible = mode === 'webcam-fx';
  // aura is child 0; place glow then crisp lines right above it (under fists).
  playerLayer.addChildAt(poseGlow, 1);
  playerLayer.addChildAt(poseLines, 2);

  // --- Shield ward (drawn when shielding) ---
  const ward = new Graphics();
  ward.visible = false;
  playerLayer.addChild(ward);

  // Per-demon sprite pool keyed by uid. Each entry holds the body sprite, an
  // HP-pip ring graphic (multi-hit damage indicator), and transient juice
  // state (recoil stagger, death-pop animation).
  const demonSprites = new Map();
  // Active world FX particles (engine fx) + player FX particles (bursts/trails).
  const particles = [];
  // Floating score popups (live in the steady overlay layer).
  const popups = [];

  // --- Screen shake -------------------------------------------------------
  // `shake` is current trauma amount (0..~1); decays each frame. The world
  // container is offset by a jittered amount proportional to trauma.
  let shake = 0;
  function addShake(amount) { shake = Math.min(1, shake + amount); }

  // --- Live pose + player-move state (set from GameScreen each frame) ------
  let pose = null;                 // mirrored landmarks (display space) | null
  const moveEvents = [];           // queued punch/shield notifications
  /** GameScreen calls this with the latest (already-mirrored) landmarks. */
  function setPose(landmarks) { pose = landmarks || null; }
  /** GameScreen calls this when a move fires, so we can spawn matching FX. */
  function notifyMove(move) { if (move) moveEvents.push(move); }

  function px(p) { return { x: p.x * dims.W, y: p.y * dims.H }; }
  function center(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function layout() {
    // Use Pixi's LOGICAL screen rectangle (CSS pixels), not renderer.width/height
    // ÷ resolution. On high-DPR phones (devicePixelRatio 2–3) that division
    // collapses the coordinate space to the top ~1/dpr of the canvas, so the
    // vignette + play area only covered the upper part of the screen and a hard
    // dark band appeared mid-screen. app.screen is resolution-independent.
    const W = app.screen.width;
    const H = app.screen.height;

    // cover-fit background
    const scale = Math.max(W / bg.texture.width, H / bg.texture.height);
    bg.scale.set(scale);
    bg.x = (W - bg.texture.width * scale) / 2;
    bg.y = (H - bg.texture.height * scale) / 2;

    tint.clear();
    if (mode === 'webcam-fx') {
      // Light magical vignette so the live video reads as the "demon realm"
      // without hiding the player.
      tint.rect(0, 0, W, H).fill({ color: 0x2a103a, alpha: demo ? 0.28 : 0.16 });
      tint.rect(0, H * 0.72, W, H * 0.28).fill({ color: 0x3a0a1e, alpha: 0.22 });
    } else {
      tint.rect(0, 0, W, H).fill({ color: 0x2a103a, alpha: 0.35 });
      tint.rect(0, H * 0.6, W, H * 0.4).fill({ color: 0x3a0a1e, alpha: 0.3 });
    }

    if (player) {
      player.x = W / 2;
      player.y = H * 0.98;
      const targetH = H * 0.32 * avatar.scale;
      player.scale.set(targetH / (player.texture.height || targetH));
    }
    return { W, H };
  }
  let dims = layout();
  app.renderer.on('resize', () => {
    dims = layout();
  });

  // Returns the per-demon render holder { box(container), s(body sprite),
  // pips(Graphics HP ring), recoil state, death-pop state }.
  function holderForDemon(demon) {
    let h = demonSprites.get(demon.uid);
    if (!h) {
      const box = new Container();
      const s = new Sprite(Texture.EMPTY);
      s.anchor.set(0.5);
      s.eventMode = 'static';      // allow demo-mode clicks
      s.cursor = 'pointer';
      const pips = new Graphics();   // multi-hit HP ring
      box.addChild(s, pips);
      demonLayer.addChild(box);
      h = {
        box, s, pips,
        recoilUntil: 0, recoilAng: 0,   // brief hit stagger
        dying: false, deathT: 0,        // kill pop/fade animation
        lastHits: demon.hitsRemaining,
      };
      demonSprites.set(demon.uid, h);
    }
    return h;
  }

  // Draw the HP pip ring for a multi-hit demon (a thin arc that depletes as it
  // loses HP). 1-hit imps get no ring (no clutter).
  function drawHpRing(pips, demon, radiusPx) {
    pips.clear();
    if (demon.hitsToKill <= 1) return;
    const frac = Math.max(0, demon.hitsRemaining / demon.hitsToKill);
    const r = radiusPx * 1.02;
    const startA = -Math.PI / 2;
    // faint full track
    pips.arc(0, 0, r, 0, Math.PI * 2).stroke({ color: 0x000000, width: 5, alpha: 0.3 });
    pips.arc(0, 0, r, 0, Math.PI * 2).stroke({ color: 0x57e3ff, width: 3, alpha: 0.14 });
    // remaining health arc (green->orange->red as it drains)
    if (frac > 0) {
      const col = frac > 0.5 ? 0x7dffa0 : frac > 0.25 ? 0xffd45e : 0xff5a4c;
      pips.arc(0, 0, r, startA, startA + Math.PI * 2 * frac)
        .stroke({ color: col, width: 4, alpha: 0.95 });
    }
  }

  // Generic engine-FX particle (normalized 0..1 position).
  function spawnParticle(type, x, y) {
    const url = FX_TEXTURES[type] || FX_TEXTURES.hit;
    const p = new Sprite(tex[url] || Texture.WHITE);
    p.anchor.set(0.5);
    p.x = x * dims.W;
    p.y = y * dims.H;
    p.alpha = 0.95;
    p.scale.set(type === 'kill' ? 0.9 : 0.5);
    p._life = 0;
    p._max = type === 'kill' ? 520 : 360;
    p._spin = 0.004;
    p._grow = 0.0009;
    fxLayer.addChild(p);
    particles.push(p);
  }

  // Player energy particle in PIXELS (used for punch bursts / trails).
  function spawnEnergyParticle(url, x, y, opts = {}) {
    const p = new Sprite(tex[url] || Texture.WHITE);
    p.anchor.set(0.5);
    p.x = x; p.y = y;
    p.blendMode = 'add';
    p.tint = opts.tint ?? 0xff9a4c;
    p.alpha = opts.alpha ?? 0.95;
    p.scale.set(opts.scale ?? 0.5);
    p.rotation = Math.random() * Math.PI * 2;
    p._life = 0;
    p._max = opts.max ?? 360;
    p._spin = opts.spin ?? 0.006;
    p._grow = opts.grow ?? 0.0014;
    p._vx = opts.vx ?? 0;
    p._vy = opts.vy ?? 0;
    fxLayer.addChild(p);
    particles.push(p);
  }

  // Spawn a punch burst + small trail at the given (px) wrist position.
  function spawnPunchBurst(x, y) {
    // central flash
    spawnEnergyParticle(BURST_TEX, x, y, { tint: 0xffe7a8, scale: 0.7, max: 300, grow: 0.0026 });
    spawnEnergyParticle(FIST_TEX, x, y, { tint: 0xff7a3c, scale: 0.9, max: 340, grow: 0.0022 });
    // radial sparks
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 0.18 + Math.random() * 0.22;
      spawnEnergyParticle(TRAIL_TEX, x, y, {
        tint: 0xffc46b, scale: 0.35, max: 280, grow: 0.0006,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      });
    }
  }

  // IMPACT BURST at a normalized contact point (the "it connected!" pop).
  // Scaled by demon size; bigger on a kill. Additive flash + fire + sparks.
  function spawnImpactBurst(nx, ny, { size = 90, kill = false } = {}) {
    const x = nx * dims.W;
    const y = ny * dims.H;
    const sizeK = Math.max(0.7, size / 100);   // 0.7..~2.3
    const big = kill ? 1.7 : 1;

    // hot core flash
    spawnEnergyParticle(IMPACT_FLASH_TEX, x, y, {
      tint: 0xffffff, scale: 0.5 * sizeK * big, alpha: 1, max: 220 * big, grow: 0.006 * big,
    });
    // fiery bloom
    spawnEnergyParticle(IMPACT_FIRE_TEX, x, y, {
      tint: kill ? 0xff5a2c : 0xff8a3c, scale: 0.7 * sizeK * big, max: 360 * big, grow: 0.004 * big,
    });
    // soft shock ring
    spawnEnergyParticle(IMPACT_FLARE_TEX, x, y, {
      tint: kill ? 0xffd45e : 0xffc46b, scale: 0.4 * sizeK * big, alpha: 0.8, max: 300 * big, grow: 0.009 * big, spin: 0.0,
    });
    // radial sparks (more + faster on a kill)
    const n = kill ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const sp = (0.22 + Math.random() * 0.3) * (kill ? 1.5 : 1);
      spawnEnergyParticle(BURST_TEX, x, y, {
        tint: 0xffe7a8, scale: 0.3 * sizeK, max: 320, grow: 0.0008,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: 0.01,
      });
    }
  }

  // Floating score popup that drifts up and fades (steady overlay layer).
  function spawnScorePopup(nx, ny, text, big = false) {
    let t;
    try {
      t = new Text({
        text,
        style: {
          fill: big ? 0xffe07a : 0xfff2c8,
          fontFamily: 'Arial, sans-serif',
          fontSize: big ? 30 : 20,
          fontWeight: '900',
          stroke: { color: 0x3a0a1e, width: big ? 5 : 4 },
          dropShadow: { color: 0xff7a3c, blur: 8, distance: 0, alpha: 0.9 },
        },
      });
    } catch (e) {
      return; // never let a text glyph failure break the loop
    }
    t.anchor.set(0.5);
    t.x = nx * dims.W;
    t.y = ny * dims.H - (big ? 22 : 14);
    t._life = 0;
    t._max = big ? 950 : 750;
    t._vy = -0.06 - (big ? 0.02 : 0);
    overlay.addChild(t);
    popups.push(t);
  }

  // Shield arc shimmer particles above the head.
  function spawnShieldFlourish(cx, cy, r) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const a = Math.PI + t * Math.PI; // top arc
      spawnEnergyParticle(SHIELD_FX_TEX, cx + Math.cos(a) * r, cy + Math.sin(a) * r, {
        tint: 0x57e3ff, scale: 0.4, max: 420, grow: 0.0008, spin: 0.002,
      });
    }
  }

  // ----- Punch trail history per wrist (recent positions) -----
  const trailHist = { left: [], right: [] };

  /**
   * Position the energy fist orb at a wrist, with idle flicker.
   * @param {Container} fist
   * @param {{x,y}} pos pixel position
   * @param {number} now
   */
  function placeFist(fist, pos, now, energetic) {
    fist.visible = true;
    fist.x = pos.x;
    fist.y = pos.y;
    const baseR = dims.H * 0.10;
    const flick = 0.85 + 0.15 * Math.sin(now / 90 + (fist === fists.left ? 0 : Math.PI));
    const punchBoost = energetic ? 1.45 : 1;
    fist._glow.scale.set((baseR / (fist._glow.texture.width || baseR)) * flick * punchBoost);
    fist._glow.alpha = 0.85 * flick;
    fist._glow.rotation += 0.02;
    fist._core.scale.set((baseR * 0.45 / (fist._core.texture.width || baseR)) * flick * punchBoost);
    fist._core.alpha = 0.95;
    fist._core.rotation -= 0.03;
  }

  /**
   * Render one frame from engine state.
   * @param {object} state engine state
   * @param {number} dtMs
   * @param {(uid:string)=>void} [onDemonClick] demo-mode punch handler
   */
  function render(state, dtMs, onDemonClick) {
    const now = performance.now();

    // --- Drain engine FX events: JUICE on every connect (hit) and kill ---
    for (const fx of drainFx(state)) {
      if (fx.type === 'hit') {
        const kill = !!fx.kill;
        const size = fx.demonSize || 90;
        // Impact particle burst at the contact point.
        spawnImpactBurst(fx.x, fx.y, { size, kill });
        // Screen shake scaled to demon size (heavier on a kill).
        addShake((kill ? 0.5 : 0.28) * Math.max(0.6, size / 140));
        // SFX: a softer "chip" for a non-killing brute hit, punchier otherwise.
        const multiHitChip = !kill && (fx.hitsToKill || 1) > 2;
        sfx.play(multiHitChip ? 'hitSoft' : 'hit', {
          volume: kill ? 0.85 : 0.7,
          rate: 1 + (size > 150 ? -0.15 : 0.05),
        });
        // Recoil stagger on the struck demon's holder.
        const h = demonSprites.get(fx.uid);
        if (h && !h.dying) {
          h.recoilUntil = now + 130;
          h.recoilAng = (Math.random() - 0.5) * 0.5;
        }
        // Small per-hit score popup for non-kills (kills get the bigger one).
        if (!kill && fx.points) spawnScorePopup(fx.x, fx.y, `+${fx.points}`, false);
      } else if (fx.type === 'kill') {
        const size = fx.demonSize || 110;
        // Bigger burst + meaty kill thud + extra shake.
        spawnImpactBurst(fx.x, fx.y, { size, kill: true });
        spawnParticle('kill', fx.x, fx.y);
        addShake(0.6 * Math.max(0.7, size / 130));
        sfx.play('kill', { volume: 1, rate: size > 160 ? 0.85 : 1 });
        // Mark the holder dying so the demon pops/fades instead of vanishing.
        const h = demonSprites.get(fx.uid);
        if (h) { h.dying = true; h.deathT = 0; }
        // Kill score popup uses the live combo for a satisfying number.
        const pts = fx.points || Math.round((fx.demonPoints || 0));
        spawnScorePopup(fx.x, fx.y - 0.02, pts ? `+${pts}` : 'SLAIN!', true);
      } else {
        // shield + any legacy fx
        spawnParticle(fx.type, fx.x, fx.y);
      }
    }

    // --- Demons ---
    const seen = new Set();
    for (const demon of state.demons) {
      seen.add(demon.uid);
      const h = holderForDemon(demon);
      const s = h.s;
      // Show the dedicated "hit" frame briefly when flashing, else the flap frame.
      let frameUrl = demon.frames[demon.frame];
      if (now < demon.flashUntil && demon.hitFrame) frameUrl = demon.hitFrame;
      if (!tex[frameUrl]) {
        tex[frameUrl] = Texture.WHITE;
        Assets.load(frameUrl).then((t) => (tex[frameUrl] = t)).catch(() => {});
      }
      if (s.texture !== tex[frameUrl] && tex[frameUrl]) s.texture = tex[frameUrl];
      const radiusPx = demon.size / 2;

      h.box.x = demon.x * dims.W;
      h.box.y = demon.y * dims.H;
      const sc = demon.size / (s.texture.width || demon.size);
      s.scale.set(sc);

      // White flash on connect; recoil stagger (brief rotate + squash).
      const flashing = now < demon.flashUntil;
      s.tint = flashing ? 0xffffff : 0xffd0d0;
      if (now < h.recoilUntil) {
        const k = (h.recoilUntil - now) / 130;        // 1 -> 0
        h.box.rotation = h.recoilAng * k;
        s.scale.set(sc * (1 + 0.12 * k), sc * (1 - 0.08 * k));
      } else {
        h.box.rotation = 0;
      }
      s.alpha = 1;

      // Multi-hit HP pip ring.
      drawHpRing(h.pips, demon, radiusPx);

      if (onDemonClick && !s._wired) {
        s._wired = true;
        s.on('pointerdown', () => onDemonClick(s._uid));
      }
      s._uid = demon.uid;
    }
    // Cull holders whose demon is gone — but play a death pop/fade first.
    for (const [uid, h] of demonSprites) {
      if (seen.has(uid)) continue;
      if (!h._removing) {
        h._removing = true;
        if (!h.dying) { h.dying = true; h.deathT = 0; } // safety: cull = die
      }
      h.deathT += dtMs;
      const t = Math.min(1, h.deathT / 320);
      // pop bigger then fade + spin out
      const pop = 1 + 0.5 * Math.sin(t * Math.PI);
      h.box.scale.set(pop);
      h.box.alpha = 1 - t;
      h.box.rotation += dtMs * 0.01;
      if (h.pips) h.pips.clear();
      if (t >= 1) {
        h.box.destroy({ children: true });
        demonSprites.delete(uid);
      }
    }

    // --- PLAYER ---
    if (mode === 'sprite') renderSpritePlayer(state, now);
    else renderPosePlayer(state, now);

    // --- Player move notifications -> FX (after pose so positions are fresh) -
    drainMoveEvents(now);

    // --- Shield ward (engine state authoritative) ---
    if (state.shielding) {
      ward.visible = true;
      ward.clear();
      // anchor to head when we have pose, else center-top.
      let cx = dims.W / 2, cy = dims.H * 0.18;
      if (pose && visible(pose[LM.nose])) {
        const head = px(pose[LM.nose]);
        cx = head.x; cy = head.y - dims.H * 0.06;
      }
      ward.alpha = 0.6 + 0.4 * Math.sin(now / 200);
      ward
        .arc(cx, cy, dims.W * 0.16, Math.PI, 0)
        .stroke({ color: 0x57e3ff, width: 4, alpha: 0.9 });
    } else {
      ward.visible = false;
    }

    // --- Particle aging ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p._life += dtMs;
      const t = p._life / p._max;
      const a0 = p._a0 ?? (p._a0 = p.alpha ?? 0.95);
      p.alpha = Math.max(0, a0 * (1 - t));
      p.x += (p._vx || 0) * dims.W * (dtMs / 1000);
      p.y += (p._vy || 0) * dims.H * (dtMs / 1000);
      p.scale.set(p.scale.x + dtMs * (p._grow ?? 0.0009));
      p.rotation += dtMs * (p._spin ?? 0.004);
      if (t >= 1) {
        p.destroy();
        particles.splice(i, 1);
      }
    }

    // --- Score popups aging (steady overlay) ---
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p._life += dtMs;
      const t = p._life / p._max;
      p.y += p._vy * dims.H * (dtMs / 1000) * (1 - t * 0.4);
      // ease out: full early then fade
      p.alpha = t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) / 0.75);
      if (t >= 1) {
        p.destroy();
        popups.splice(i, 1);
      }
    }

    // --- SCREEN SHAKE: jitter the world container, then decay trauma ---
    if (shake > 0.001) {
      const mag = shake * shake * dims.W * 0.03;   // quadratic feels punchier
      world.x = (Math.random() * 2 - 1) * mag;
      world.y = (Math.random() * 2 - 1) * mag;
      shake *= Math.pow(0.86, dtMs / 16.67);
    } else {
      shake = 0;
      world.x = 0; world.y = 0;
    }
  }

  // --- Legacy static sprite player ---
  function renderSpritePlayer(state, now) {
    if (!player) return;
    let poseTex = avatar.sprites.idle;
    if (state.shielding) poseTex = avatar.sprites.block;
    else if (now < state.lastKillAt + 160 || now < state.stunnedUntil) {
      poseTex = now < state.stunnedUntil ? avatar.sprites.idle : avatar.sprites.punch;
    }
    if (tex[poseTex] && player.texture !== tex[poseTex]) {
      player.texture = tex[poseTex];
      const targetH = dims.H * 0.32 * avatar.scale;
      player.scale.set(targetH / (player.texture.height || targetH));
    }
    player.alpha = now < state.stunnedUntil ? 0.6 : 1;
  }

  // --- Pose-tracked player (webcam-fx + skeleton) ---
  function renderPosePlayer(state, now) {
    // Skeleton stick figure
    if (mode === 'skeleton') {
      skeleton.clear();
      if (pose) {
        for (const [a, b] of SKELETON_EDGES) {
          if (visible(pose[a]) && visible(pose[b])) {
            const pa = px(pose[a]);
            const pb = px(pose[b]);
            skeleton.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y)
              .stroke({ color: 0xb079ff, width: 5, alpha: 0.9 });
          }
        }
        // glowing joints
        for (const k of Object.values(LM)) {
          if (visible(pose[k])) {
            const p = px(pose[k]);
            skeleton.circle(p.x, p.y, 6).fill({ color: 0xff9a4c, alpha: 0.9 });
          }
        }
      }
    }

    if (mode !== 'webcam-fx') return;
    const energetic = now < state.lastKillAt + 200; // brighten right after a hit

    // Live skeleton overlay on the mirrored webcam (feedback so the player can
    // SEE the tracked points on their body). Uses the SAME mirrored landmarks
    // the fists use, so it stays aligned with the video (no double-mirroring).
    drawPoseOverlay(now, state);

    // Torso aura
    if (pose && visible(pose[LM.leftShoulder]) && visible(pose[LM.rightHip])) {
      const sh = center(px(pose[LM.leftShoulder]), px(pose[LM.rightShoulder] || pose[LM.leftShoulder]));
      const hp = center(px(pose[LM.leftHip] || pose[LM.rightHip]), px(pose[LM.rightHip]));
      const c = center(sh, hp);
      aura.visible = true;
      aura.x = c.x; aura.y = c.y;
      const r = Math.hypot(hp.x - sh.x, hp.y - sh.y) + dims.H * 0.18;
      aura.scale.set((r / (aura.texture.width || r)) * 1.4);
      aura.alpha = (state.shielding ? 0.4 : 0.26) * (0.8 + 0.2 * Math.sin(now / 400)) + (energetic ? 0.15 : 0);
      aura.rotation += 0.004;
      aura.tint = state.shielding ? 0x57e3ff : 0x9a4cff;
    } else {
      aura.visible = false;
    }

    // Energy fist orbs at both wrists (null-safe: hide if pose/wrist lost).
    const wrists = {
      left: pose && visible(pose[LM.leftWrist]) ? px(pose[LM.leftWrist]) : null,
      right: pose && visible(pose[LM.rightWrist]) ? px(pose[LM.rightWrist]) : null,
    };
    for (const side of ['left', 'right']) {
      const f = fists[side];
      const w = wrists[side];
      if (w) {
        placeFist(f, w, now, energetic);
        // motion trail history
        const h = trailHist[side];
        h.push({ x: w.x, y: w.y, t: now });
        while (h.length && now - h[0].t > 140) h.shift();
        // draw faint trail beads when the wrist is moving fast
        if (h.length >= 2) {
          const a = h[0], b = h[h.length - 1];
          const speed = Math.hypot(b.x - a.x, b.y - a.y);
          if (speed > dims.W * 0.05) {
            spawnEnergyParticle(TRAIL_TEX, a.x, a.y, {
              tint: 0xffb066, scale: 0.3, max: 180, grow: 0.0004, spin: 0.001,
            });
          }
        }
      } else {
        f.visible = false;
        trailHist[side].length = 0;
      }
    }
  }

  // --- Live pose overlay (webcam-fx) -------------------------------------
  // Draws the 33 landmark dots + standard pose connections over the mirrored
  // webcam as a subtle magic-purple / cyan neon wireframe. Two passes: an
  // additive soft glow underlay + crisp thin lines on top. Null-safe: skips
  // low-visibility points/edges and never throws if the pose is lost.
  function drawPoseOverlay(now, state) {
    poseGlow.clear();
    poseLines.clear();
    if (!pose) return;

    // Gentle breathing pulse so the overlay reads as "alive" tech-magic.
    const pulse = 0.82 + 0.18 * Math.sin(now / 520);
    // Cyan-ish when shielding (matches the ward), magic-purple otherwise.
    const lineColor = state && state.shielding ? 0x57e3ff : 0xb079ff;
    const dotColor = 0x57e3ff;            // cyan joints to contrast the purple bones
    const r = dims.H * 0.006;             // dot radius scales with canvas

    // Connections.
    for (const [a, b] of SKELETON_EDGES) {
      const pa = pose[a];
      const pb = pose[b];
      if (!visible(pa) || !visible(pb)) continue;
      const A = px(pa);
      const B = px(pb);
      // soft additive glow (thick)
      poseGlow.moveTo(A.x, A.y).lineTo(B.x, B.y)
        .stroke({ color: lineColor, width: 7, alpha: 0.16 * pulse });
      // crisp thin line
      poseLines.moveTo(A.x, A.y).lineTo(B.x, B.y)
        .stroke({ color: lineColor, width: 2, alpha: 0.5 * pulse });
    }

    // Landmark points.
    for (const k of ALL_LANDMARKS) {
      const p = pose[k];
      if (!visible(p)) continue;
      const P = px(p);
      poseGlow.circle(P.x, P.y, r * 2.4).fill({ color: dotColor, alpha: 0.18 * pulse });
      poseLines.circle(P.x, P.y, r).fill({ color: dotColor, alpha: 0.7 * pulse });
    }
  }

  // Convert queued player moves into matching energy FX at the right spot.
  function drainMoveEvents(now) {
    if (!moveEvents.length) return;
    const evs = moveEvents.splice(0, moveEvents.length);
    for (const m of evs) {
      if (m.type === 'punch') {
        // Prefer the live fist position; fall back to the payload x/y (0..1)
        // which the detector reports in mirrored display space.
        const side = m.payload && m.payload.side;
        let pos = null;
        if (side && fists && fists[side] && fists[side].visible) {
          pos = { x: fists[side].x, y: fists[side].y };
        } else if (m.payload && m.payload.x != null) {
          pos = { x: m.payload.x * dims.W, y: m.payload.y * dims.H };
        }
        if (pos) spawnPunchBurst(pos.x, pos.y);
      } else if (m.type === 'shield') {
        let cx = dims.W / 2, cy = dims.H * 0.18, r = dims.W * 0.16;
        if (pose && visible(pose[LM.nose])) {
          const head = px(pose[LM.nose]);
          cx = head.x; cy = head.y - dims.H * 0.06;
        }
        spawnShieldFlourish(cx, cy, r);
      }
    }
  }

  function destroy() {
    app.destroy(true, { children: true });
  }

  // Expose audio unlock so the host can resume WebAudio on a user gesture
  // (browsers block sound until the first interaction).
  function unlockAudio() { try { sfx.unlock(); } catch {} }

  return { app, render, layout, destroy, setPose, notifyMove, unlockAudio, mode };
}
