// ===========================================================================
// Temple Dash — CONFIG (single source of tunables).
// ---------------------------------------------------------------------------
// A third-person Three.js temple runner ported from the standalone
// monument3d_game prototype. The corridor + route + hazards are built from a
// JSON map (public/assets/temple/map.json); these numbers tune feel only.
//
// Coordinates mirror the prototype: each "unit" is an L-shaped corridor —
// a straight hall (length hallLen) that turns left or right into an exit hall
// (length exitLen). The camera + a visible third-person avatar follow a
// waypoint polyline through the route; built-in BEAMS (jump) and BLADES (duck)
// plus the wall TURNS are the hazards. A 2D boulder overlay chases you and
// surges on death.
// ===========================================================================

// Asset URLs (served from public/). Reference by URL inside the module.
import { assetUrl } from './assetUrl.js';
export const ASSETS = {
  corridor: assetUrl('assets/temple/corridor_dark.webp'),
  // TIP-NODE look (ported from the level1 prototype): a brighter one-point-
  // perspective hall photo projected from a node field, plus a carved-arch
  // doorway PANEL (solid wall + transparent arched hole) placed on open sides.
  corridorBright: assetUrl('assets/temple/corridor_bright.webp'),
  doorwayPanel: assetUrl('assets/temple/doorway_panel.webp'),   // alpha cutout (webp keeps the transparency)
  boulder: assetUrl('assets/temple/boulder_hero.webp'),
  door: assetUrl('assets/temple/stone_door.webp'),   // carved sun-lion exit door (real alpha)
  // sprite frame counts (r_00..r_NN.png), zero-padded to 2 digits.
  run: { dir: assetUrl('assets/temple/char/run'), count: 19 },   // tightened run cycle (cut frames 8-20 of the 32-frame original; kept 21)
  jump: { dir: assetUrl('assets/temple/char/jump'), count: 24 },
  duck: { dir: assetUrl('assets/temple/char/duck'), count: 24 },
  beam: assetUrl('assets/temple/obs_beam.webp'),    // photoreal carved fallen beam (keyed)
  blade: assetUrl('assets/temple/obs_blade_head.webp'),  // photoreal blade head (chain cropped; a 3D chain is added in-engine)
  // Photoreal carved LION-MOUTH wall vent spitting a horizontal flame jet across the
  // corridor (keyed PNG). Mounted on a side wall; the flame height decides the move:
  // a LOW jet you JUMP, a HIGH jet you DUCK.
  // Two layers: the carved stone lion HEAD stays bolted to the wall, and a real
  // FIRE VIDEO (Grok, 6s) baked into a sprite sheet plays from its mouth across the hall.
  fireLion: assetUrl('assets/temple/lion_head.webp'),          // static stone head (flame removed)
  fireFlameSheet: assetUrl('assets/temple/fire_jet_sheet.webp'), // animated flamethrower jet (sprite sheet)
  // Photoreal top-down broken temple floor with a chasm — laid flat on the floor at a gap.
  crackFloor: assetUrl('assets/temple/crack_floor.webp'),
  // Photoreal first-person view straight down a sunlit temple corridor ending in a
  // bright golden archway with god-ray sun shafts — TIP-projected onto the final
  // dedicated EXIT corridor (same aspect/style as corridor_dark.png). .jpg, not .png.
  exitImg: assetUrl('assets/temple/exit_light.webp'),
  // Seamless tileable surfacing textures for the ALTERNATE "tiled" corridor mode
  // (A/B vs the default TIP projection). Used by MeshStandardMaterial when
  // CORRIDOR_SURFACE==='tiled' (or ?surf=tiled). Flat/orthographic, no baked light.
  texFloor: assetUrl('assets/temple/tex_floor.webp'),
  texWall: assetUrl('assets/temple/tex_wall.webp'),
  map: assetUrl('assets/temple/map.json'),
};

