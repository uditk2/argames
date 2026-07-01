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
  ctx.shadowColor = 'rgba(120,235,120,0.9)'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#7ef07e';
  ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#122a0c';
  ctx.beginPath(); ctx.arc(x, y, 2.3, 0, 7); ctx.fill();
  ctx.restore();
}

function drawArrow(ctx, x, y, heading) {
  const ang = Math.atan2(heading ? heading.z : 0, heading ? heading.x : 1);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // glowing gold disc + arrowhead pointing along travel
  ctx.shadowColor = 'rgba(255,200,80,0.95)'; ctx.shadowBlur = 9;
  ctx.fillStyle = '#1c1208';
  ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd45a';
  ctx.beginPath(); ctx.moveTo(6.5, 0); ctx.lineTo(-3.5, -4.2); ctx.lineTo(-1.2, 0); ctx.lineTo(-3.5, 4.2); ctx.closePath(); ctx.fill();
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

export function drawMinimap(ctx, {
  canvas, maze, bounds, waypoints, correctWaypoints, junctionStubs, mazeSegments, hazards, pos, heading,
}) {
  if (!ctx) return;
  const { minx, maxx, minz, maxz } = bounds;
  const MM = canvas.width;
  ctx.clearRect(0, 0, MM, MM);
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

  // 3) DEAD ENDS: a red X capping each dim dead-end stub (the wrong turns).
  const iconR = Math.max(3.2, MM * 0.03);
  if (junctionStubs && junctionStubs.length) {
    junctionStubs.forEach((st) => {
      if (st && st.length) { const e = st[st.length - 1]; drawDeadEnd(ctx, tx(e.x), tz(e.z), iconR); }
    });
  }

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
