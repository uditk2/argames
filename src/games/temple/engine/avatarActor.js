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
import { AVATAR, getSelectedCharacter } from '../config.js';
import { makeSpriteSheets } from './spriteSheets.js';

export function createAvatarActor({ THREE, scene, ALIGN = { avatarScale: 1, avatarLift: 0 }, character } = {}) {
  const CHAR = character || getSelectedCharacter();
  const JUMP_LIFT = (CHAR && CHAR.jumpLift != null) ? CHAR.jumpLift : AVATAR.jumpLift;
  const DUCK_DROP = (CHAR && CHAR.duckDrop != null) ? CHAR.duckDrop : AVATAR.duckDrop;
  // 'lift' anim (L5 gem claim): frames are taller (arms up) with this native aspect.
  const LIFT_ASPECT = 368 / 1362;   // keep undistorted
  const LIFT_BODY = 1.1;            // plane height vs AVATAR.height so her body matches the run size
  const sprite = makeSpriteSheets(THREE, CHAR && CHAR.sprites);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  // warm torch tint so the unlit sprite reads as lit by the temple (per-character).
  if (CHAR && CHAR.tint != null) mat.color.setHex(CHAR.tint);
  const geo = new THREE.PlaneGeometry(AVATAR.height * AVATAR.aspect, AVATAR.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.scale.setScalar(ALIGN.avatarScale);
  scene.add(mesh);

  // ---- soft contact shadow: a radial-gradient blob on the floor under the runner.
  // Grounds the flat billboard so it reads as placed IN the hall (3D), and shrinks
  // + fades as the runner leaves the ground on a jump.
  const shadow = (() => {
    const cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    let tex = null;
    if (cv) {
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      rg.addColorStop(0, 'rgba(0,0,0,0.62)'); rg.addColorStop(0.7, 'rgba(0,0,0,0.28)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(cv);
    }
    const smat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    const shW = AVATAR.height * AVATAR.aspect * 1.35 * ALIGN.avatarScale;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(shW, shW * 0.58), smat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.05; m.renderOrder = 4;
    scene.add(m);
    return { mesh: m, mat: smat, tex };
  })();

  let anim = 'run', animT = 0, animFrame = 0, runT = 0;

  function setAnim(name) { anim = name; animT = 0; animFrame = 0; }
  function reset() {
    setAnim('run'); runT = 0;
    mat.opacity = 1;
    mesh.scale.setScalar(ALIGN.avatarScale);
    shadow.mat.opacity = 0.5; shadow.mesh.scale.set(1, 1, 1);
  }

  function update(dt, { pos, camQuat, moving, phase, deathCause, fallY = 0, fallP = 0, winT = 0, stuckT = 0, sliceT = 0 }) {
    // ---- frame selection: run cycles while moving; jump/duck play once --------
    const sheet = sprite[anim] || sprite.run;
    const fps = anim === 'run' ? AVATAR.runFps : AVATAR.actionFps;
    animT += dt * fps;
    if (moving || anim !== 'run') runT += dt * AVATAR.runFps;
    if (anim === 'run') {
      animFrame = Math.floor(runT) % sheet.count;
    } else if (anim === 'lift') {
      animFrame = Math.min(Math.floor(animT), sheet.count - 1);   // play once, HOLD the last frame (gem aloft)
    } else {
      animFrame = Math.floor(animT);
      if (animFrame >= sheet.count) { setAnim('run'); animFrame = 0; }
    }
    const tex = sheet.frames[Math.min(animFrame, sheet.count - 1)];
    if (tex && mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }

    // ---- placement: feet on the floor, lift on jump / dip on duck -------------
    const lift = anim === 'jump' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * JUMP_LIFT : 0;
    const drop = anim === 'duck' ? Math.sin(Math.min(1, animT / sheet.count) * Math.PI) * DUCK_DROP : 0;
    if (anim === 'lift') {
      // The lift frames are TALLER (arms raised) with their own aspect. Scale the plane
      // to that native aspect (no distortion) and to a height where her BODY matches the
      // run size, then anchor her FEET on the floor (raised arms + gem extend up).
      const sY = LIFT_BODY * ALIGN.avatarScale;
      const sX = (LIFT_ASPECT / AVATAR.aspect) * sY;
      mesh.scale.set(sX, sY, 1);
      const worldH = AVATAR.height * sY;
      mesh.position.set(pos.x, AVATAR.yOffset + worldH / 2 + ALIGN.avatarLift, pos.z);
    } else {
      mesh.scale.setScalar(ALIGN.avatarScale);
      const footY = AVATAR.yOffset + (AVATAR.height * ALIGN.avatarScale) / 2 + ALIGN.avatarLift;
      mesh.position.set(pos.x, footY + lift - drop, pos.z);
    }
    mesh.quaternion.copy(camQuat);   // billboard: face the (un-rolled) camera

    // contact shadow: stays on the floor under the runner; shrinks + softens as
    // they leave the ground on a jump (sells the height), stronger on a duck.
    const air = Math.max(0, lift);
    shadow.mesh.position.set(pos.x, 0.05, pos.z);
    const ss = Math.max(0.5, 1 - air * 0.14) * (1 + drop * 0.05);
    shadow.mesh.scale.set(ss, ss, 1);

    // ---- failure / ending FX (transforms on the sprite, no bespoke clips) -----
    const falling = fallP > 0;
    if (falling || deathCause === 'pit') {
      mesh.position.y -= fallY;
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fallP * 0.9));
      mat.opacity = Math.max(0, 1 - fallP * 1.05);
    } else if (phase === 'won' && anim !== 'lift') {
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
    // shadow fades with the runner (death dissolve / jump air) so they leave together.
    shadow.mat.opacity = mat.opacity * 0.5 * Math.max(0.35, 1 - Math.max(0, lift) * 0.1);
  }

  function dispose() {
    try { scene.remove(mesh); geo.dispose(); mat.dispose(); } catch { /* gone */ }
    try { scene.remove(shadow.mesh); shadow.mesh.geometry.dispose(); shadow.mat.dispose(); if (shadow.tex) shadow.tex.dispose(); } catch { /* gone */ }
    Object.values(sprite).forEach((sh) => sh.frames.forEach((t) => { try { t.dispose(); } catch { /* gone */ } }));
  }

  return { setAnim, update, reset, dispose, get hasLift() { return !!sprite.lift; } };
}

export default createAvatarActor;