// ---- ALIGNMENT VARIATIONS (A/B/C) ------------------------------------------
// Three switchable ways to COMPOSE the runner + chasing boulder within the SAME
// fixed TIP corridor (camera/projection/gameplay unchanged). Each preset purely
// re-scales + re-positions two billboards/overlays:
//   avatarScale  — multiplier on AVATAR.height (avatar mesh scale; feet stay on floor)
//   avatarLift   — extra world-Y lift on the avatar (raises the runner on screen)
//   boulderScale — multiplier on the boulder's on-screen base diameter (resting + crush)
//   peekFar      — fraction of base shown above screen bottom at danger 0 (far/low)
//   peekNear     — extra fraction added by danger (0->1) so it climbs higher as it closes
// V1 must reproduce today's look EXACTLY (scale 1, lift 0, current peek 0.32/0.55).
export const ALIGN_VARIATION = 2;   // LOCKED default = V2 (big boulder + gap). 1..3, override at runtime with ?align=1|3
export const ALIGN_PRESETS = [
  // V1 — Current baseline (reference; identical to pre-variation look).
  { avatarScale: 1.0,  avatarLift: 0.0,  boulderScale: 1.0,  peekFar: 0.32, peekNear: 0.55 },
  // V2 — Big boulder, clear gap: runner a touch smaller + lifted higher (more corridor
  // shows between them), boulder noticeably BIGGER sitting lower/behind with an obvious gap.
  { avatarScale: 0.86, avatarLift: 0.9,  boulderScale: 1.45, peekFar: 0.22, peekNear: 0.42 },
  // V3 — Looming boulder, close behind: boulder LARGE + HIGH on screen (on the runner's
  // heels, menacing), runner normal size, minimal gap, maximum threat.
  { avatarScale: 1.0,  avatarLift: 0.0,  boulderScale: 1.5,  peekFar: 0.52, peekNear: 0.40 },
];

// ---- GRID WORLD (the true-maze engine) --------------------------------------
// The grid engine builds the 3D world and the minimap from the SAME grid, so
// every corridor on the map is walkable. cellW is the world size of one maze
// cell (corridor width AND cell pitch — buildGridWorld carves square cells).
// It is the single source for pacing too: mazeGen derives each level's collapse
// budget from (routeSteps * GRID.cellW) / runSpeed, so world scale and timer
// can never drift apart.
export const GRID = {
  cellW: 14,          // world units per maze cell (corridor width = cell pitch)
};

// ---- CORRIDOR SURFACING MODE (A/B) -----------------------------------------
// 'tip'   = the default photoreal TIP (projected-photo) corridor (unchanged).
// 'tiled' = surface the corridor with seamless tiling MeshStandardMaterial
//           textures (tex_floor/tex_wall), lit by the torch PointLights.
// Overridable at runtime (no rebuild) via the URL query ?surf=tiled — handy for
// A/B comparison. The engine reads this default and the query param together.
export const CORRIDOR_SURFACE = 'tip';

// ---- AVATAR IDENTITY -------------------------------------------------------
// The playable relic hunter's name + one-line identity, kept here as the SINGLE
// source so copy (wizard, store listing, share card) reads from one place and the
// character can be renamed with a one-line change. Original character (no IP tie).
export const AVATAR_IDENTITY = {
  name: 'Mira',
  title: 'relic hunter',
  tagline: 'Mira, relic hunter',
};

// Default map params — only used if a field is missing from the loaded JSON.
export const MAP_DEFAULTS = {
  hallWidth: 12,
  hallHeight: 7,
  hallLen: 22,
  exitLen: 18,
  runSpeed: 9,
  startGrace: 12,
  collapseTime: 60,   // seconds to escape the level before the temple collapses
                      // (overridden per-level via map.params.collapseTime)
};

// ---- COLLAPSE TIMER --------------------------------------------------------
// Each level has a time budget (map.params.collapseTime, falling back to
// MAP_DEFAULTS.collapseTime). The countdown starts the moment the run arms (after
// startGrace) and is shown in the HUD. On EXPIRY the whole temple BLOWS APART (a
// 2D fx-canvas cinematic) and the run ends with deathCause 'collapse'.
// Hitting a beam BLOCKED also lights a SHORT collapse fuse: if still blocked when
// the fuse burns out the ceiling comes down (buried) -> same 'collapse' death.
export const COLLAPSE = {
  urgentS: 8,         // seconds remaining at which the HUD timer turns red/urgent
  blockFuseS: 2.4,    // seconds from a beam-BLOCK to the temple burying the player
  // --- expiry cinematic (2D fx-canvas overlay; modelled on boulderFx) ---------
  durS: 2.2,          // length of the blow-apart cinematic before phase -> 'over'
  shakeAmp: 34.0,     // px screen-shake amplitude at the peak of the collapse
  camShake: 0.10,     // 3D-camera shake (world units) at the peak
  chunkCount: 22,     // number of falling ceiling chunks/debris dropped
  dustCount: 30,      // number of dust puffs kicked up
  rumbleAlpha: 0.92,  // peak darkening/rumble opacity as the temple buries the view
  flashDur: 0.3,      // brief white concussion flash at the first slam
};

