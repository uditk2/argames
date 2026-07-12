// ===========================================================================
// Temple Collapse — GRID ENGINE (the runtime engine: world == minimap).
// ---------------------------------------------------------------------------
// The ground and the map are two views of ONE grid (map.grid), so every
// corridor the minimap shows is walkable — real junctions, real dead ends,
// multiple routes. A modular stitch, each piece owning one job (SRP):
//   • buildGridWorld   (gridGeometry.js) — TIP-projected 3D maze from the grid,
//   • createGridNav    (gridMaze.js)     — auto-run + free turns on that grid,
//   • createHazardProps(hazardProps.js)  — the photoreal trap meshes/anims,
//   • createGridHazards(gridHazards.js)  — trap placement on cells + judging,
//   • createAvatarActor(avatarActor.js)  — the third-person billboard runner,
//   • createStoneDoor  (stoneDoor.js)    — the 'door' ending slab,
//   • createCollapse   (collapse.js)     — countdown + blow-apart cinematic,
//   • createBoulderFx  (boulderFx.js)    — exit bloom / win whiteout / death fades,
//   • createAudio      (audio.js)        — SFX + rumble bed,
//   • drawMinimap      (minimap.js)      — the map, drawn from the same grid.
// Public API is identical to createTempleEngine (which remains as the LEGACY
// linear engine, selectable via ?engine=legacy):
//   createGridEngine({ canvas, fxCanvas, minimapCanvas, map, onCue, onState,
//                      onStall, runToMove }) ->
//     { start, stop, dispose, input, resize, pauseLoop, resumeLoop,
//       setMinimapCanvas, setReadingHold, setMuted, toggleMuted, muted,
//       budgetS, state, phase }
// `map` is buildEngineMap(...) output — consumes .grid, .path, .hazardCells,
// .params, .ending (NOT the flattened .junctions chain).
// ===========================================================================
import * as THREE from 'three';
import {
  ASSETS, CAM, PLAY, EXIT, GRID, MAP_DEFAULTS, COLLAPSE, BOULDER,
  RUN_TO_MOVE, ALIGN_VARIATION, ALIGN_PRESETS,
} from '../config.js';
import { buildGridWorld } from './gridGeometry.js';
import { createGridNav } from './gridMaze.js';
import { createHazardProps } from './hazardProps.js';
import { createGridHazards } from './gridHazards.js';
import { createAvatarActor } from './avatarActor.js';
import { createStoneDoor } from './stoneDoor.js';
import { createRelicProp } from './relicProp.js';
import { drawMinimap } from './minimap.js';
import { createCollapse } from './collapse.js';
import { createBoulderFx } from './boulderFx.js';
import { createAudio } from './audio.js';

