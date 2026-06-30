// ===========================================================================
// Temple Dash — ROUTE / PATH / TURN state machine (extracted from templeEngine.js).
// ---------------------------------------------------------------------------
// This module owns EVERYTHING about the corridor path: it builds the corridor
// geometry, the waypoint polyline + arc-length helpers (ptAt/sAt/recomputeArc),
// and the PLAYER-DRIVEN turn state machine (straight-by-default + splice-on-turn
// + pit detection). templeEngine only orchestrates (camera follow, hazards,
// boulder, FX); route.js is the single source of truth for the path.
//
// PLAYER-DRIVEN TURN MODEL
// ------------------------
// The DEFAULT active path is the STRAIGHT SPINE through every junction. Each
// junction's straight spine ends in a short FLOORLESS PIT STUB — run straight
// off its edge and you FALL (death cause 'pit'). The bend into a junction's
// exit-hall is a BRANCH that is SPLICED into the active path ONLY when the
// player presses the correct turn within the turn window (generalises the old
// maze divert/recomputeArc machinery). Because the default spine is straight,
// the camera (which just follows the active path by arc-length) does NOT rotate
// until a turn splices the bend — "the camera turns only when you turn" for free.
//
// Both LINEAR levels and the MAZE go through this SAME machinery. In a linear
// level there is one correct side per junction (seg.turn); in a maze BOTH side
// walls are open but only `correct` continues — picking the other side (or not
// turning) leaves the straight-to-pit stub and you fall.
//
//   createRoute({ THREE, scene, WD, geometry, params, segments, junctions,
//                 maze, camY, surf }) -> {
//     // geometry / layout (read once after construction)
//     unitFrames, junctionStubs, exitCorridorInfo, mmBounds, correctWaypoints,
//     // turn decisions (arc-length of each junction's decision point)
//     sTurn,                          // [{ s, dir, idx }]
//     // arc-length state (live)
//     get waypoints, get total,
//     ptAt(sv), sAt(p),
//     // player-driven turn machinery
//     resetPath(),                    // restore the straight default for a new run
//     takeTurn(idx, dir) -> 'ok'|'pit'|'late', // splice the bend OR signal a pit fall
//     pitEdgeS(),                     // arc-length of the CURRENT active path's floor edge
//     isOnPit(),                      // true when the active tail is the straight pit stub
//     reachedExit(sp, stop),          // win check (only true once fully turned to the exit)
//   }
// ===========================================================================

