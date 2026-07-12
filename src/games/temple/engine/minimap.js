// ===========================================================================
// Temple Collapse — minimap rendering (styled stone-maze HUD).
// ---------------------------------------------------------------------------
// Pure 2D rendering, NO game-state mutation. Renders the maze like a carved
// treasure map: warm parchment wash, embossed sandstone corridors, a glowing
// GOLD EXIT archway, a green START marker, red-X DEAD ENDS at each dead-end
// stub, and legend icons for every trap (beam / blade / fire / crumbling
// floor). A glowing arrow marks the player. (An ornate frame PNG is overlaid
// around the canvas by the React HUD.)
// ===========================================================================

function polyline(ctx, pts, tx, tz) {
  ctx.beginPath();
  pts.forEach((p, i) => { i ? ctx.lineTo(tx(p.x), tz(p.z)) : ctx.moveTo(tx(p.x), tz(p.z)); });
  ctx.stroke();
}

// short perpendicular "mortar" ticks along each corridor segment → tiled-block read.
function tileSeams(ctx, segs, tx, tz, step) {
  ctx.strokeStyle = 'rgba(20,12,6,0.55)';
  ctx.lineWidth = 1;
  segs.forEach((seg) => {
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = tx(seg[i].x), az = tz(seg[i].z), bx = tx(seg[i + 1].x), bz = tz(seg[i + 1].z);
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, px = -uz, pz = ux;     // unit + perpendicular
      const half = 4.5;
      for (let d = step; d < len; d += step) {
        const cx = ax + ux * d, cz = az + uz * d;
        ctx.beginPath(); ctx.moveTo(cx - px * half, cz - pz * half); ctx.lineTo(cx + px * half, cz + pz * half); ctx.stroke();
      }
    }
  });
}

// warm aged-paper wash behind the corridors so the empty space reads as a
// treasure map rather than a black box.
function parchmentFill(ctx, MM) {
  const g = ctx.createRadialGradient(MM * 0.5, MM * 0.44, MM * 0.08, MM * 0.5, MM * 0.5, MM * 0.72);
  g.addColorStop(0, 'rgba(74,54,31,0.42)');
  g.addColorStop(1, 'rgba(28,18,9,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, MM, MM);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawExit(ctx, x, y) {
  ctx.save();
  // bright halo so the goal stands out at a glance
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 16);
  halo.addColorStop(0, 'rgba(255,224,140,0.55)'); halo.addColorStop(1, 'rgba(255,210,110,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill();
  // larger glowing GOLD archway (the EXIT doorway)
  ctx.shadowColor = 'rgba(255,210,110,0.95)'; ctx.shadowBlur = 9;
  ctx.fillStyle = '#ffe6a4';
  const w = 13, h = 15;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + h / 2);
  ctx.lineTo(x - w / 2, y - h / 2 + 4);
  ctx.arc(x, y - h / 2 + 4, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // dark doorway interior
  ctx.fillStyle = 'rgba(34,18,6,0.95)';
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 3, y + h / 2);
  ctx.lineTo(x - w / 2 + 3, y - h / 2 + 6);
  ctx.arc(x, y - h / 2 + 6, w / 2 - 3, Math.PI, 0);
  ctx.lineTo(x + w / 2 - 3, y + h / 2);
  ctx.closePath(); ctx.fill();
  // "EXIT" tag
  ctx.fillStyle = '#ffe6a4'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
  ctx.fillText('EXIT', x, y - h / 2 - 3);
  ctx.restore();
}

// green "you started here" disc (matches the treasure-map START marker).
function drawStart(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(120,235,120,0.9)'; ctx.shadowBlur = 9;
  ctx.fillStyle = '#7ef07e';
  ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#122a0c';
  ctx.beginPath(); ctx.arc(x, y, 2.7, 0, 7); ctx.fill();
  ctx.restore();
}

