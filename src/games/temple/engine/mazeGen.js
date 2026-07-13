// ===========================================================================
// Temple Collapse — GRID MAZE GENERATION + AUTO-PACING (framework-free).
// ---------------------------------------------------------------------------
// Produces a TRUE interconnected grid maze (not a single spine): a perfect maze
// carved by randomized DFS, then partially "braided" so some dead ends open into
// loops — giving MULTIPLE plausible routes plus genuine (unmarked) dead ends. A
// solution always exists (the carve fully connects the grid).
//
// It also solves the pacing problem the design flagged: longer routes take
// longer to run, so a fixed collapse timer would make bigger mazes impossible.
// Instead we DERIVE the timer from the maze's own shortest path:
//
//     collapseTime = (shortestPathLen / runSpeed) * margin + readingBuffer
//
// so every generated maze is completable BY CONSTRUCTION, regardless of size.
// Size, run speed and margin ramp per level (calm L1 -> tense L6).
//
// This module is pure data (no three.js): it emits a maze the corridor builder
// and minimap can both consume, plus the derived level params.
// ===========================================================================

import { GRID } from '../config.js';

// deterministic PRNG so a level (or a daily seed) is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [['N', -1, 0, 'S'], ['S', 1, 0, 'N'], ['E', 0, 1, 'W'], ['W', 0, -1, 'E']];
const key = (cols, r, c) => r * cols + c;

// ---- generation -----------------------------------------------------------
// braid: 0 = perfect maze (max dead ends, one route). 1 = every dead end opened
// (many loops, few dead ends). ~0.35–0.5 = a readable labyrinth with both.
export function generateMaze({ cols, rows, braid = 0.4, seed = 1 } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ r, c, N: true, E: true, S: true, W: true, v: false })));
  const inb = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

  // randomized DFS (recursive backtracker) — perfect maze, fully connected.
  const stack = [grid[rows - 1][0]];
  grid[rows - 1][0].v = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nbrs = [];
    for (const [d, dr, dc, opp] of DIRS) {
      const nr = cur.r + dr, nc = cur.c + dc;
      if (inb(nr, nc) && !grid[nr][nc].v) nbrs.push([d, nr, nc, opp]);
    }
    if (!nbrs.length) { stack.pop(); continue; }
    const [d, nr, nc, opp] = nbrs[(rnd() * nbrs.length) | 0];
    cur[d] = false; grid[nr][nc][opp] = false; grid[nr][nc].v = true;
    stack.push(grid[nr][nc]);
  }

  // braid: open some dead ends into loops -> multiple plausible routes.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cel = grid[r][c];
    const wallCount = ['N', 'E', 'S', 'W'].reduce((n, w) => n + (cel[w] ? 1 : 0), 0);
    if (wallCount >= 3 && rnd() < braid) {              // it's a dead end
      const opts = [];
      for (const [d, dr, dc, opp] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (inb(nr, nc) && cel[d]) opts.push([d, nr, nc, opp]);
      }
      if (opts.length) {
        const [d, nr, nc, opp] = opts[(rnd() * opts.length) | 0];
        cel[d] = false; grid[nr][nc][opp] = false;
      }
    }
  }

  return { cols, rows, grid, entrance: { r: rows - 1, c: 0 }, exit: { r: 0, c: cols - 1 } };
}

// ---- generation: Kruskal's -------------------------------------------------
// Randomized Kruskal (union-find over the interior walls) — a uniform, unbiased
// perfect maze: branchier / more junctions than DFS (which snakes long corridors),
// so there are more "which way?" decisions. Then braided the same way to open some
// dead ends into loops, which is what creates MULTIPLE routes to the exit.
export function generateMazeKruskal({ cols, rows, braid = 0.4, seed = 1 } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ r, c, N: true, E: true, S: true, W: true })));
  const inb = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

  // union-find
  const parent = new Array(rows * cols).fill(0).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  // all interior walls (each as an edge between two cells) — only E and S to avoid dupes.
  const edges = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c < cols - 1) edges.push([r, c, 'E', r, c + 1, 'W']);
    if (r < rows - 1) edges.push([r, c, 'S', r + 1, c, 'N']);
  }
  // seeded shuffle
  for (let i = edges.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [edges[i], edges[j]] = [edges[j], edges[i]]; }
  for (const [r, c, d, nr, nc, opp] of edges) {
    if (find(r * cols + c) !== find(nr * cols + nc)) {
      grid[r][c][d] = false; grid[nr][nc][opp] = false;
      union(r * cols + c, nr * cols + nc);
    }
  }

  // braid: open some dead ends -> loops -> multiple routes.
  const DIRS2 = [['N', -1, 0, 'S'], ['S', 1, 0, 'N'], ['E', 0, 1, 'W'], ['W', 0, -1, 'E']];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cel = grid[r][c];
    const wallCount = ['N', 'E', 'S', 'W'].reduce((n, w) => n + (cel[w] ? 1 : 0), 0);
    if (wallCount >= 3 && rnd() < braid) {
      const opts = [];
      for (const [d, dr, dc, opp] of DIRS2) { const nr = r + dr, nc = c + dc; if (inb(nr, nc) && cel[d]) opts.push([d, nr, nc, opp]); }
      if (opts.length) { const [d, nr, nc, opp] = opts[(rnd() * opts.length) | 0]; cel[d] = false; grid[nr][nc][opp] = false; }
    }
  }
  return { cols, rows, grid, entrance: { r: rows - 1, c: 0 }, exit: { r: 0, c: cols - 1 } };
}

