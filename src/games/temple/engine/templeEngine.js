// ===========================================================================
// Temple Dash — CORE ENGINE (framework-free).
// ---------------------------------------------------------------------------
// Ported from the standalone monument3d_game prototype, with two additions:
//   • a VISIBLE third-person avatar (camera-facing billboard) that runs ahead
//     of a pulled-back camera, cycling run / jump / duck sprite frames;
//   • the corridor route + per-segment hazards are built from a PARSED MAP
//     ({ params, segments:[{turn,hazards:[{type,at}]}] }), so the level is
//     configurable by editing public/assets/temple/map.json.
//
// The engine owns the Three.js scene, the camera-on-rails follow, the hazard /
// turn judging, the boulder-heat chase pressure and the 2D boulder overlay.
// It exposes:
//   createTempleEngine({ canvas, fxCanvas, minimapCanvas, map, onCue, onState })
//     .start() .stop() .dispose()
//     .input('jump'|'duck'|'left'|'right'|'restart')
//     .state  -> { distance, clears, phase }  (read live)
//
// It is framework-free: the React UI just mounts the canvases, fetches the map,
// forwards input + reads .state. No DOM beyond the passed-in canvases.
// ===========================================================================
import * as THREE from 'three';
import { ASSETS, MAP_DEFAULTS, CAM, AVATAR, PLAY, EXIT, BOULDER, COLLAPSE, FIRE, CRACK, RUN_TO_MOVE, CORRIDOR_SURFACE, ALIGN_VARIATION, ALIGN_PRESETS } from '../config.js';
import { makeSpriteSheets } from './spriteSheets.js';
import { makeWD, makeGeometry } from './geometry.js';
import { drawMinimap } from './minimap.js';
import { createBoulderFx } from './boulderFx.js';
import { createRoute } from './route.js';
import { createCollapse } from './collapse.js';
import { createAudio } from './audio.js';

// World direction basis used by the prototype's `place()` — q indexes a heading.
const WD = makeWD(THREE);

