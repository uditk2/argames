// ===========================================================================
// Temple Collapse — AVATAR ACTOR (third-person billboard runner, its own module).
// ---------------------------------------------------------------------------
// The camera-facing sprite-plane runner: run/jump/duck sheet animation plus the
// failure/ending transforms (pit plunge, win dissolve, stumble slump, blade/fire
// topple, generic death fade) — extracted from templeEngine's inline avatar so
// the grid engine shares one implementation. No boulder-crush variant (the
// chase boulder is retired).
//
//   createAvatarActor({ THREE, scene, ALIGN }) -> {
//     setAnim('run'|'jump'|'duck'),
//     update(dt, ctx),   // ctx: { pos, camQuat, moving, phase, deathCause,
//                        //        fallY, fallP, winT, stuckT, sliceT }
//     reset(), dispose(),
//   }
// `fallY`/`fallP` = pit-fall drop (world units) and progress 0..1 — computed by
// the engine so camera + avatar share the exact same plunge.
// ===========================================================================
import { AVATAR } from '../config.js';
import { makeSpriteSheets } from './spriteSheets.js';

export function createAvatarActor({ THREE, scene, ALIGN = { avatarScale: 1, avatarLift: 0 } } = {}) {
  const sprite = makeSpriteSheets(THREE);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const geo = new THREE.PlaneGeometry(AVATAR.height * AVATAR.aspect, AVATAR.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.scale.setScalar(ALIGN.avatarScale);
  scene.add(mesh);

  let anim = 'run', animT = 0, animFrame = 0, runT = 0;

  function setAnim(name) { anim = name; animT = 0; animFrame = 0; }
  function reset() {
    setAnim('run'); runT = 0;
    mat.opacity = 1;
    mesh.scale.setScalar(ALIGN.avatarScale);
  }

  function update(dt, { pos, camQuat, moving, phase, deathCause, fallY = 0, fallP = 0, winT = 0, stuckT = 0, sliceT = 0 }) {
    // ---- frame selection: run cycles while moving; jump/duck play once --------
    const sheet = sprite[anim] || sprite.run;
    const fps = anim === 'run' ? AVATAR.runFps : AVATAR.actionFps;
    animT += dt * fps;
    if (moving || anim !== 'run') runT += dt * AVATAR.runFps;
    if (anim === 'run') {
      animFrame = Math.floor(runT) % sheet.count;
    } else {
      animFrame = Math.floor(animT);
      if (animFrame >= sheet.count) { setAnim('run'); animFrame = 0; }
    }
    const tex = sheet.frames[Math.min(animFrame, sheet.count - 1)];
    if (tex && mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }

    // ---- placement: feet on the floor, lift on jump / dip on duck -------------
    const lift = anim === 'jump' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * AVATAR.jumpLift : 0;
    const drop = anim === 'duck' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * AVATAR.duckDrop : 0;
    const footY = AVATAR.yOffset + (AVATAR.height * ALIGN.avatarScale) / 2 + ALIGN.avatarLift;
    mesh.position.set(pos.x, footY + lift - drop, pos.z);
    mesh.quaternion.copy(camQuat);   // billboard: face the (un-rolled) camera

    // ---- failure / ending FX (transforms on the sprite, no bespoke clips) -----
    const falling = fallP > 0;
    if (falling || deathCause === 'pit') {
      mesh.position.y -= fallY;
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fallP * 0.9));
      mat.opacity = Math.max(0, 1 - fallP * 1.05);
    } else if (phase === 'won') {
      mat.opacity = Math.max(0, 1 - Math.min(1, winT * 0.8));           // dissolve into the light
    } else if (phase === 'stuck') {
      const t = Math.min(1, stuckT * 1.4);
      mesh.position.y -= t * 0.5;                                        // slump into the trap
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.55));
    } else if (phase === 'over' && (deathCause === 'blade' || deathCause === 'fire')) {
      const t = Math.min(1, sliceT * 2.4);
      mesh.position.x += Math.sin(sliceT * 46) * 0.18 * (1 - t);         // jolt
      mesh.position.y -= t * 1.3;                                        // drop
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), t * 1.4)); // topple
      mat.opacity = Math.max(0, 1 - t);
    } else if (phase === 'over') {
      const t = Math.min(1, stuckT * 1.8);
      mesh.position.y -= t * 0.9;                                        // sink to a stop
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.7)); // pitch forward
      mat.opacity = Math.max(0, 1 - t);
    } else {
      mat.opacity = 1;
    }
  }

  function dispose() {
    try { scene.remove(mesh); geo.dispose(); mat.dispose(); } catch { /* gone */ }
    Object.values(sprite).forEach((sh) => sh.frames.forEach((t) => { try { t.dispose(); } catch { /* gone */ } }));
  }

  return { setAnim, update, reset, dispose };
}

export default createAvatarActor;
