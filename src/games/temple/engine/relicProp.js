// ===========================================================================
// Temple Collapse — RELIC PROP (the 'artifact' level ending, its own module).
// ---------------------------------------------------------------------------
// The Syamantaka Gem: Surya's sun-gem, sitting on a stone pedestal in L5's exit
// cell. It is the campaign's PEAK — the one thing the player came for. Approach
// it and it LIFTS: rises off the pedestal, spins up, flares white, then leaves
// with you (fades out) — the visible pay-off. The glow reads at the game's
// third-person angle via a FLAT floor ring + a point light (no camera-facing card,
// which looked like a stray shadow).
//
//   createRelicProp({ THREE, scene, pos, dirVec, W, H, addLight }) -> {
//     update(dt, tnow), grab(), reset(), get grabbed, get carryColor, dispose(),
//   }
// ===========================================================================

export function createRelicProp({ THREE, scene, pos, dirVec, W, H, addLight } = {}) {
  const GOLD = 0xffd24a;        // sun-gem core (warm gold)
  const GOLD_HI = 0xfff6d8;     // hot white-gold highlight at the grab flare
  const group = new THREE.Group();
  const cx = pos.x + (dirVec.x || 0) * (W * 0.12);
  const cz = pos.z + (dirVec.z || 0) * (W * 0.12);
  group.position.set(cx, 0, cz);
  scene.add(group);

  // ---- pedestal: a warm carved plinth (light enough to read as stone, not a
  //      dark shadow), with a faint emissive lift so it never goes to a black blob.
  const PED_H = H * 0.30;
  const pedMat = new THREE.MeshStandardMaterial({ color: 0x6b5334, emissive: 0x3a2a12, emissiveIntensity: 0.5, roughness: 0.85, metalness: 0.05 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.15, W * 0.2, PED_H, 10), pedMat);
  pedestal.position.y = PED_H / 2;
  group.add(pedestal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.18, W * 0.155, PED_H * 0.14, 10), pedMat);
  cap.position.y = PED_H + PED_H * 0.02;
  group.add(cap);

  // ---- the gem: a faceted octahedron, emissive so it glows in the dark ---------
  const gemMat = new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.4 });
  const GEM_R = W * 0.11;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(GEM_R, 0), gemMat);
  const GEM_Y0 = PED_H + GEM_R * 1.5;    // rest height just above the pedestal (mid-corridor height)
  gem.position.y = GEM_Y0;
  group.add(gem);

  // ---- floor glow ring: a flat additive disc pooled on the stone at the base.
  //      Additive so it only ever brightens (never a dark card), and flat on the
  //      floor so it reads from the third-person camera looking down the hall.
  const glowMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(W * 0.42, 28), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06;
  glow.renderOrder = 3;
  group.add(glow);

  // ---- glow light: pools warm gold on the pedestal + nearby stone -------------
  const light = addLight
    ? addLight(new THREE.Vector3(cx, GEM_Y0, cz), GOLD, 2.6, W * 2.6)
    : (() => { const l = new THREE.PointLight(GOLD, 2.6, W * 2.6, 2.0); l.position.set(cx, GEM_Y0, cz); scene.add(l); return l; })();

  let grabbed = false, grabT = 0;
  const GRAB_DUR = 0.9;          // seconds of lift + spin-up + flare (visible; the panel is held back)

  function update(dt, tnow) {
    const t = tnow || 0;
    if (!grabbed) {
      // idle: slow spin, gentle bob, breathing pulse on the glow.
      gem.rotation.y = t * 0.9;
      gem.rotation.x = Math.sin(t * 0.7) * 0.15;
      gem.position.y = GEM_Y0 + Math.sin(t * 1.8) * GEM_R * 0.22;
      const pulse = 1 + 0.2 * Math.sin(t * 2.6);
      gemMat.emissiveIntensity = 1.6 * pulse;
      glowMat.opacity = 0.32 * pulse;
      glowMat.color.setHex(GOLD);
      light.intensity = 2.6 * pulse;
    } else {
      // grab: gem rises off the pedestal, spins up, flares white-gold, then leaves.
      grabT += dt;
      const p = Math.min(1, grabT / GRAB_DUR);
      const ease = p * p * (3 - 2 * p);
      gem.rotation.y += dt * (6 + 26 * (1 - p));
      gem.position.y = GEM_Y0 + ease * H * 0.62;                 // clear vertical lift
      gem.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.7);
      const flash = Math.sin(p * Math.PI);
      gemMat.emissive.setHex(GOLD).lerp(new THREE.Color(GOLD_HI), flash);
      gemMat.emissiveIntensity = 1.6 + flash * 7.0;
      glowMat.opacity = 0.35 + flash * 0.55;
      glowMat.color.setHex(GOLD).lerp(new THREE.Color(GOLD_HI), flash * 0.7);
      glow.scale.setScalar(1 + flash * 1.6);
      light.intensity = 2.6 + flash * 8.0;
      light.position.y = gem.position.y;
      if (p >= 1) {                                              // taken — fade the prop out
        const f = Math.max(0, 1 - (grabT - GRAB_DUR) * 2.0);
        group.visible = f > 0.02;
        gemMat.emissiveIntensity = 1.6 * f; glowMat.opacity = 0.35 * f; light.intensity = 2.6 * f;
      }
    }
  }

  function grab() { if (grabbed) return; grabbed = true; grabT = 0; }

  function reset() {
    grabbed = false; grabT = 0; group.visible = true;
    gem.position.y = GEM_Y0; gem.scale.setScalar(1); gem.rotation.set(0, 0, 0);
    gemMat.emissive.setHex(GOLD); gemMat.emissiveIntensity = 1.6;
    glowMat.opacity = 0.35; glow.scale.setScalar(1);
    light.intensity = 2.6; light.position.set(cx, GEM_Y0, cz);
  }

  function dispose() {
    try { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } catch { /* gone */ }
  }

  return { update, grab, reset, dispose, get grabbed() { return grabbed; }, get carryColor() { return GOLD; } };
}

export default createRelicProp;
