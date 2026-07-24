// ===========================================================================
// Temple Collapse — L6 BOULDER CHASE (the escape set-piece, its own module).
// ---------------------------------------------------------------------------
// A great stone sphere that rolls out behind the runner and chases along the
// SOLUTION PATH toward the daylight exit. It never navigates the maze — it just
// advances down the correct route at `speed` (a touch faster than the runner),
// so if you dawdle in the open route it catches and crushes you. Ducking into a
// dead end takes you OFF the route: the boulder rolls straight past the branch
// while you're tucked to the side, then you U-turn out behind it and finish.
//
//   createBoulderChase({ THREE, scene, path, cellW, H, speed, startBehind }) -> {
//     start(), update(dt, running) -> {x,z}, worldPos(), reset(), dispose(),
//     get arc, get total, get R, get gone,
//   }
// Crush is decided by the engine (world-distance to the runner) — this only moves
// and rolls the stone and reports its position.
// ===========================================================================
import { ASSETS } from '../config.js';

export function createBoulderChase({ THREE, scene, path = [], cellW = 14, H = 7, speed = 14, startBehind = 2 } = {}) {
  // path -> world points (grid cell (r,c) -> world x=c*cellW, z=-r*cellW).
  const pts = path.map((p) => new THREE.Vector3(p.c * cellW, 0, -p.r * cellW));
  if (pts.length < 2) pts.push(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 2));
  const seg = [], cum = [0];
  for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); cum.push(cum[i - 1] + d); }
  const total = cum[cum.length - 1];
  const R = cellW * 0.52;                     // nearly fills the corridor — menacing

  // rocky stone sphere (seamless wall texture, dark warm stone).
  const texLoader = new THREE.TextureLoader();
  const tex = texLoader.load(ASSETS.texWall);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 2);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x7a6650, roughness: 1.0, metalness: 0.0, emissive: 0x1a1108, emissiveIntensity: 0.4 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20), mat);
  mesh.renderOrder = 2;
  scene.add(mesh);

  const startArc = -Math.abs(startBehind) * cellW;
  let arc = startArc, rolling = false, rollAngle = 0, gone = false, crashT = -1, crashFired = false;

  function posAt(a) {
    if (a <= 0) {                              // behind the entrance — extrapolate back
      const dir = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
      return new THREE.Vector3().copy(pts[0]).addScaledVector(dir, a);
    }
    if (a >= total) return pts[pts.length - 1].clone();   // clamp at the wall it crashes into
    let i = 1; while (i < cum.length && cum[i] < a) i++;
    const t = (a - cum[i - 1]) / (seg[i - 1] || 1);
    return new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], t);
  }

  function update(dt, running) {
    if (rolling && running && !gone && crashT < 0) arc += speed * dt;
    if (arc >= total && crashT < 0) { arc = total; crashT = 0; }   // reached the wall — crash
    if (crashT >= 0) { crashT += dt; if (crashT > 1.1) { gone = true; mesh.visible = false; } }
    const p = posAt(arc);
    const bob = crashT >= 0 ? Math.max(0, 1 - crashT * 3) * R * 0.15 * Math.sin(crashT * 40) : 0;  // shudder on impact
    mesh.position.set(p.x, R * 0.9 + bob, p.z);
    const ahead = posAt(arc + 0.1), dir = new THREE.Vector3().subVectors(ahead, p);
    dir.y = 0; if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, 1);
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);
    if (crashT < 0) { rollAngle += (speed * dt) / R; mesh.quaternion.setFromAxisAngle(axis, rollAngle); }
    return { x: p.x, z: p.z };
  }

  // true exactly once, on the frame the boulder slams into the wall (engine booms).
  function takeCrash() { if (crashT >= 0 && !crashFired) { crashFired = true; return true; } return false; }

  return {
    update, takeCrash,
    start() { rolling = true; },
    reset() { arc = startArc; rolling = false; rollAngle = 0; gone = false; crashT = -1; crashFired = false; mesh.visible = true; const p = posAt(arc); mesh.position.set(p.x, R * 0.9, p.z); },
    worldPos() { const p = posAt(arc); return { x: p.x, z: p.z }; },
    get arc() { return arc; },
    get total() { return total; },
    get R() { return R; },
    get gone() { return gone; },
    dispose() { try { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); if (tex.dispose) tex.dispose(); } catch { /* gone */ } },
  };
}

export default createBoulderChase;
