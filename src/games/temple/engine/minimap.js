// ===========================================================================
// Temple Dash — minimap rendering (styled stone-maze HUD).
// ---------------------------------------------------------------------------
// Pure 2D rendering, NO game-state mutation. Renders the maze like a carved
// stone map: embossed sandstone corridors, a glowing GOLD route to the exit,
// dim dead-end branches, an EXIT archway marker and a glowing arrow for the
// player. (An ornate frame PNG is overlaid around the canvas by the React HUD.)
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

export function drawMinimap(ctx, {
  canvas, maze, bounds, waypoints, correctWaypoints, junctionStubs, mazeSegments, pos, heading,
}) {
  if (!ctx) return;
  const { minx, maxx, minz, maxz } = bounds;
  const MM = canvas.width;
  ctx.clearRect(0, 0, MM, MM);
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

  // 3) EVERY corridor is drawn the SAME (no highlighted "solution" route) — the player
  //    reads the map and decides the way themselves. Only the EXIT and the player are
  //    marked: a glowing gold ARCHWAY at the goal, and the player ARROW for "you are here".
  const ex = (routeWP && routeWP.length) ? routeWP[routeWP.length - 1] : null;
  if (ex) drawExit(ctx, tx(ex.x), tz(ex.z));
  drawArrow(ctx, tx(pos.x), tz(pos.z), heading);
}

export default drawMinimap;
