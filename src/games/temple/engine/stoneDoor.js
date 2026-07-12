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

  // Lower the slab with the collapse progress (0 = full time, 1 = expired).
  function update(prog) {
    gap = DOOR.openGap + (DOOR.duckGap - DOOR.openGap) * Math.max(0, Math.min(1, prog));
    mesh.position.y = gap + DOOR_H / 2;
  }

  // Gate the escape. High door = walk through; low door = only while ducking.
  function tryPass(ducking) {
    if (passed) return true;
    if (gap >= DOOR.needGap || ducking) { passed = true; return true; }
    return false;
  }

  function reset() { passed = false; gap = DOOR.openGap; mesh.position.y = gap + DOOR_H / 2; }

  return {
    update, tryPass, reset,
    get lowGap() { return gap < DOOR.needGap; },
    get passed() { return passed; },
  };
}

export default createStoneDoor;