// Camera / third-person rig. The camera sits BEHIND + ABOVE the avatar so the
// runner is visible ahead of it on the corridor centerline.
export const CAM = {
  fov: 66,
  near: 0.1,
  far: 500,
  eyeY: 4.3,          // base camera height — modest elevated, angled-down chase view.
                      // The TIP capture cameras AND the render camera both use this
                      // (capVP(...camY...) calls in buildUnit/buildJunction/buildExit),
                      // so raising it moves both together: the photoreal projection stays
                      // matched while the lookAt targets (kept at y≈2.5) tilt the view down.
  lookAhead: 7,       // arc-length ahead the camera aims at
  charAhead: 4.0,     // avatar arc-length AHEAD of the camera (so it's on screen)
};

// Avatar billboard (camera-facing sprite plane).
export const AVATAR = {
  height: 3.1,        // world height of the sprite plane (bigger + more present in the hall)
  aspect: 0.62,       // width/height of the keyed sprite art
  yOffset: 0.0,       // lift off the floor so feet sit on the ground
  runFps: 22,         // run-cycle frame rate
  actionFps: 30,      // jump/duck clip frame rate (plays once per action)
  jumpLift: 3.1,      // how high the avatar visually hops on jump — a weightier, higher arc that clearly clears beams/fire/gaps
  duckDrop: 1.7,      // how far the avatar visually dips on duck — deep enough to clearly pass UNDER the blade
};

// ---- PLAYABLE CHARACTERS (sprite sets) -------------------------------------
// Each character is an original relic hunter with its own run/jump/duck sprite
// set (green-screen video → keyed → sliced) plus its own jump/duck LIFT tuning
// (Mira's sheets carry the vertical motion in-sprite, so she needs far less
// engine lift than the legacy sheets). The selected character id is stored in
// localStorage; the engine reads getSelectedCharacter() at avatar creation.
// Add a new hunter by dropping frames under char/<id>/{run,jump,duck} and adding
// an entry here — nothing else needs to change.
export const CHARACTERS = {
  mira: {
    id: 'mira', name: 'Mira', title: 'relic hunter', tagline: 'Mira, relic hunter',
    sprites: {
      run:  { dir: assetUrl('assets/temple/char/mira/run'),  count: 19 },
      jump: { dir: assetUrl('assets/temple/char/mira/jump'), count: 24 },
      duck: { dir: assetUrl('assets/temple/char/mira/duck'), count: 24 },
    },
    // sprite already rises/crouches, so keep the engine lift small (just a touch of pop).
    jumpLift: 1.1, duckDrop: 0.5,
    // Warm torch tint (multiplied onto the unlit sprite) so she reads as lit by the
    // temple's torchlight instead of flat/cool — matched to the corridor palette.
    tint: 0xd9b385,
  },
  vikram: {
    id: 'vikram', name: 'Vikram', title: 'relic hunter', tagline: 'Vikram, relic hunter',
    sprites: {
      run:  { dir: assetUrl('assets/temple/char/vikram/run'),  count: 19 },
      jump: { dir: assetUrl('assets/temple/char/vikram/jump'), count: 24 },
      duck: { dir: assetUrl('assets/temple/char/vikram/duck'), count: 24 },
    },
    jumpLift: 1.1, duckDrop: 0.5,
    tint: 0xd9b385,
  },
  // Legacy sheet kept available (?character=classic) but no longer the default —
  // it reads as Nathan Drake (IP risk), which the new hunters exist to replace.
  classic: {
    id: 'classic', name: 'Adventurer', title: 'treasure hunter', tagline: 'the adventurer',
    sprites: {
      run:  { dir: assetUrl('assets/temple/char/run'),  count: 19 },
      jump: { dir: assetUrl('assets/temple/char/jump'), count: 24 },
      duck: { dir: assetUrl('assets/temple/char/duck'), count: 24 },
    },
    jumpLift: 3.1, duckDrop: 1.7,
    tint: 0xffffff,   // legacy sheet is already warm-toned — no tint
  },
};
export const DEFAULT_CHARACTER = 'mira';
const CHARACTER_KEY = 'relichunter.character';
// The selected hunter: URL ?character=<id> wins (QA/deep-link), else localStorage,
// else the default. Always returns a valid CHARACTERS entry.
export function getSelectedCharacter() {
  let id = DEFAULT_CHARACTER;
  try {
    const q = new URLSearchParams(location.search).get('character');
    if (q && CHARACTERS[q]) id = q;
    else { const s = localStorage.getItem(CHARACTER_KEY); if (s && CHARACTERS[s]) id = s; }
  } catch { /* SSR/tests */ }
  return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}
