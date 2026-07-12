// ===========================================================================
// Temple Collapse — RELIC PROP (the 'artifact' level ending, its own module).
// ---------------------------------------------------------------------------
// The Syamantaka: Surya's sun-gem, sitting on a stone pedestal in L5's exit
// cell. It is the campaign's PEAK — the one thing the player came for, and the
// only moment the whole run is built around. Before this module the climax was
// a text cue + a chime and NOTHING to see; now there's a real, glowing prop you
// approach and physically take.
//
//   createRelicProp({ THREE, scene, pos, dirVec, W, H, addLight }) -> {
//     update(dt, tnow),   // float + pulse; drives the grab burst once grabbed
//     grab(),             // fire the 0.6s slow-mo reach + light burst (latches)
//     reset(),
//     get grabbed,
//     get carryColor,     // warm core colour for the L6 carried glow
//     dispose(),
//   }
// `pos` = world centre of the exit cell, `dirVec` = travel dir INTO the cell so
// the pedestal sits a touch past centre, framed by the approach.
// ===========================================================================

export function createRelicProp({ THREE, scene, pos, dirVec, W, H, addLight } = {}) {
  const GOLD = 0xffd24a;        // sun-gem core (warm gold)
  const GOLD_HI = 0xfff2c0;     // hot highlight at the grab burst
  const group = new THREE.Group();
  // Sit the relic a touch past cell centre along the approach, so it's framed
  // dead-ahead as the player runs in.
  const cx = pos.x + (dirVec.x || 0) * (W * 0.18);
  const cz = pos.z + (dirVec.z || 0) * (W * 0.18);
  const PED_H = H * 0.42;        // pedestal height (gem floats at ~chest/eye height)
  group.position.set(cx, 0, cz);
  scene.add(group);

  // ---- pedestal: a squat carved stone plinth --------------------------------
  const pedMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9, metalness: 0.05 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.16, W * 0.2, PED_H, 8), pedMat);
  pedestal.position.y = PED_H / 2;
  group.add(pedestal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.19, W * 0.17, PED_H * 0.12, 8), pedMat);
  cap.position.y = PED_H + PED_H * 0.02;
  group.add(cap);

  // ---- the gem: a faceted octahedron, unlit + emissive so it glows in the dark
  const gemMat = new THREE.MeshStandardMaterial({
    color: GOLD, emissive: GOLD, emissiveIntensity: 1.4,
    roughness: 0.15, metalness: 0.35,
  });
  const GEM_R = W * 0.13;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(GEM_R, 0), gemMat);
  const GEM_Y0 = PED_H + GEM_R * 1.6;   // rest height above the pedestal
  gem.position.y = GEM_Y0;
  group.add(gem);

  // ---- halo: a soft additive sprite-ish plane that always faces the gem out --
  const haloMat = new THREE.MeshBasicMaterial({
    color: GOLD, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(GEM_R * 6, GEM_R * 6), haloMat);
  halo.position.y = GEM_Y0;
  halo.renderOrder = 4;
  group.add(halo);

  // ---- glow light: pools warm gold on the pedestal + nearby stone -----------
  const light = addLight
    ? addLight(new THREE.Vector3(cx, GEM_Y0, cz), GOLD, 2.2, W * 2.4)
    : (() => { const l = new THREE.PointLight(GOLD, 2.2, W * 2.4, 2.0); l.position.set(cx, GEM_Y0, cz); scene.add(l); return l; })();

  let grabbed = false, grabT = 0;
  const GRAB_DUR = 0.6;          // seconds of slow-mo reach + burst

  function update(dt, tnow) {
    const t = tnow || 0;
    if (!grabbed) {
      // idle: slow spin, gentle bob, breathing pulse on the glow.
      gem.rotation.y = t * 0.9;
      gem.rotation.x = Math.sin(t * 0.7) * 0.15;
      const bob = Math.sin(t * 1.8) * GEM_R * 0.25;
      gem.position.y = GEM_Y0 + bob;
      halo.position.y = gem.position.y;
      const pulse = 1 + 0.18 * Math.sin(t * 2.6);
      gemMat.emissiveIntensity = 1.4 * pulse;
      halo.material.opacity = 0.42 * pulse;
      light.intensity = 2.2 * pulse;
    } else {
      // grab burst: gem spins up, rises toward the camera, glow spikes then eases.
      grabT += dt;
      const p = Math.min(1, grabT / GRAB_DUR);
      const ease = p * p * (3 - 2 * p);        // smoothstep
      gem.rotation.y += dt * (8 + 20 * (1 - p));
      gem.position.y = GEM_Y0 + ease * H * 0.5;
      gem.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.6);
      // colour flashes to hot highlight at the peak, then settles.
      const flash = Math.sin(p * Math.PI);
      gemMat.emissive.setHex(GOLD).lerp(new THREE.Color(GOLD_HI), flash);
      gemMat.emissiveIntensity = 1.4 + flash * 5.0;
      halo.position.y = gem.position.y;
      halo.material.opacity = 0.5 + flash * 0.5;
      halo.scale.setScalar(1 + flash * 2.2);
      light.intensity = 2.2 + flash * 6.0;
      light.position.y = gem.position.y;
      // after the burst the gem "leaves with you" — fade the prop out.
      if (p >= 1) { const f = Math.max(0, 1 - (grabT - GRAB_DUR) * 2.2); group.visible = f > 0.02; gemMat.emissiveIntensity = 1.4 * f; halo.material.opacity = 0.5 * f; light.intensity = 2.2 * f; }
    }
    // billboard the halo toward the world up-facing camera arc (cheap: face +Z of group)
    halo.lookAt(halo.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, -1)));
  }

  function grab() { if (grabbed) return; grabbed = true; grabT = 0; }

  function reset() {
    grabbed = false; grabT = 0;
    group.visible = true;
    gem.position.y = GEM_Y0; gem.scale.setScalar(1); gem.rotation.set(0, 0, 0);
    gemMat.emissive.setHex(GOLD); gemMat.emissiveIntensity = 1.4;
    halo.position.y = GEM_Y0; halo.material.opacity = 0.5; halo.scale.setScalar(1);
    light.intensity = 2.2; light.position.set(cx, GEM_Y0, cz);
  }

  function dispose() {
    try {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    } catch { /* gone */ }
  }

  return {
    update, grab, reset, dispose,
    get grabbed() { return grabbed; },
    get carryColor() { return GOLD; },
  };
}

export default createRelicProp;
