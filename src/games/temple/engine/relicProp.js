// ===========================================================================
// Temple Collapse — RELIC PROP (the 'artifact' level ending, its own module).
// ---------------------------------------------------------------------------
// The Syamantaka Gem: Surya's sun-jewel, resting on a stone pedestal in L5's exit
// cell. It is the campaign's PEAK — the one thing the player came for. Rather than
// a flat low-poly octahedron (which read as a 2D gold shape), the gem is now a
// SMALL, camera-facing billboard of the radiant sun-jewel art (the same hero image
// used across the game), additively blended so it glows out of the dark chamber and
// its black backing vanishes. It's deliberately hand-sized — a jewel you could carry.
//
// On approach it hovers + breathes with light. On the grab, the hunter LIFTS it: it
// rises off the pedestal to about chest height, swells with light, and holds there
// (carried) — the pay-off ends on the lift, no giant fly-away.
//
//   createRelicProp({ THREE, scene, cam, pos, dirVec, W, H, addLight }) -> {
//     update(dt, tnow), grab(), reset(), get grabbed, get carryColor, dispose(),
//   }
// ===========================================================================
import { assetUrl } from '../assetUrl.js';

export function createRelicProp({ THREE, scene, cam, pos, dirVec, W, H, addLight } = {}) {
  const GOLD = 0xffd24a;        // sun-gem warm gold (glow pool + carried light)
  const group = new THREE.Group();
  const cx = pos.x + (dirVec.x || 0) * (W * 0.12);
  const cz = pos.z + (dirVec.z || 0) * (W * 0.12);
  group.position.set(cx, 0, cz);
  scene.add(group);

  // ---- pedestal: a modest carved plinth so the small jewel reads as PLACED -------
  const PED_H = H * 0.28;
  const pedMat = new THREE.MeshStandardMaterial({ color: 0x6b5334, emissive: 0x3a2a12, emissiveIntensity: 0.5, roughness: 0.85, metalness: 0.05 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.12, W * 0.17, PED_H, 10), pedMat);
  pedestal.position.y = PED_H / 2;
  group.add(pedestal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.145, W * 0.125, PED_H * 0.14, 10), pedMat);
  cap.position.y = PED_H + PED_H * 0.02;
  group.add(cap);

  // ---- the gem: a SMALL camera-facing billboard of the radiant sun-jewel art.
  //      Additive blending => the black backing disappears and only the light shows,
  //      so it glows like a jewel with no chroma-keying and never reads as a card.
  const tex = new THREE.TextureLoader().load(assetUrl('assets/temple/gem_hero.webp'));
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  const gemMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1, fog: false });
  const GEM_SIZE = H * 0.34;                 // hand-sized jewel (small on purpose)
  const gem = new THREE.Mesh(new THREE.PlaneGeometry(GEM_SIZE, GEM_SIZE), gemMat);
  const GEM_Y0 = PED_H + GEM_SIZE * 0.5;     // rest height: sitting just on the cap
  gem.position.y = GEM_Y0;
  gem.renderOrder = 6;
  group.add(gem);

  // ---- floor glow ring: flat additive pool on the stone (reads from the 3P angle) -
  const glowMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(W * 0.34, 28), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06;
  glow.renderOrder = 3;
  group.add(glow);

  // ---- glow light: pools warm gold on the pedestal + nearby stone -----------------
  const light = addLight
    ? addLight(new THREE.Vector3(cx, GEM_Y0, cz), GOLD, 2.4, W * 2.4)
    : (() => { const l = new THREE.PointLight(GOLD, 2.4, W * 2.4, 2.0); l.position.set(cx, GEM_Y0, cz); scene.add(l); return l; })();

  let grabbed = false, grabT = 0;
  const GRAB_DUR = 1.1;          // seconds of the LIFT (held back so it can be relished)
  const LIFT_H = H * 0.30;       // modest rise to ~chest height — a lift, not a fly-away

  function faceCam() { if (cam) gem.quaternion.copy(cam.quaternion); }

  function update(dt, tnow) {
    const t = tnow || 0;
    faceCam();
    if (!grabbed) {
      // idle: gentle bob + breathing glow (the radiant thing waiting to be taken).
      gem.position.y = GEM_Y0 + Math.sin(t * 1.8) * GEM_SIZE * 0.06;
      const pulse = 1 + 0.16 * Math.sin(t * 2.4);
      gemMat.opacity = 0.9 + 0.1 * Math.sin(t * 2.4);
      glowMat.opacity = 0.28 * pulse;
      light.intensity = 2.4 * pulse;
    } else {
      // grab: the jewel is LIFTED off the pedestal to chest height, swells with
      // light, then HOLDS there (carried). The moment ends on the lift.
      grabT += dt;
      const p = Math.min(1, grabT / GRAB_DUR);
      const ease = p * p * (3 - 2 * p);
      gem.position.y = GEM_Y0 + ease * LIFT_H;
      const swell = Math.sin(Math.min(1, p) * Math.PI * 0.5);   // ramps up, holds high
      gem.scale.setScalar(1 + swell * 0.35);
      gemMat.opacity = 1;
      glowMat.opacity = 0.3 + swell * 0.5;
      glow.scale.setScalar(1 + swell * 0.8);
      light.intensity = 2.4 + swell * 5.0;
      light.position.y = gem.position.y;
    }
  }

  function grab() { if (grabbed) return; grabbed = true; grabT = 0; }

  function reset() {
    grabbed = false; grabT = 0; group.visible = true;
    gem.position.y = GEM_Y0; gem.scale.setScalar(1); gemMat.opacity = 1;
    glowMat.opacity = 0.3; glow.scale.setScalar(1);
    light.intensity = 2.4; light.position.set(cx, GEM_Y0, cz);
  }

  function dispose() {
    try { tex.dispose(); } catch { /* gone */ }
    try { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } catch { /* gone */ }
  }

  return { update, grab, reset, dispose, get grabbed() { return grabbed; }, get carryColor() { return GOLD; } };
}

export default createRelicProp;