// ---- solving --------------------------------------------------------------
// BFS shortest path entrance->exit (the "optimal route" used for pacing).
export function solvePath(maze) {
  const { cols, rows, grid, entrance, exit } = maze;
  const prev = new Map();
  prev.set(key(cols, entrance.r, entrance.c), null);
  const q = [entrance];
  while (q.length) {
    const cur = q.shift();
    if (cur.r === exit.r && cur.c === exit.c) break;
    for (const [d, dr, dc] of DIRS) {
      if (grid[cur.r][cur.c][d]) continue;             // wall between cells
      const nr = cur.r + dr, nc = cur.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const k = key(cols, nr, nc);
      if (prev.has(k)) continue;
      prev.set(k, { r: cur.r, c: cur.c });
      q.push({ r: nr, c: nc });
    }
  }
  const path = [];
  let cur = { r: exit.r, c: exit.c };
  while (cur) { path.push(cur); cur = prev.get(key(cols, cur.r, cur.c)); }
  return path.reverse();
}

// ---- route enumeration (for percentile pacing) ----------------------------
// Enumerate simple (no-repeat-cell) routes entrance->exit and return their step
// lengths, sorted ascending. Capped so a densely-braided maze can't explode.
// This is how we implement "the shortest N% of routes must be winnable": pick the
// route length at the Nth percentile as the pacing target.
export function routeLengths(maze, { cap = 20000, maxLen = 0 } = {}) {
  const { cols, rows, grid, entrance, exit } = maze;
  const limit = maxLen || cols * rows;         // don't chase absurdly long meanders
  const lengths = [];
  const seen = new Uint8Array(rows * cols);
  const DIRS2 = [['N', -1, 0], ['S', 1, 0], ['E', 0, 1], ['W', 0, -1]];
  function dfs(r, c, len) {
    if (lengths.length >= cap || len > limit) return;
    if (r === exit.r && c === exit.c) { lengths.push(len); return; }
    seen[r * cols + c] = 1;
    for (const [d, dr, dc] of DIRS2) {
      if (grid[r][c][d]) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (seen[nr * cols + nc]) continue;
      dfs(nr, nc, len + 1);
    }
    seen[r * cols + c] = 0;
  }
  dfs(entrance.r, entrance.c, 0);
  lengths.sort((a, b) => a - b);
  return lengths;
}

// length (steps) of the route at the given percentile (0..1) — the LONGEST route
// still inside "the shortest pct fraction". budget is derived from this so exactly
// that fraction of routes are winnable.
export function routePercentileSteps(lengths, pct) {
  if (!lengths.length) return 0;
  const i = Math.max(0, Math.min(lengths.length - 1, Math.ceil(pct * lengths.length) - 1));
  return lengths[i];
}

// count dead ends (cells with 3 walls) and derive a rough loop count (extra
// passages beyond a spanning tree) — useful for reporting / tuning.
export function mazeStats(maze) {
  const { cols, rows, grid } = maze;
  let deadEnds = 0, passages = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cel = grid[r][c];
    const open = 4 - ['N', 'E', 'S', 'W'].reduce((n, w) => n + (cel[w] ? 1 : 0), 0);
    if (open === 1) deadEnds++;
    if (!cel.E && c < cols - 1) passages++;
    if (!cel.S && r < rows - 1) passages++;
  }
  const cells = cols * rows;
  const loops = passages - (cells - 1);                // edges beyond a tree = independent loops
  return { deadEnds, loops: Math.max(0, loops), cells };
}

