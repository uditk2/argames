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

import { Application, Assets, Container, Sprite, Graphics, Texture } from 'pixi.js';
import { getAvatar } from '../config/avatars.js';
import { PLAYER_RENDER_MODE } from '../config/game.config.js';
import { drainFx } from '../engine/state.js';

const BG_URL = '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png';

// Generic demon/world FX (engine-driven hits/kills/etc.)
const FX_TEXTURES = {
  hit: '/assets/effects/spark_01.png',
  kill: '/assets/effects/flame_05.png',
  shield: '/assets/effects/magic_01.png',
};

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
  });
  mount.appendChild(app.canvas);

  const avatar = getAvatar(avatarId);

  // --- Layered containers (back -> front) ---
  const bgLayer = new Container();
  const demonLayer = new Container();
  const playerLayer = new Container();   // pose-tracked energy FX live here
  const fxLayer = new Container();
  app.stage.addChild(bgLayer, demonLayer, playerLayer, fxLayer);

  // --- Preload textures (graceful if any fail) ---
  const urls = [
    BG_URL,
    avatar.sprites.idle,
    avatar.sprites.punch,
    avatar.sprites.block,
    FIST_TEX, FIST_CORE_TEX, AURA_TEX, TRAIL_TEX, BURST_TEX, SHIELD_FX_TEX,
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

  // Per-demon sprite pool keyed by uid.
  const demonSprites = new Map();
  // Active world FX particles (engine fx) + player FX particles (bursts/trails).
  const particles = [];

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
    const W = app.renderer.width / app.renderer.resolution;
    const H = app.renderer.height / app.renderer.resolution;

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

  function spriteForDemon(demon) {
    let s = demonSprites.get(demon.uid);
    if (!s) {
      s = new Sprite(Texture.EMPTY);
      s.anchor.set(0.5);
      s.eventMode = 'static';      // allow demo-mode clicks
      s.cursor = 'pointer';
      demonLayer.addChild(s);
      demonSprites.set(demon.uid, s);
    }
    return s;
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

    // --- Drain engine FX events into world particles ---
    for (const fx of drainFx(state)) spawnParticle(fx.type, fx.x, fx.y);

    // --- Demons ---
    const seen = new Set();
    for (const demon of state.demons) {
      seen.add(demon.uid);
      const s = spriteForDemon(demon);
      const frameUrl = demon.frames[demon.frame];
      if (!tex[frameUrl]) {
        tex[frameUrl] = Texture.WHITE;
        Assets.load(frameUrl).then((t) => (tex[frameUrl] = t)).catch(() => {});
      }
      if (s.texture !== tex[frameUrl] && tex[frameUrl]) s.texture = tex[frameUrl];
      s.x = demon.x * dims.W;
      s.y = demon.y * dims.H;
      const sc = demon.size / (s.texture.width || demon.size);
      s.scale.set(sc);
      s.tint = now < demon.flashUntil ? 0xffffff : 0xffd0d0;
      s.alpha = 1;
      if (onDemonClick && !s._wired) {
        s._wired = true;
        s.on('pointerdown', () => onDemonClick(s._uid));
      }
      s._uid = demon.uid;
    }
    for (const [uid, s] of demonSprites) {
      if (!seen.has(uid)) {
        s.destroy();
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

  return { app, render, layout, destroy, setPose, notifyMove, mode };
}
