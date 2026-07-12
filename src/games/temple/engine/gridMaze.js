// ===========================================================================
// Temple Collapse — GRID MAZE navigation + layout (the "ground = minimap" core).
// ---------------------------------------------------------------------------
// The maze is ONE piece of data: a grid of cells, each with N/E/S/W walls (from
// mazeGen). BOTH the 3D corridors and the minimap render straight from it, so the
// world the player runs IS the map — every open passage is walkable, dead ends are
// real, and there can be many routes. This module owns only the DATA + NAVIGATION
// (framework-free, unit-testable); the 3D geometry builder and camera consume its
// layout + live position. Adding a path = removing a wall in the grid; it shows up
// in the ground and the map automatically.
//
//   createGridNav(maze, { speed, cellW }) -> {
//     reset(),
//     update(dt, running),        // auto-run forward along the heading
//     turn(dir 'L'|'R'),          // rotate into an open side passage (or about-face at a dead end)
//     get cell()  -> { r, c },    // current grid cell
//     get heading()-> 'N'|'E'|'S'|'W',
//     get t()     -> 0..1,        // fraction from this cell toward the next (for smooth pos)
//     get atWall(),               // stopped facing a wall (dead end / straight wall — turn to leave)
//     get atExit(),               // arrived at the exit cell
//     worldPos()  -> { x, z },    // interpolated world position (for camera + avatar)
//     headingVec()-> { x, z },    // unit forward in world space
//     openings(r,c)-> ['N',..],   // open directions of a cell (for junction detection / turn cues)
//     isJunction()-> bool,        // current cell has a choice (>2 openings, or a turn)
//     isDeadEnd(r,c)-> bool,
//   }
// Grid→world: cell (r,c) maps to world (x = c*cellW, z = -r*cellW). Grid NORTH
// (row decreasing) = world -z = "forward into the screen", matching the renderer.
// ===========================================================================

const DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
// SCREEN handedness: with wz(r)=-r*cellW the render camera looks down +z when
// heading N, which mirrors a naive grid map — the opening that is the player's
// SCREEN-left/right is the OPPOSITE grid side. These tables are the screen-true
// mapping (verified against the camera's world axes, matches the heading-up
// minimap): turn('R') always takes the passage on the player's right ON SCREEN.
const LEFT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const RIGHT = { N: 'W', W: 'S', S: 'E', E: 'N' };
const BACK = { N: 'S', S: 'N', E: 'W', W: 'E' };
// world forward per heading. wz(r) = -r*cellW, so grid NORTH (row decreasing, toward
// the exit at r=0) is world +z; SOUTH is -z. (These must match worldPos()'s motion.)
const HVEC = { N: { x: 0, z: 1 }, S: { x: 0, z: -1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };

export function createGridNav(maze, { speed = 6, cellW = 10 } = {}) {
  const { cols, rows, grid, entrance, exit } = maze;
  const inb = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const openDir = (r, c, d) => inb(r, c) && !grid[r][c][d];          // no wall on side d
  const openings = (r, c) => ['N', 'E', 'S', 'W'].filter((d) => openDir(r, c, d));
  const isDeadEnd = (r, c) => openings(r, c).length === 1;

  let r, c, heading, t, atWall;

  function firstOpen(cr, cc, prefer) {
    for (const d of prefer) if (openDir(cr, cc, d)) return d;
    return openings(cr, cc)[0] || 'N';
  }
  function reset() {
    r = entrance.r; c = entrance.c; t = 0; atWall = false;
    // face the way out of the entrance (prefer heading toward the exit: up / toward its column)
    const prefer = [exit.r < r ? 'N' : 'S', exit.c > c ? 'E' : 'W', 'N', 'E', 'S', 'W'];
    heading = firstOpen(r, c, prefer);
  }

  // A cell's wall sits half a cell (t=0.5) from its centre. When the heading side
  // is CLOSED the runner must stop a body's length SHORT of the wall face — not
  // glide through it to the neighbour centre (the old t=1 clamp put the camera
  // inside solid stone). stopShort is in world units.
  const stopShort = 1.6;
  const wallT = Math.max(0.05, 0.5 - stopShort / cellW);

  // advance forward; cross into the next cell when open, else stop BEFORE the wall.
  function update(dt, running) {
    if (!running || atWall) return;
    t += (speed * dt) / cellW;
    let guard = 0;
    while (guard++ < 8) {
      if (!openDir(r, c, heading)) {                     // heading side closed
        if (t >= wallT) { t = wallT; atWall = true; }    // stop short of the wall
        break;
      }
      if (t < 1) break;
      const [dr, dc] = DELTA[heading];
      if (!inb(r + dr, c + dc)) { t = wallT; atWall = true; break; }
      r += dr; c += dc; t -= 1;                          // cross into the next cell
    }
    if (t < 0) t = 0;
  }

  // turn into an open side passage. At a wall/dead end, any turn first tries the
  // sides, then about-faces so you can always get out. Returns true if the heading changed.
  function turn(dir) {
    const want = dir === 'L' ? LEFT[heading] : RIGHT[heading];
    // from a wall stop the runner pivots AT the cell centre (t=0) so the new
    // corridor is entered cleanly; mid-stride turns keep t (cutting the corner).
    if (openDir(r, c, want)) { heading = want; if (atWall || t >= 1) t = 0; atWall = false; return true; }
    if (atWall) {
      const other = dir === 'L' ? RIGHT[heading] : LEFT[heading];
      if (openDir(r, c, other)) { heading = other; atWall = false; t = 0; return true; }
      const back = BACK[heading];
      if (openDir(r, c, back)) { heading = back; atWall = false; t = 0; return true; }
    }
    return false;
  }

  // MID-CORRIDOR U-TURN: reverse heading in place, anywhere (not just at a wall).
  // Re-anchors to the neighbour ahead with t'=1-t so the WORLD position stays
  // continuous (no snap) — you pivot and run back exactly the way you came.
  // Returns false only when there's nothing behind to reverse into (e.g. facing
  // out of the entrance). The camera rig eases the heading swing.
  function turnAround() {
    const back = BACK[heading];
    if (!openDir(r, c, back)) return false;
    const [dr, dc] = DELTA[heading];
    const nr = r + dr, nc = c + dc;
    if (t > 0.001 && t < 1 && openDir(r, c, heading) && inb(nr, nc)) {
      r = nr; c = nc; t = 1 - t; heading = back;   // continuous re-anchor
    } else {
      heading = back; t = 0;                        // at a wall / cell centre: pivot in place
    }
    atWall = false;
    return true;
  }

  function worldPos() {
    const [dr, dc] = DELTA[heading];
    const cr = r + dr * t, cc = c + dc * t;      // interpolate toward the next cell
    return { x: cc * cellW, z: -cr * cellW };
  }
  function isJunction() {
    // a decision point: more than a straight-through (either a side opening exists, or it's a corner/dead-end)
    const o = openings(r, c);
    if (o.length !== 2) return true;             // dead end (1) or 3/4-way (>2)
    return !(o.includes(heading) && o.includes(BACK[heading])); // a 2-way corner counts as a turn
  }

  reset();
  return {
    reset, update, turn, turnAround, worldPos, openings, isDeadEnd, isJunction,
    headingVec: () => HVEC[heading],
    get cell() { return { r, c }; },
    get heading() { return heading; },
    get t() { return t; },
    get atWall() { return atWall; },
    get atExit() { return r === exit.r && c === exit.c; },
    get cellW() { return cellW; },
  };
}

export default createGridNav;