export function createTempleEngine({ canvas, fxCanvas, minimapCanvas, map, onCue, onState, onStall, runToMove } = {}) {
  // ---- resolve map params (fall back to defaults per-field) ----
  const mp = { ...MAP_DEFAULTS, ...(map && map.params ? map.params : {}) };
  // RUN-TO-MOVE: forward motion is gated on a held RUN input (see input('runStart'/'runStop')).
  const RUN2MOVE = (runToMove != null) ? !!runToMove : RUN_TO_MOVE;
  let runHeld = false;
  const W = mp.hallWidth, H = mp.hallHeight, Lh = mp.hallLen, Lh2 = mp.exitLen;
  const hw = W / 2;
  const camY = CAM.eyeY;
  const SPD = mp.runSpeed || PLAY.speed;
  const GRACE_S = mp.startGrace != null ? mp.startGrace : PLAY.graceS;
  // per-level COLLAPSE budget (seconds): map params, falling back to the config default.
  const COLLAPSE_S = mp.collapseTime != null ? mp.collapseTime : MAP_DEFAULTS.collapseTime;
  // LEVEL ENDING: 'door' (default, L1-L4 stone door), 'artifact' (L5 — take the Sunstone),
  // or 'exit' (L6 — burst into daylight). Drives the end-of-run visual + win message.
  const ENDING = (map && map.ending) || mp.ending || 'door';
  const WIN_CUE = ENDING === 'artifact' ? 'THE SUNSTONE!' : ENDING === 'exit' ? 'DAYLIGHT!' : 'ESCAPE!';
  // ---- MAZE MODE (opt-in) ----------------------------------------------------
  // The engine has two route builders. The DEFAULT (linear) builds a fixed chain
  // of L-shaped units from `map.segments` (only the correct side opens; judge the
  // pressed dir vs the scripted turn). The MAZE branch (only when map.mode==='maze')
  // builds a chain of JUNCTIONS where BOTH sides open: one side continues toward the
  // exit, the other is a visible DEAD-END stub. The player reads the minimap to pick
  // the correct side at each junction; a wrong pick diverts the camera down the stub
  // and crashes it into the stub's end wall. Everything below (exit corridor, win,
  // arc-length, hop/duck, boulder, FX) is shared between the two modes.
  const MAZE = !!(map && map.mode === 'maze');
  // route from the map segments (fall back to a default zig-zag).
  const segments = (map && Array.isArray(map.segments) && map.segments.length)
    ? map.segments
    : [{ turn: 'R' }, { turn: 'L' }, { turn: 'L' }, { turn: 'R' }, { turn: 'R' }, { turn: 'L' }];
  // junctions for maze mode (fall back to a 3-junction prototype).
  const junctions = (map && Array.isArray(map.junctions) && map.junctions.length)
    ? map.junctions
    : [{ correct: 'R' }, { correct: 'L' }, { correct: 'R' }];

  // ---- three.js core ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Max anisotropic filtering — the default (1) smears wall/floor textures at the
  // grazing angles a runner spends most of its time looking at. (Issue #7.)
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
  // Mipmaps on the TIP photo enable the hybrid shader's blurred-photo lighting lookup
  // (texture2D(uImg,uv,5.0)). Only on WebGL2 — the photo is NPOT, which can't mipmap on WebGL1.
  const HAS_MIPS = !!renderer.capabilities.isWebGL2;
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  // ---- ATMOSPHERIC BACKDROP --------------------------------------------------
  // Never let off-corridor area render as pure black (e.g. mid-turn over-aim, or
  // the pit void). A near-black WARM STONE clear color + warm-dark fog make depth
  // fall off into atmosphere instead of a hard void, so any sliver of background
  // reads as "deep dark temple" rather than a render error.
  const ATMO = 0x0d0805;   // near-black warm stone
  renderer.setClearColor(ATMO, 1);
  scene.background = new THREE.Color(ATMO);
  // warm-dark exponential-ish linear fog: corridor stays clear up close, distance
  // dissolves into the dark stone color. Tuned to the hall scale (near ~26u, far ~72u).
  scene.fog = new THREE.Fog(ATMO, 30, 58);
  const cam = new THREE.PerspectiveCamera(CAM.fov, aspect(), CAM.near, CAM.far);

  function aspect() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    return w / Math.max(1, h);
  }

  // ---- corridor (TIP-projected photoreal texture, same shader as prototype) --
  const _texLoader = new THREE.TextureLoader();
  // TIP photos: once the async load resolves, push the REAL pixel dims into the
  // shared uImgSize vector (created lazily by mkMat via texture.userData.__imgSize)
  // so the hybrid shader's texel-stretch estimate is exact (§7a: set after onLoad).
  const _tipSizeOnLoad = (t) => {
    if (t && t.image && t.userData && t.userData.__imgSize) t.userData.__imgSize.set(t.image.width, t.image.height);
  };
  const img = _texLoader.load(ASSETS.corridor, _tipSizeOnLoad);
  img.minFilter = HAS_MIPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; img.generateMipmaps = HAS_MIPS;
  img.magFilter = THREE.LinearFilter; img.anisotropy = MAX_ANISO;
  // OFF-PROJECTION FALLBACK tile (tiling stone) for the TIP shader, so surfaces outside a
  // hall's projection render as dark textured stone, not a flat black/tan box at turns.
  const fallbackTile = _texLoader.load(ASSETS.texWall);
  fallbackTile.wrapS = fallbackTile.wrapT = THREE.RepeatWrapping;
  fallbackTile.minFilter = THREE.LinearMipmapLinearFilter; fallbackTile.magFilter = THREE.LinearFilter;
  fallbackTile.anisotropy = MAX_ANISO;
  if ('colorSpace' in fallbackTile) fallbackTile.colorSpace = THREE.SRGBColorSpace;
  // Photoreal sunlit EXIT corridor texture (TIP-projected onto the appended final
  // hall — Option A). Same aspect/style as `img`; sRGB so the golden archway reads.
  const exitImg = _texLoader.load(ASSETS.exitImg, _tipSizeOnLoad);
  exitImg.minFilter = HAS_MIPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; exitImg.generateMipmaps = HAS_MIPS;
  exitImg.magFilter = THREE.LinearFilter; exitImg.anisotropy = MAX_ANISO;
  if ('colorSpace' in exitImg) exitImg.colorSpace = THREE.SRGBColorSpace;

  // ---- photoreal hazard textures (keyed PNGs mapped onto the prop geometry,
  // same image-on-geometry principle as the corridor; unlit like the avatar so
  // their baked lighting reads photoreal) ----
  function loadKeyed(url) {
    const t = _texLoader.load(url);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const beamTex = loadKeyed(ASSETS.beam);
  const bladeTex = loadKeyed(ASSETS.blade);
  const fireLionTex = loadKeyed(ASSETS.fireLion);    // static carved lion head (flame removed)
  const crackFloorTex = loadKeyed(ASSETS.crackFloor); // photoreal broken-floor chasm (top-down)
  // Animated flamethrower jet, baked from the Grok fire video into a sprite sheet. ONE
  // shared texture whose UV offset is advanced each frame (all jets share the animation).
  const fireSheetTex = _texLoader.load(ASSETS.fireFlameSheet);
  fireSheetTex.minFilter = THREE.LinearFilter; fireSheetTex.magFilter = THREE.LinearFilter;
  if ('colorSpace' in fireSheetTex) fireSheetTex.colorSpace = THREE.SRGBColorSpace;
  fireSheetTex.wrapS = THREE.ClampToEdgeWrapping; fireSheetTex.wrapT = THREE.ClampToEdgeWrapping;
  fireSheetTex.repeat.set(1 / FIRE.cols, 1 / FIRE.rows);
  let fireAnimT = 0;
  const BEAM_AR = 1216 / 399;    // source aspect of the cropped carved beam
  const BLADE_AR = 1084 / 895;   // source aspect of the cropped blade head

  // stateless TIP/geometry helpers (P/capVP/mkMat/quad), bound to THREE + scene +
  // the default dark corridor texture. mkMat defaults to `img`; the exit hall passes
  // `exitImg` explicitly (see buildExitCorridor).
  const { P, capVP, mkMat, quad } = makeGeometry({ THREE, scene, WD, defaultTex: img, defaultTile: fallbackTile });

  // ---- CORRIDOR SURFACING MODE (A/B toggle: TIP vs TILED) --------------------
  // Default = TIP (the projected-photo corridor, unchanged). ?surf=tiled swaps to
  // seamless tiling MeshStandard textures WITHOUT a rebuild (read from the URL at
  // construction). Falls back to the config default when there's no query param.
  const SURF = (() => {
    let qp = null;
    try {
      if (typeof location !== 'undefined' && location.search) {
        qp = new URLSearchParams(location.search).get('surf');
      }
    } catch { /* no location (SSR/tests) */ }
    if (qp === 'tiled') return 'tiled';
    if (qp === 'tip') return 'tip';
    return CORRIDOR_SURFACE === 'tiled' ? 'tiled' : 'tip';
  })();
  const TILED = SURF === 'tiled';

  // ---- ALIGNMENT VARIATION (A/B/C composition of runner + boulder) -----------
  // Read 1..3 from ?align=N (default ALIGN_VARIATION), guarded for no `location`.
  // The selected preset only re-scales/re-positions the avatar billboard + the 2D
  // boulder overlay — corridor/camera/projection and ALL gameplay timing untouched.
  const ALIGN = (() => {
    let n = ALIGN_VARIATION;
    try {
      if (typeof location !== 'undefined' && location.search) {
        const q = parseInt(new URLSearchParams(location.search).get('align'), 10);
        if (q >= 1 && q <= ALIGN_PRESETS.length) n = q;
      }
    } catch { /* no location (SSR/tests) */ }
    const idx = Math.max(0, Math.min(ALIGN_PRESETS.length - 1, (n | 0) - 1));
    return ALIGN_PRESETS[idx];
  })();

  // TILE world-size: ~1 texture tile per this many world units (keeps flagstones /
  // carved-wall blocks at a believable scale, not stretched). Tuned for W=12,H=7.
  const TILE = 4.5;
  // Tiled-mode textures (loaded once, only when needed). RepeatWrapping so the UV
  // repeat counts written by quad() tile the seamless art; sRGB so colours read.
  let texFloor = null, texWall = null, floorMatT = null, wallMatT = null;
  if (TILED) {
    const mkTiled = (url) => {
      const t = _texLoader.load(url);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
      return t;
    };
    texFloor = mkTiled(ASSETS.texFloor);
    texWall = mkTiled(ASSETS.texWall);
    // Warm worn-stone surfaces lit by the torches (high roughness, near-zero metal).
    floorMatT = new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.95, metalness: 0.0 });
    // walls/ceiling/end-walls all share the carved-wall texture.
    wallMatT = new THREE.MeshStandardMaterial({ map: texWall, roughness: 0.95, metalness: 0.05 });
  }
  // surf(kind) -> the material to use for a corridor surface in the CURRENT mode.
  //   kind: 'floor' | 'wall' | 'ceil' | 'end'
  // In TIP mode this is ignored (callers pass the TIP ShaderMaterial as before);
  // it only routes the tiled MeshStandard materials. Floor uses texFloor; walls,
  // ceiling and end-walls all reuse texWall.
  const surfMat = (kind) => (kind === 'floor' ? floorMatT : wallMatT);
  // uvFor(kind, length, width) -> the UV repeat ({u,v}) for a surface of the given
  // world span so the texture tiles by WORLD size (no stretch). For floor/ceil the
  // quad's a->b edge runs across the WIDTH and a->d runs along the LENGTH; for a
  // wall the a->b edge runs along LENGTH and a->d runs up the HEIGHT.
  const uvFor = (across, along) => ({ u: Math.max(1, across / TILE), v: Math.max(1, along / TILE) });

  // ---- ROUTE (path/waypoints/turn state machine) — owned by ./route.js --------
  // The route module builds ALL corridor geometry, the waypoint polyline + arc-
  // length helpers, and the PLAYER-DRIVEN turn machine (straight-by-default +
  // splice-on-turn + pit detection). It needs a `surf` adapter that routes the
  // TIP-vs-TILED material choice (the engine still owns the materials/textures):
  //   • mat(kind, tipMat)     -> tiled MeshStandard material OR the passed TIP mat
  //   • uv(across, along)     -> UV repeat (tiled) or undefined (TIP)
  //   • matExit(kind, tipMat) -> exit corridor: tiled surfaces but TIP archway
  const surf = {
    mat: (kind, tipMat) => (TILED ? surfMat(kind) : tipMat),
    uv: (across, along) => (TILED ? uvFor(across, along) : undefined),
    matExit: (kind, tipMat) => (TILED ? surfMat(kind) : tipMat),
    // Bright sunlit exit only for the true DAYLIGHT escape (L6). For the stone-door
    // and artifact endings the exit space is the SAME dark photoreal corridor — the
    // door seals you into darkness, no bright daylight bleed.
    exitImg: (ENDING === 'exit') ? exitImg : img,
    exitCorridorLen: EXIT.corridorLen,
    // warm point-light hook so the route can drop a subtle torch glow at each
    // junction's open archway (draws the eye to the correct turn). Routed through
    // surf so route.js owns no THREE light state of its own. Defined below addTorch.
    addTorch: (x, y, z, intensity) => addTorch(new THREE.Vector3(x, y, z), intensity),
  };
  const route = createRoute({
    THREE, scene, WD,
    geometry: { P, capVP, mkMat, quad },
    params: mp, segments, junctions, maze: MAZE, camY, surf,
  });
  // Read-once layout from the route (hazard placement + minimap + exit light).
  const unitFrames = route.unitFrames;
  const junctionStubs = route.junctionStubs;
  const correctWaypoints = route.correctWaypoints;
  const exitCorridorInfo = route.exitCorridorInfo;
  // arc-length helpers proxy to the route (active path is player-driven).
  const ptAt = (sv) => route.ptAt(sv);
  const sAt = (p) => route.sAt(p);

  // ---- hazards (built-in 3D beams/blades, lit by torches) --------------------
  // TIP mode: the corridor surfaces are unlit ShaderMaterial (their look is baked in
  // the projected photo), so the ambient only needs to lift the lit 3D props. TILED
  // mode: the corridor is MeshStandard and NEEDS light to read, so bump the warm
  // ambient and add a soft hemisphere fill (warm from torches above, cool stone below)
  // so the tiled walls/floor aren't flat-dark — tuned to keep the warm torch-lit mood.
  scene.add(new THREE.AmbientLight(0xffce8a, TILED ? 0.85 : 0.42));
  if (TILED) {
    scene.add(new THREE.HemisphereLight(0xffd9a0, 0x251a10, 0.55));   // warm sky / dim stone ground fill
  }
  function addTorch(pos, intensity) {
    const pl = new THREE.PointLight(0xffa64a, intensity, 30, 2.4);
    pl.position.copy(pos); scene.add(pl); return pl;
  }
  // Colored accent light to make a hazard glow / stand out from the dark stone.
  function addLight(pos, color, intensity, dist) {
    const pl = new THREE.PointLight(color, intensity, dist || 12, 2.0);
    pl.position.copy(pos); scene.add(pl); return pl;
  }
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95, metalness: 0.04 });
  // Fallen BEAM: lighter, warm sandstone that pops off the dark floor + a faint self-glow so it reads in shadow.
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xb9935a, roughness: 0.85, metalness: 0.05, emissive: 0x3a2206, emissiveIntensity: 0.9 });
  // Glowing amber hazard stripe baked onto the top of each beam ("step up / JUMP" cue).
  const beamWarnMat = new THREE.MeshBasicMaterial({ color: 0xffb43a });
  // BLADE: bright polished steel with a strong emissive sheen so the swing catches the eye.
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.18, metalness: 0.95, emissive: 0x6a3a10, emissiveIntensity: 0.9 });
  // Glowing hot edge along the blade tip.
  const bladeEdgeMat = new THREE.MeshBasicMaterial({ color: 0xffd86a });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.7, metalness: 0.8 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42 });

  // ---- STONE DOOR (level ending) --------------------------------------------
  // A carved slab that DESCENDS across the exit as the collapse timer drains. To
  // escape you DUCK under it; the lower it is, the more you must duck. It never
  // fully closes — the gap floors at DUCK_GAP, so "just before collapse it's still
  // wide enough to duck through." Placed just inside the exit archway.
  const DOOR = {
    setback: 3.4,            // world units before the archway end
    openGap: H * 0.92,       // gap under the door when the timer is full (walk through)
    duckGap: H * 0.34,       // gap when fully descended (must duck; never lower)
    needGap: H * 0.66,       // below this you MUST be ducking to pass
    duckWindow: 480,         // ms after a duck press that counts as "ducking"
  };
  let doorMesh = null, doorPos = null, doorGap = DOOR.openGap, doorPassed = false, doorCued = false, duckUntil = -1;
  const DOOR_H = H * 1.4;   // door plane height — tall so its top hides above the ceiling
  if (exitCorridorInfo && ENDING === 'door') {
    const dir = exitCorridorInfo.outDir.clone().setY(0).normalize();
    doorPos = exitCorridorInfo.farEnd.clone().addScaledVector(dir, -DOOR.setback);
    // The SAME photoreal corridor stone as the walls, kept DARK — a heavy blast slab
    // that matches the game, not a bright carved relief. Opaque (whole plane is solid
    // stone); it translates down, its top hiding above the ceiling.
    const doorTex = _texLoader.load(ASSETS.texWall);
    doorTex.wrapS = doorTex.wrapT = THREE.RepeatWrapping; doorTex.repeat.set(2.4, 2.4);
    doorTex.minFilter = HAS_MIPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; doorTex.generateMipmaps = HAS_MIPS;
    doorTex.anisotropy = MAX_ANISO;
    if ('colorSpace' in doorTex) doorTex.colorSpace = THREE.SRGBColorSpace;
    const doorMat = new THREE.MeshBasicMaterial({ map: doorTex, color: 0x2a2016, side: THREE.DoubleSide, depthWrite: true });
    doorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, DOOR_H), doorMat);
    doorMesh.rotation.y = Math.atan2(dir.x, dir.z);
    doorMesh.renderOrder = 5;
    doorMesh.position.set(doorPos.x, DOOR.openGap + DOOR_H / 2, doorPos.z);
    scene.add(doorMesh);
  }
  // Lower the door each frame as the collapse timer drains (bottom edge = doorGap).
  function updateDoor() {
    if (!doorMesh) return;
    const prog = Math.max(0, Math.min(1, 1 - collapse.remaining() / Math.max(1, BUDGET_S)));
    doorGap = DOOR.openGap + (DOOR.duckGap - DOOR.openGap) * prog;   // lowers as time runs out
    doorMesh.position.y = doorGap + DOOR_H / 2;
    if (prog > 0.3 && phase === 'run') audio.doorGrind(prog);   // grinding stone as it descends
    // Warn the player once when they reach the exit corridor and the door is low
    // enough that they'll need to DUCK to slip under it.
    if (phase === 'run' && !doorPassed && !doorCued && doorGap < DOOR.needGap
        && route.resolvedCount >= (map && map.junctions ? map.junctions.length : 0)) {
      doorCued = true; cue('DUCK — DOOR LOW', '#ffd23a');
    }
  }
  // Gate the win on ducking under a low door. Returns true if the player may escape
  // now; false means they hit the door (caller stumbles them into a DUCK).
  function doorClear() {
    if (!doorMesh || doorPassed) return true;
    if (doorGap >= DOOR.needGap) { doorPassed = true; return true; }   // high enough — walk through
    if (performance.now() < duckUntil) { doorPassed = true; return true; }  // ducking — slip under
    return false;                                                       // too low + upright — blocked
  }

  const unitPlace = (lx, ly, lz, uf) => P(lx, ly, lz, uf.o, uf.q);
  function unitQuat(uf) {
    const f = WD[uf.q], r = WD[(uf.q + 1) % 4];
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(r.x, 0, r.z),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-f.x, 0, -f.z),
    );
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  const blades = [];          // { pivot, phase }
  const beamPts = [];         // world centers of each beam
  const bladePts = [];        // world positions of each blade swing arc
  const firePts = [];         // { p: world center, duck } — lion fire jets
  const crackPts = [];        // world centers of each cracked-floor band
  const fireMeshes = [];      // { mesh, phase, mirror } — for the flame flicker

  // Shared photoreal prop materials (unlit, keyed alpha — same treatment as the
  // avatar/boulder so the baked lighting in the art reads photoreal in-scene).
  const beamPlaneMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, depthWrite: true });
  // Blade WRITES depth (with a firm alphaTest so only the solid disc/chain contribute) so
  // it occludes correctly against the runner billboard: the runner passes IN FRONT while
  // approaching and the blade passes OVER once you duck under it — no more poking-through
  // the silhouette (the old depthWrite:false + low alphaTest let the swing bleed across the runner).
  const bladePlaneMat = new THREE.MeshBasicMaterial({ map: bladeTex, transparent: true, alphaTest: 0.55, side: THREE.DoubleSide, depthWrite: true });
  // Lion-mouth fire hazard, two layers: the STONE lion stays fixed (alphaTest-keyed,
  // normal blend) while the FLAME jet glows (additive) and is the only part animated.
  const fireLionMat = new THREE.MeshBasicMaterial({ map: fireLionTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: false });
  // Flame jet: the shared sprite-sheet texture, ADDITIVE so the pure-black video background
  // contributes nothing and only the fire glows over the dark corridor (no keying needed).
  const fireFlameMat = new THREE.MeshBasicMaterial({ map: fireSheetTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  // FALL-IN CHASM: a photoreal broken-floor texture laid FLAT on the floor (the gap is baked
  // in) over a recessed near-black VOID box you plunge into if you don't jump. Unlit/front-side
  // so it reads from the chase cam and the camera sees the void when it drops through.
  const crackFloorMat = new THREE.MeshBasicMaterial({ map: crackFloorTex, side: THREE.FrontSide });
  const crackVoidMat = new THREE.MeshBasicMaterial({ color: 0x04030a, side: THREE.DoubleSide });   // near-black chasm walls/bottom

  // Hazards live in the usable band of the straight hall, before the turn opening.
  // We SPREAD a segment's hazards evenly across this band so a beam+blade pair has
  // room to jump THEN duck (rather than honouring tightly-authored `at` values that
  // would land them on top of each other).
  const HZ_LO = 0.20, HZ_HI = 0.80;                 // fraction of (Lh-W): start ... before the turn
  // SEG-0 SAFE BAND: segment 0 hazards must sit well AHEAD of the spawn (avatar spawns
  // at arc ≈ SCHAR/charAhead) with reaction room, so we clamp them to the FAR part of
  // the (now longer) opening hall — the latter ~60–85% of (Lh-W).
  const HZ0_LO = 0.60, HZ0_HI = 0.85;
  const hazFrac = (i, n, at, lo, hi) => (n <= 1)
    ? lo + (hi - lo) * Math.max(0, Math.min(1, at != null ? at : 0.5))
    : lo + (hi - lo) * (i / (n - 1));               // even spread, max spacing
  // hazZfrac(frac, Lh) — local z of a hazard at `frac` of the usable band, using THIS
  // segment's hall length (so a variable-length seg places hazards at the right depth).
  const hazZfrac = (frac, Lh) => -frac * (Lh - W);

  unitFrames.forEach((uf, ui) => {
    const ufLh = (uf.Lh != null && isFinite(uf.Lh) && uf.Lh > 0) ? uf.Lh : mp.hallLen;
    // SEGMENT 0: by default a hazard-free run-up to the first turn (the avatar spawns
    // a few units ahead of the camera, so a near hazard would sit at/behind the player).
    // It now CAN carry hazards IF the map authors them — but they're clamped to the FAR
    // part of the (longer) hall (HZ0_LO..HZ0_HI) so they're always safely ahead of spawn
    // with reaction room. With no authored hazards, seg 0 stays a clean run-up.
    if (ui === 0 && !(uf.hazards && uf.hazards.length)) return;
    const uq = unitQuat(uf);
    // From the map if provided, else alternate beams/blades per unit (prototype).
    let hz = uf.hazards;
    if (!hz) hz = (ui % 2 !== 0) ? [{ type: 'blade', at: 0.42 }] : [{ type: 'beam', at: 0.30 }, { type: 'beam', at: 0.55 }];
    // order by authored `at` so the spread keeps the intended beam/blade sequence.
    hz = hz.slice().sort((a, b) => ((a.at != null ? a.at : 0.5) - (b.at != null ? b.at : 0.5)));
    const nHz = hz.length;
    // seg 0 uses the FAR safe band; every other segment uses the normal band.
    const lo = ui === 0 ? HZ0_LO : HZ_LO;
    const hi = ui === 0 ? HZ0_HI : HZ_HI;
    hz.forEach((h, hi2) => {
      const dz = hazZfrac(hazFrac(hi2, nHz, h.at, lo, hi), ufLh);
      if (h.type === 'beam') {
        // PHOTOREAL fallen beam: the keyed carved-stone image on an upright plane
        // spanning the corridor, low enough to hop. (image-on-geometry, not a box.)
        const bw = W * 0.96;                       // span almost the full corridor
        const bh = (bw / BEAM_AR) * 0.62;          // keep carving proportions but low & jumpable
        const beam = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), beamPlaneMat);
        beam.position.copy(unitPlace(0, bh / 2 + 0.05, dz, uf)); beam.quaternion.copy(uq);
        beam.renderOrder = 4;
        scene.add(beam);
        addLight(unitPlace(0, bh + 1.2, dz + 1.2, uf), 0xffb050, 0.8, 9);   // warm key light on the carving
        beamPts.push(unitPlace(0, camY, dz, uf));
        const sh = new THREE.Mesh(new THREE.CircleGeometry(W * 0.55, 24), shadowMat);
        sh.position.copy(unitPlace(0, 0.05, dz, uf)); sh.quaternion.copy(uq); sh.rotateX(-Math.PI / 2); sh.scale.set(1, 0.42, 1);
        scene.add(sh);
        addTorch(unitPlace(hw - 1.2, 4.4, dz, uf), 0.55);
        addTorch(unitPlace(-(hw - 1.2), 4.4, dz, uf), 0.55);
      } else if (h.type === 'blade') {
        // PHOTOREAL swinging blade: the keyed pendulum image (chain + blade + swing
        // blur already baked) on a plane that hangs from the ceiling pivot and swings.
        const anchor = new THREE.Group();
        anchor.position.copy(unitPlace(0, H, dz, uf)); anchor.quaternion.copy(uq);
        scene.add(anchor);
        const pivot = new THREE.Group(); anchor.add(pivot);
        // properly-sized photoreal blade disc, hung at duck height on a thin 3D chain.
        const bladeW = 2.7, bladeH = bladeW / BLADE_AR;     // ~2.7 x 2.23 (scaled down)
        const bladeCY = -3.5;                               // local y of disc center -> world ~3.5 (clear duck-under)
        const chainLen = -(bladeCY + bladeH / 2);           // ceiling down to the disc top
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, chainLen, 8), chainMat);
        chain.position.set(0, -chainLen / 2, 0); pivot.add(chain);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(bladeW, bladeH), bladePlaneMat);
        plane.position.set(0, bladeCY, 0);
        plane.renderOrder = 4;
        pivot.add(plane);
        // subtle cool steel glint riding with the blade so the swing catches light
        // without washing an orange halo around the disc (QA: odd orange glow).
        const bl = new THREE.PointLight(0xbcd0e0, 0.35, 8, 2.2);
        bl.position.set(0, bladeCY, 0); pivot.add(bl);
        const hub = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 1.2), stoneMat);
        hub.position.set(0, -0.15, 0); anchor.add(hub);
        blades.push({ pivot, phase: ui * 1.7 });
        bladePts.push(unitPlace(0, camY, dz, uf));
        addTorch(unitPlace(hw - 1.0, 4.2, dz - 1.5, uf), 0.85);
        addTorch(unitPlace(-(hw - 1.0), 4.2, dz + 1.5, uf), 0.85);
      } else if (h.type === 'fire') {
        // FIRE-SPITTING LION: a carved STONE lion head bolted to the right wall + a real
        // FLAMETHROWER jet (Grok video, sprite-sheet animated, additive) blasting from its
        // mouth clear across the corridor to the far wall. A LOW jet (mode 'jump') you hop;
        // a HIGH jet (mode 'duck') you duck under.
        const duck = (h.mode === 'duck' || h.height === 'high');
        const cy = duck ? FIRE.highY : FIRE.lowY;
        const SL = FIRE.size;
        const offX = hw - SL * 0.30;                       // lion block hugs the right wall
        // STATIC stone lion — bolted to the wall, never moves.
        const lionMesh = new THREE.Mesh(new THREE.PlaneGeometry(SL, SL), fireLionMat);
        lionMesh.position.copy(unitPlace(offX, cy, dz, uf)); lionMesh.quaternion.copy(uq);
        lionMesh.renderOrder = 6; scene.add(lionMesh);
        // ANIMATED flame jet: a wide plane (frame aspect, no stretch-distortion) centred in
        // the hall so the nozzle reads at the lion's mouth (right) and the tip reaches the
        // far wall (left). All jets share fireSheetTex; its UV offset is advanced each frame.
        const FW = W * FIRE.jetWFrac, FH = FW / FIRE.jetAspect;
        const flameMesh = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), fireFlameMat);
        flameMesh.position.copy(unitPlace(0, cy, dz, uf)); flameMesh.quaternion.copy(uq);
        flameMesh.renderOrder = 7; scene.add(flameMesh);
        addLight(unitPlace(0, cy, dz + 1.0, uf), FIRE.light, 2.0, 18);          // flame glow across the hall
        addTorch(unitPlace(hw - 0.6, cy + 1.4, dz, uf), 0.7);
        firePts.push({ p: unitPlace(0, camY, dz, uf), duck });
      } else if (h.type === 'crack') {
        // COLLAPSED-FLOOR CHASM: a DRY broken gap across the corridor you JUMP. Real sunken
        // geometry — jagged broken-flagstone lips, dark stone walls dropping into a near-
        // black void, and a few rubble chunks at the edge. No lava (fits the dry temple).
        const cl = CRACK.len, depth = CRACK.depth, hwv = W * 0.5;
        const DL = cl + 14;   // floor-decal length (the chasm sits at the centre, cracked floor around it)
        // PHOTOREAL broken-floor DECAL laid FLAT on the floor (the chasm is baked into the
        // texture — photoreal, like the rest of the corridor). Front-side so it shows from the
        // chase cam but vanishes once the camera drops below it into the void during a fall.
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(W, DL), crackFloorMat);
        decal.position.copy(unitPlace(0, 0.04, dz, uf)); decal.quaternion.copy(uq); decal.rotateX(-Math.PI / 2);
        decal.renderOrder = 3; scene.add(decal);
        // recessed near-black VOID box under the gap — the chasm you plunge into if you don't jump.
        const pushTo = (arr, a, b, c, d) => {
          const W4 = [a, b, c, d].map((p) => unitPlace(p[0], p[1], p[2], uf));
          arr.push(W4[0].x, W4[0].y, W4[0].z, W4[1].x, W4[1].y, W4[1].z, W4[2].x, W4[2].y, W4[2].z);
          arr.push(W4[0].x, W4[0].y, W4[0].z, W4[2].x, W4[2].y, W4[2].z, W4[3].x, W4[3].y, W4[3].z);
        };
        const zN = dz + cl * 0.5, zF = dz - cl * 0.5, yB = -depth, vt = [];
        pushTo(vt, [-hwv, 0.03, zN], [hwv, 0.03, zN], [hwv, yB, zN], [-hwv, yB, zN]);   // near wall
        pushTo(vt, [-hwv, 0.03, zF], [-hwv, yB, zF], [hwv, yB, zF], [hwv, 0.03, zF]);   // far wall
        pushTo(vt, [-hwv, 0.03, zN], [-hwv, yB, zN], [-hwv, yB, zF], [-hwv, 0.03, zF]); // left wall
        pushTo(vt, [hwv, 0.03, zN], [hwv, 0.03, zF], [hwv, yB, zF], [hwv, yB, zN]);     // right wall
        pushTo(vt, [-hwv, yB, zN], [hwv, yB, zN], [hwv, yB, zF], [-hwv, yB, zF]);       // bottom
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vt), 3)); g.computeVertexNormals();
        const voidMesh = new THREE.Mesh(g, crackVoidMat); voidMesh.renderOrder = 2; scene.add(voidMesh);
        // warm torches at the gap edges so the broken-floor texture catches light on approach.
        addTorch(unitPlace(hw - 1.0, 4.2, dz, uf), 0.7);
        addTorch(unitPlace(-(hw - 1.0), 4.2, dz, uf), 0.7);
        crackPts.push(unitPlace(0, camY, dz, uf));
      }
    });
  });

  // ---- third-person AVATAR (camera-facing billboard) -------------------------
  const sprite = makeSpriteSheets(THREE);
  const avatarTex = new THREE.Texture();
  avatarTex.minFilter = THREE.LinearFilter; avatarTex.magFilter = THREE.LinearFilter;
  const avatarMat = new THREE.MeshBasicMaterial({ map: avatarTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const avatarGeo = new THREE.PlaneGeometry(AVATAR.height * AVATAR.aspect, AVATAR.height);
  const avatar = new THREE.Mesh(avatarGeo, avatarMat);
  avatar.renderOrder = 5;
  // Alignment variation: scale the avatar billboard about its center (geometry is
  // unchanged so V1 with avatarScale=1 is identical to before).
  avatar.scale.setScalar(ALIGN.avatarScale);
  scene.add(avatar);

  // ---- ESCAPE / WIN: warm light at the photoreal exit corridor's archway --------
  // The bright opening + god-ray archway now come from the photoreal `exitImg`
  // TIP-projected onto the appended exit corridor (Option A) — so the old floating
  // additive bright PLANE + halo are GONE (they would double up into an ugly white
  // box over the photo). We keep ONLY a gentle warm PointLight sitting at the
  // archway end, pouring daylight back up the corridor onto the 3D avatar so the
  // runner reads as lit by the exit. The fx-canvas bloom ramp + win whiteout
  // (in drawOverlay) still sell the "burst into daylight" on arrival.
  (function buildExitLight() {
    if (!exitCorridorInfo) return;
    const { farEnd, outDir } = exitCorridorInfo;
    // sit the light just inside the archway (a touch back from the very end) and
    // a little above eye level, so it lights the runner from ahead.
    const pos = farEnd.clone().add(new THREE.Vector3(outDir.x * -1.5, 1.5, outDir.z * -1.5));
    addLight(pos, 0xfff0d0, EXIT.lightIntensity, EXIT.lightDist);
  })();

  // ---- arc-length-derived hazard / turn anchors (path owned by ./route.js) ----
  // The route exposes ptAt/sAt against its LIVE active path; the boulder/hazard
  // arc-anchors below are computed once from the world-space hazard centres. Turn
  // decisions + pit detection are delegated to the route (player-driven).
  // Hazard arc-anchors use sAtFull (the immutable FULL correct path) so a hazard in a
  // far hall gets the right arc-length even though the live active path is truncated to
  // the current junction. Arc-length on the correct path == on the active path for every
  // hall the player legitimately reaches (they turned correctly to get there).
  const sBeam = beamPts.map(route.sAtFull).sort((a, b) => a - b);
  const sBlade = bladePts.map(route.sAtFull).sort((a, b) => a - b);
  // FIRE: arc-length + which move clears it (duck vs jump). CRACK: arc-length (jump).
  const sFire = firePts.map((f) => ({ s: route.sAtFull(f.p), duck: f.duck })).sort((a, b) => a.s - b.s);
  const sCrack = crackPts.map(route.sAtFull).sort((a, b) => a - b);
  // sTurn: per-junction decision points (route keeps `.s` fresh as bends splice in).
  const sTurn = route.sTurn;

  // ---- minimap ---------------------------------------------------------------
  // Bounds + layout come from the route (it owns the immutable correct path, the
  // maze dim stubs and the pit tails). The ACTIVE polyline (route.waypoints) is the
  // live player-driven path, so the linear minimap follows a turn (or pit) as it splices.
  // LATE-ATTACH: the React HUD mounts the minimap <canvas> on the same render
  // that creates the engine, so on the FIRST level it may not exist yet (the
  // L1 "black map" bug). Keep the canvas + ctx mutable and expose
  // setMinimapCanvas() so the ref callback can attach it whenever it mounts.
  let mmCanvas = minimapCanvas || null;
  let mx = mmCanvas ? mmCanvas.getContext('2d') : null;
  function setMinimapCanvas(c) {
    mmCanvas = c || null;
    mx = mmCanvas ? mmCanvas.getContext('2d') : null;
    if (mx) drawMM(s);   // paint immediately (don't wait a frame — study panel may be up)
  }
  const mmBounds = route.mmBounds;
  const mazeSegments = route.mazeSegments;
  // Length of the full correct route → CONTINUOUS minimap-dot progress (the marker
  // slides as the player moves, instead of only jumping forward at each junction).
  let mmFullLen = 0;
  { const cw = route.correctWaypoints || []; for (let i = 0; i < cw.length - 1; i++) mmFullLen += cw[i + 1].distanceTo(cw[i]); }
  // Hazard map-anchors (world x/z of every placed trap) so the minimap can drop
  // legend icons on the maze — beams, blades, fire jets and crumbling floor.
  const mmHazards = {
    beam: beamPts.map((p) => ({ x: p.x, z: p.z })),
    blade: bladePts.map((p) => ({ x: p.x, z: p.z })),
    fire: firePts.map((f) => ({ x: f.p.x, z: f.p.z })),
    crack: crackPts.map((p) => ({ x: p.x, z: p.z })),
  };
  function drawMM(sv) {
    if (!mx) return;
    const clampS = (v) => Math.max(0.1, Math.min(route.total - 0.1, v));
    const aS = clampS(sv + dir * SCHAR);
    const p0 = ptAt(aS), p1 = ptAt(clampS(aS + dir * 1.6));
    drawMinimap(mx, {
      canvas: mmCanvas, maze: MAZE, bounds: mmBounds,
      waypoints: route.waypoints, correctWaypoints, junctionStubs, mazeSegments, hazards: mmHazards,
      // FULL grid labyrinth for the map (all corridors/dead-ends), + progress for the dot.
      gridView: (map && map.grid) ? { grid: map.grid, path: map.path, hazardCells: map.hazardCells, progress: Math.max(0, Math.min(1, route.sAtFull(p0) / Math.max(1, mmFullLen))) } : null,
      // the dot tracks the AVATAR (sv + the in-travel-direction lead), so it follows a
      // wrong-branch excursion and the back-out, matching what the player sees.
      pos: p0,
      heading: { x: p1.x - p0.x, z: p1.z - p0.z },
    });
  }

  // ---- 2D boulder overlay ----------------------------------------------------
  const fc = fxCanvas ? fxCanvas.getContext('2d') : null;
  const boulderImg = new Image(); let boulderReady = false;
  boulderImg.onload = () => { boulderReady = true; };
  boulderImg.src = ASSETS.boulder;

  // ---- boulder overlay + crush cinematic (2D fx-canvas) ----------------------
  // The boulder/crush/dust/shake/escape-slide + exit bloom/whiteout all live in
  // ./boulderFx.js. It owns its own mutable cinematic state (crushT, escapeT,
  // shakeX/Y, impactTime, dust pool, boulderRoll); the engine reads back crushT /
  // shakeX / shakeY via getters and threads the rest of the game state into draw().
  const fx = createBoulderFx({ BOULDER, EXIT, ALIGN });
  const CRUSH = fx.CRUSH;       // tunables (camShake / shakeImpact read by the 3D cam shake)

  // ---- COLLAPSE TIMER (its own module: engine/collapse.js) -------------------
  // Owns the per-level countdown, the beam-block fuse, expiry detection and the
  // blow-apart cinematic (2D fx-canvas overlay). The engine just arms it when the
  // run begins (grace over), ticks it in the run loop, exposes remaining() via
  // onState, and triggers the collapse death on expiry. It exposes a shake the
  // engine threads into the 3D camera (same pattern as boulderFx).
  // AUTO-PACING: when a level sets params.paceMargin, DERIVE the collapse budget
  // from the SHORTEST route so wandering a much bigger route TRAPS the player.
  // The timer is PAUSED during startGrace (the player auto-runs for free during
  // it), so the budget only needs to cover the route length that remains AFTER the
  // free grace distance:
  //     graceDist        = runSpeed * startGrace           (covered for free)
  //     underTimerTime   = (optimalRouteLen - graceDist) / runSpeed
  //     budget           = underTimerTime * paceMargin + paceBuffer
  // paceMargin is now a TIGHT tolerance over the shortest route (~1.10 = only 10%
  // slack -> only near-optimal routing survives; the longest route is NOT afforded).
  // Ramp it: calm early (~1.30) -> tense late (~1.10). Falls back to the authored
  // collapseTime when paceMargin is absent (backward compatible).
  function fullRouteLen() {
    const cw = route.correctWaypoints; let L = 0;
    for (let i = 0; i < cw.length - 1; i++) L += cw[i + 1].distanceTo(cw[i]);
    return L;
  }
  const PACE_MARGIN = mp.paceMargin;
  let BUDGET_S = COLLAPSE_S;
  if (PACE_MARGIN != null && isFinite(PACE_MARGIN) && PACE_MARGIN > 0) {
    const graceDist = SPD * GRACE_S;
    const underTimerTime = Math.max(0, (fullRouteLen() - graceDist) / SPD);
    BUDGET_S = Math.max(8, Math.round(underTimerTime * PACE_MARGIN + (mp.paceBuffer != null ? mp.paceBuffer : 3)));
  }
  const collapse = createCollapse({ COLLAPSE, budgetS: BUDGET_S });
  const audio = createAudio();   // procedural Web Audio SFX + collapse-rumble bed

  // ---- game state ------------------------------------------------------------
  const TURN_WIN = PLAY.turnWin, HAZ_WIN = PLAY.hazWin;
  const CRACK_HALF = CRACK.len / 2;   // gap half-length (the fall triggers at the near edge)
  const LATE = PLAY.lateTol != null ? PLAY.lateTol : 3.0;   // forgiveness past a turn
  const LEAD = PLAY.cueLead != null ? PLAY.cueLead : 16;    // telegraph distance
  const SCHAR = CAM.charAhead;                              // judge at the AVATAR, not the camera
  let s = 0, last = performance.now(), raf = 0, running = false;
  // READING HOLD: while true, the scene + minimap render but the player can't move
  // and the collapse timer can't arm — a "study the map" beat before the run starts.
  let readingHold = false;
  let phase = 'ready';        // 'ready' | 'run' | 'stuck' | 'over' | 'won'
  let clears = 0;
  let winT = 0;               // seconds since the ESCAPE (drives the win whiteout flash + ease)
  let boulderHeat = 0;
  let deathCause = null;      // 'blade' | 'boulder' | 'turn' | 'blocked' | 'pit' | 'collapse'
  let stuckT = 0, sliceT = 0; // beam-stumble timer / blade-slice timer
  let stuckWarned = false;    // one-shot escalation cue while stuck (the hidden fuse is burning)
  let stuckAction = 'jump';   // which move recovers the current stumble ('jump' | 'duck')
  // ---- COLLAPSE arming -------------------------------------------------------
  // The countdown must start at the moment the run ACTUALLY begins — i.e. when the
  // hazards arm at the end of startGrace. `collapseArmed` latches once we cross
  // GRACE_S of arc-length so we arm the timer exactly once per run.
  let collapseArmed = false;
  // ---- PIT FALL state --------------------------------------------------------
  // When the avatar runs off a junction's floorless pit stub (missed/wrong/no turn)
  // we drive a FALL: `falling` latches and `fallT` accumulates seconds, driving the
  // avatar + camera DROP on Y (accelerating) + a fade. When it completes we flip to
  // 'over' with deathCause 'pit'. No boulder. See the run-loop + camera/avatar code.
  let falling = false, fallT = 0;
  const FALL = { grav: 44, dur: 1.25, tilt: 0.9 };   // accel (units/s^2), seconds to 'over', max tilt — deeper plunge so the camera drops past the banded shaft walls
  // ---- MAZE traversal state (dead-end backtrack; NO pits/falls in maze mode) --------
  // A wrong/missed turn runs into a DEAD-END WALL; the player presses a turn to back
  // out to the junction and pick again. `dir` flips the camera+avatar to face the way
  // of travel; `camBlend` smooths the rig across a 180° flip so nothing pops.
  let dir = 1;            // travel/look direction: +1 forward, -1 backing out
  let mazeWall = false;   // stopped against a wall (straight far wall OR a dead-end wall)
  let backing = false;    // running back out of a dead end toward the junction
  let camBlend = 0;       // seconds of rig-position smoothing left after a direction flip
  const WALL_STOP = 1.4;  // how far short of a wall the avatar stops
  const CAM_BLEND_S = 0.45;
  const sCamPos = new THREE.Vector3();   // smoothed base camera path position
  const sCharPos = new THREE.Vector3();  // smoothed base avatar path position
  let rigInit = false;    // lazily seed the smoothed rig on the first frame
  // On a turn the boulder can't corner — it overshoots straight past the junction
  // and is GONE FOR GOOD (it never re-enters during a run).
  // (crushT/escapeT/boulderRoll now live in the boulderFx instance `fx`.)
  let boulderGone = false, escapeDir = -1;
  // The boulder is the OPENING threat only: it chases down the first straight and
  // is dropped the instant the player takes (or fatally misses) the first turn.
  // `boulderDropped` latches true at that moment and gates the crush cinematic:
  //   • pre-drop (boulder still present) deaths -> the boulder rolls in and crushes;
  //   • post-drop (boulder already gone) deaths -> a quick non-boulder fade/impact.
  // It only resets in resetGame, so once the boulder is gone it never comes back.
  let boulderDropped = false;
  // `presence` (0..1) is an eased ramp that makes the post-turn boulder read as a
  // FRESH one approaching from far down the corridor rather than teleporting back to
  // rest size. It starts at 1 (full presence) and is knocked to 0 when a vanished
  // boulder re-enters, then climbs at BOULDER.presenceRise. It GATES the proximity
  // mapping (the effective danger = heat * presence), so a fresh boulder is small/far
  // until pressure rebuilds. The crush path ignores presence entirely.
  let presence = 1;
  let hop = 0, dip = 0, hopV = 0, dipV = 0;
  // ---- TURN IMPULSE (responsive "you turned the camera" feedback) -------------
  // The camera is on rails: the ~90° corner rotation comes ONLY from arc-length `s`
  // advancing through the corner waypoints. But a turn is JUDGED a clear up to
  // TURN_WIN units BEFORE the junction, so without help the camera wouldn't move
  // until `s` physically reaches the corner a beat later (input feels disconnected).
  // On a SUCCESSFUL turn we kick a short spring-damped impulse that immediately
  // BANKS (rolls) the camera into the turn and YAW-LEADS the look target toward the
  // turn direction, then decays out (~0.4–0.5s) and blends into the rails rotation.
  // It NEVER adds net rotation past the corner — the rails still do the full 90°;
  // this only previews/eases the swing so the press reads instantly. Decays fully
  // to 0 before the next turn, so there's no residual tilt on straights.
  const TURN = {
    kick: 4.0,        // initial impulse velocity injected on a successful turn
    springK: 26,      // spring stiffness (snappy ease-out, like hop/dip)
    springD: 11,      // spring damping (slightly over-damped: no oscillation/overshoot)
    bank: 0.07,       // max camera roll (radians) per unit of lean — a SUBTLE bank, stays down-corridor
    yawLead: 1.0,     // how far (world units) to swing the look target sideways per unit lean (small: aim stays in the corridor — reduced from 1.4 so the bank never grazes the open corner)
    leanClamp: 0.6,   // hard cap on |turnLean| so the impulse can never aim the camera out of the corridor
  };
  let turnLean = 0, turnLeanV = 0;   // spring position/velocity; sign = turn direction (- = L, + = R)
  // avatar animation
  let anim = 'run', animT = 0, animFrame = 0, runT = 0;
  let avatarMoving = true;    // run-to-move: false when stopped, so the run cycle idles

  const beamDone = sBeam.map(() => false), bladeDone = sBlade.map(() => false);
  const fireDone = sFire.map(() => false), crackDone = sCrack.map(() => false);
  const fireArmed = sFire.map(() => false);   // one-shot jump/duck telegraph for each fire jet
  const crackArmed = sCrack.map(() => false); // one-shot JUMP! telegraph for each fall-in gap
  const turnDone = sTurn.map(() => false), turnArmed = sTurn.map(() => false);
  const beamArmed = sBeam.map(() => false), bladeArmed = sBlade.map(() => false);

  const state = { distance: 0, clears: 0, phase: 'ready', cause: null, falling: false, timeLeft: BUDGET_S, timeUrgent: false, timeArmed: false };
  function pushState() {
    state.distance = Math.floor(s * PLAY.metresPerUnit);
    state.clears = clears; state.phase = phase; state.cause = deathCause; state.falling = falling;
    // collapse countdown for the HUD (seconds remaining + urgency). React displays;
    // the engine just computes (timer logic lives in engine/collapse.js).
    state.timeLeft = collapse.remaining();
    state.timeUrgent = collapse.urgent;
    state.timeArmed = collapseArmed;
    if (onState) onState({ ...state });
  }
  function cue(text, color) { if (onCue) onCue(text, color); }

  function clearGrace() {
    for (let i = 0; i < sBeam.length; i++) if (sBeam[i] < GRACE_S) beamDone[i] = true;
    for (let i = 0; i < sBlade.length; i++) if (sBlade[i] < GRACE_S) bladeDone[i] = true;
    for (let i = 0; i < sFire.length; i++) if (sFire[i].s < GRACE_S) fireDone[i] = true;
    for (let i = 0; i < sCrack.length; i++) if (sCrack[i] < GRACE_S) crackDone[i] = true;
    for (let i = 0; i < sTurn.length; i++) if (sTurn[i].s < GRACE_S) turnDone[i] = true;
  }
  function resetGame() {
    // Restore the route's straight DEFAULT active path (un-splice every bend) so the
    // next run starts player-driven from junction 0 again. Refreshes waypoints/arc/sTurn.
    route.resetPath();
    s = 0; phase = 'run'; clears = 0; boulderHeat = 0;
    deathCause = null; stuckT = 0; sliceT = 0; winT = 0; fallT = 0; falling = false;
    dir = 1; mazeWall = false; backing = false; camBlend = 0; rigInit = false;
    collapseArmed = false; collapse.reset();
    // BOULDER RETIRED (Temple Collapse): the chase boulder is fully removed — the
    // collapse timer is the pressure now. Initialize as if the boulder is already
    // gone/dropped so it never renders (overlay alpha 0), the crush cinematic never
    // plays, and every death routes through the plain non-boulder fade/impact path.
    boulderGone = true; presence = 0; boulderDropped = true;
    hop = 0; dip = 0; hopV = 0; dipV = 0; anim = 'run'; animT = 0; animFrame = 0; runT = 0;
    turnLean = 0; turnLeanV = 0;
    beamDone.fill(false); bladeDone.fill(false); turnDone.fill(false); turnArmed.fill(false);
    beamArmed.fill(false); bladeArmed.fill(false); fireDone.fill(false); crackDone.fill(false);
    fireArmed.fill(false); crackArmed.fill(false); stuckAction = 'jump';
    doorPassed = false; doorCued = false; duckUntil = -1;   // reset the exit stone door for the new run
    audio.ambient(false);                 // silence the rumble bed until the run re-arms
    // reset avatar FX transforms
    avatarMat.opacity = 1; avatar.scale.set(1, 1, 1);
    // reset crush cinematics (crushT/escapeT/dust/shake/impact all live in fx)
    fx.reset();
    clearGrace(); last = performance.now(); pushState();
  }
  // Turn crash / wrong-way death. If the boulder hasn't been dropped yet (the player
  // failed the FIRST turn) the boulder rolls in and crushes them; once it's dropped
  // (post-first-turn) this is a plain wall-impact death (no boulder — gated by
  // `boulderDropped` in drawOverlay's `crushing`).
  function die(cause) { if (phase === 'over') return; phase = 'over'; deathCause = cause || 'turn'; fx.clearCrush(); audio.ambient(false); audio.die(deathCause); pushState(); }
  // BLADE = nasty instant kill: immediate over, red slice flash, avatar topples.
  // dieBlade fires only from 'run' (instant slice), where dust is empty + impactTime
  // is -1, so fx.clearCrush() (crushT=0 + dust/impact clear) is equivalent to the
  // original `crushT = 0` here. We also zero sliceT for the slice flash/topple.
  function dieBlade() { if (phase === 'over') return; phase = 'over'; deathCause = 'blade'; fx.clearCrush(); sliceT = 0; cue('SLICED!', '#ff2e22'); pushState(); }
  // FIRE = instant kill if you don't clear the jet with the right move (jump a low jet,
  // duck a high one). Same instant-death path as the blade, with a fiery burn flash.
  function dieFire() { if (phase === 'over') return; phase = 'over'; deathCause = 'fire'; fx.clearCrush(); sliceT = 0; cue('BURNED!', '#ff7a1e'); pushState(); }
  // BEAM = a NON-LETHAL STUMBLE. The runner trips and STOPS at the beam (losing time —
  // the collapse countdown keeps draining), but it NEVER costs a life. To get moving
  // again the player JUMPS: that clears the beam and resumes the run (see recoverBeam,
  // wired into input('jump')). The only thing that ends the run is the timer (or a
  // blade). No collapse fuse, no boulder crush. (Issue: a block must not cost a life.)
  // `getStuck(action)` records WHICH move frees you: 'jump' (beams, low fire, cracks) or
  // 'duck' (high fire). The matching input in recover() resumes the run. Never lethal.
  function getStuck(action) {
    if (phase !== 'run') return;
    stuckAction = action || 'jump';
    phase = 'stuck'; deathCause = null; stuckT = 0; stuckWarned = false; fx.clearCrush(); setAnim('run');
    audio.stumble();
    cue(stuckAction === 'duck' ? 'DUCK!' : 'JUMP!', '#ffd23a'); pushState();
  }
  // Recover from a stumble: the CORRECT move (the one that would have cleared the hazard)
  // gets you running again. The hazard is already marked done, so it won't re-trigger.
  function recover(action) {
    if (phase !== 'stuck' || action !== stuckAction) return;
    phase = 'run'; deathCause = null; stuckT = 0;
    if (action === 'duck') { dipV = Math.max(dipV, PLAY.dipV); setAnim('duck'); }
    else { hopV = Math.max(hopV, PLAY.hopV); setAnim('jump'); }
    avatarMat.opacity = 1; avatar.scale.set(1, 1, 1);
    pushState();
  }
  // PIT = run off the floorless stub past a junction (missed/wrong/no turn). Latches a
  // FALL: the avatar + camera drop on Y (driven in the run-loop + camera/avatar code),
  // then `fallT` reaching FALL.dur flips to 'over' with cause 'pit'. No boulder.
  function startFall() {
    if (falling || phase === 'over') return;
    falling = true; fallT = 0; boulderHeat = 0; boulderGone = true; boulderDropped = true;
    fx.clearCrush(); setAnim('run'); cue('FALL!', '#ff7a5a'); pushState();
  }

  // COLLAPSE = the temple blows apart (countdown expired OR the beam-block fuse
  // burned out while still blocked). The blow-apart cinematic lives in the collapse
  // module (2D fx-canvas); here we just flip to 'over' cause 'collapse' (costs a life
  // via the onState 'over'-edge decrement) and trigger the cinematic. boulderDropped
  // is latched so the boulder crush path is suppressed (no rolling rock — the ceiling
  // is what kills). It's safe from any live phase ('run' / 'stuck').
  function dieCollapse() {
    if (phase === 'over') return;
    phase = 'over'; deathCause = 'collapse';
    boulderGone = true; boulderDropped = true; boulderHeat = 0;
    fx.clearCrush(); collapse.trigger(); audio.ambient(false); audio.die('collapse'); pushState();
  }

  function setAnim(name) { anim = name; animT = 0; animFrame = 0; }

  // ---- input -----------------------------------------------------------------
  // Reward feedback on a clean hazard clear — a bright ding + a brief ✓ (juice).
  function onClear() { audio.clear(); cue('✓', '#9be7a0'); }
  function judgeAction(arr, done, kind) {
    const sp = s + SCHAR;                 // the avatar's position is what the player sees at the hazard
    for (let i = 0; i < arr.length; i++) {
      if (done[i]) continue;
      if (Math.abs(sp - arr[i]) <= HAZ_WIN) {
        done[i] = true; clears++; boulderHeat = Math.max(0, boulderHeat - 0.5);
        onClear(); pushState(); return;
      }
    }
  }
  // FIRE: a jump clears LOW jets, a duck clears HIGH jets (matched by `wantDuck`).
  function judgeFire(wantDuck) {
    const sp = s + SCHAR;
    for (let i = 0; i < sFire.length; i++) {
      if (fireDone[i]) continue;
      if (sFire[i].duck === wantDuck && Math.abs(sp - sFire[i].s) <= HAZ_WIN) {
        fireDone[i] = true; clears++; onClear(); pushState(); return;
      }
    }
  }
  // CRACK: a jump LEAPS the gap — clears if pressed from a window before the near edge to
  // just past the far edge (the gap is wide, so the window spans the whole gap + reaction room).
  function judgeCrack() {
    const sp = s + SCHAR;
    for (let i = 0; i < sCrack.length; i++) {
      if (crackDone[i]) continue;
      if (sp >= sCrack[i] - CRACK_HALF - HAZ_WIN && sp <= sCrack[i] + CRACK_HALF + 1) { crackDone[i] = true; clears++; onClear(); pushState(); return; }
    }
  }
  // ---- PLAYER-DRIVEN TURN (unified linear + maze) ----------------------------
  // The DEFAULT path is straight (into a pit). A press is only judged for the CURRENT
  // junction (route enforces idx === resolved) and only within the forgiving window:
  //   • correct dir in window  -> route splices the bend (the camera rotates ONLY now);
  //     boulder drops, turn-impulse kicks. The pit tail is replaced by the exit hall.
  //   • wrong dir in window     -> route returns 'pit': the straight stub stands, so the
  //     avatar keeps running off the floor edge -> fall (handled in the run-loop).
  // A NO-input case needs no handler here: the straight default already ends in the pit.
  function judgeTurn(dir) {
    if (phase !== 'run' || falling) return;
    const sp = s + SCHAR;
    for (let i = 0; i < sTurn.length; i++) {
      if (turnDone[i]) continue;
      const d = sTurn[i].s - sp;
      if (!isFinite(d)) continue;                 // junction not on the active path yet
      if (d <= TURN_WIN && d > -LATE) {
        const r = route.takeTurn(sTurn[i].idx, dir);
        if (r === 'ok') {
          turnDone[i] = true; clears++; boulderHeat = 0;
          // the boulder can't take the corner: it overshoots straight and is GONE FOR
          // GOOD (boulderDropped latches so it never rebuilds for the rest of the run).
          boulderGone = true; boulderDropped = true; fx.resetEscape(); escapeDir = (dir === 'L') ? 1 : -1;
          // kick the camera turn-impulse so the press reads instantly, then it springs
          // back to 0 as the (now-spliced) bend rounds the corner (- = left, + = right).
          const tdir = (dir === 'L') ? -1 : 1;
          turnLeanV = (Math.abs(turnLeanV) < TURN.kick ? TURN.kick : Math.abs(turnLeanV)) * tdir;
          audio.turn();
          pushState();
        } else if (r === 'pit') {
          // Wrong direction: the bend is NOT spliced — the straight pit stub stands and
          // the avatar runs off the edge (the run-loop's pit check starts the fall). Drop
          // the boulder + mark this junction handled so the press isn't re-judged.
          turnDone[i] = true; boulderGone = true; boulderDropped = true; fx.resetEscape();
          cue('✕ NOT THAT WAY', '#ff3b30'); pushState();
        }
        return;
      }
    }
  }
  function input(action) {
    if (readingHold) return;   // studying the map — ignore all gameplay input
    audio.resume();            // first gesture unlocks Web Audio
    // DUCK also arms the "ducking" window used to slip under the descending exit door.
    if (action === 'duck') duckUntil = performance.now() + DOOR.duckWindow;
    // RUN-TO-MOVE: hold the run input to advance (released = stop). Works in any phase.
    if (action === 'runStart') { runHeld = true; return; }
    if (action === 'runStop') { runHeld = false; return; }
    if (phase === 'won') { if (action === 'restart') resetGame(); return; }
    if (phase === 'over') { if (action === 'restart') resetGame(); return; }
    if (phase === 'ready') { resetGame(); }
    // STUMBLE: the run is stopped at a beam/fire — the correct move (jump or duck) frees
    // it. Other input is ignored while stumbling. Never costs a life.
    if (phase === 'stuck') { if (action === 'jump' || action === 'duck') recover(action); return; }
    if (action === 'jump') { hopV = Math.max(hopV, PLAY.hopV); setAnim('jump'); audio.jump(); judgeAction(sBeam, beamDone, 'jump'); judgeFire(false); judgeCrack(); }
    else if (action === 'duck') { dipV = Math.max(dipV, PLAY.dipV); setAnim('duck'); audio.duck(); judgeAction(sBlade, bladeDone, 'duck'); judgeFire(true); }
    else if (action === 'left') { MAZE ? judgeTurnMaze('L') : judgeTurn('L'); }
    else if (action === 'right') { MAZE ? judgeTurnMaze('R') : judgeTurn('R'); }
  }

  // ---- MAZE TURN (dead-end / back-out aware) ---------------------------------
  // Three situations a turn press handles in a maze:
  //   • stopped at a DEAD-END wall  -> turn around and run back out to the junction;
  //   • stopped at the straight far WALL (no turn taken) -> pick now from a standstill;
  //   • approaching the junction within the window -> pick on the move.
  // Correct pick splices the through-bend and advances; a wrong pick splices the
  // wrong-side dead-end hall (run to its wall, then back out). NEVER a fall / life loss.
  function judgeTurnMaze(pressDir) {
    if (phase !== 'run' || backing) return;
    const i = route.resolvedCount;
    if (i >= sTurn.length) return;
    // at a dead-end wall: any turn = back out. Flipping `dir` mirrors the avatar offset
    // (avatar = s + dir*SCHAR), so shift `s` by +2*SCHAR to keep the avatar pinned at the
    // wall through the flip (only the camera swings — smoothed by camBlend).
    if (mazeWall && route.onWrongBranch()) {
      s += 2 * SCHAR;
      backing = true; dir = -1; mazeWall = false; camBlend = CAM_BLEND_S;
      setAnim('run'); audio.back(); cue('DOUBLE BACK', '#ffd99a'); pushState();
      return;
    }
    const t = sTurn[i];
    if (!isFinite(t.s)) return;
    const sp = s + SCHAR;
    const d = t.s - sp;
    const withinApproach = d <= TURN_WIN && d > -LATE;
    if (!withinApproach && !mazeWall) return;   // not at this junction yet
    // snap to the decision point if choosing from a standstill at the straight wall,
    // so the splice stays continuous (the rig blend smooths the small reposition).
    if (mazeWall && !route.onWrongBranch()) { s = t.s - SCHAR; camBlend = CAM_BLEND_S; }
    const r = route.takeTurn(t.idx, pressDir);
    if (r === 'ok') {
      turnDone[i] = true; clears++; boulderHeat = 0;
      boulderGone = true; boulderDropped = true; fx.resetEscape();
      escapeDir = (pressDir === 'L') ? 1 : -1;
      const tdir = (pressDir === 'L') ? -1 : 1;
      turnLeanV = (Math.abs(turnLeanV) < TURN.kick ? TURN.kick : Math.abs(turnLeanV)) * tdir;
      mazeWall = false; dir = 1;
      setAnim('run'); pushState();
    } else if (r === 'wrong') {
      // head down the (now spliced) dead-end hall toward its wall.
      boulderGone = true; boulderDropped = true; fx.resetEscape();
      mazeWall = false; dir = 1; camBlend = CAM_BLEND_S;
      setAnim('run'); cue('✕ NOT THAT WAY', '#ff3b30'); pushState();
    }
  }

  // ---- main loop -------------------------------------------------------------
  function animate() {
    if (!running) return;
    const now = performance.now();
    const rawMs = now - last; last = now;
    // rAF STARVATION GUARD: if frames stop arriving (window occluded WITHOUT a
    // visibilitychange — capture rigs, fully-covered windows, heavy throttling),
    // clamped-dt integration would turn the run into slow-motion mush with a
    // frozen timer. Instead: skip the sim entirely for the stalled frame and tell
    // the host (which hard-pauses with a PAUSED overlay). Only mid-run — menus,
    // reading holds and end screens don't care about big gaps.
    if (rawMs > 600 && phase === 'run' && !readingHold) {
      if (onStall) onStall();               // host normally hard-pauses (running -> false)
      if (!running) return;
      raf = requestAnimationFrame(animate); return;   // no host pause: freeze sim, keep looping
    }
    const dt = Math.min(50, rawMs) / 1000;
    const tnow = now * 0.001;

    // Swing the pendulum with a WIDE amplitude so the motion clearly reads at speed
    // (the QA note: the blade "barely reads as moving"). ~74° each way, a touch faster.
    blades.forEach((b) => { b.pivot.rotation.z = Math.sin(tnow * 2.1 + b.phase) * 1.3; });
    // FLAME ANIMATION: advance the shared fire sprite-sheet by UV offset (the real Grok
    // fire video plays from every lion's mouth). The lion stone planes never move.
    fireAnimT += dt * FIRE.sheetFps;
    const fr = Math.floor(fireAnimT) % FIRE.frames;
    const col = fr % FIRE.cols, row = Math.floor(fr / FIRE.cols);
    fireSheetTex.offset.set(col / FIRE.cols, 1 - (row + 1) / FIRE.rows);

    // ---- COLLAPSE TIMER (module-owned countdown + beam-block fuse) ------------
    // Arm the countdown exactly when the run begins — at the end of startGrace,
    // the same moment hazards arm (clearGrace marks every hazard/turn before
    // GRACE_S done). We detect that by the AVATAR arc-length crossing GRACE_S.
    // RUN-TO-MOVE: the arc may never reach GRACE_S if the player dawdles, so also arm the
    // countdown the moment they first start running — then the clock drains even if they stop.
    if (!collapseArmed && !readingHold && phase === 'run' && !falling && ((s + SCHAR) >= GRACE_S || (RUN2MOVE && runHeld))) {
      collapseArmed = true; collapse.arm(); audio.ambient(true);
    }
    // Tick while the run is live (running forward) OR blocked at a beam (the fuse
    // burns while stuck). `active` is true only when the player is actually in the
    // run/stuck threat — not falling, won or over. On the frame it expires we fire
    // the collapse death (timer ran out, or the beam-block fuse burned out).
    {
      const ticking = (phase === 'run' && !falling) || phase === 'stuck';
      if (collapse.tick(dt, ticking) && phase !== 'over' && phase !== 'won') {
        // NEAR-EXIT GRACE: if the runner is right at the exit when time runs out, count
        // it as an ESCAPE rather than a collapse death (Issue: a few feet from the exit
        // shouldn't cost a life). Otherwise the temple comes down.
        if (route.reachedExit(s + SCHAR, EXIT.timeGrace)) {
          phase = 'won'; winT = 0; setAnim('run'); audio.ambient(false); (ENDING === 'artifact' ? audio.pickup() : audio.win()); cue('BARELY!', '#ffe08a'); pushState();
        } else {
          dieCollapse();
        }
      }
    }

    // STONE DOOR + AUDIO: lower the exit door and drive the ambient danger swell +
    // pace-synced footfalls each frame.
    updateDoor();
    audio.danger(Math.max(0, Math.min(1, 1 - collapse.remaining() / Math.max(1, BUDGET_S))));
    audio.tickFeet(dt, phase === 'run' && avatarMoving);

    if (phase === 'run' && falling) {
      // FALLING off a pit edge: freeze forward progress, accumulate the drop timer, and
      // flip to 'over' (cause 'pit') once the fall completes. The Y drop + tilt + fade are
      // applied in the camera/avatar code (driven by fallT). No boulder, no crush.
      fallT += dt;
      if (fallT >= FALL.dur) { phase = 'over'; deathCause = 'pit'; pushState(); }
    } else if (phase === 'run') {
      const total = route.total;
      // RUN-TO-MOVE: forward/back motion only while the RUN input is held. (Auto-run when off.)
      // READING HOLD also freezes motion (study-the-map beat before the run).
      const moveOK = (!RUN2MOVE || runHeld) && !readingHold;
      avatarMoving = moveOK && !mazeWall;   // idle the run cycle when stopped / at a wall
      if (MAZE) {
        // ---- MAZE MOVEMENT: dead-end walls + back-out (NO pits/falls) -------------
        if (backing) {
          // running BACK out of a dead end toward the junction (the avatar leads in the
          // reverse direction). When it reaches the decision point, face forward again
          // and restore the straight tail so the junction is choosable.
          if (moveOK) s -= dt * SPD;
          // avatar leads in reverse (avatar = s + dir*SCHAR = s - SCHAR). Stop when it
          // reaches the junction; flip to forward, pinning the avatar AT the junction by
          // placing the camera one SCHAR behind it (s = throughS - SCHAR).
          if (s - SCHAR <= route.throughS()) {
            backing = false; dir = 1; mazeWall = false; camBlend = CAM_BLEND_S;
            route.goBack();
            s = route.throughS() - SCHAR;
            setAnim('run'); cue('WHICH WAY?', '#ffd99a'); pushState();
          }
        } else if (!mazeWall) {
          if (moveOK) s += dt * SPD;
          const sp0 = s + SCHAR;
          if (route.reachedExit(sp0, EXIT.stop)) {
            s = Math.min(s, total - SCHAR - 0.05);
            if (doorClear()) { phase = 'won'; winT = 0; setAnim('run'); audio.ambient(false); (ENDING === 'artifact' ? audio.pickup() : audio.win()); cue(WIN_CUE, '#ffe08a'); pushState(); }
            else { getStuck('duck'); }   // the exit door is too low — DUCK to slip under it
          } else if (sp0 >= route.tailWallS() - WALL_STOP) {
            // Run up to the wall and stop (face it). No auto-reverse — the player backs
            // out themselves with a turn. Prompt "WHICH WAY?" only at a real straight-wall
            // junction; a dead end reads itself on the moving minimap.
            s = route.tailWallS() - SCHAR - WALL_STOP;
            mazeWall = true; setAnim('run');
            if (!route.onWrongBranch()) cue('WHICH WAY?', '#ffd23a');
            pushState();
          }
        }
        // (mazeWall && !backing): frozen at a wall, waiting for a turn press.
      } else {
        // ---- LINEAR MOVEMENT: pit edge / exit ------------------------------------
        if (moveOK) s += dt * SPD;
        const sp0 = s + SCHAR;
        if (route.isOnPit() && sp0 >= route.pitEdgeS()) {
          s = Math.min(s, total - SCHAR - 0.05);
          startFall();
        } else if (route.reachedExit(sp0, EXIT.stop)) {
          s = Math.min(s, total - SCHAR - 0.05);
          if (doorClear()) { phase = 'won'; winT = 0; setAnim('run'); cue(WIN_CUE, '#ffe08a'); pushState(); }
          else { getStuck('duck'); }   // the exit door is too low — DUCK to slip under it
        }
      }
      // ---- shared HAZARD checks (only while running FORWARD on the floor) --------
      // No on-screen prompts — the player READS the environment (the beam across the
      // floor, the swinging blade, the wall ahead at a junction).
      if (phase === 'run' && dir > 0 && !mazeWall && !backing && !falling) {
        const sp = s + SCHAR;   // avatar position (what the player perceives at the hazard)
        const HIT_TOL = 0.8;
        // BEAMS: a NON-LETHAL STUMBLE on contact — stop, jump to recover (no life lost).
        for (let i = 0; i < sBeam.length; i++) {
          if (beamDone[i]) continue;
          if (sp > sBeam[i] + HIT_TOL) { beamDone[i] = true; getStuck(); }
        }
        // BLADES: NASTY instant kill on contact — but the player gets a brief on-approach
        // DUCK! telegraph (armed once at the cue-lead distance, like the turn cue) so they
        // are never sliced with zero warning.
        for (let i = 0; i < sBlade.length; i++) {
          if (bladeDone[i]) continue;
          const dB = sBlade[i] - sp;
          if (!bladeArmed[i] && dB <= LEAD && dB > HIT_TOL) {
            bladeArmed[i] = true; cue('DUCK!', '#ff4a3a');   // red urgent warning — duck the blade
          }
          if (sp > sBlade[i] + HIT_TOL) { bladeDone[i] = true; dieBlade(); }
        }
        // FIRE jets: INSTANT KILL if you don't clear them with the right move — jump a LOW
        // jet, duck a HIGH one. A one-shot telegraph (JUMP!/DUCK!) arms on approach so it's fair.
        for (let i = 0; i < sFire.length; i++) {
          if (fireDone[i]) continue;
          const d = sFire[i].s - sp;
          if (!fireArmed[i] && d <= LEAD && d > 0) {
            fireArmed[i] = true; cue(sFire[i].duck ? 'DUCK!' : 'JUMP!', '#ff7a1e');   // fiery warning
          }
          if (sp > sFire[i].s + HIT_TOL) { fireDone[i] = true; dieFire(); }
        }
        // CRACKING PATH: reach the gap's NEAR EDGE without jumping -> run straight in and FALL.
        // A one-shot JUMP! telegraph arms on approach (it's a lethal fall now, so warn fairly).
        for (let i = 0; i < sCrack.length; i++) {
          if (crackDone[i]) continue;
          const dC = (sCrack[i] - CRACK_HALF) - sp;            // distance to the near edge
          if (!crackArmed[i] && dC <= LEAD && dC > 0) { crackArmed[i] = true; cue('JUMP!', '#ffd23a'); }
          if (sp > sCrack[i] - CRACK_HALF + 0.4) { crackDone[i] = true; startFall(); }
        }
        // TURNS: arm the telegraph as you near a junction. LINEAR closes the window past
        // the late tolerance (miss -> pit). MAZE keeps the junction open (you bump the
        // wall and choose / back out — never auto-closed).
        for (let i = 0; i < sTurn.length; i++) {
          if (turnDone[i]) continue;
          const d = sTurn[i].s - sp;
          if (!isFinite(d)) continue;            // junction not on the active path yet
          if (!turnArmed[i] && d <= LEAD && d > 0) {
            turnArmed[i] = true; boulderHeat = Math.min(1, boulderHeat + 0.12);
            // DIRECTIONAL TURN CUE — fire ONCE when the turn arms (cueLead ahead), so a
            // first-time player is told which way to go before the floor edge / pit. A
            // big on-brand arrow glyph pointing the correct way (gold = the safe move).
            // (Linear only — in a maze the player must READ the map; we don't reveal it.)
            if (!MAZE) cue(sTurn[i].dir === 'L' ? '◀ TURN' : 'TURN ▶', '#ffd23a');
          }
          if (!MAZE && d <= -LATE) { turnDone[i] = true; }   // linear: window closed
        }
      }
      boulderHeat = Math.min(1, boulderHeat + dt * BOULDER.heatRise);
      // After a turn the boulder is gone; once it re-enters (boulderGone cleared in
      // the overlay), `presence` eases back up so the new boulder closes from a
      // distance instead of snapping to rest size.
      if (!boulderGone) presence = Math.min(1, presence + dt * BOULDER.presenceRise);
    } else if (phase === 'won') {
      // ESCAPED: avatar keeps running into the light, easing to a gentle stop just
      // inside the exit. No boulder, no crush. winT drives the whiteout flash.
      winT += dt;
      const target = route.total - SCHAR - 0.05; // just inside the bright opening
      s += (target - s) * Math.min(1, dt * 2.2); // ease toward the stop point
      boulderHeat = 0;
    } else if (phase === 'over' && deathCause === 'pit') {
      fallT += dt;   // keep the camera/avatar dropping after the run flips to 'over'
    } else if (phase === 'stuck') {
      // BEAM STUMBLE: the runner is stopped at the beam, waiting for a JUMP to recover.
      // This NEVER becomes a death — only the collapse countdown (ticking above) ends a
      // run. stuckT just drives the stumble pose. (No boulder crush, no fuse.)
      stuckT += dt;
      // ESCALATE: the block quietly burns the collapse fuse — surface it so the player
      // isn't killed with no warning. Re-cue the freeing move, loud + red, after ~0.9s.
      if (stuckT > 0.9 && !stuckWarned) { stuckWarned = true; cue(stuckAction === 'duck' ? 'DUCK — NOW!' : 'JUMP — NOW!', '#ff2e22'); }
    } else if (phase === 'over' && (deathCause === 'blade' || deathCause === 'fire')) {
      sliceT += dt;   // drives the slice/burn flash + topple
    } else if (phase === 'over' && boulderDropped) {
      // POST-DROP non-boulder death (wall impact / beam stumble): no boulder crush to
      // drive the fade/FX, so advance the stuck-timer in 'over' too — it drives the
      // avatar pitch-forward + the dark over-fade (see updateAvatar / drawOverlay).
      stuckT += dt;
    }

    // hop/duck spring
    hop += hopV * dt; hopV -= (PLAY.springK * hop + PLAY.springD * hopV) * dt; if (hop < 0 && hopV < 0) hop *= 0.5;
    dip += dipV * dt; dipV -= (PLAY.springK * dip + PLAY.springD * dipV) * dt; if (dip < 0 && dipV < 0) dip *= 0.5;
    hop = Math.max(0, hop); dip = Math.max(0, dip);

    // turn-impulse spring (over-damped: eases out to 0 within ~0.4–0.5s, no overshoot).
    turnLean += turnLeanV * dt;
    turnLeanV -= (TURN.springK * turnLean + TURN.springD * turnLeanV) * dt;
    // HARD CLAMP the lean so the bank/yaw-lead impulse can never aim the camera off
    // the corridor (was producing a skewed trapezoid in black on a turn). Bleed the
    // velocity too when clamped so it doesn't fight the cap.
    if (turnLean > TURN.leanClamp) { turnLean = TURN.leanClamp; if (turnLeanV > 0) turnLeanV = 0; }
    else if (turnLean < -TURN.leanClamp) { turnLean = -TURN.leanClamp; if (turnLeanV < 0) turnLeanV = 0; }
    if (Math.abs(turnLean) < 1e-3 && Math.abs(turnLeanV) < 1e-3) { turnLean = 0; turnLeanV = 0; }

    // ---- camera (third-person: trail behind the avatar) ----
    // `dir` flips the rig to face the way of travel (+1 forward, -1 backing out of a
    // maze dead end). After a 180° flip (`camBlend`), the BASE rig positions are eased
    // toward their new targets so the swing-around reads smoothly instead of popping.
    const total = route.total;
    const clampS = (v) => Math.max(0.1, Math.min(total - 0.1, v));
    const baseCam = ptAt(clampS(s));
    const baseChar = ptAt(clampS(s + dir * CAM.charAhead));
    if (!rigInit) { sCamPos.copy(baseCam); sCharPos.copy(baseChar); rigInit = true; }
    if (camBlend > 0) {
      camBlend = Math.max(0, camBlend - dt);
      const a = Math.min(1, dt * 12);
      sCamPos.lerp(baseCam, a); sCharPos.lerp(baseChar, a);
    } else { sCamPos.copy(baseCam); sCharPos.copy(baseChar); }
    const pCam = sCamPos;
    const pChar = sCharPos;
    // Shorten the look-ahead while banking through a turn so the aim stays ON the bend
    // centerline (no over-reach across the open corner). 1 on straights -> ~0.45 mid-turn.
    const leanF = Math.min(1, Math.abs(turnLean) / Math.max(1e-3, TURN.leanClamp));
    const lookAheadEff = CAM.lookAhead * (1 - 0.55 * leanF);
    const look = ptAt(clampS(s + dir * (CAM.charAhead + lookAheadEff)));
    // PIT FALL: the camera drops on Y (accelerating with fallT) so the whole view plunges
    // into the void. Avatar gets the same drop (in updateAvatar). No boulder/crush.
    const fallY = falling ? 0.5 * FALL.grav * fallT * fallT : 0;
    cam.position.set(pCam.x, camY + hop * 0.6 - dip * 0.7 - fallY, pCam.z);
    // 3D-camera shake during the crush — driven by the same shake magnitude the
    // fx canvas uses (normalized to world units), so the slam jolts the whole view.
    // The boulder crush only happens BEFORE the boulder is dropped (first-turn fail).
    // Once dropped, deaths are non-boulder so there's no roll-in / cam shake.
    // The boulder crush is fully retired (beams stumble, turn-misses are pits/dead-ends),
    // so this only ever shakes for a genuine pre-drop 'over' crush — never a beam stumble.
    const crushing = !boulderDropped && phase === 'over' && deathCause !== 'blade' && deathCause !== 'pit';
    if (crushing) {
      const mag = Math.hypot(fx.shakeX, fx.shakeY) / Math.max(1, CRUSH.shakeImpact);
      const cs = CRUSH.camShake * Math.min(1, mag);
      cam.position.x += Math.sin(tnow * 57.0) * cs;
      cam.position.y += Math.cos(tnow * 63.0) * cs;
    }
    // 3D-camera shake during the COLLAPSE cinematic — driven by the collapse
    // module's fx-canvas shake magnitude (same pattern as the boulder crush), so
    // the whole view rumbles as the temple comes down.
    if (collapse.collapsing) {
      const cmag = Math.hypot(collapse.shakeX, collapse.shakeY) / Math.max(1, COLLAPSE.shakeAmp);
      const ccs = COLLAPSE.camShake * Math.min(1, cmag);
      cam.position.x += Math.sin(tnow * 61.0) * ccs;
      cam.position.y += Math.cos(tnow * 67.0) * ccs;
    }
    // ---- turn-impulse: yaw-lead the look target sideways toward the turn so the
    // view starts swinging the instant you press, then decays as the rails take over
    // (it's an offset on the AIM only — total rotation still ends at the rails' 90°,
    // no overshoot). Offset is perpendicular (horizontal) to the view direction.
    let lookX = look.x, lookZ = look.z;
    if (turnLean !== 0) {
      const fx = look.x - pCam.x, fz = look.z - pCam.z;     // forward (horizontal) dir
      const fl = Math.hypot(fx, fz) || 1;
      const rx = -fz / fl, rz = fx / fl;                    // right = forward rotated +90°
      lookX += rx * turnLean * TURN.yawLead;
      lookZ += rz * turnLean * TURN.yawLead;
    }
    // FALL look target: tilt the aim DOWN into the lit shaft as the camera plunges, so
    // the player sees the recessed shaft walls/floor dropping past — not a featureless
    // forward gradient (Issue: the fall read as the scene collapsing to a flat tan).
    // The aim point sits BELOW the (already-dropping) camera and pulls toward straight
    // down as the fall deepens.
    let lookY = 2.5 + hop * 0.25;
    if (falling || deathCause === 'pit') {
      const tt = Math.min(1, fallT / FALL.dur);
      // aim well below the camera (which is at camY - fallY): look into the shaft.
      lookY = (camY - fallY) - (3 + tt * 22);
      // ease the horizontal aim back toward directly below the camera so the view
      // points down the shaft rather than far ahead over the void.
      lookX = pCam.x + (lookX - pCam.x) * (1 - tt * 0.85);
      lookZ = pCam.z + (lookZ - pCam.z) * (1 - tt * 0.85);
    }
    cam.lookAt(lookX, lookY, lookZ);
    // snapshot the un-rolled orientation so the billboard avatar stays upright
    // (the bank is a CAMERA lean, not an avatar lean).
    const camFacing = cam.quaternion.clone();
    // bank/roll the camera into the turn (camera-space Z) as responsive lean.
    if (turnLean !== 0) cam.rotateZ(turnLean * TURN.bank);

    // ---- avatar billboard ----
    updateAvatar(dt, pChar, hop, dip, camFacing);

    renderer.render(scene, cam);
    drawMM(s);
    // atExit: the daylight bloom may ONLY build once the player is on the REAL exit
    // corridor (every junction resolved). Otherwise, in a linear level the active-path
    // `total` is the truncated path-so-far, so distant/early halls would read their
    // arc-length as "near the exit" and flood bright orange (Issue: washed-out halls).
    const atExit = route.resolvedCount >= unitFrames.length;
    fx.draw(fc, fxCanvas, {
      phase, deathCause, boulderDropped, boulderGone, boulderHeat, presence,
      escapeDir, s, SCHAR, total, winT, stuckT, sliceT, boulderReady, boulderImg, atExit,
    }, dt);
    // COLLAPSE cinematic draws ON TOP of the (already-cleared) boulder overlay —
    // it owns its own debris/dust/shake/rumble. No-op unless collapse.collapsing.
    collapse.drawCollapse(fc, fxCanvas, dt);

    pushState();
    raf = requestAnimationFrame(animate);
  }

  function updateAvatar(dt, pChar, hopV2, dipV2, camFacing) {
    // pick the current frame for the active animation; jump/duck play once then
    // fall back to run.
    const sheet = sprite[anim] || sprite.run;
    const fps = anim === 'run' ? AVATAR.runFps : AVATAR.actionFps;
    animT += dt * fps;
    // run cycle advances continuously WHILE MOVING (run-to-move: it idles when stopped).
    if (avatarMoving || anim !== 'run') runT += dt * AVATAR.runFps;
    if (anim === 'run') {
      animFrame = Math.floor(runT) % sheet.count;
    } else {
      animFrame = Math.floor(animT);
      if (animFrame >= sheet.count) { setAnim('run'); animFrame = 0; }
    }
    const tex = sheet.frames[Math.min(animFrame, sheet.count - 1)];
    if (tex && avatarMat.map !== tex) { avatarMat.map = tex; avatarMat.needsUpdate = true; }

    // place the avatar on the centerline ahead of the camera; lift on jump, dip
    // on duck so the visible action reads.
    const lift = anim === 'jump' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * AVATAR.jumpLift : 0;
    const drop = anim === 'duck' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * AVATAR.duckDrop : 0;
    // Center the (possibly scaled) billboard so its feet rest on the floor, then
    // raise it by the alignment preset's world-Y lift (lifts the runner on screen).
    const footY = AVATAR.yOffset + (AVATAR.height * ALIGN.avatarScale) / 2 + ALIGN.avatarLift;
    avatar.position.set(pChar.x, footY + lift - drop, pChar.z);
    // face the camera (billboard) but keep upright — use the un-rolled orientation
    // so the turn-impulse camera bank doesn't tilt the avatar.
    avatar.quaternion.copy(camFacing || cam.quaternion);

    // ---- failure FX (no bespoke clips — transforms on the existing sprite) ----
    if (falling || deathCause === 'pit') {
      // PIT FALL: the avatar plunges with the camera (same accelerating Y drop), tilts
      // forward as it tumbles, and fades out toward the end of the fall. No boulder.
      const fy = 0.5 * FALL.grav * fallT * fallT;
      avatar.position.y -= fy;
      const tt = Math.min(1, fallT / FALL.dur);
      avatar.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tt * FALL.tilt));
      avatarMat.opacity = Math.max(0, 1 - tt * 1.05);
    } else if (phase === 'won') {
      // ESCAPED: the runner keeps its run cycle and dissolves into the daylight.
      const t = Math.min(1, winT * 0.8);
      avatarMat.opacity = Math.max(0, 1 - t);                            // fade into the glow
    } else if (deathCause === 'blocked' && (phase === 'stuck' || phase === 'over')) {
      // BLOCKED at a beam: the runner STOPS DEAD and stays right there. No squash, no
      // flatten, no boulder — just the stumble/stopped pose (a gentle pitch-forward into
      // the beam) and a slow, gentle fade. The 'stuck'->'over' flip still happens via the
      // stuckT timer (run loop) so the end panel appears.
      const t = Math.min(1, stuckT * 1.4);
      avatar.position.y -= t * 0.35;                                      // a small stumble dip (NOT a flatten)
      avatar.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.5)); // pitch forward, stopped at the beam
      avatarMat.opacity = Math.max(0.35, 1 - t * 0.55);                  // gentle fade — stays visible "right there"
    } else if (phase === 'stuck') {
      const t = Math.min(1, stuckT * 1.4);
      avatar.position.y -= t * 0.5;                                       // slump
      avatar.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.55)); // pitch into the beam
    } else if (phase === 'over' && (deathCause === 'blade' || deathCause === 'fire')) {
      const t = Math.min(1, sliceT * 2.4);
      avatar.position.x += Math.sin(sliceT * 46) * 0.18 * (1 - t);        // jolt
      avatar.position.y -= t * 1.3;                                       // drop
      avatar.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), t * 1.4)); // topple sideways
      avatarMat.opacity = Math.max(0, 1 - t);
    } else if (phase === 'over' && !boulderDropped) {
      // PRE-DROP boulder / turn crush — driven down + flattened as the boulder covers it.
      // `c` ramps to 1 right at the slam (CRUSH.slamAt) so the squash peaks on impact.
      const t = fx.crushT;
      const c = Math.min(1, t / CRUSH.slamAt);
      const ce = c * c * (3 - 2 * c);                                    // smoothstep
      avatar.position.y -= ce * 1.5;                                     // sink under the rock
      // tiny jitter while it's being ground down (dies out as the squash completes)
      avatar.position.x += Math.sin(animT * 60) * 0.12 * (1 - ce);
      avatar.scale.set(1 + ce * 0.7, Math.max(0.08, 1 - ce * 0.92), 1);  // squash hard + flat
      avatarMat.opacity = Math.max(0, 1 - ce * 1.05);                    // fade out as the rock covers it
    } else if (phase === 'over') {
      // POST-DROP non-boulder death (wall impact / beam stumble) — no rock; the avatar
      // just pitches forward and sinks/fades as the run ends. Driven by stuckT (beam) or
      // a short ramp on crushT (turn) so it reads quickly without a boulder.
      const t = Math.min(1, Math.max(stuckT, fx.crushT) * 1.8);
      avatar.position.y -= t * 0.9;                                      // sink to a stop
      avatar.position.x += Math.sin(sliceT * 0 + animT * 40) * 0.1 * (1 - t); // tiny stumble jitter
      avatar.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.7)); // pitch forward
      avatarMat.opacity = Math.max(0, 1 - t);                            // fade out
    }
  }

  // ---- sizing ----------------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (fxCanvas) { fxCanvas.width = w; fxCanvas.height = h; }
  }

  // ---- lifecycle -------------------------------------------------------------
  function start() {
    if (running) return;
    resize();
    resetGame();
    running = true; last = performance.now();
    raf = requestAnimationFrame(animate);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  // Pause/resume the loop WITHOUT resetting the run (used on tab-hide so the game
  // doesn't slide into slow-motion / spring instability while backgrounded).
  function pauseLoop() { if (!running) return; running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function resumeLoop() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(animate); }
  function dispose() {
    stop();
    try { renderer.dispose(); } catch {}
    try {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { if (m.map) m.map.dispose && m.map.dispose(); m.dispose && m.dispose(); });
        }
      });
    } catch {}
    try { img.dispose(); } catch {}
    try { exitImg.dispose(); } catch {}
    try { if (texFloor) texFloor.dispose(); } catch {}
    try { if (texWall) texWall.dispose(); } catch {}
    Object.values(sprite).forEach((sh) => sh.frames.forEach((t) => { try { t.dispose(); } catch {} }));
  }

  return {
    start, stop, dispose, input, resize, pauseLoop, resumeLoop, setMinimapCanvas,
    setMuted(v) { return audio.setMuted(v); },
    toggleMuted() { return audio.toggleMuted(); },
    get muted() { return audio.muted; },
    setReadingHold(v) { readingHold = !!v; },
    get readingHold() { return readingHold; },
    get budgetS() { return BUDGET_S; },
    get state() { return { ...state }; },
    get phase() { return phase; },
  };
}

export default createTempleEngine;