export function setSelectedCharacter(id) {
  if (!CHARACTERS[id]) return;
  try { localStorage.setItem(CHARACTER_KEY, id); } catch { /* SSR/tests */ }
}

// ---- RUN-TO-MOVE (player-driven pace) --------------------------------------
// When ON, the runner only advances while a RUN input is held (keyboard Shift, or
// the on-screen RUN button; later: run-in-place via webcam cadence). Stopping lets
// the player read the maze and choose a turn deliberately. The collapse timer keeps
// draining, so dawdling still costs you. When OFF, the classic auto-run is used.
// OFF by default so the runner auto-runs (easier to pick up); the intro toggles it ON
// for the deliberate "you set the pace" mode (and it's the webcam run-in-place control).
export const RUN_TO_MOVE = false;

// Gameplay windows / pacing (ported from the prototype tunables).
export const PLAY = {
  speed: 8,           // arc units / sec (overridden by map.params.runSpeed) — slightly slower for reaction
  metresPerUnit: 1.0,
  turnWin: 16,        // arc ahead of a turn you may already turn — MATCHES cueLead so a press the instant the cue shows is accepted (was 12: cue showed at 16 but window only opened at 12, dropping instinctive presses)
  lateTol: 3.5,       // arc PAST a turn you can still turn before crashing (forgiving)
  hazWin: 4.0,        // arc half-window around a beam/blade for a clean clear (generous)
  cueLead: 16,        // arc ahead of a hazard/turn to start the warning telegraph
  graceS: 12,         // start-of-run free window (reaction time)
  hopV: 7.5,          // jump impulse for the camera hop spring
  dipV: 7.5,          // duck impulse for the camera dip spring
  springK: 30,        // hop/dip spring stiffness
  springD: 9,         // hop/dip spring damping
};

// ---- FIRE-SPITTING LION (jump/duck-by-height hazard) -----------------------
// A carved lion-mouth vent mounted on a side wall spits a horizontal flame jet
// across the corridor. The jet HEIGHT decides the move: a LOW jet you JUMP over,
// a HIGH jet you DUCK under. Wrong/no move = a NON-LETHAL singe-stumble you
// recover from with the correct action (same forgiving model as the beams).
export const FIRE = {
  lowY: 1.45,         // centre height of a LOW flame jet (JUMP)
  highY: 3.5,         // centre height of a HIGH flame jet (DUCK)
  size: 9.5,          // world size of the (square) lion plane (the carved head)
  jetWFrac: 1.18,     // flame plane width as a fraction of hall width (spans wall-to-wall)
  jetAspect: 2.13,    // flame frame aspect (w/h) so the sprite isn't distorted
  // sprite-sheet animation (Grok fire video baked to a grid)
  cols: 6, rows: 5, frames: 30, sheetFps: 22,
  light: 0xff7a1e,    // warm flame light colour
};

// ---- CRACKING PATH (fall-in gap) -------------------------------------------
// A WIDE broken chasm across the floor. The runner must JUMP it; not jumping means
// you run straight INTO it and FALL (a real gap, not a stumble).
export const CRACK = {
  len: 8.5,           // length (along the corridor) of the gap — wide enough that you can't step over it
  depth: 9.0,         // how deep the chasm drops (so falling in reads as a real plunge)
  glow: 0xff6a1e,     // faint warm glow at the broken edges (no lava — dry temple)
};

