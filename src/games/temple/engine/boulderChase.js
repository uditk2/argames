// ===========================================================================
// Temple Collapse — L6 BOULDER CHASE (logic only; drawn as a 2D overlay).
// ---------------------------------------------------------------------------
// A great stone sphere rolls STRAIGHT down the entrance corridor behind the
// runner and can't turn: your escape route turns off the maze, so it smashes into
// the wall ahead and crashes (never reaches the exit). This module owns only its
// POSITION along that straight run + the crash — it has no 3D mesh. The boulder is
// drawn by the engine as the ornate boulder_hero image peeking up from the bottom
// of the screen (behind you, so a 3D sphere would be behind the camera), rising as
// it closes in. Crush is the engine's call (world-distance to the runner).
//
//   createBoulderChase({ path, cellW, speed, startBehind }) -> {
//     start(), update(dt, running) -> {x,z}, worldPos(), takeCrash(), reset(),
//     get gone, get arc, get total, dispose(),
//   }
// `path` = the STRAIGHT run of cells from the entrance to the wall it crashes into.
// ===========================================================================

export function createBoulderChase({ path = [], cellW = 14, speed = 14, startBehind = 4 } = {}) {
  const pts = path.map((p) => ({ x: p.c * cellW, z: -p.r * cellW }));
  if (pts.length < 2) pts.push({ x: 0, z: 0 }, { x: 0, z: cellW });
  const seg = [], cum = [0];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); seg.push(d); cum.push(cum[i - 1] + d); }
  const total = cum[cum.length - 1];
  const startArc = -Math.abs(startBehind) * cellW;
  let arc = startArc, rolling = false, gone = false, crashT = -1, crashFired = false;

  function posAt(a) {
    if (a <= 0) { const dx = pts[1].x - pts[0].x, dz = pts[1].z - pts[0].z, L = Math.hypot(dx, dz) || 1; return { x: pts[0].x + (dx / L) * a, z: pts[0].z + (dz / L) * a }; }
    if (a >= total) return { x: pts[pts.length - 1].x, z: pts[pts.length - 1].z };
    let i = 1; while (i < cum.length && cum[i] < a) i++;
    const t = (a - cum[i - 1]) / (seg[i - 1] || 1);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
  }

  function update(dt, running) {
    if (rolling && running && !gone && crashT < 0) arc += speed * dt;
    if (arc >= total && crashT < 0) { arc = total; crashT = 0; }   // hit the wall — crash
    if (crashT >= 0) { crashT += dt; if (crashT > 0.8) gone = true; }
    return posAt(arc);
  }
  function takeCrash() { if (crashT >= 0 && !crashFired) { crashFired = true; return true; } return false; }

  return {
    update, takeCrash,
    start() { rolling = true; },
    reset() { arc = startArc; rolling = false; gone = false; crashT = -1; crashFired = false; },
    worldPos() { return posAt(arc); },
    get gone() { return gone; },
    get arc() { return arc; },
    get total() { return total; },
    dispose() { /* nothing to free — no 3D mesh */ },
  };
}

export default createBoulderChase;