// ---- pacing (route-percentile) --------------------------------------------
// Budget = enough time to complete any route in the SHORTEST `routePct` fraction,
// and no more — so the longer routes trap you. routePct shrinks per level.
//   targetSteps = route length at the routePct percentile
//   collapse    = (targetSteps*cellLen)/runSpeed  (running time for that route)
// The collapse timer is PAUSED during startGrace (free auto-run) — the engine
// already subtracts that. Reading time (studying the map before the run) is a
// SEPARATE, timer-off phase (readTime) so the tight budget stays fair.
export function computeRoutePacing({ lengths, routePct, cellLen, runSpeed, slack = 0.15, reaction = 2 }) {
  const targetSteps = routePercentileSteps(lengths, routePct);
  const shortest = lengths.length ? lengths[0] : 0;
  const targetLen = targetSteps * cellLen;
  const targetTime = targetLen / runSpeed;
  // `slack` = reaction/hazard overhead so the allowed route is completable with real
  // play (not frame-perfect); it ramps DOWN per level. The routePct is the design
  // lever (which routes win); slack just keeps that route humanly runnable.
  const collapseTime = Math.round(targetTime * (1 + slack) + reaction);
  return {
    routes: lengths.length, shortestSteps: shortest, targetSteps,
    targetTime: +targetTime.toFixed(1), collapseTime,
  };
}

// ---- per-level ramp -------------------------------------------------------
// Size/speed grow; routePct (fraction of routes that stay winnable) SHRINKS from
// 40% (L1, forgiving) toward ~12% (L6, only near-optimal routing survives). readTime
// = seconds to study the map before the run (bigger early so it isn't too tough).
export const LEVEL_MAZE = [
  { cols: 4, rows: 4, braid: 0.45, runSpeed: 8,  routePct: 0.40, slack: 0.28, cellLen: 22, readTime: 5, grace: 6, ending: 'door',     hazards: [] },                               // L1 calm
  { cols: 5, rows: 4, braid: 0.48, runSpeed: 9,  routePct: 0.33, slack: 0.24, cellLen: 22, readTime: 5, grace: 5, ending: 'door',     hazards: ['blade'] },                          // L2 — teaches DUCK (blades only)
  { cols: 5, rows: 5, braid: 0.50, runSpeed: 10, routePct: 0.27, slack: 0.20, cellLen: 21, readTime: 4, grace: 5, ending: 'door',     hazards: ['blade', 'beam', 'crack'] },         // L3 — adds JUMP (beams + cracked floor); duck retained
  { cols: 6, rows: 5, braid: 0.52, runSpeed: 11, routePct: 0.22, slack: 0.16, cellLen: 21, readTime: 4, grace: 4, ending: 'door',     hazards: ['beam', 'blade', 'crack', 'fire'] },// L4
  { cols: 6, rows: 6, braid: 0.55, runSpeed: 11, routePct: 0.17, slack: 0.12, cellLen: 20, readTime: 4, grace: 4, ending: 'artifact', hazards: ['beam', 'blade', 'crack', 'fire'] },// L5 (artifact)
  { cols: 7, rows: 6, braid: 0.58, runSpeed: 13, routePct: 0.12, slack: 0.10, cellLen: 20, readTime: 3, grace: 3, ending: 'exit',     hazards: ['beam', 'blade', 'crack', 'fire'] },// L6 (escape)
];

// ---- adapter: grid maze -> engine route -----------------------------------
// The corridor engine consumes a `junctions` chain (auto-run, turn-at-junction).
// We walk the maze's SHORTEST solution and emit a junction at every TURN, merging
// straight runs into the hall length — so the 3D route TRACES the real labyrinth
// (organic turn pattern + hall lengths), not a regular spine. Hazards from the
// level's set are sprinkled along it deterministically.
const ORDER = ['N', 'E', 'S', 'W'];
function dirOf(a, b) {
  if (b.r < a.r) return 'N'; if (b.r > a.r) return 'S';
  if (b.c > a.c) return 'E'; if (b.c < a.c) return 'W'; return null;
}
function relTurn(h, d) {                       // 'S'(straight) | 'R' | 'L' | 'B'(back)
  const diff = (ORDER.indexOf(d) - ORDER.indexOf(h) + 4) % 4;
  return diff === 0 ? 'S' : diff === 1 ? 'R' : diff === 2 ? 'B' : 'L';
}
export function mazeToJunctions(path, { cellLen, hazards = [], seed = 1 }) {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const out = [];
  if (!path || path.length < 2) return out;
  let heading = dirOf(path[0], path[1]);
  let run = 1;                                  // cells travelled straight since the last turn
  const pushJ = (correct) => {
    const len = Math.max(18, Math.round(run * cellLen));
    const hz = [];
    if (hazards.length && out.length >= 1) {     // no hazards on the very first hall (ramp-in)
      const n = rnd() < 0.30 ? 2 : rnd() < 0.80 ? 1 : 0;
      const used = new Set();
      for (let k = 0; k < n; k++) {
        const t = hazards[(rnd() * hazards.length) | 0];
        if (used.has(t)) continue; used.add(t);
        const at = +(0.3 + rnd() * 0.42).toFixed(2);
        const h = { type: t, at };
        if (t === 'fire') h.mode = rnd() < 0.5 ? 'jump' : 'duck';
        hz.push(h);
      }
      hz.sort((a, b) => a.at - b.at);
    }
    out.push({ correct, len, hazards: hz });
  };
  for (let i = 1; i < path.length - 1; i++) {
    const d = dirOf(path[i], path[i + 1]);
    const r = relTurn(heading, d);
    if (r === 'S') { run++; }
    else if (r === 'L' || r === 'R') { pushJ(r); heading = d; run = 1; }
    else { run++; }                              // 'B' shouldn't occur on a shortest path
  }
  return out;
}

