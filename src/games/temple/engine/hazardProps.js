// ===========================================================================
// Temple Collapse — HAZARD PROPS (shared photoreal trap builders).
// ---------------------------------------------------------------------------
// One module owns the LOOK of every trap — textures, materials, meshes and
// their animation (blade swing, fire sprite-sheet) — extracted from the
// original templeEngine recipes so any engine can place them (DRY). Placement
// is delegated to the caller through a LOCAL HALL FRAME:
//   place(lx, ly, lz) -> THREE.Vector3   world position for hall-local coords
//                                        (x across, y up, z NEGATIVE = forward)
//   quat              -> THREE.Quaternion facing down the hall (forward = -z)
// so the same recipes serve the legacy linear route (unit frames) and the grid
// world (cell frames) without duplication.
//
//   createHazardProps({ THREE, scene, W, H, addTorch, addLight }) -> {
//     buildBeam(place, quat),           // fallen carved beam (JUMP, non-lethal)
//     buildBlade(place, quat, phase),   // swinging pendulum blade (DUCK, lethal)
//     buildFire(place, quat, duck),     // lion-mouth flame jet (JUMP low / DUCK high, lethal)
//     buildCrack(place, quat),          // collapsed-floor chasm (JUMP, fall)
//     update(dt, tnow),                 // advance blade swing + flame animation
//     dispose(),
//   }
// `W` = corridor width, `H` = corridor height at the placement site.
// ===========================================================================
import { ASSETS, FIRE, CRACK } from '../config.js';

const BEAM_AR = 1216 / 399;    // source aspect of the cropped carved beam
const BLADE_AR = 1084 / 895;   // source aspect of the cropped blade head