export function createGridEngine({ canvas, fxCanvas, minimapCanvas, map, onCue, onState, onStall, runToMove } = {}) {
  const mp = { ...MAP_DEFAULTS, ...(map && map.params ? map.params : {}) };
  const maze = map.grid, path = map.path || [];
  const CELL = mp.cellW || GRID.cellW;       // corridor width = cell pitch (one grid, one scale)
  const H = mp.hallHeight || 7;
  const SPD = mp.runSpeed || PLAY.speed;
  const GRACE_S = mp.startGrace != null ? mp.startGrace : PLAY.graceS;
  const BUDGET_S = mp.collapseTime != null ? mp.collapseTime : MAP_DEFAULTS.collapseTime;
  const RUN2MOVE = (runToMove != null) ? !!runToMove : RUN_TO_MOVE;
  const ENDING = (map && map.ending) || mp.ending || 'door';
  const WIN_CUE = ENDING === 'artifact' ? 'THE SYAMANTAKA!' : ENDING === 'exit' ? 'DAYLIGHT!' : 'ESCAPE!';
  const ALIGN = ALIGN_PRESETS[Math.max(0, Math.min(ALIGN_PRESETS.length - 1, ALIGN_VARIATION - 1))];
  const camY = CAM.eyeY;

  // Cross-level "you're carrying the relic" flag (set when L5's gem is grabbed,
  // read by L6 for the carried glow). sessionStorage so it survives the per-level
  // engine teardown but not a browser session; guarded for SSR/tests.
  const RELIC_KEY = 'temple_relic_taken';
  function relicTaken() { try { return sessionStorage.getItem(RELIC_KEY) === '1'; } catch { return false; } }
  function setRelicTaken(v) { try { v ? sessionStorage.setItem(RELIC_KEY, '1') : sessionStorage.removeItem(RELIC_KEY); } catch { /* SSR/tests */ } }

  // ---- three.js scene ---------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
  const HAS_MIPS = !!renderer.capabilities.isWebGL2;
  // ---- CORRIDOR SURFACING -------------------------------------------------------
  // Default = TIP: the photoreal projected-photo corridor (the game's signature
  // look). On the grid its captures are RE-AIMED at runtime (world.retarget) to
  // the player's entry point + travel direction per corridor run — the same
  // framing the legacy one-way route baked in, so the photo reads right in both
  // directions and from side entries. ?surf=tiled switches to the lit seamless
  // stone surfaces + torch rig for A/B.
  const SURF = (() => {
    try { const q = new URLSearchParams(location.search).get('surf'); if (q === 'tip' || q === 'tiled') return q; } catch { /* SSR/tests */ }
    return 'tip';
  })();
  const TILED = SURF === 'tiled';

  const scene = new THREE.Scene();
  const ATMO = 0x0d0805;                       // near-black warm stone (never a hard void)
  renderer.setClearColor(ATMO, 1);
  scene.background = new THREE.Color(ATMO);
  // Lit mode can afford deeper visibility; TIP keeps the tighter original veil.
  scene.fog = TILED ? new THREE.Fog(ATMO, CELL * 2.0, CELL * 5.6) : new THREE.Fog(ATMO, CELL * 1.8, CELL * 4.6);
  const aspect = () => (canvas.clientWidth || window.innerWidth) / Math.max(1, canvas.clientHeight || window.innerHeight);
  const cam = new THREE.PerspectiveCamera(CAM.fov, aspect(), CAM.near, CAM.far);
  // TILED corridors NEED light to read: warm ambient + a soft hemisphere fill
  // (torch-warm from above, dim stone below), then real torch lights pool on the
  // stone. TIP surfaces are unlit shaders, so there the ambient only lifts props.
  scene.add(new THREE.AmbientLight(0xffce8a, TILED ? 0.85 : 0.5));
  scene.add(new THREE.HemisphereLight(0xffd9a0, 0x251a10, TILED ? 0.55 : 0.35));
  function addTorch(pos, intensity) {
    const pl = new THREE.PointLight(0xffa64a, intensity, 30, 2.4);
    pl.position.copy(pos); scene.add(pl); return pl;
  }
  function addLight(pos, color, intensity, dist) {
    const pl = new THREE.PointLight(color, intensity, dist || 12, 2.0);
    pl.position.copy(pos); scene.add(pl); return pl;
  }

  // ---- TIP-NODE world (ported from the level1 prototype) ----------------------
  // The corridors are projected from a node field onto the maze geometry, and the
  // carved-arch doorway PANEL (alpha cutout) is placed on every open side. Both
  // assets live entirely inside buildGridWorld's shaders now — the old single
  // re-aimed per-run capture (and its corridor_dark/tile fallbacks) is retired.
  const texLoader = new THREE.TextureLoader();
  const brightImg = texLoader.load(ASSETS.corridorBright || ASSETS.corridor);
  brightImg.minFilter = HAS_MIPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; brightImg.generateMipmaps = HAS_MIPS;
  brightImg.magFilter = THREE.LinearFilter; brightImg.anisotropy = MAX_ANISO;
  if ('colorSpace' in brightImg) brightImg.colorSpace = THREE.SRGBColorSpace;
  const doorwayImg = texLoader.load(ASSETS.doorwayPanel);
  doorwayImg.minFilter = HAS_MIPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; doorwayImg.generateMipmaps = HAS_MIPS;
  doorwayImg.magFilter = THREE.LinearFilter; doorwayImg.anisotropy = MAX_ANISO;
  if ('colorSpace' in doorwayImg) doorwayImg.colorSpace = THREE.SRGBColorSpace;
  const worldGroup = new THREE.Group(); scene.add(worldGroup);
  // TILED surfaces: seamless worn-stone floor/wall textures on lit materials.
  let tiled = null;
  if (TILED) {
    const mkTiled = (url) => {
      const t = texLoader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = MAX_ANISO;
      if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    tiled = {
      floorMat: new THREE.MeshStandardMaterial({ map: mkTiled(ASSETS.texFloor), roughness: 0.95, metalness: 0.0 }),
      wallMat: new THREE.MeshStandardMaterial({ map: mkTiled(ASSETS.texWall), roughness: 0.95, metalness: 0.05 }),
      tile: 4.5,   // ~1 texture tile per 4.5 world units (believable block scale)
    };
  }
  const world = buildGridWorld({
    THREE, group: worldGroup, maze, cellW: CELL, H, camY, tiled,
    corridorTex: brightImg, doorTex: doorwayImg,
  });

  // ---- torch light rig (tiled mode) --------------------------------------------
  // • a CARRIED torch that travels just ahead of the runner (with a live flame
  //   flicker) so the player's surroundings always read clearly;
  // • a fixed torch pooled at every real junction — decision points glow, which
  //   both looks intentional and quietly signposts the maze.
  let playerTorch = null;
  const PLAYER_TORCH_I = 1.6;
  if (TILED) {
    playerTorch = new THREE.PointLight(0xffb060, PLAYER_TORCH_I, CELL * 2.6, 2.0);
    scene.add(playerTorch);
  }

  // ---- navigation (the SAME grid the world + minimap are built from) ----------
  const nav = createGridNav(maze, { speed: SPD, cellW: CELL });

  // ---- traps (placement/judging from map.hazardCells; look from hazardProps) --
  const props = createHazardProps({ THREE, scene, W: CELL, H, addTorch, addLight });
  const hazards = createGridHazards({ THREE, scene, props, cells: map.hazardCells || [], cellW: CELL });

  // ---- exit dressing: approach direction, warm light, ending visual -----------
  const exitWorld = world.exitWorld;
  const approach = (() => {                    // travel direction INTO the exit cell (world)
    if (path.length >= 2) {
      const a = path[path.length - 2], b = path[path.length - 1];
      return { x: (b.c - a.c), z: -(b.r - a.r) };
    }
    return { x: 0, z: 1 };
  })();
  addLight(new THREE.Vector3(exitWorld.x, 1.6, exitWorld.z), 0xfff0d0, EXIT.lightIntensity, EXIT.lightDist);
  // junction torches (tiled mode): warm pools at every >=3-way cell, capped so a
  // big braided maze can't stack up an unreasonable light count.
  if (TILED) {
    world.junctionCells.slice(0, 14).forEach((j) => {
      addLight(new THREE.Vector3(j.x, H - 1.4, j.z), 0xffa64a, 0.9, CELL * 1.6);
    });
  }
  if (ENDING === 'exit') {
    // L6 DAYLIGHT: the photoreal sunlit archway on the exit cell's far wall.
    const exitImg = texLoader.load(ASSETS.exitImg);
    exitImg.minFilter = THREE.LinearFilter; exitImg.magFilter = THREE.LinearFilter;
    if ('colorSpace' in exitImg) exitImg.colorSpace = THREE.SRGBColorSpace;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL - 0.4, H - 0.3),
      new THREE.MeshBasicMaterial({ map: exitImg, side: THREE.DoubleSide, fog: false }),
    );
    glow.position.set(exitWorld.x + approach.x * (CELL / 2 - 0.25), H / 2, exitWorld.z + approach.z * (CELL / 2 - 0.25));
    glow.rotation.y = Math.atan2(approach.x, approach.z);
    scene.add(glow);
  }
  // RELIC (L5): the Syamantaka sun-gem on a pedestal at the exit cell. This is
  // the campaign's peak — a real prop you approach and physically take, replacing
  // the old text-cue-only climax. Grabbed on win() (see below).
  const relic = ENDING === 'artifact' ? createRelicProp({
    THREE, scene, W: CELL, H, addLight,
    pos: { x: exitWorld.x, z: exitWorld.z }, dirVec: approach,
  }) : null;
  // CARRIED GLOW (L6): if the relic was taken on L5 this run, the runner carries
  // a warm gold glow — the "you're holding the thing you came for" payoff. The
  // flag is set on grab (below) and persists for the L6 leg via sessionStorage.
  let carryGlow = null;
  if (ENDING === 'exit' && relicTaken()) {
    carryGlow = new THREE.PointLight(0xffd24a, 2.0, CELL * 2.2, 2.0);
    scene.add(carryGlow);
  }
  // STONE DOOR (L1-L4): a slab just past the exit cell's centre, lowering with the timer.
  const door = ENDING === 'door' ? createStoneDoor({
    THREE, scene, W: CELL, H,
    pos: { x: exitWorld.x + approach.x * 2.0, z: exitWorld.z + approach.z * 2.0 },
    dirVec: approach,
  }) : null;

  // ---- countdown / fx / audio (unchanged modules) ------------------------------
  const collapse = createCollapse({ COLLAPSE, budgetS: BUDGET_S });
  const fx = createBoulderFx({ BOULDER, EXIT, ALIGN });
  const audio = createAudio();
  const fc = fxCanvas ? fxCanvas.getContext('2d') : null;
  const noImg = new Image();                   // boulder retired: fx never draws it

  // ---- avatar (third-person billboard, AT the nav position) --------------------
  const avatar = createAvatarActor({ THREE, scene, ALIGN });

  // ---- state --------------------------------------------------------------------
  const FALL = { grav: 44, dur: 1.25 };        // crack-chasm plunge (accel, seconds to 'over')
  const SYNTH_TOTAL = 1000;                    // synthetic arc-length for fx's exit bloom
  let phase = 'ready', running = false, raf = 0, last = performance.now();
  let readingHold = false, runHeld = false;
  let collapseArmed = false, runT = 0, runDist = 0, clears = 0;
  let deathCause = null, winT = 0, stuckT = 0, sliceT = 0, stuckWarned = false, stuckAction = 'jump';
  let falling = false, fallT = 0;
  let duckUntil = -1, doorCued = false;
  let pendTurn = null, pendAt = 0;   // buffered left/right tap (applied at the next junction)
  const DUCK_WINDOW = 480;                     // ms a duck press counts as "ducking" at the door
  let hop = 0, dip = 0, hopV = 0, dipV = 0;
  let sealShake = 0;   // decaying camera-shake pulse fired when the wall slams shut behind you
  const hitDeadEnds = new Set();
  let mmCanvas = minimapCanvas || null, mx = mmCanvas ? mmCanvas.getContext('2d') : null;
  // smoothed rig (heading + position) so turns/pivots swing instead of snapping
  const camFwd = { x: 0, z: 1 };
  const sPos = new THREE.Vector3();
  let rigInit = false;

  const state = { distance: 0, clears: 0, phase: 'ready', cause: null, falling: false, timeLeft: BUDGET_S, timeUrgent: false, timeArmed: false };
  function pushState() {
    state.distance = Math.floor(runDist * (PLAY.metresPerUnit || 1));
    state.clears = clears; state.phase = phase; state.cause = deathCause; state.falling = falling;
    state.timeLeft = collapse.remaining(); state.timeUrgent = collapse.urgent; state.timeArmed = collapseArmed;
    if (onState) onState({ ...state });
  }
  function cue(text, color) { if (onCue) onCue(text, color); }
  const distExit = () => { const p = nav.worldPos(); return Math.hypot(p.x - exitWorld.x, p.z - exitWorld.z); };

  function resetGame() {
    nav.reset(); collapse.reset(); hazards.reset(); fx.reset(); avatar.reset();
    world.retarget(nav.cell.r, nav.cell.c, nav.heading, true);   // re-anchor the entry projection
    if (door) door.reset();
    if (relic) { relic.reset(); setRelicTaken(false); }   // retrying L5 un-takes the gem
    hitDeadEnds.clear();
    phase = 'run'; collapseArmed = false; runT = 0; runDist = 0; clears = 0;
    deathCause = null; winT = 0; stuckT = 0; sliceT = 0; stuckWarned = false; stuckAction = 'jump';
    falling = false; fallT = 0; duckUntil = -1; doorCued = false;
    hop = 0; dip = 0; hopV = 0; dipV = 0; sealShake = 0;
    const hv = nav.headingVec(); camFwd.x = hv.x; camFwd.z = hv.z;
    rigInit = false;
    audio.ambient(false);
    last = performance.now(); pushState();
  }

  // ---- deaths / stumbles --------------------------------------------------------
  function die(causeName, text, color) {
    if (phase === 'over') return;
    phase = 'over'; deathCause = causeName; sliceT = 0; stuckT = 0;
    audio.ambient(false); audio.die(causeName);
    if (text) cue(text, color);
    pushState();
  }
  // BEAM (and a too-low door) = a NON-LETHAL STUMBLE: stop, the correct move resumes.
  function getStuck(action) {
    if (phase !== 'run') return;
    stuckAction = action || 'jump';
    phase = 'stuck'; stuckT = 0; stuckWarned = false;
    avatar.setAnim('run'); audio.stumble();
    cue(stuckAction === 'duck' ? 'DUCK!' : 'JUMP!', '#ffd23a'); pushState();
  }
  function recover(action) {
    if (phase !== 'stuck' || action !== stuckAction) return;
    phase = 'run'; stuckT = 0;
    if (action === 'duck') { dipV = Math.max(dipV, PLAY.dipV); avatar.setAnim('duck'); }
    else { hopV = Math.max(hopV, PLAY.hopV); avatar.setAnim('jump'); }
    pushState();
  }
  // CRACK CHASM: run in un-jumped -> plunge, then 'over' cause 'pit'.
  function startFall() {
    if (falling || phase !== 'run') return;
    falling = true; fallT = 0;
    avatar.setAnim('run'); cue('FALL!', '#ff7a5a'); pushState();
  }
  function dieCollapse() {
    if (phase === 'over') return;
    phase = 'over'; deathCause = 'collapse'; stuckT = 0;
    collapse.trigger(); audio.ambient(false); audio.die('collapse');
    cue('ENTOMBED', '#ff2e22'); pushState();
  }
  function win(text) {
    phase = 'won'; winT = 0; avatar.setAnim('run');
    audio.ambient(false); (ENDING === 'artifact' ? audio.pickup() : audio.win());
    // L5: physically take the gem — fires the 0.6s slow-mo reach + light burst,
    // and flags the run so L6 shows the carried glow.
    if (relic) { relic.grab(); setRelicTaken(true); }
    // L1–L4: SLAM the wall shut behind you — the "no going back" climax. The boom
    // + camera-shake pulse fire on impact (in the loop), synced to the visual.
    if (door) door.seal();
    cue(text || WIN_CUE, '#ffe08a'); pushState();
  }

  // ---- hazard consequences (gridHazards reports, the engine decides) -----------
  function onHazardEvent(evt, payload) {
    if (evt === 'cue') { cue(payload.text, payload.color); return; }
    if (evt === 'beam') getStuck('jump');
    else if (evt === 'blade') die('blade', 'SLICED!', '#ff2e22');
    else if (evt === 'fire') die('fire', 'BURNED!', '#ff7a1e');
    else if (evt === 'crack') startFall();
  }

  // ---- input --------------------------------------------------------------------
  function onClear() { clears++; audio.clear(); cue('✓', '#9be7a0'); pushState(); }
  function input(action) {
    if (readingHold) return;
    audio.resume();
    if (action === 'duck') duckUntil = performance.now() + DUCK_WINDOW;
    if (action === 'runStart') { runHeld = true; return; }
    if (action === 'runStop') { runHeld = false; return; }
    if (phase === 'won' || phase === 'over') { if (action === 'restart') resetGame(); return; }
    if (phase === 'ready') { resetGame(); }
    if (phase === 'stuck') { if (action === 'jump' || action === 'duck') recover(action); return; }
    if (action === 'restart') { resetGame(); return; }
    if (falling) return;
    const p = nav.worldPos();
    if (action === 'jump') {
      hopV = Math.max(hopV, PLAY.hopV); avatar.setAnim('jump'); audio.jump();
      if (hazards.judge('jump', p.x, p.z)) onClear();
    } else if (action === 'duck') {
      dipV = Math.max(dipV, PLAY.dipV); avatar.setAnim('duck'); audio.duck();
      if (hazards.judge('duck', p.x, p.z)) onClear();
    } else if (action === 'left' || action === 'right') {
      // BUFFER the tap: apply now if the opening is already reachable, else hold it
      // and retry each frame until the player reaches the junction (or it expires).
      // A fresh tap overwrites the buffer, so you can change your mind.
      pendTurn = action; pendAt = performance.now();
      tryTurn();
    } else if (action === 'uturn') {
      // mid-corridor about-face (keyboard Q / on-screen button)
      const before = nav.heading;
      if (nav.turnAround()) {
        const reversed = { N: 'S', S: 'N', E: 'W', W: 'E' }[before] === nav.heading;
        cue(reversed ? 'TURN AROUND' : 'TURN', '#ffd99a'); audio.back(); pushState();
      }
    }
  }

  // buffered-turn state + resolver (see the left/right branch above)
  const TURN_BUFFER_MS = 1000;
  function tryTurn() {
    if (!pendTurn || phase !== 'run') { if (phase !== 'run') pendTurn = null; return; }
    if (performance.now() - pendAt > TURN_BUFFER_MS) { pendTurn = null; return; }
    const cell = nav.cell, wasWall = nav.atWall, before = nav.heading;
    const choice = nav.openings(cell.r, cell.c).length >= 3;   // a REAL decision point
    if (nav.turn(pendTurn === 'left' ? 'L' : 'R')) {
      pendTurn = null;
      const reversed = { N: 'S', S: 'N', E: 'W', W: 'E' }[before] === nav.heading;
      if (reversed) { cue('DOUBLE BACK', '#ffd99a'); audio.back(); }
      else if (choice || wasWall) { onClear(); audio.turn(); }   // navigated a junction
      else audio.turn();
      pushState();
    }
  }

  // ---- minimap (live navigated cell + heading — matches free movement) ---------
  // HEADING-UP: the WHOLE map rotates so the player's travel direction is always
  // UP, derived from the CAMERA's own world axes (right = col0, forward = -col2)
  // so the map can never disagree with the 3D view. (Prototype parity.)
  const _camR = new THREE.Vector3(), _camF = new THREE.Vector3();
  function drawMM() {
    if (!mx) return;
    const cell = nav.cell, hv = nav.headingVec();
    cam.updateMatrixWorld();
    _camR.setFromMatrixColumn(cam.matrixWorld, 0);            // camera right (world)
    _camF.setFromMatrixColumn(cam.matrixWorld, 2).negate();   // camera forward (world)
    drawMinimap(mx, {
      canvas: mmCanvas,
      gridView: {
        grid: maze, path,
        hazardCells: map.hazardCells,
        hitDeadEnds: [...hitDeadEnds],
        player: { r: cell.r, c: cell.c, t: nav.t, dc: hv.x, dr: -hv.z },
        camR: { x: _camR.x, z: _camR.z }, camF: { x: _camF.x, z: _camF.z },
      },
    });
  }

  // ---- main loop ------------------------------------------------------------------
  function animate() {
    if (!running) return;
    const now = performance.now();
    const rawMs = now - last; last = now;
    // rAF starvation guard: a stalled frame mid-run hard-pauses via the host.
    // With NO stall handler (QA/automation ?nopause runs), fall through instead —
    // the dt clamp below caps the sim step at 50ms, so a starved loop advances
    // slowly rather than freezing forever (every wake frame used to skip).
    if (rawMs > 600 && phase === 'run' && !readingHold && onStall) {
      onStall();
      if (!running) return;
      raf = requestAnimationFrame(animate); return;
    }
    const dt = Math.min(50, rawMs) / 1000;
    const tnow = now * 0.001;

    props.update(dt, tnow);   // blade swings + flame sheet
    if (relic) relic.update(dt, tnow);   // idle float/pulse + grab burst

    // ---- collapse countdown (armed once the grace run-up is spent) -------------
    if (!collapseArmed && !readingHold && phase === 'run' && !falling
        && (runT >= GRACE_S || (RUN2MOVE && runHeld))) {
      collapseArmed = true; collapse.arm(); audio.ambient(true);
    }
    {
      const ticking = (phase === 'run' && !falling) || phase === 'stuck';
      if (collapse.tick(dt, ticking) && phase !== 'over' && phase !== 'won') {
        // NEAR-EXIT GRACE: expiring within reach of the exit counts as an escape.
        if (distExit() <= EXIT.timeGrace) win('BARELY!');
        else dieCollapse();
      }
    }
    if (door) {
      door.update(1 - collapse.remaining() / Math.max(1, BUDGET_S));
      if (phase === 'run' && !doorCued && door.lowGap && distExit() <= PLAY.cueLead * 1.2) {
        doorCued = true; cue('DUCK — DOOR LOW', '#ffd23a');
      }
      // slam behind you on a clear: advance the drop; on impact fire boom + shake.
      if (door.sealing && door.tickSeal(dt)) { sealShake = 1; audio.seal(); }
    }
    audio.danger(Math.max(0, Math.min(1, 1 - collapse.remaining() / Math.max(1, BUDGET_S))));

    // ---- movement / hazards / exit ----------------------------------------------
    let moving = false;
    if (phase === 'run' && falling) {
      fallT += dt;
      if (fallT >= FALL.dur) { phase = 'over'; deathCause = 'pit'; pushState(); }
    } else if (phase === 'run') {
      const moveOK = (!RUN2MOVE || runHeld) && !readingHold;
      if (moveOK) runT += dt;
      const wallBefore = nav.atWall;
      nav.update(dt, moveOK && !nav.atExit);
      tryTurn();   // apply any buffered left/right tap now that we've advanced (fires at the junction)
      moving = moveOK && !nav.atWall && !nav.atExit;
      if (moving) runDist += SPD * dt;
      // wall stop: a dead end gets marked on the map; a junction wall asks for a pick.
      if (!wallBefore && nav.atWall) {
        const cell = nav.cell;
        if (nav.isDeadEnd(cell.r, cell.c)) {
          hitDeadEnds.add(cell.r * maze.cols + cell.c);
          cue('DEAD END', '#ff6a52'); audio.back();
        } else {
          cue('WHICH WAY?', '#ffd23a');
        }
      }
      // TIP re-aim: no-op until the player crosses into a different corridor run
      // or reverses — then that run's projection re-anchors to their entry point.
      const cellNow = nav.cell;
      world.retarget(cellNow.r, cellNow.c, nav.heading);
      const p = nav.worldPos();
      hazards.step(p.x, p.z, nav.headingVec(), onHazardEvent);
      if (phase === 'run' && nav.atExit) {
        if (!door || door.tryPass(performance.now() < duckUntil)) win();
        else getStuck('duck');   // the slab is low — duck to slip under it
      }
    } else if (phase === 'won') {
      winT += dt;
    } else if (phase === 'over' && deathCause === 'pit') {
      fallT += dt;   // keep the plunge going under the end panel
    } else if (phase === 'stuck') {
      stuckT += dt;
      if (stuckT > 0.9 && !stuckWarned) {
        stuckWarned = true;
        cue(stuckAction === 'duck' ? 'DUCK — NOW!' : 'JUMP — NOW!', '#ff2e22');
      }
    } else if (phase === 'over' && (deathCause === 'blade' || deathCause === 'fire')) {
      sliceT += dt;
    } else if (phase === 'over') {
      stuckT += dt;   // drives the generic death fade
    }
    audio.tickFeet(dt, phase === 'run' && moving && !falling);

    // ---- hop/duck camera springs --------------------------------------------------
    hop += hopV * dt; hopV -= (PLAY.springK * hop + PLAY.springD * hopV) * dt; if (hop < 0 && hopV < 0) hop *= 0.5;
    dip += dipV * dt; dipV -= (PLAY.springK * dip + PLAY.springD * dipV) * dt; if (dip < 0 && dipV < 0) dip *= 0.5;
    hop = Math.max(0, hop); dip = Math.max(0, dip);

    // ---- third-person camera (trails the avatar; smoothed heading + position) ----
    const hv = nav.headingVec();
    const k = Math.min(1, dt * 5);
    camFwd.x += (hv.x - camFwd.x) * k; camFwd.z += (hv.z - camFwd.z) * k;
    const fl = Math.hypot(camFwd.x, camFwd.z) || 1; const fxv = camFwd.x / fl, fzv = camFwd.z / fl;
    const navP = nav.worldPos();
    if (!rigInit) { sPos.set(navP.x, 0, navP.z); rigInit = true; }
    else sPos.lerp(new THREE.Vector3(navP.x, 0, navP.z), Math.min(1, dt * 10));
    const fallY = falling || deathCause === 'pit' ? 0.5 * FALL.grav * fallT * fallT : 0;
    const fallP = falling || deathCause === 'pit' ? Math.min(1, fallT / FALL.dur) : 0;
    const BACK = 5.2, LOOK = CAM.lookAhead;
    cam.position.set(sPos.x - fxv * BACK, camY + hop * 0.6 - dip * 0.7 - fallY, sPos.z - fzv * BACK);
    let lookY = 2.5 + hop * 0.25;
    let lookX = sPos.x + fxv * LOOK, lookZ = sPos.z + fzv * LOOK;
    if (fallP > 0) {
      // aim down into the chasm as the camera plunges
      lookY = (camY - fallY) - (3 + fallP * 22);
      lookX = cam.position.x + (lookX - cam.position.x) * (1 - fallP * 0.85);
      lookZ = cam.position.z + (lookZ - cam.position.z) * (1 - fallP * 0.85);
    }
    cam.lookAt(lookX, lookY, lookZ);
    const camFacing = cam.quaternion.clone();
    // carried torch: rides just ahead of the runner, flame flicker on intensity.
    if (playerTorch) {
      playerTorch.position.set(sPos.x + fxv * 2.5, H - 2.0, sPos.z + fzv * 2.5);
      playerTorch.intensity = PLAYER_TORCH_I * (1 + 0.08 * Math.sin(tnow * 13.7) + 0.05 * Math.sin(tnow * 29.3));
    }
    // carried relic glow (L6): a warm gold pool riding on the runner, flickering
    // like the gem's pulse — the visible sign you're holding the Syamantaka.
    if (carryGlow) {
      carryGlow.position.set(sPos.x, H * 0.5, sPos.z);
      carryGlow.intensity = 2.0 * (1 + 0.12 * Math.sin(tnow * 2.6));
    }
    // collapse cinematic camera rumble (same pattern as the fx-canvas shake)
    if (collapse.collapsing) {
      const cmag = Math.hypot(collapse.shakeX, collapse.shakeY) / Math.max(1, COLLAPSE.shakeAmp);
      const ccs = COLLAPSE.camShake * Math.min(1, cmag);
      cam.position.x += Math.sin(tnow * 61.0) * ccs;
      cam.position.y += Math.cos(tnow * 67.0) * ccs;
    }
    // wall-slam kick: a sharp decaying jolt when the exit seals behind you.
    if (sealShake > 0.001) {
      const scs = (COLLAPSE.camShake || 0.4) * 1.6 * sealShake;
      cam.position.x += Math.sin(tnow * 84.0) * scs;
      cam.position.y += Math.cos(tnow * 73.0) * scs;
      sealShake = Math.max(0, sealShake - dt * 2.6);
    }

    // ---- avatar -------------------------------------------------------------------
    avatar.update(dt, {
      pos: sPos, camQuat: camFacing, moving,
      phase, deathCause, fallY, fallP, winT, stuckT, sliceT,
    });

    // TIP-node projection: pick the top-K nearest same-facing capture nodes for
    // the current viewpoint (player pos + smoothed look direction). No-op in tiled mode.
    world.frameView(sPos, { x: fxv, z: fzv });

    renderer.render(scene, cam);
    drawMM();

    // ---- 2D overlays: exit bloom / win whiteout / death fades + collapse ----------
    const dE = distExit();
    fx.draw(fc, fxCanvas, {
      phase, deathCause, boulderDropped: true, boulderGone: true, boulderHeat: 0, presence: 0,
      escapeDir: -1, s: SYNTH_TOTAL - dE, SCHAR: 0, total: SYNTH_TOTAL,
      winT, stuckT, sliceT, boulderReady: false, boulderImg: noImg,
      atExit: dE <= EXIT.ramp,
    }, dt);
    collapse.drawCollapse(fc, fxCanvas, dt);

    pushState();
    raf = requestAnimationFrame(animate);
  }

  // ---- sizing / lifecycle ----------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (fxCanvas) { fxCanvas.width = w; fxCanvas.height = h; }
  }
  function start() { if (running) return; resize(); resetGame(); running = true; last = performance.now(); raf = requestAnimationFrame(animate); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function pauseLoop() { if (!running) return; running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function resumeLoop() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(animate); }
  function dispose() {
    stop();
    try { avatar.dispose(); } catch { /* gone */ }
    try { props.dispose(); } catch { /* gone */ }
    try { if (relic) relic.dispose(); } catch { /* gone */ }
    try { world.dispose(); } catch { /* gone */ }
    try {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { if (m.map && m.map.dispose) m.map.dispose(); if (m.dispose) m.dispose(); });
        }
      });
    } catch { /* partial teardown is fine */ }
    try { renderer.dispose(); } catch { /* gone */ }
  }

  return {
    start, stop, dispose, input, resize, pauseLoop, resumeLoop,
    setMinimapCanvas(c) { mmCanvas = c || null; mx = mmCanvas ? mmCanvas.getContext('2d') : null; if (mx) drawMM(); },
    setReadingHold(v) { readingHold = !!v; },
    get readingHold() { return readingHold; },
    setMuted(v) { return audio.setMuted(v); },
    toggleMuted() { return audio.toggleMuted(); },
    get muted() { return audio.muted; },
    get budgetS() { return BUDGET_S; },
    get state() { return { ...state }; },
    get phase() { return phase; },
  };
}

export default createGridEngine;