// ---- ESCAPE / WIN (finite level end) --------------------------------------
// The route is FINITE: after the last mapped segment the corridor opens into a
// bright light shaft (the temple exit). When the AVATAR (drawn at s+charAhead)
// reaches the exit we flip to the 'won' phase and show the ESCAPED screen.
export const EXIT = {
  // arc-length BEFORE the route's `total` at which the avatar "reaches" the exit
  // and the run ends (a small margin so we stop just inside the bright opening,
  // not exactly on the final waypoint). Larger = stops a touch earlier.
  stop: 2.5,          // EXIT_STOP — avatar arc-length short of `total` that wins
  // NEAR-EXIT TIME GRACE — if the collapse timer expires while the runner is within
  // this arc-length of the exit, it counts as an ESCAPE (win) instead of a death.
  timeGrace: 12,      // "a couple of feet from the exit" — generous so an almost-out run survives
  // arc-length window before the exit over which the light bloom ramps from 0->1
  // (corridor floods with daylight as you approach). Larger = longer fade-in.
  ramp: 26,           // EXIT_RAMP — arc distance over which the exit glow builds
  // peak opacity of the radial white/gold daylight bloom on the fx canvas as the
  // avatar nears the opening (0..1), reached right at the exit.
  bloomMax: 0.72,     // EXIT_BLOOM_MAX — strongest pre-win glow before the flash
  // win whiteout flash: a brief bright burst on 'won' that eases to the overlay.
  flashDur: 0.9,      // EXIT_FLASH_DUR — seconds the win whiteout lingers/eases
  // emissive brightness + light range of the procedural exit shaft in the 3D scene.
  // (the bright PLANE/halo is gone — the photoreal exit_light corridor now provides
  // the light + archway; this is just the gentle warm PointLight pouring back up it.)
  lightIntensity: 3.2,
  lightDist: 70,
  // --- dedicated photoreal EXIT corridor (Option A) -------------------------------
  // After the last mapped segment we append a STRAIGHT corridor (no turn) whose
  // floor/ceiling/walls are TIP-projected with ASSETS.exitImg. The camera runs
  // straight into it, the bright sunlit archway in the image sits at the far end,
  // and 'won' triggers near the end (via EXIT.stop against the extended `total`).
  corridorLen: 34,    // EXIT_CORRIDOR_LEN — world length of the appended sunlit hall
};

// Boulder 2D overlay.
export const BOULDER = {
  baseFrac: 0.34,     // diameter (at full danger) as a fraction of min(W,H)
  rollSpeed: 4.2,     // constant spin (rad/s)
  heatRise: 0.06,     // base chase pressure rise per second
  crushSpeed: 1.8,    // crush animation progress per second
  crushScale: 1.9,    // extra scale at full crush
  // --- Proximity / depth-cue mapping (Issue 2) ---------------------------------
  // The boulder's resting size + screen Y are driven smoothly by `danger`
  // (presence-gated heat). danger 0 = far behind (small/low), danger 1 = right on you.
  farScale: 0.85,     // resting diameter at danger 0 (BIGGER so when it does show it reads as a real boulder, not a coin — but it's faded out at low danger, see fadeIn below)
  nearGrow: 0.70,     // extra resting diameter added by danger (0->1 grows large + close as it bears down)
  restRise: 0.62,     // how much danger raises the boulder on screen (fraction of base radius it climbs toward the runner)
  restGap: 0.30,      // baseline gap below the runner line kept even at high danger (fraction of base) — keeps it readable as "behind me"
  shadowMax: 0.42,    // peak opacity of the soft ground-shadow / dust band under the boulder (tracks proximity)
  // --- Visibility gating (Issue 3): the boulder must NOT read as an ornate disc glued
  // under the feet at low danger. It stays essentially hidden until pressure builds, then
  // rises BEHIND + BELOW the runner as an unmistakable chasing boulder.
  fadeIn: 0.30,       // danger below this -> boulder alpha 0 (invisible); fades in across [fadeIn .. fadeIn+0.25]
  fadeBand: 0.25,     // danger span over which it fades from invisible to fully shown
  sinkFrac: 0.34,     // how far the boulder sits BELOW the feet line at LOW danger (fraction of base) — keeps it lower/behind, never a crisp disc under the feet
  blurMax: 0.55,      // peak motion-blur smear strength (extra stretched after-images) at high danger
  // --- Guaranteed gap (so the runner is ALWAYS clearly ahead of the boulder) ----
  // The boulder's on-screen TOP stays at least `minGapFrac` of the screen BELOW the
  // runner's feet line even at full danger — you always see floor between them, and at
  // low danger it sits much lower (sinkFrac) so it's clearly a thing BEHIND, not underfoot.
  feetLineFrac: 0.72, // runner's feet as a fraction of screen height (camera offset is fixed)
  minGapFrac: 0.06,   // min gap (fraction of screen height) kept between feet and boulder top at HIGH danger
  // --- Turn escape + fresh-approach re-entry (Issue 1) -------------------------
  goneHide: 1.1,      // hidden beat AFTER the slide-off (s) — genuine relief before any rebuild
  presenceRise: 0.5,  // how fast `presence` eases 0->1 after re-entry (per second) — the fresh boulder closing the corridor
};

export default { ASSETS, MAP_DEFAULTS, CAM, AVATAR, PLAY, EXIT, BOULDER, COLLAPSE, FIRE, CRACK, ALIGN_VARIATION, ALIGN_PRESETS };