// Map each junction's hazards back onto GRID CELLS (for the minimap's trap icons).
// Replays the same straight-run walk as mazeToJunctions: hall k = the straight run
// of cells ending at turn k; a hazard at fraction `at` of hall k sits ~at% along
// that run. Approximate on purpose — these are map legend icons, not colliders.
export function hazardCellsFor(path, junctions) {
  if (!path || path.length < 2 || !junctions || !junctions.length) return [];
  const segs = [];
  let heading = dirOf(path[0], path[1]);
  let seg = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const d = dirOf(path[i], path[i + 1]);
    const r = relTurn(heading, d);
    seg.push(path[i]);
    if (r === 'L' || r === 'R') { segs.push(seg); heading = d; seg = [path[i]]; }
  }
  seg.push(path[path.length - 1]); segs.push(seg);
  const out = [];
  junctions.forEach((j, k) => {
    const cells = segs[k] || segs[segs.length - 1];
    (j.hazards || []).forEach((h) => {
      const idx = Math.max(0, Math.min(cells.length - 1, Math.round(h.at * (cells.length - 1))));
      out.push({ type: h.type, r: cells[idx].r, c: cells[idx].c });
    });
  });
  return out;
}

// ---- GRID-CELL hazard placement (the grid engine's traps) -------------------
// Places the level's hazard set directly onto SOLUTION-PATH CELLS of the grid —
// the same cells the 3D world builds corridors for and the minimap draws icons
// on, so world/map/trap data can never disagree. Rules:
//   • straight-through cells only (a trap spanning a junction would be unfair
//     and the props are built to span a single corridor axis);
//   • skips the entrance run-up (everything reachable inside startGrace);
//   • breathing room (>= 3 cells) between consecutive traps;
//   • deterministic per level seed.
// Emits [{ type, r, c, dir, mode? }] — `dir` is the along-corridor travel
// direction (orients the 3D prop), `mode` picks jump/duck for fire jets.
const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
export function placeGridHazards(path, maze, { hazards = [], seed = 1, cellW = GRID.cellW, runSpeed = 9, grace = 4 } = {}) {
  if (!hazards.length || !path || path.length < 5) return [];
  const rnd = mulberry32((seed ^ 0x51d7348d) >>> 0);
  const grid = maze.grid;
  const open = (cel) => ['N', 'E', 'S', 'W'].filter((d) => !cel[d]);
  // keep the OPENING stretch clean (reaction room out of the entrance) — half the
  // grace run at speed, min 2 cells. Solution paths are short (7-12 cells), so a
  // full-grace skip would starve the level of traps entirely.
  const graceCells = Math.max(2, Math.ceil((runSpeed * grace * 0.5) / cellW));
  const out = [];
  let lastIdx = -99;
  for (let i = 1; i < path.length - 1; i++) {
    if (i < graceCells) continue;
    if (i - lastIdx < 2) continue;                          // breathing room between traps
    const dPrev = dirOf(path[i - 1], path[i]), dNext = dirOf(path[i], path[i + 1]);
    if (dPrev !== dNext) continue;                          // straight-through only (no traps on turns)
    const cel = grid[path[i].r][path[i].c];
    const o = open(cel);
    if (o.length > 3) continue;                             // full crossroads stay clean
    // per-type eligibility (braided Kruskal mazes have few strictly-2-open cells):
    //   • crack needs a fully-walled hall (its void box spans the cell floor);
    //   • fire needs the lion's mounting wall (right of travel) to be CLOSED;
    //   • beam/blade span the through axis and read fine past one side opening.
    const allowed = hazards.filter((t) => (
      t === 'crack' ? o.length === 2
        : t === 'fire' ? !!cel[RIGHT_OF[dNext]]
          : true));
    if (!allowed.length) continue;
    if (rnd() >= 0.75) continue;                            // most eligible cells carry a trap
    const type = allowed[(rnd() * allowed.length) | 0];
    const h = { type, r: path[i].r, c: path[i].c, dir: dNext };
    if (type === 'fire') h.mode = rnd() < 0.5 ? 'jump' : 'duck';
    out.push(h); lastIdx = i;
  }
  return out;
}

