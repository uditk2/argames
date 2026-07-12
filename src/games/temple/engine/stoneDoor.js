// ===========================================================================
// Temple Collapse — STONE DOOR (the 'door' level ending, its own module).
// ---------------------------------------------------------------------------
// A carved slab that DESCENDS across the exit as the collapse timer drains. To
// escape you DUCK under it; it never fully closes (the gap floors at duckGap),
// so even at the last second it's still duck-able. Extracted from templeEngine
// so both engines share ONE door implementation.
//
//   createStoneDoor({ THREE, scene, pos, dirVec, W, H }) -> {
//     update(prog),        // 0..1 collapse progress -> lower the slab
//     tryPass(ducking),    // at the door: true = through (latches), false = blocked
//     get lowGap,          // true once the gap needs a duck (cue trigger)
//     get passed,
//     reset(),
//   }
// `pos` = world position of the door plane, `dirVec` = outward corridor
// direction (the plane is perpendicular to it).
// ===========================================================================
import { ASSETS } from '../config.js';

export function createStoneDoor({ THREE, scene, pos, dirVec, W, H } = {}) {
  const DOOR = {
    openGap: H * 0.92,       // gap under the door when the timer is full (walk through)
    duckGap: H * 0.34,       // gap when fully descended (must duck; never lower)
    needGap: H * 0.66,       // below this you MUST be ducking to pass
  };
  const DOOR_H = H * 1.4;    // tall so its top hides above the ceiling

  const texLoader = new THREE.TextureLoader();
  const doorTex = texLoader.load(ASSETS.texWall);
  doorTex.wrapS = doorTex.wrapT = THREE.RepeatWrapping; doorTex.repeat.set(2.4, 2.4);
  doorTex.minFilter = THREE.LinearFilter; doorTex.magFilter = THREE.LinearFilter;
  if ('colorSpace' in doorTex) doorTex.colorSpace = THREE.SRGBColorSpace;
  const doorMat = new THREE.MeshBasicMaterial({ map: doorTex, color: 0x2a2016, side: THREE.DoubleSide, depthWrite: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, DOOR_H), doorMat);
  mesh.rotation.y = Math.atan2(dirVec.x, dirVec.z);
  mesh.renderOrder = 5;
  mesh.position.set(pos.x, DOOR.openGap + DOOR_H / 2, pos.z);
  scene.add(mesh);

  let gap = DOOR.openGap, passed = false;
  // SEAL: once you're through, the wall SLAMS to the floor behind you — the
  // "there's no going back" climax beat. sealT drives a fast drop; sealImpact
  // latches true for exactly one frame when it hits the floor (engine reads it to
  // fire the boom + camera shake + dust).
  let sealing = false, sealT = 0, sealImpact = false, sealGap0 = 0;
  const SEAL_DUR = 0.28;     // seconds for the slab to crash down

  // Lower the slab with the collapse progress (0 = full time, 1 = expired).
  function update(prog) {
    if (sealing) return;     // once sealing, the slam owns the slab's height
    gap = DOOR.openGap + (DOOR.duckGap - DOOR.openGap) * Math.max(0, Math.min(1, prog));
    mesh.position.y = gap + DOOR_H / 2;
  }

  // Advance the slam. Returns true on the single frame the slab hits the floor.
  function tickSeal(dt) {
    sealImpact = false;
    if (!sealing) return false;
    const was = sealT;
    sealT = Math.min(SEAL_DUR, sealT + dt);
    const p = sealT / SEAL_DUR;
    const ease = p * p;      // accelerate into the floor
    gap = sealGap0 * (1 - ease);
    mesh.position.y = gap + DOOR_H / 2;
    if (was < SEAL_DUR && sealT >= SEAL_DUR) { sealImpact = true; return true; }
    return false;
  }

  // Kick off the slam from wherever the slab currently sits.
  function seal() { if (sealing) return; sealing = true; sealT = 0; sealGap0 = gap; }

  // Gate the escape. High door = walk through; low door = only while ducking.
  function tryPass(ducking) {
    if (passed) return true;
    if (gap >= DOOR.needGap || ducking) { passed = true; return true; }
    return false;
  }

  function reset() {
    passed = false; gap = DOOR.openGap; mesh.position.y = gap + DOOR_H / 2;
    sealing = false; sealT = 0; sealImpact = false;
  }

  return {
    update, tryPass, reset, tickSeal, seal,
    get lowGap() { return gap < DOOR.needGap; },
    get passed() { return passed; },
    get sealing() { return sealing; },
    get sealImpact() { return sealImpact; },
  };
}

export default createStoneDoor;