export function createRoute({
  THREE, scene, WD, geometry, params, segments, junctions, maze, camY, surf,
} = {}) {
  const { P, capVP, mkMat, quad } = geometry;
  const mp = params;
  const W = mp.hallWidth, H = mp.hallHeight, Lh2 = mp.exitLen;
  const hw = W / 2;
  const exitImg = surf.exitImg;

  // surf routes the tiled-vs-TIP material choice (engine builds the materials).
  const mat = (kind, tipMat) => surf.mat(kind, tipMat);
  const uv = (across, along) => surf.uv(across, along);

  // ---- PIT geometry tunables -------------------------------------------------
  // Past a junction's opening band, the straight spine continues onto a SHORT
  // floor stub then the floor ENDS (pit). Run off the edge => fall. (Replaces the
  // old "WALL AHEAD" dead-end: no wall, just an edge and an endless drop.)
  const PIT_RUN = Math.max(6, Math.min(Lh2, W * 0.9)); // length of the floored pit stub past the opening
  // PIT SHAFT depth cues: past the floor EDGE we sink a short shaft (recessed side
  // walls + a far-below floor) that fades to black, so the straight-ahead reads as
  // a HOLE GOING DOWN, not a flat black end wall. The floor edge itself stays at
  // z=-(Lh+PIT_RUN) (so route.pitEdgeS / the fall trigger are untouched).
  const PIT_DEPTH = 60;          // how far the shaft drops below the corridor floor (deep enough the fall plunges past lit walls, not black)
  const PIT_SHAFT_LEN = 26;      // how far past the edge the shaft recedes before it's pure void (longer = real walls fill the down-view, not a flat trapezoid)

  // Self-lit warm PORTAL GLOW (unlit basic, so it reads in BOTH tip + tiled modes —
  // the TIP corridor is unlit, so PointLights alone don't brighten the wall texture;
  // Dark "void" materials owned here (route is the only place a pit/shaft exists).
  // A near-black, slightly self-emissive stone so the shaft reads as receding depth
  // (the corridor fog already swallows it to black further down/back). Unlit basic
  // so it stays consistently dark in BOTH tip and tiled modes.
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x05030a, side: THREE.DoubleSide });
  // Shaft WALL stone — dark, but visible enough that the plunge reads as dropping past
  // real recessed walls (not a black/tan void). A faint warm self-glow at the top fading
  // to near-black at the bottom is faked with two stacked bands (lit upper / dark lower).
  const shaftWallMat = new THREE.MeshBasicMaterial({ color: 0x3a2616, side: THREE.DoubleSide });
  const shaftWallLowMat = new THREE.MeshBasicMaterial({ color: 0x140d07, side: THREE.DoubleSide });
  // COURSED-STONE banding palette for the pit shaft: alternating warm-stone shades per
  // course (lighter upper -> darker lower) plus a thin dark MORTAR strip between courses,
  // so the plunge reads as dropping past real masonry rather than a smooth flat brown wall.
  const shaftCourseMats = [
    new THREE.MeshBasicMaterial({ color: 0x4a3018, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x382414, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x2c1c10, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x21150b, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x180f07, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x100a05, side: THREE.DoubleSide }),
  ];
  const shaftMortarMat = new THREE.MeshBasicMaterial({ color: 0x080503, side: THREE.DoubleSide });
  // Warm molten glow at the very bottom of the shaft — gives the fall a lit floor to
  // plummet toward so the drop has depth/scale rather than fading to a flat colour.
  const shaftGlowMat = new THREE.MeshBasicMaterial({ color: 0x6a3410, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  // The DANGER EDGE LIP: a thin WARM-EMBER threshold strip right at the floor edge so
  // the "floor ends here — drop!" reads as a hazard rim against the dark drop beyond it.
  // (Was pure red 0xff2419 — during the plunge the camera tilted down across it and the
  // red strip filled the frame, reading as a corruption bar. A warm amber/ember rim
  // still pops as a hazard lip when standing but never reads as a red error mid-fall.)
  const lipMat = new THREE.MeshBasicMaterial({ color: 0xc8531a, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  // CORNER self-lit warm stone — used to surface the L-junction corner box so it reads as
  // continuously LIT masonry (matching the exit hall's brightness) in TIP mode, where the
  // unlit corridor shader leaves the far corner dark. This kills the "bright exit panel
  // floating in dark void" read: the whole bend is lit corridor, no dark wedge.
  // These were far too dark (0x3a2a1a / 0x2c2013) — they ARE the surfaces that enclose the
  // inner-turn quadrant the camera sweeps mid-bank, and at near-black they read as a dark
  // VOID WEDGE beside the lit exit (the reported blocker). Brightened to a warm LIT stone
  // matching the maze corner's torch-lit masonry, so the whole bend reads as a continuous
  // lit corridor with no dark wedge. (cornerStone = walls/ceiling; cornerFloor a touch
  // deeper so floor vs wall still read as distinct surfaces.)
  // The corner-enclosure surfaces are TEXTURED stone (not a flat tan slab): the seamless
  // wall/floor tiles, tinted to the warm torch-lit corridor tone, so the bend reads as
  // real masonry continuing the corridor. Unlit (MeshBasic) so it shows in TIP mode.
  const _ctl = new THREE.TextureLoader();
  const _mkTile = (url, tint) => {
    const t = _ctl.load(url);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, color: tint, side: THREE.DoubleSide });
  };
  const cornerStoneMat = _mkTile('/assets/temple/tex_wall.jpg', 0x6f5736);   // warm dim stone wall
  const cornerFloorMat = _mkTile('/assets/temple/tex_floor.jpg', 0x6a5030);  // warm dim stone floor
  const TILE = 4.5;   // ~one texture tile per this many world units (matches the corridor scale)

  // ---- per-junction geometry + waypoint groups -------------------------------
  // Every junction (linear OR maze) is built the SAME way. We DON'T pre-bake the
  // bend into the active path; instead each junction yields three waypoint groups
  // in world space:
  //   spine[i] : the straight-through centreline (entry -> through the opening band)
  //   pit[i]   : the straight pit-stub tail past the band (-> edge -> a touch beyond)
  //   bend[i]  : the turn into the exit hall (shared through-point -> pivot -> down hall)
  // The DEFAULT active path is spine[0]+pit[0]; a correct turn at i swaps pit[i]
  // for bend[i] and reveals spine[i+1]+pit[i+1] (or the exit corridor after the
  // last junction). See buildActivePath().
  let unitFrames = [];
  const junctionStubs = [];       // maze: dim dead-end stub polylines for the minimap
  const spineWP = [];             // spine[i] world waypoints
  const pitWP = [];               // pit[i] world waypoints (straight off the floor edge)
  const bendWP = [];              // bend[i] world waypoints (the spliced turn)
  // MAZE-only waypoint groups (dead-end model — no pits):
  const straightStubWP = [];      // maze: short straight tail that ends at the junction's far WALL
  const wrongBendWP = [];         // maze: the WRONG turn into a dead-end hall ending at a WALL
  const mazeSegments = [];        // maze: every corridor centreline (uniform) for the minimap

  // MAZE dead-end hall length (the WRONG side opens into a short hall that ends at a
  // wall, so a wrong/missed turn is a DEAD END to back out of — never a pit/fall).
  const WRONG_LEN = Math.max(8, Math.min(Lh2, Lh2 * 0.6));

  // ---------------------------------------------------------------------------
  // MODULAR depth/opening helpers — these make the junction READABLE:
  //   buildPitShaft : the floor edge reads as a DROP (lit lip + recessed shaft).
  //   buildArchway  : the correct side reads as an OPEN PORTAL with a hall beyond.
  // Both are pure geometry emitters (use quad/scene via the captured helpers);
  // they hold no state and are called once per junction by buildJunctionGeo.
  // ---------------------------------------------------------------------------

  // buildPitShaft(o, q, edgeZ) — at the straight-ahead floor EDGE (edgeZ), build:
  //   • a thin lit threshold LIP across the corridor right at the edge,
  //   • shaft SIDE-WALLS that drop straight DOWN into darkness past the edge,
  //   • a far-below shaft FLOOR fading to black,
  // so the read is "the flagstones end and there's a hole going down". No vertical
  // end-wall plane (that's what made it look like a dead-end). edgeZ stays exactly
  // where the floor stub ends so route.pitEdgeS() / the fall trigger are unchanged.
  function buildPitShaft(o, q, edgeZ) {
    const far = edgeZ - PIT_SHAFT_LEN;      // shaft recedes a bit further forward then voids out
    const yb = -PIT_DEPTH;                  // shaft floor far below
    // lit threshold LIP — a THIN bright strip flush with the floor at the very edge,
    // so the floor's end reads as a lit rim against the dark drop just beyond it. Kept
    // narrow (0.35u) and warm-ember so it never fills the frame as the camera tilts down.
    const lipD = 0.35;
    quad(P(-hw, 0.02, edgeZ + lipD, o, q), P(hw, 0.02, edgeZ + lipD, o, q), P(hw, 0.02, edgeZ, o, q), P(-hw, 0.02, edgeZ, o, q), lipMat);
    // ---- BANDED SHAFT WALLS (real recessed depth that scrolls past as you plunge) ----
    // Split the full drop into N horizontal bands, each a slightly darker stone toward the
    // bottom. Banding gives the side/back walls visible horizontal seams so the fall reads
    // as DROPPING PAST RECESSED MASONRY, not sliding down a flat tan trapezoid.
    // COURSED MASONRY: more, thinner courses (each a distinct stone shade) with a thin
    // dark MORTAR line at the bottom of every course. The strong shade-to-shade contrast
    // + mortar seams give the shaft walls visible horizontal banding as you plunge.
    const BANDS = 12;
    const courseMat = (k) => shaftCourseMats[Math.min(shaftCourseMats.length - 1, Math.floor(k / 2))];
    const yAt = (k) => -PIT_DEPTH * (k / BANDS);
    // The shaft recedes forward as it deepens (a slight inward batter) so the down-view
    // sees the back wall stepping away — extra parallax during the plunge.
    const zAt = (k) => edgeZ - PIT_SHAFT_LEN * (k / BANDS);
    const mortarFrac = 0.16;          // fraction of each course taken by the dark mortar seam
    for (let k = 0; k < BANDS; k++) {
      const y0 = yAt(k), y1 = yAt(k + 1);
      const z0 = zAt(k), z1 = zAt(k + 1);
      // split the course into a STONE block (most of it) + a MORTAR seam at its base.
      const ym = y0 + (y1 - y0) * (1 - mortarFrac);   // boundary between stone and mortar
      const zm = z0 + (z1 - z0) * (1 - mortarFrac);
      const cm = courseMat(k);
      // BACK wall: stone block then a mortar strip, stepping down + back.
      quad(P(-hw, y0, z0, o, q), P(hw, y0, z0, o, q), P(hw, ym, zm, o, q), P(-hw, ym, zm, o, q), cm);
      quad(P(-hw, ym, zm, o, q), P(hw, ym, zm, o, q), P(hw, y1, z1, o, q), P(-hw, y1, z1, o, q), shaftMortarMat);
      // SIDE walls on both sides — same stone block + mortar seam split.
      for (const sx of [-1, 1]) {
        quad(P(sx * hw, y0, edgeZ, o, q), P(sx * hw, y0, z0, o, q), P(sx * hw, ym, zm, o, q), P(sx * hw, ym, edgeZ, o, q), cm);
        quad(P(sx * hw, ym, edgeZ, o, q), P(sx * hw, ym, zm, o, q), P(sx * hw, y1, z1, o, q), P(sx * hw, y1, edgeZ, o, q), shaftMortarMat);
      }
    }
    // shaft FLOOR far below — the bottom you'd plummet toward, with a warm molten glow
    // pane just above it so the fall has a LIT target (depth/scale) instead of a flat void.
    quad(P(-hw, yb, edgeZ, o, q), P(hw, yb, edgeZ, o, q), P(hw, yb, far, o, q), P(-hw, yb, far, o, q), voidMat);
    quad(P(-hw, yb + 0.1, edgeZ, o, q), P(hw, yb + 0.1, edgeZ, o, q), P(hw, yb + 0.1, far, o, q), P(-hw, yb + 0.1, far, o, q), shaftGlowMat);
  }

  // buildArchway(o, q, s, Lh, m) — frame the correct-side opening (the gap over the
  // band [-(Lh-W) .. -Lh] in the s-side wall) as an OPEN PORTAL: stone jambs at the
  // front+back edges of the gap and a lintel across its top, so the eye reads "the
  // path continues that way" (the exit hall floor/walls already lie beyond it). The
  // gap itself stays empty (you can see through into the lit hall). Optional torch
  // glow at the portal draws the eye (subtle, matches the existing torch style).
  function buildArchway(o, q, s, Lh, m) {
    const zNear = -(Lh - W);     // front edge of the opening (nearer the player)
    const zFar = -Lh;            // back edge of the opening
    const jambD = 0.6;           // jamb thickness (along the hall)
    const lintH = H * 0.78;      // height the opening reaches before the lintel
    const x = s * hw;
    // JAMBS: thin solid wall slivers at the front + back of the gap so the opening
    // is framed (a doorway), not a raw missing-wall hole.
    quad(P(x, 0, zNear, o, q), P(x, 0, zNear - jambD, o, q), P(x, H, zNear - jambD, o, q), P(x, H, zNear, o, q), mat('wall', m), uv(jambD, H));
    quad(P(x, 0, zFar + jambD, o, q), P(x, 0, zFar, o, q), P(x, H, zFar, o, q), P(x, H, zFar + jambD, o, q), mat('wall', m), uv(jambD, H));
    // LINTEL: spans the top of the opening between the jambs (the doorway header).
    quad(P(x, lintH, zNear - jambD, o, q), P(x, lintH, zFar + jambD, o, q), P(x, H, zFar + jambD, o, q), P(x, H, zNear - jambD, o, q), mat('wall', m), uv(Lh - W, H - lintH));
    // (No glowing "portal pane" in the opening — the turn cue + minimap tell you which
    // way; the open archway is just framed stone + warm torchlight, not a transparent slab.)
    // BRIGHT warm portal lighting so the open side reads as a LIT ARCHWAY a first-time
    // player can spot at speed (vs the dark pit straight ahead): a strong torch right
    // in the mouth, PLUS a second warm glow set DOWN the exit hall so the floor beyond
    // the opening is clearly lit (the eye follows the light into the turn).
    if (surf.addTorch) {
      const gx = s * (hw + 1.0), gz = -(Lh - W / 2);
      const gp = P(gx, 4.4, gz, o, q);
      surf.addTorch(gp.x, gp.y, gp.z, 1.6);                 // bright torch in the portal mouth
      // warm spill a few units down the exit hall (lights the turn's floor/walls beyond).
      const dp = P(s * (hw + W * 0.9), 3.6, -(Lh - W / 2), o, q);
      surf.addTorch(dp.x, dp.y, dp.z, 1.1);
    }
  }

  // buildCornerEnclosure(o, q, s, Lh, m) — SEAL the L-junction corner so rounding the
  // bend reads as a CONTINUOUS enclosed corridor (no fog/void "wedges"). The straight
  // hall (x∈[-hw,hw], z 0..-Lh) meets the perpendicular exit hall (x∈[s*hw .. s*(hw+Lh2)],
  // z∈[-(Lh-W),-Lh]) at the corner box (x∈[-hw,hw], z∈[-(Lh-W),-Lh]). On a turn the camera
  // sweeps from facing -z to facing +s*x and, mid-sweep, used to see PAST the open corner
  // into the pit/fog on the OUTER side. We close that with:
  //   • an OUTER WALL across the far end (z=-Lh) on the NON-turn half (x from -s*hw to 0),
  //     so the wall behind the bend is solid (the inner half stays open: that's the pit
  //     stub straight-ahead / the exit mouth, which must read as a hole/opening).
  //   • a CORNER FLOOR + CEILING patch wrapping the full WxW corner box, so floor/ceiling
  //     are continuous from the main hall into the exit hall with no gap at the seam.
  //   • the inner corner JAMB wall (z=-(Lh-W)) on the NON-turn half, so the inside of the
  //     bend is a solid wall the camera looks along, not void.
  // Together the L-junction is a solid box: through the whole bend the frame is filled
  // by corridor (walls/floor/ceiling), and only the deliberate pit hole reads as dark.
  function buildCornerEnclosure(o, q, s, Lh, m) {
    const zN = -(Lh - W);      // near edge of corner box (inner corner)
    const zF = -Lh;            // far edge of corner box (outer corner)
    // All corner surfaces use the SELF-LIT warm stone so the bend reads as lit corridor in
    // TIP mode (no dark wedge around the bright exit panel). The corner box is enclosed:
    //   • floor + ceiling over the full WxW box (continuous with the main + exit halls),
    //   • the OUTER far wall + INNER near wall on the NON-turn half (x from -s*hw to 0) —
    //     the solid stone the camera looks at/along as it rounds the bend.
    const uvWW = { u: W / TILE, v: W / TILE }, uvHwH = { u: hw / TILE, v: H / TILE };
    quad(P(-hw, 0.01, zN, o, q), P(hw, 0.01, zN, o, q), P(hw, 0.01, zF, o, q), P(-hw, 0.01, zF, o, q), cornerFloorMat, uvWW);
    quad(P(-hw, H - 0.01, zN, o, q), P(-hw, H - 0.01, zF, o, q), P(hw, H - 0.01, zF, o, q), P(hw, H - 0.01, zN, o, q), cornerStoneMat, uvWW);
    quad(P(-s * hw, 0, zF + 0.03, o, q), P(0, 0, zF + 0.03, o, q), P(0, H, zF + 0.03, o, q), P(-s * hw, H, zF + 0.03, o, q), cornerStoneMat, uvHwH);
    quad(P(-s * hw, 0, zN, o, q), P(0, 0, zN, o, q), P(0, H, zN, o, q), P(-s * hw, H, zN, o, q), cornerStoneMat, uvHwH);
    // Also surface the OUTER side wall along the approach-to-corner (the -s side, last 2W
    // units before the corner) so the wall the camera pans across as it banks is textured
    // stone, not a flat slab. Covers x = -s*hw, z from -(Lh-2W) to -Lh.
    const zApp = -(Lh - 2 * W);
    const xo = -s * (hw - 0.05);   // just INSIDE the structural outer wall (no z-fight)
    quad(P(xo, 0, zApp, o, q), P(xo, 0, zF, o, q), P(xo, H, zF, o, q), P(xo, H, zApp, o, q), cornerStoneMat, { u: (2 * W) / TILE, v: H / TILE });
  }

  // buildJunctionGeo(o, q, side, len, isMaze) — build ONE junction's geometry and
  // its three waypoint groups. `side` is the CORRECT/continuing turn ('L'|'R').
  //   • straight spine floor runs the FULL hall (0..-Lh) then a short pit stub
  //     (-Lh .. -(Lh+PIT_RUN)); the floor ENDS there (no wall) => pit.
  //   • the correct side wall has the W-wide opening into the exit hall.
  //   • maze: BOTH side walls open (the wrong side becomes a dim pit stub, no wall).
  function buildJunctionGeo(o, q, side, len, isMaze) {
    const Lh = (len != null && isFinite(len) && len > 0) ? len : mp.hallLen;
    const s = side === 'R' ? 1 : -1;     // continuing (correct) side
    const w = -s;                         // other side (maze: also open -> pit)
    const m1 = mkMat(capVP(P(0, camY, 2, o, q), P(0, 2.5, -30, o, q)));
    // floor: full hall, then a short pit stub past the opening band, then NOTHING.
    quad(P(-hw, 0, 0, o, q), P(hw, 0, 0, o, q), P(hw, 0, -Lh, o, q), P(-hw, 0, -Lh, o, q), mat('floor', m1), uv(W, Lh));      // hall floor
    quad(P(-hw, H, 0, o, q), P(-hw, H, -Lh, o, q), P(hw, H, -Lh, o, q), P(hw, H, 0, o, q), mat('ceil', m1), uv(W, Lh));      // ceiling
    // STRAIGHT-AHEAD TAIL.
    //  • LINEAR: a short floored pit stub past the opening band, then the floor ENDS
    //    (buildPitShaft sinks a dark shaft) — miss a turn and you fall.
    //  • MAZE: NO pit. The straight path is closed by a solid WALL at the far end of
    //    the hall (z=-Lh), so going straight (or not turning) is a DEAD END you bump
    //    into and back out of — never a fall. (Issue: dead ends are walls, not pits.)
    if (!isMaze) {
      const pitEdgeZ = -(Lh + PIT_RUN);
      quad(P(-hw, 0, -Lh, o, q), P(hw, 0, -Lh, o, q), P(hw, 0, pitEdgeZ, o, q), P(-hw, 0, pitEdgeZ, o, q), mat('floor', m1), uv(W, PIT_RUN));
      buildPitShaft(o, q, pitEdgeZ);
    } else {
      // solid dead-end wall closing the straight-ahead at the end of the hall.
      quad(P(-hw, 0, -Lh, o, q), P(hw, 0, -Lh, o, q), P(hw, H, -Lh, o, q), P(-hw, H, -Lh, o, q), mat('wall', m1), uv(W, H));
    }
    // side walls — solid up to the opening band; the opening (gap of width W) sits
    // in [-(Lh-W), -Lh]. Linear: only the correct side opens (framed as a portal by
    // buildArchway). Maze: both open. The pit stub itself stays open-sided.
    for (const sx of [-1, 1]) {
      const opens = isMaze ? true : (sx === s);
      if (opens) {
        // front solid piece (mouth -> opening), gap left empty over the band, framed.
        quad(P(sx * hw, 0, 0, o, q), P(sx * hw, 0, -(Lh - W), o, q), P(sx * hw, H, -(Lh - W), o, q), P(sx * hw, H, 0, o, q), mat('wall', m1), uv(Lh - W, H));
      } else {
        // fully solid wall along the whole hall.
        quad(P(sx * hw, 0, 0, o, q), P(sx * hw, 0, -Lh, o, q), P(sx * hw, H, -Lh, o, q), P(sx * hw, H, 0, o, q), mat('wall', m1), uv(Lh, H));
      }
    }
    // Frame the opening(s) as OPEN ARCHWAYS/PORTALS (jambs + lintel + a subtle torch).
    // LINEAR: only the correct side opens, so only it is framed — the lit hall beyond
    // is what the eye follows. MAZE: BOTH sides open and are framed IDENTICALLY (no
    // hint which continues) — the player must READ THE MAP to tell the through-path
    // from the dead end (Issue: don't reveal the solution in-world).
    buildArchway(o, q, s, Lh, m1);
    if (isMaze) buildArchway(o, q, -s, Lh, m1);
    // SEAL THE CORNER so the bend reads as a continuous enclosed corridor (no void wedge).
    // LINEAR: close the outer corner with a solid wall on the non-turn half + wrap the
    // corner floor/ceiling. MAZE: both sides are real halls, so only wrap the floor/ceiling
    // patch (no outer wall — that would block the open dead-end/through halls).
    if (!isMaze) {
      buildCornerEnclosure(o, q, s, Lh, m1);
    } else {
      const zN = -(Lh - W), zF = -Lh;
      quad(P(-hw, 0.0, zN, o, q), P(hw, 0.0, zN, o, q), P(hw, 0.0, zF, o, q), P(-hw, 0.0, zF, o, q), mat('floor', m1), uv(W, W));
      quad(P(-hw, H, zN, o, q), P(-hw, H, zF, o, q), P(hw, H, zF, o, q), P(hw, H, zN, o, q), mat('ceil', m1), uv(W, W));
    }
    // (NO "WALL AHEAD" — running straight runs onto the pit stub and off its edge.)
    // The pit stub has NO end wall: it's a ledge into the lit shaft / void.

    // --- CONTINUING (correct) side EXIT HALL (the branch spliced in on a turn) ---
    // CRITICAL for an enclosed bend: the exit corridor's floor/ceiling/SIDE-WALLS start at
    // the OPPOSITE main-hall wall (x = -s*hw), bridging the WHOLE corner box (x∈[-hw,hw])
    // before running out to x = s*(hw+Lh2). This way, as the camera rounds the bend and
    // looks down the exit, the bounding walls (at z=-(Lh-W) and z=-Lh) and floor/ceiling
    // cover the corner too — there is no open sliver between the main hall and the exit
    // hall, so no void wedge / floating-panel read. The exit-hall extent is x∈[-s*hw .. s*(hw+Lh2)].
    const xIn = -s * hw;                 // inner start (opposite main-hall wall): bridges the corner
    const xOut = s * (hw + Lh2);         // far end of the exit hall
    const exLen = Math.abs(xOut - xIn);  // total bridged length (corner box + exit hall)
    const m2 = mkMat(capVP(P(s * hw, camY, -(Lh - W / 2), o, q), P(s * (hw + 60), 2.5, -(Lh - W / 2), o, q)));
    quad(P(xIn, 0, -(Lh - W), o, q), P(xOut, 0, -(Lh - W), o, q), P(xOut, 0, -Lh, o, q), P(xIn, 0, -Lh, o, q), mat('floor', m2), uv(exLen, W)); // floor2 (bridges corner)
    quad(P(xIn, H, -(Lh - W), o, q), P(xIn, H, -Lh, o, q), P(xOut, H, -Lh, o, q), P(xOut, H, -(Lh - W), o, q), mat('ceil', m2), uv(W, exLen)); // ceil2 (bridges corner)
    // SIDE WALLS of the exit corridor run from its MOUTH (x = s*hw) outward only — they
    // must NOT cross the corner box (x∈[-hw,hw]), or they'd wall off the straight-through
    // spine/pit path that also passes through the corner. (The corner box is enclosed by
    // the corner floor/ceiling patch + the buildCornerEnclosure outer/inner walls instead.)
    for (const zl of [-(Lh - W), -Lh]) {
      quad(P(s * hw, 0, zl, o, q), P(xOut, 0, zl, o, q), P(xOut, H, zl, o, q), P(s * hw, H, zl, o, q), mat('wall', m2), uv(Lh2, H));
    }

    // --- MAZE wrong side: a full, FLOORED dead-end hall that ENDS IN A WALL (no pit).
    // Picking this side (or mis-reading the map) sends the runner down a short hall to
    // a wall they bump into; they then TURN to run back out to the junction and pick
    // the other way. We mirror the correct exit-hall build, but shorter (WRONG_LEN)
    // and capped with a solid end wall. A dim minimap stub records the dead end.
    if (isMaze) {
      const ms = mkMat(capVP(P(w * hw, camY, -(Lh - W / 2), o, q), P(w * (hw + 60), 2.5, -(Lh - W / 2), o, q)));
      const WL = WRONG_LEN;
      quad(P(w * hw, 0, -(Lh - W), o, q), P(w * (hw + WL), 0, -(Lh - W), o, q), P(w * (hw + WL), 0, -Lh, o, q), P(w * hw, 0, -Lh, o, q), mat('floor', ms), uv(WL, W)); // dead-end floor
      quad(P(w * hw, H, -(Lh - W), o, q), P(w * hw, H, -Lh, o, q), P(w * (hw + WL), H, -Lh, o, q), P(w * (hw + WL), H, -(Lh - W), o, q), mat('ceil', ms), uv(W, WL)); // dead-end ceiling
      for (const zl of [-(Lh - W), -Lh]) {               // the two side walls of the dead-end hall
        quad(P(w * hw, 0, zl, o, q), P(w * (hw + WL), 0, zl, o, q), P(w * (hw + WL), H, zl, o, q), P(w * hw, H, zl, o, q), mat('wall', ms), uv(WL, H));
      }
      // solid END WALL capping the dead end (this is what the runner bumps into).
      quad(P(w * (hw + WL), 0, -(Lh - W), o, q), P(w * (hw + WL), 0, -Lh, o, q), P(w * (hw + WL), H, -Lh, o, q), P(w * (hw + WL), H, -(Lh - W), o, q), mat('wall', ms), uv(W, H));
      junctionStubs.push([
        P(0, camY, -(Lh - W / 2), o, q),
        P(w * (hw + WL), camY, -(Lh - W / 2), o, q),
      ]);
    }

    // --- waypoint groups (world space) ---
    const through = P(0, camY, -(Lh - W / 2), o, q);     // centreline point at the opening band
    spineWP.push([
      P(0, camY, 1, o, q),                               // entry
      through,                                            // straight through the opening band
    ]);
    pitWP.push([
      through,
      P(0, camY, -(Lh + PIT_RUN - 0.4), o, q),           // out onto the pit stub, right to the edge
      P(0, camY, -(Lh + PIT_RUN + 6), o, q),             // a touch beyond the edge (the fall trigger zone)
    ]);
    bendWP.push([
      through,                                            // shared through-point (continuity)
      P(s * hw, camY, -(Lh - W / 2), o, q),              // pivot into the correct side
      P(s * (hw + Lh2 - 1), camY, -(Lh - W / 2), o, q),  // down the exit hall
    ]);
    // MAZE: straight tail stops just short of the far dead-end WALL; the wrong turn
    // runs into the wrong-side dead-end hall up to its end wall.
    straightStubWP.push([
      through,
      P(0, camY, -(Lh - 0.6), o, q),                     // up to (just shy of) the straight wall
    ]);
    wrongBendWP.push([
      through,                                            // shared through-point (continuity)
      P(-s * hw, camY, -(Lh - W / 2), o, q),             // pivot into the WRONG side
      P(-s * (hw + WRONG_LEN - 0.8), camY, -(Lh - W / 2), o, q), // up to the dead-end wall
    ]);
    // minimap: this junction's corridors (uniform — spine + both branches).
    mazeSegments.push([P(0, camY, 1, o, q), through]);                                  // spine in
    mazeSegments.push([through, P(s * (hw + Lh2 - 1), camY, -(Lh - W / 2), o, q)]);      // correct branch
    if (isMaze) mazeSegments.push([through, P(-s * (hw + WRONG_LEN - 0.8), camY, -(Lh - W / 2), o, q)]); // dead-end branch

    const exitHeading = side === 'R' ? (q + 1) % 4 : (q + 3) % 4;
    const exitOrigin = P(s * (hw + Lh2), 0, -(Lh - W / 2), o, q);
    return { exitOrigin, exitHeading };
  }

  // ---- build the chain of junctions ------------------------------------------
  let o = new THREE.Vector3(0, 0, 0), q = 0;
  const list = maze ? junctions : segments;
  for (const item of list) {
    const side = maze
      ? (item.correct === 'L' ? 'L' : 'R')
      : (item.turn === 'L' ? 'L' : 'R');
    const segLh = (item.len != null && isFinite(item.len) && item.len > 0) ? item.len : mp.hallLen;
    // unitFrames mirrors the old shape so the engine's hazard placement works.
    unitFrames.push({ o: o.clone(), q, turn: side, hazards: item.hazards != null ? item.hazards : (maze ? [] : null), Lh: segLh });
    const r = buildJunctionGeo(o, q, side, segLh, maze);
    o = r.exitOrigin; q = r.exitHeading;
  }

  // ---- ESCAPE: dedicated photoreal EXIT corridor (after the LAST junction) ----
  // Built at the chain end (o,q after the last junction's exit hall). The exit
  // corridor's waypoints are appended to the active path ONLY when the player has
  // correctly turned through the last junction (see buildActivePath).
  let exitCorridorInfo = null;
  const exitWP = [];
  (function buildExitCorridor() {
    const Le = surf.exitCorridorLen;
    const me = mkMat(capVP(P(0, camY, 2, o, q), P(0, 2.5, -30, o, q)), exitImg, 0x6a4a22);
    const matE = (kind) => surf.matExit(kind, me);
    quad(P(-hw, 0, 0, o, q), P(hw, 0, 0, o, q), P(hw, 0, -Le, o, q), P(-hw, 0, -Le, o, q), matE('floor'), uv(W, Le));
    quad(P(-hw, H, 0, o, q), P(-hw, H, -Le, o, q), P(hw, H, -Le, o, q), P(hw, H, 0, o, q), matE('ceil'), uv(W, Le));
    for (const sx of [-1, 1]) {
      quad(P(sx * hw, 0, 0, o, q), P(sx * hw, 0, -Le, o, q), P(sx * hw, H, -Le, o, q), P(sx * hw, H, 0, o, q), matE('wall'), uv(Le, H));
    }
    quad(P(-hw, 0, -Le, o, q), P(hw, 0, -Le, o, q), P(hw, H, -Le, o, q), P(-hw, H, -Le, o, q), me);   // bright archway end wall
    exitWP.push(P(0, camY, 1, o, q), P(0, camY, -(Le - 1), o, q));
    exitCorridorInfo = { farEnd: P(0, camY, -Le, o, q), outDir: WD[q].clone() };
  })();

  // ===========================================================================
  // ACTIVE PATH (player-driven straight-default + splice-on-turn)
  // ===========================================================================
  // `resolved` = how many junctions the player has correctly turned through. The
  // active path = (for each resolved junction j: spine[j] + bend[j]) + (the CURRENT
  // junction's spine + its STRAIGHT PIT tail). Once ALL junctions are resolved the
  // pit tail is replaced by the exit corridor (the only way to actually escape).
  // Because the resolved prefix is identical before/after a splice, the avatar's
  // current `s` stays continuous when a turn splices the next bend.
  const N = unitFrames.length;
  let resolved = 0;
  // MAZE: branch state for the CURRENT (unresolved) junction.
  //   null    -> straight tail (runs up to the junction's far wall),
  //   'wrong' -> the wrong-side dead-end hall (runs to its end wall; back out to retry).
  let branch = null;
  let waypoints = [];
  let segLens = [], total = 0, cum = [0];

  // junction i's decision point (arc-length): the through-point of junction i in the
  // CURRENT active path. Recomputed on every rebuild (it shifts as bends splice in).
  // cumStartOfJunction[i] = arc-length at the START of junction i's spine.
  let cumStartOfJunction = [];

  function recomputeArc() {
    segLens = []; total = 0; cum = [0];
    for (let i = 0; i < waypoints.length - 1; i++) {
      let L = waypoints[i + 1].distanceTo(waypoints[i]);
      if (!isFinite(L) || L < 0) L = 0;
      segLens.push(L); total += L; cum.push(total);
    }
    if (!isFinite(total) || total <= 0) total = 1e-3;
  }

  // buildActivePath() — assemble waypoints from the resolved prefix + current tail.
  function buildActivePath() {
    const wp = [];
    cumStartOfJunction = [];
    let acc = 0;
    const pushLeg = (pts, skipFirst) => {
      const start = skipFirst ? 1 : 0;
      for (let k = start; k < pts.length; k++) {
        if (wp.length) acc += pts[k].distanceTo(wp[wp.length - 1]);
        wp.push(pts[k].clone());
      }
    };
    for (let j = 0; j < N; j++) {
      cumStartOfJunction[j] = acc;
      // junction j's spine (skip first point if it duplicates the previous tail end).
      pushLeg(spineWP[j], wp.length > 0);
      if (j < resolved) {
        // resolved: splice the bend into the exit hall (continues to next junction).
        pushLeg(bendWP[j], true);
      } else {
        // current (unresolved) junction. STOP here (rest is hidden).
        if (maze) {
          // MAZE: tail is either the straight stub (up to the far wall) or, after a
          // wrong pick, the dead-end hall (up to its end wall). No pit.
          pushLeg(branch === 'wrong' ? wrongBendWP[j] : straightStubWP[j], true);
        } else {
          // LINEAR: straight pit tail (run off the edge -> fall).
          pushLeg(pitWP[j], true);
        }
        waypoints = wp; recomputeArc(); return;
      }
    }
    // all junctions resolved: append the exit corridor (the actual escape).
    pushLeg(exitWP, true);
    waypoints = wp; recomputeArc();
  }

  // pit-edge arc-length: where the CURRENT active path's floor ends. When the tail
  // is the straight pit stub, that's pitWP[resolved][1] (the very edge). The path's
  // last point is a touch BEYOND the edge (the fall-trigger zone).
  function pitEdgeS() {
    if (maze) return total + 1e6;              // MAZE: no pits, ever
    // pit stub = the last leg before the final beyond-point. The edge is the
    // second-to-last waypoint of the active path when on a pit.
    if (resolved >= N) return total + 1e6;     // fully on the exit corridor: no pit
    // edge point is waypoints[last-1]; its cum is cum[len-2].
    return cum[Math.max(0, cum.length - 2)];
  }
  function isOnPit() { return !maze && resolved < N; }
  // MAZE: arc-length of the WALL at the end of the current tail (straight stub or the
  // wrong-side dead-end) — the runner bumps it and stops. It's just the active total.
  function tailWallS() { return total; }
  // MAZE: arc-length of the CURRENT junction's decision/through-point on the active
  // path (used to know when a back-out run has returned to the junction).
  function throughS() { return (resolved < N) ? sTurn[resolved].s : Infinity; }
  // MAZE: is the current tail the wrong-side dead-end (vs the straight stub)?
  function onWrongBranch() { return maze && branch === 'wrong'; }

  // ---- arc-length sampling ---------------------------------------------------
  function ptAt(sv) {
    let acc = 0;
    for (let i = 0; i < segLens.length; i++) {
      const L = segLens[i] || 1e-6;
      if (sv <= acc + L) { const t = (sv - acc) / L; return waypoints[i].clone().lerp(waypoints[i + 1], t); }
      acc += segLens[i];
    }
    return waypoints[waypoints.length - 1].clone();
  }
  function sAt(p) {
    let best = 1e9, bs = 0;
    for (let i = 0; i < segLens.length; i++) {
      const a = waypoints[i], b = waypoints[i + 1];
      const ab = b.clone().sub(a); const L2 = ab.lengthSq() || 1e-6;
      let t = p.clone().sub(a).dot(ab) / L2; t = Math.max(0, Math.min(1, t));
      const proj = a.clone().add(ab.multiplyScalar(t)); const d = proj.distanceToSquared(p);
      if (d < best) { best = d; bs = cum[i] + t * segLens[i]; }
    }
    return bs;
  }

  // ---- TURN decision points --------------------------------------------------
  // sTurn[i].s = arc-length of junction i's through-point (the decision point) in
  // the CURRENT active path. We expose a getter-style array refreshed on rebuild.
  // For an UNRESOLVED junction beyond the current one, its decision point isn't on
  // the active path yet; only the CURRENT junction (idx === resolved) is judgeable,
  // which is exactly the player-driven model (you decide each junction as you reach it).
  const sTurn = unitFrames.map((uf, i) => ({ s: 0, dir: uf.turn, idx: i }));
  function refreshTurnS() {
    for (let i = 0; i < N; i++) {
      // through-point sits at the END of spine[i]; its cum index in the active path:
      // start-of-junction + (spine length - 1) legs. We recompute via the spine[i]
      // last point projected onto the active path (robust; handles the hidden tail).
      if (i <= resolved && i < N) {
        const through = spineWP[i][spineWP[i].length - 1];
        sTurn[i].s = sAt(through);
      } else {
        sTurn[i].s = Infinity;     // not yet on the active path
      }
    }
  }

  // ---- player turn: splice the bend OR signal a pit fall ----------------------
  // takeTurn(idx, dir): only the CURRENT junction (idx === resolved) is live.
  //   • correct dir  -> splice the bend (continue); returns 'ok'.
  //   • wrong dir     -> returns 'pit' (caller drives the fall; the straight stub stands).
  function takeTurn(idx, dir) {
    if (idx !== resolved || resolved >= N) return 'late';
    const want = unitFrames[idx].turn;
    if (dir === want) {
      resolved++;
      branch = null;
      buildActivePath();
      refreshTurnS();
      return 'ok';
    }
    // wrong direction:
    if (maze) {
      // MAZE: splice the wrong-side DEAD-END hall (runner heads into it, hits the wall,
      // then backs out). Never a fall.
      branch = 'wrong';
      buildActivePath();
      refreshTurnS();
      return 'wrong';
    }
    return 'pit';     // LINEAR: leave the straight pit stub -> fall
  }

  // MAZE: back out of the wrong-side dead end — restore the straight tail so the
  // current junction is choosable again (called once the back-out run reaches it).
  function goBack() {
    if (!maze) return;
    branch = null;
    buildActivePath();
    refreshTurnS();
  }

  function resetPath() {
    resolved = 0;
    branch = null;
    buildActivePath();
    refreshTurnS();
  }

  // reachedExit(sp, stop): true only when fully resolved (on the exit corridor) and
  // the avatar has run into the bright archway. A pit tail NEVER wins.
  function reachedExit(sp, stop) {
    return resolved >= N && sp >= total - stop;
  }

  // ---- initial build ---------------------------------------------------------
  buildActivePath();
  refreshTurnS();

  // immutable full correct path (for the minimap) — spine+bend for every junction
  // plus the exit corridor, regardless of how far the player has resolved.
  const correctWaypoints = (() => {
    const wp = [];
    const pushLeg = (pts, skipFirst) => {
      for (let k = (skipFirst ? 1 : 0); k < pts.length; k++) wp.push(pts[k].clone());
    };
    for (let j = 0; j < N; j++) { pushLeg(spineWP[j], wp.length > 0); pushLeg(bendWP[j], true); }
    pushLeg(exitWP, true);
    return wp;
  })();

  // sAtFull(p): arc-length of `p` along the IMMUTABLE full correct path (every bend
  // spliced + the exit corridor). Hazards live in the straight halls, which sit at the
  // SAME arc-length on the correct path as on the player's active path WHEN they turn
  // correctly (the intended hazard-clearing run) — so this gives stable hazard anchors
  // that don't depend on how much of the path is currently spliced in. (The active
  // sAt() projects onto the live, possibly-truncated path and is wrong for far halls.)
  const cwLens = [], cwCum = [0];
  (function buildCorrectArc() {
    let t = 0;
    for (let i = 0; i < correctWaypoints.length - 1; i++) {
      let L = correctWaypoints[i + 1].distanceTo(correctWaypoints[i]);
      if (!isFinite(L) || L < 0) L = 0;
      cwLens.push(L); t += L; cwCum.push(t);
    }
  })();
  function sAtFull(p) {
    let best = 1e9, bs = 0;
    for (let i = 0; i < cwLens.length; i++) {
      const a = correctWaypoints[i], b = correctWaypoints[i + 1];
      const ab = b.clone().sub(a); const L2 = ab.lengthSq() || 1e-6;
      let t = p.clone().sub(a).dot(ab) / L2; t = Math.max(0, Math.min(1, t));
      const proj = a.clone().add(ab.multiplyScalar(t)); const d = proj.distanceToSquared(p);
      if (d < best) { best = d; bs = cwCum[i] + t * cwLens[i]; }
    }
    return bs;
  }

  // minimap bounds: span the correct path + (maze) every dim stub + every pit tail.
  const mmPts = correctWaypoints
    .concat(...junctionStubs)
    .concat(...pitWP);
  const wx = mmPts.map((p) => p.x), wz = mmPts.map((p) => p.z);
  const mmBounds = {
    minx: Math.min(...wx), maxx: Math.max(...wx),
    minz: Math.min(...wz), maxz: Math.max(...wz),
  };

  return {
    unitFrames, junctionStubs, mazeSegments, exitCorridorInfo, mmBounds, correctWaypoints, sTurn,
    get waypoints() { return waypoints; },
    get total() { return total; },
    get resolvedCount() { return resolved; },
    ptAt, sAt, sAtFull,
    resetPath, takeTurn, goBack, pitEdgeS, isOnPit, reachedExit,
    tailWallS, throughS, onWrongBranch,
  };
}

export default createRoute;