// Full engine map object for a level, generated from a real grid labyrinth.
// The GRID ENGINE consumes .grid (world + minimap + navigation) and
// .hazardCells (traps); .junctions is kept for the LEGACY linear engine only.
export function buildEngineMap(levelIndex, seedOverride) {
  const L = generateTempleLevel(levelIndex, seedOverride);
  const cfg = L.cfg;
  const junctions = mazeToJunctions(L.path, { cellLen: cfg.cellLen, hazards: cfg.hazards, seed: L.seed });
  return {
    mode: 'maze',
    ending: cfg.ending,
    params: {
      hallWidth: 12, hallHeight: 7, exitLen: 18, cellW: GRID.cellW,
      runSpeed: cfg.runSpeed, startGrace: cfg.grace,
      collapseTime: L.pacing.collapseTime, readTime: cfg.readTime, ending: cfg.ending,
    },
    junctions,           // LEGACY linear-route chain (templeEngine only)
    grid: L.maze,        // full labyrinth (cells + walls): world + minimap + nav
    path: L.path,        // shortest solution (entrance -> exit) for pacing/reference
    // grid-cell traps: 3D props (grid engine) AND minimap icons from ONE list.
    hazardCells: placeGridHazards(L.path, L.maze, {
      hazards: cfg.hazards, seed: L.seed, runSpeed: cfg.runSpeed, grace: cfg.grace,
    }),
    _meta: { seed: L.seed, routes: L.pacing.routes, stats: L.stats },
  };
}

// Build everything for a level: the maze (Kruskal + braid for multiple routes),
// its shortest solution, the full route-length distribution, stats, and the
// route-percentile pacing (collapseTime, runSpeed, readTime). seed defaults to a
// stable per-level value so builds are reproducible (pass a daily seed later).
export function generateTempleLevel(levelIndex, seedOverride) {
  const cfg = LEVEL_MAZE[Math.max(0, Math.min(LEVEL_MAZE.length - 1, levelIndex))];
  const seed = seedOverride != null ? seedOverride : (levelIndex + 1) * 1013904223;
  const maze = generateMazeKruskal({ cols: cfg.cols, rows: cfg.rows, braid: cfg.braid, seed });
  const path = solvePath(maze);
  const lengths = routeLengths(maze);
  const stats = mazeStats(maze);
  // Pacing uses the GRID world scale (GRID.cellW — what the runtime engine
  // actually builds), NOT cfg.cellLen (legacy hall length for the linear route),
  // so the collapse budget matches the distance the player really runs.
  const pacing = computeRoutePacing({ lengths, routePct: cfg.routePct, slack: cfg.slack, cellLen: GRID.cellW, runSpeed: cfg.runSpeed });
  return { levelIndex, seed, cfg, maze, path, lengths, stats, pacing, readTime: cfg.readTime };
}

// ---- ASCII (debug / validation) -------------------------------------------
export function toAscii(maze, path) {
  const { cols, rows, grid } = maze;
  const onPath = new Set((path || []).map((p) => key(cols, p.r, p.c)));
  let out = '+' + '---+'.repeat(cols) + '\n';
  for (let r = 0; r < rows; r++) {
    let top = '|', bot = '+';
    for (let c = 0; c < cols; c++) {
      const cel = grid[r][c];
      const isE = maze.entrance.r === r && maze.entrance.c === c;
      const isX = maze.exit.r === r && maze.exit.c === c;
      const mark = isE ? ' S ' : isX ? ' X ' : onPath.has(key(cols, r, c)) ? ' . ' : '   ';
      top += mark + (cel.E ? '|' : ' ');
      bot += (cel.S ? '---' : '   ') + '+';
    }
    out += top + '\n' + bot + '\n';
  }
  return out;
}

export default { generateMaze, generateMazeKruskal, solvePath, routeLengths, routePercentileSteps, mazeStats, computeRoutePacing, generateTempleLevel, toAscii, LEVEL_MAZE };