function drawArrow(ctx, x, y, heading) {
  const ang = Math.atan2(heading ? heading.z : 0, heading ? heading.x : 1);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // HEADING CONE — a soft light-wedge ahead of the marker so facing reads at a
  // glance even at corner-HUD size (the tiny glyph alone didn't).
  const cone = ctx.createLinearGradient(0, 0, 24, 0);
  cone.addColorStop(0, 'rgba(255,212,90,0.55)'); cone.addColorStop(1, 'rgba(255,212,90,0)');
  ctx.fillStyle = cone;
  ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(24, -8.5); ctx.lineTo(24, 8.5); ctx.closePath(); ctx.fill();
  // glowing gold disc (bigger + light ring) + arrowhead pointing along travel
  ctx.shadowColor = 'rgba(255,200,80,0.95)'; ctx.shadowBlur = 10;
  ctx.fillStyle = '#1c1208';
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffe6a4'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, 7); ctx.stroke();
  ctx.fillStyle = '#ffd45a';
  ctx.beginPath(); ctx.moveTo(8.2, 0); ctx.lineTo(-4.6, -5.4); ctx.lineTo(-1.6, 0); ctx.lineTo(-4.6, 5.4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// red X at a dead-end (matches the treasure-map "DEAD END" legend).
function drawDeadEnd(ctx, x, y, r) {
  ctx.save();
  ctx.strokeStyle = '#e5493a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.restore();
}

// dark parchment chip behind a trap icon so it reads on the busy stone.
function hazChip(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(18,11,5,0.6)';
  ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 7); ctx.fill();
}

function drawFire(ctx, x, y, r) {
  hazChip(ctx, x, y, r);
  ctx.save();
  ctx.shadowColor = 'rgba(255,140,40,0.95)'; ctx.shadowBlur = 6;
  const g = ctx.createLinearGradient(x, y + r, x, y - r);
  g.addColorStop(0, '#ff6a12'); g.addColorStop(1, '#ffd23c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r, y - r * 0.1, x, y + r);
  ctx.quadraticCurveTo(x - r, y - r * 0.1, x, y - r);
  ctx.fill();
  ctx.restore();
}

function drawBlade(ctx, x, y, r) {
  hazChip(ctx, x, y, r);
  ctx.save();
  ctx.fillStyle = '#d3dae0'; ctx.strokeStyle = '#5f656d'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawBeam(ctx, x, y, r) {
  hazChip(ctx, x, y, r);
  ctx.save();
  ctx.fillStyle = '#e2a44c'; ctx.strokeStyle = '#7a5220'; ctx.lineWidth = 0.7;
  roundRect(ctx, x - r, y - r * 0.42, r * 2, r * 0.84, 1.4);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawCrack(ctx, x, y, r) {
  hazChip(ctx, x, y, r);
  ctx.save();
  ctx.strokeStyle = '#0e0904'; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r * 0.5);
  ctx.lineTo(x - r * 0.25, y);
  ctx.lineTo(x + r * 0.25, y - r * 0.45);
  ctx.lineTo(x + r, y + r * 0.55);
  ctx.stroke();
  ctx.restore();
}

const HAZ_DRAW = { beam: drawBeam, blade: drawBlade, fire: drawFire, crack: drawCrack };

// Draw the FULL grid labyrinth (every carved corridor + unmarked dead ends + loops)
// as a treasure map: this is what makes the map READ as a maze, not a spine. The
// route is NOT highlighted — the player traces it themselves. Start (green), exit
// (gold arch) and the player arrow are placed by grid cell.
// HEADING-UP variant: the whole maze is rotated about its CENTRE so the player's
// travel direction points up. The rotation basis comes from the 3D camera's own
// world axes (passed as camR/camF), so the map orientation can never disagree
// with what the player sees ahead. Ported from the level1 prototype's drawMM.
function drawGridMazeRot(ctx, MM, { grid, hazardCells, hitDeadEnds, player, camR, camF }) {
  const { cols, rows, grid: cells, entrance, exit } = grid;
  parchmentFill(ctx, MM);
  const pad = 16;
  // camera axes projected to the grid plane: world x -> +c, world z -> -r.
  const Rc = camR.x, Rr = -camR.z, Fc = camF.x, Fr = -camF.z;
  const rn = Math.hypot(Rc, Rr) || 1, fn = Math.hypot(Fc, Fr) || 1;
  const gc = (cols - 1) / 2, gr = (rows - 1) / 2;
  const span = Math.max(cols, rows);
  const s = (MM - 2 * pad) / (span * 1.42);   // fit the WHOLE maze even spun to 45°
  // grid cell (c,r) -> rotated screen point; forward -> up (the minus on y).
  const M = (c, r) => {
    const dc = c - gc, dr = r - gr;
    return [MM / 2 + (dc * Rc + dr * Rr) / rn * s, MM / 2 - (dc * Fc + dr * Fr) / fn * s];
  };
  const CW = Math.max(4, s * 0.42);

  // corridors: every open wall between adjacent cells, drawn as a rotated segment.
  const segs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cel = cells[r][c];
    if (!cel.E && c < cols - 1) segs.push([c, r, c + 1, r]);
    if (!cel.S && r < rows - 1) segs.push([c, r, c, r + 1]);
  }
  const stroke = (w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    segs.forEach(([c1, r1, c2, r2]) => { const a = M(c1, r1), b = M(c2, r2); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
    ctx.stroke();
  };
  stroke(CW + 4, '#120c07');
  stroke(CW, '#7e6038');
  stroke(CW * 0.5, 'rgba(206,176,116,0.5)');
  ctx.fillStyle = '#7e6038';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const p = M(c, r); ctx.beginPath(); ctx.arc(p[0], p[1], CW * 0.5, 0, 7); ctx.fill(); }

  const xr = Math.max(3.2, s * 0.32);
  if (hitDeadEnds && hitDeadEnds.length) hitDeadEnds.forEach((k) => { const c = k % cols, r = (k / cols) | 0; const p = M(c, r); drawDeadEnd(ctx, p[0], p[1], xr); });
  if (hazardCells && hazardCells.length) {
    const hr = Math.max(3.2, s * 0.4);
    ['crack', 'beam', 'blade', 'fire'].forEach((kind) => { hazardCells.forEach((h) => { if (h.type === kind && HAZ_DRAW[kind]) { const p = M(h.c, h.r); HAZ_DRAW[kind](ctx, p[0], p[1], hr); } }); });
  }
  const pe = M(exit.c, exit.r), ps = M(entrance.c, entrance.r);
  drawExit(ctx, pe[0], pe[1]);
  drawStart(ctx, ps[0], ps[1]);
  // player: live navigated position + heading, both rotated (heading resolves to up).
  const pC = player.c + (player.dc || 0) * (player.t || 0);
  const pR = player.r + (player.dr || 0) * (player.t || 0);
  const pp = M(pC, pR);
  const hx = player.dc || 0, hr2 = player.dr || 0;
  const sx = (hx * Rc + hr2 * Rr) / rn, sy = -(hx * Fc + hr2 * Fr) / fn;
  drawArrow(ctx, pp[0], pp[1], { x: sx, z: sy });
}

function drawGridMaze(ctx, MM, view) {
  // HEADING-UP: when the camera axes are supplied, rotate the WHOLE map so travel
  // is up (prototype parity). Otherwise fall back to the static north-up map.
  if (view.camR && view.camF) { drawGridMazeRot(ctx, MM, view); return; }
  const { grid, path, progress, hazardCells, hitDeadEnds, player } = view;
  const { cols, rows, grid: cells, entrance, exit } = grid;
  parchmentFill(ctx, MM);
  const pad = 15;
  const cw = (MM - 2 * pad) / cols, ch = (MM - 2 * pad) / rows;
  const cx = (c) => pad + (c + 0.5) * cw;
  const cy = (r) => pad + (r + 0.5) * ch;
  const CW = Math.max(4.5, Math.min(cw, ch) * 0.4);

  // North-up map (no heading rotation). PLAYER marker:
  //   • grid engine passes `player` { r, c, t, dc, dr } — the LIVE navigated cell
  //     (t = fraction toward the next cell, dc/dr = heading in grid space), so the
  //     arrow follows the player anywhere in the labyrinth (wrong turns included);
  //   • legacy engine passes `progress` — interpolated along the solution path.
  let pC, pR, hd;
  if (player) {
    pC = player.c + (player.dc || 0) * (player.t || 0);
    pR = player.r + (player.dr || 0) * (player.t || 0);
    hd = { x: player.dc || 0, z: player.dr || 0 };
  } else {
    const n = path ? path.length : 1;
    const fpos = Math.max(0, Math.min(n - 1, (progress || 0) * (n - 1)));
    const pi = Math.floor(fpos), frac = fpos - pi;
    const pc = (path && path[pi]) || entrance, pn = (path && path[Math.min(n - 1, pi + 1)]) || pc;
    pC = pc.c + (pn.c - pc.c) * frac; pR = pc.r + (pn.r - pc.r) * frac;
    hd = { x: pn.c - pc.c, z: pn.r - pc.r };
  }

  const segs = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cel = cells[r][c];
    if (!cel.E && c < cols - 1) segs.push([cx(c), cy(r), cx(c + 1), cy(r)]);
    if (!cel.S && r < rows - 1) segs.push([cx(c), cy(r), cx(c), cy(r + 1)]);
  }
  const stroke = (w, col, dy) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    segs.forEach(([ax, ay, bx, by]) => { ctx.moveTo(ax, ay + (dy || 0)); ctx.lineTo(bx, by + (dy || 0)); });
    ctx.stroke();
  };
  stroke(CW + 4, '#120c07', 0);
  stroke(CW, '#7e6038', 0);
  stroke(CW * 0.5, 'rgba(206,176,116,0.5)', -1.2);
  ctx.fillStyle = '#7e6038';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { ctx.beginPath(); ctx.arc(cx(c), cy(r), CW * 0.5, 0, 7); ctx.fill(); }
  // discovered dead ends only (a red-X appears once you've run into that cell)
  const xr = Math.max(3.6, Math.min(cw, ch) * 0.17);
  if (hitDeadEnds && hitDeadEnds.length) hitDeadEnds.forEach((k) => { const c = k % cols, r = (k / cols) | 0; drawDeadEnd(ctx, cx(c), cy(r), xr); });
  if (hazardCells && hazardCells.length) {
    const hr = Math.max(3.6, Math.min(cw, ch) * 0.19);
    ['crack', 'beam', 'blade', 'fire'].forEach((kind) => { hazardCells.forEach((h) => { if (h.type === kind && HAZ_DRAW[kind]) HAZ_DRAW[kind](ctx, cx(h.c), cy(h.r), hr); }); });
  }
  drawExit(ctx, cx(exit.c), cy(exit.r));
  drawStart(ctx, cx(entrance.c), cy(entrance.r));
  drawArrow(ctx, cx(pC), cy(pR), hd);
}

export function drawMinimap(ctx, opts) {
  if (!ctx) return;
  const { canvas, maze, bounds, waypoints, correctWaypoints, junctionStubs, mazeSegments, hazards, pos, heading, gridView } = opts;
  // CRISP AT ANY SIZE: all layout below is in 190 LOGICAL units; the canvas backing
  // store can be larger (e.g. 380 for the study panel) and we scale the transform —
  // vectors rasterize at full backing resolution, so no blurry 190px upscale.
  const MM = 190;
  const S = (canvas.width || MM) / MM;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, MM, MM);
  if (gridView && gridView.grid) { drawGridMaze(ctx, MM, gridView); return; }
  const { minx, maxx, minz, maxz } = bounds;
  parchmentFill(ctx, MM);
  const pad = 18, sc = Math.min((MM - 2 * pad) / ((maxx - minx) || 1), (MM - 2 * pad) / ((maxz - minz) || 1));
  const tx = (x) => pad + (x - minx) * sc, tz = (z) => pad + (z - minz) * sc;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // The WHOLE level map is always shown (the full route start→exit), so the player can
  // see where to go from the very start — not just the segment they're standing on.
  const routeWP = (correctWaypoints && correctWaypoints.length) ? correctWaypoints : waypoints;
  const usingTriples = !!(mazeSegments && mazeSegments.length);
  const segs = (maze && usingTriples) ? mazeSegments : [routeWP];

  const CW = 11;   // corridor block width (px)
  // 1) carved-stone corridors: dark outer edge -> warm stone fill -> top bevel highlight.
  ctx.strokeStyle = '#120c07'; ctx.lineWidth = CW + 4; segs.forEach((s) => polyline(ctx, s, tx, tz));
  ctx.strokeStyle = '#7e6038'; ctx.lineWidth = CW; segs.forEach((s) => polyline(ctx, s, tx, tz));
  ctx.save(); ctx.translate(0, -1.3);
  ctx.strokeStyle = 'rgba(206,176,116,0.55)'; ctx.lineWidth = CW * 0.46; segs.forEach((s) => polyline(ctx, s, tx, tz));
  ctx.restore();
  // 2) mortar seams (tiled-block read).
  tileSeams(ctx, segs, tx, tz, CW * 1.05);

  // 3) DEAD ENDS are drawn as ordinary corridors (above) — NOT marked. The maze
  //    reads as one interconnected labyrinth and the player must trace the route
  //    themselves; wrong turns are discovered, not flagged.
  const iconR = Math.max(3.2, MM * 0.03);

  // 4) TRAP ICONS: drop a legend icon on every placed hazard along the route
  //    (crack first, then beam/blade/fire so the brighter icons sit on top).
  if (hazards) {
    ['crack', 'beam', 'blade', 'fire'].forEach((kind) => {
      const draw = HAZ_DRAW[kind]; const list = hazards[kind];
      if (draw && list) list.forEach((h) => draw(ctx, tx(h.x), tz(h.z), iconR));
    });
  }

  // 5) EXIT archway, START disc, and the player arrow ("you are here").
  const ex = (routeWP && routeWP.length) ? routeWP[routeWP.length - 1] : null;
  if (ex) drawExit(ctx, tx(ex.x), tz(ex.z));
  const st0 = (routeWP && routeWP.length) ? routeWP[0] : null;
  if (st0) drawStart(ctx, tx(st0.x), tz(st0.z));
  drawArrow(ctx, tx(pos.x), tz(pos.z), heading);
}

export default drawMinimap;