export function createHazardProps({ THREE, scene, W, H, addTorch, addLight } = {}) {
  const hw = W / 2;
  const texLoader = new THREE.TextureLoader();
  function loadKeyed(url) {
    const t = texLoader.load(url);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const beamTex = loadKeyed(ASSETS.beam);
  const bladeTex = loadKeyed(ASSETS.blade);
  const fireLionTex = loadKeyed(ASSETS.fireLion);
  const crackFloorTex = loadKeyed(ASSETS.crackFloor);
  // Animated flamethrower jet — ONE shared sprite-sheet texture whose UV offset
  // advances each frame (all jets share the animation).
  const fireSheetTex = texLoader.load(ASSETS.fireFlameSheet);
  fireSheetTex.minFilter = THREE.LinearFilter; fireSheetTex.magFilter = THREE.LinearFilter;
  if ('colorSpace' in fireSheetTex) fireSheetTex.colorSpace = THREE.SRGBColorSpace;
  fireSheetTex.wrapS = THREE.ClampToEdgeWrapping; fireSheetTex.wrapT = THREE.ClampToEdgeWrapping;
  fireSheetTex.repeat.set(1 / FIRE.cols, 1 / FIRE.rows);

  // ---- shared materials (unlit keyed planes read photoreal, like the avatar) --
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95, metalness: 0.04 });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.7, metalness: 0.8 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42 });
  const beamPlaneMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, depthWrite: true });
  const bladePlaneMat = new THREE.MeshBasicMaterial({ map: bladeTex, transparent: true, alphaTest: 0.55, side: THREE.DoubleSide, depthWrite: true });
  const fireLionMat = new THREE.MeshBasicMaterial({ map: fireLionTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const fireFlameMat = new THREE.MeshBasicMaterial({ map: fireSheetTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const crackFloorMat = new THREE.MeshBasicMaterial({ map: crackFloorTex, side: THREE.FrontSide });
  const crackVoidMat = new THREE.MeshBasicMaterial({ color: 0x04030a, side: THREE.DoubleSide });

  const blades = [];      // { pivot, phase } — animated each frame
  let fireAnimT = 0;

  // ---- BEAM: fallen carved stone beam spanning the hall, low enough to hop ----
  function buildBeam(place, quat) {
    const bw = W * 0.96;
    const bh = (bw / BEAM_AR) * 0.62;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), beamPlaneMat);
    beam.position.copy(place(0, bh / 2 + 0.05, 0)); beam.quaternion.copy(quat);
    beam.renderOrder = 4;
    scene.add(beam);
    addLight(place(0, bh + 1.2, -1.2), 0xffb050, 0.8, 9);      // warm key light on the carving
    const sh = new THREE.Mesh(new THREE.CircleGeometry(W * 0.55, 24), shadowMat);
    sh.position.copy(place(0, 0.05, 0)); sh.quaternion.copy(quat); sh.rotateX(-Math.PI / 2); sh.scale.set(1, 0.42, 1);
    scene.add(sh);
    addTorch(place(hw - 1.2, 4.4, 0), 0.55);
    addTorch(place(-(hw - 1.2), 4.4, 0), 0.55);
  }

  // ---- BLADE: pendulum blade hung from the ceiling, swings across the hall ----
  function buildBlade(place, quat, phase = 0) {
    const anchor = new THREE.Group();
    anchor.position.copy(place(0, H, 0)); anchor.quaternion.copy(quat);
    scene.add(anchor);
    const pivot = new THREE.Group(); anchor.add(pivot);
    const bladeW = 2.7, bladeH = bladeW / BLADE_AR;
    const bladeCY = -3.5;                               // disc centre -> world ~3.5 (clear duck-under)
    const chainLen = -(bladeCY + bladeH / 2);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, chainLen, 8), chainMat);
    chain.position.set(0, -chainLen / 2, 0); pivot.add(chain);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bladeW, bladeH), bladePlaneMat);
    plane.position.set(0, bladeCY, 0); plane.renderOrder = 4;
    pivot.add(plane);
    const bl = new THREE.PointLight(0xbcd0e0, 0.35, 8, 2.2);   // cool steel glint riding the swing
    bl.position.set(0, bladeCY, 0); pivot.add(bl);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 1.2), stoneMat);
    hub.position.set(0, -0.15, 0); anchor.add(hub);
    blades.push({ pivot, phase });
    addTorch(place(hw - 1.0, 4.2, 1.5), 0.85);
    addTorch(place(-(hw - 1.0), 4.2, -1.5), 0.85);
  }

  // ---- FIRE: carved lion head on the right wall + animated flame jet ----------
  function buildFire(place, quat, duck) {
    const cy = duck ? FIRE.highY : FIRE.lowY;
    const SL = FIRE.size;
    const offX = hw - SL * 0.30;
    const lionMesh = new THREE.Mesh(new THREE.PlaneGeometry(SL, SL), fireLionMat);
    lionMesh.position.copy(place(offX, cy, 0)); lionMesh.quaternion.copy(quat);
    lionMesh.renderOrder = 6; scene.add(lionMesh);
    const FW = W * FIRE.jetWFrac, FH = FW / FIRE.jetAspect;
    const flameMesh = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), fireFlameMat);
    flameMesh.position.copy(place(0, cy, 0)); flameMesh.quaternion.copy(quat);
    flameMesh.renderOrder = 7; scene.add(flameMesh);
    addLight(place(0, cy, -1.0), FIRE.light, 2.0, 18);
    addTorch(place(hw - 0.6, cy + 1.4, 0), 0.7);
  }

  // ---- CRACK: collapsed-floor chasm (photoreal decal over a recessed void) ----
  function buildCrack(place, quat) {
    const cl = CRACK.len, depth = CRACK.depth, hwv = W * 0.5;
    const DL = Math.min(cl + 5, W);   // decal length clamped to the cell so it can't bleed past a junction
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(W, DL), crackFloorMat);
    decal.position.copy(place(0, 0.04, 0)); decal.quaternion.copy(quat); decal.rotateX(-Math.PI / 2);
    decal.renderOrder = 3; scene.add(decal);
    const pushTo = (arr, a, b, c, d) => {
      const W4 = [a, b, c, d].map((p) => place(p[0], p[1], p[2]));
      arr.push(W4[0].x, W4[0].y, W4[0].z, W4[1].x, W4[1].y, W4[1].z, W4[2].x, W4[2].y, W4[2].z);
      arr.push(W4[0].x, W4[0].y, W4[0].z, W4[2].x, W4[2].y, W4[2].z, W4[3].x, W4[3].y, W4[3].z);
    };
    const zN = cl * 0.5, zF = -cl * 0.5, yB = -depth, vt = [];
    pushTo(vt, [-hwv, 0.03, zN], [hwv, 0.03, zN], [hwv, yB, zN], [-hwv, yB, zN]);   // near wall
    pushTo(vt, [-hwv, 0.03, zF], [-hwv, yB, zF], [hwv, yB, zF], [hwv, 0.03, zF]);   // far wall
    pushTo(vt, [-hwv, 0.03, zN], [-hwv, yB, zN], [-hwv, yB, zF], [-hwv, 0.03, zF]); // left wall
    pushTo(vt, [hwv, 0.03, zN], [hwv, 0.03, zF], [hwv, yB, zF], [hwv, yB, zN]);     // right wall
    pushTo(vt, [-hwv, yB, zN], [hwv, yB, zN], [hwv, yB, zF], [-hwv, yB, zF]);       // bottom
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vt), 3)); g.computeVertexNormals();
    const voidMesh = new THREE.Mesh(g, crackVoidMat); voidMesh.renderOrder = 2; scene.add(voidMesh);
    addTorch(place(hw - 1.0, 4.2, 0), 0.7);
    addTorch(place(-(hw - 1.0), 4.2, 0), 0.7);
  }

  // ---- per-frame animation (blade swing + shared flame sprite sheet) ----------
  function update(dt, tnow) {
    blades.forEach((b) => { b.pivot.rotation.z = Math.sin(tnow * 2.1 + b.phase) * 1.3; });
    fireAnimT += dt * FIRE.sheetFps;
    const fr = Math.floor(fireAnimT) % FIRE.frames;
    const col = fr % FIRE.cols, row = Math.floor(fr / FIRE.cols);
    fireSheetTex.offset.set(col / FIRE.cols, 1 - (row + 1) / FIRE.rows);
  }

  function dispose() {
    [beamTex, bladeTex, fireLionTex, crackFloorTex, fireSheetTex].forEach((t) => { try { t.dispose(); } catch { /* gone */ } });
  }

  return { buildBeam, buildBlade, buildFire, buildCrack, update, dispose };
}

export default createHazardProps;
