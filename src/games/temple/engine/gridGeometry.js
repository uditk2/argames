// ===========================================================================
// Temple Collapse — GRID WORLD builder (TIP-NODE projected maze).
// ---------------------------------------------------------------------------
// Ported from the validated prototype (prototypes/temple-dash/level1.html). The
// old build used ONE re-aimed capture per straight run; it shimmered at junctions
// and openings weren't legible. This build uses the prototype recipe that fixed
// all of that:
//
//   • CORRIDORS  — a photoreal hall photo (corridor_bright) TIP-projected from a
//     field of CAPTURE NODES placed along every open axis (both facings). One
//     shader paints each fragment from the nearest same-facing nodes (top-K per
//     frame, KMAX slots) so cost is constant at any maze size and there's no
//     stretch/ghosting. Driven each frame by the camera's world pos + forward via
//     `frameView`.
//   • DEAD-ENDS  — a flat carved-wall strip (capMat): a wall a corridor runs
//     head-on into never looks like a receding hall.
//   • OPENINGS   — a carved-arch DOORWAY PANEL (doorway_panel, solid wall with a
//     transparent arched hole) on every open side, so a turn always reads as an
//     arch, "only wall or doorway, nothing else".
//   • WALLS      — each internal wall drawn ONCE (owned by the S/E cell) to kill
//     the coincident-quad z-fighting that caused the junction "re-render" glitch.
//
//   buildGridWorld({ THREE, group, maze, cellW, H, camY, tiled,
//                    corridorTex, doorTex, imgAspect }) ->
//     { group, dispose, junctionCells, entranceWorld, exitWorld, cellW, H,
//       retarget(),               // no-op (kept for engine API compat)
//       frameView(camPos, fwd) }  // call each frame: selects top-K nodes
// Grid→world: cell (r,c) -> centre (x = c*cellW, z = -r*cellW). Matches gridMaze.
//
// ?surf=tiled still works: LIT seamless MeshStandard stone (no projection/panels).
// ===========================================================================

const KMAX = 30;   // shader node slots — top-K nearest same-facing nodes per frame

export function buildGridWorld({
  THREE, group, maze, cellW = 14, H = 7, camY = 4.3, tiled = null,
  corridorTex = null, doorTex = null, imgAspect = 1672 / 941, aimY = 2.2,
} = {}) {
  const { cols, rows, grid, entrance, exit } = maze;
  const hw = cellW / 2;
  const wx = (c) => c * cellW;
  const wz = (r) => -r * cellW;
  const inb = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const openDir = (r, c, d) => inb(r, c) && !grid[r][c][d];
  const oN = (r, c) => openDir(r, c, 'N'), oS = (r, c) => openDir(r, c, 'S');
  const oE = (r, c) => openDir(r, c, 'E'), oW = (r, c) => openDir(r, c, 'W');
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- junction list (for tiled-mode torches) --------------------------------
  const junctionCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((oN(r, c) ? 1 : 0) + (oS(r, c) ? 1 : 0) + (oE(r, c) ? 1 : 0) + (oW(r, c) ? 1 : 0) >= 3) {
      junctionCells.push({ r, c, x: wx(c), z: wz(r) });
    }
  }

  // low-level quad: two triangles a->b->c->d on `group`, optional UVs.
  function quad(a, b, c, d, mat, withUV, uvRepeat) {
    const p = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (withUV) {
      const ru = uvRepeat ? uvRepeat.u : 1, rv = uvRepeat ? uvRepeat.v : 1;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, ru, 0, ru, rv, 0, 0, ru, rv, 0, rv]), 2));
      if (uvRepeat) g.computeVertexNormals();   // lit tiled path needs normals
    }
    const mesh = new THREE.Mesh(g, mat); group.add(mesh); return mesh;
  }

  // ===========================================================================
  //  TILED MODE (A/B) — lit seamless stone, no projection/panels.
  // ===========================================================================
  if (tiled) {
    const TILE = tiled.tile || 4.5;
    const uvF = { u: cellW / TILE, v: cellW / TILE }, uvW = { u: cellW / TILE, v: H / TILE };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = wx(c) - hw, x1 = wx(c) + hw, zN = wz(r) + hw, zS = wz(r) - hw;
      quad(V(x0, 0, zS), V(x1, 0, zS), V(x1, 0, zN), V(x0, 0, zN), tiled.floorMat, true, uvF);
      quad(V(x0, H, zN), V(x1, H, zN), V(x1, H, zS), V(x0, H, zS), tiled.wallMat, true, uvF);
      if (!oN(r, c) && r === 0) quad(V(x0, 0, zN), V(x1, 0, zN), V(x1, H, zN), V(x0, H, zN), tiled.wallMat, true, uvW);
      if (!oS(r, c)) quad(V(x1, 0, zS), V(x0, 0, zS), V(x0, H, zS), V(x1, H, zS), tiled.wallMat, true, uvW);
      if (!oW(r, c) && c === 0) quad(V(x0, 0, zS), V(x0, 0, zN), V(x0, H, zN), V(x0, H, zS), tiled.wallMat, true, uvW);
      if (!oE(r, c)) quad(V(x1, 0, zN), V(x1, 0, zS), V(x1, H, zS), V(x1, H, zN), tiled.wallMat, true, uvW);
    }
    return {
      group, junctionCells, retarget() {}, frameView() {},
      dispose() { disposeGroup(THREE, group); },
      entranceWorld: { x: wx(entrance.c), z: wz(entrance.r) },
      exitWorld: { x: wx(exit.c), z: wz(exit.r) }, cellW, H,
    };
  }

  // ===========================================================================
  //  TIP-NODE MODE (default) — the prototype engine.
  // ===========================================================================
  // ---- capture nodes: along every open axis, both facings ---------------------
  const NODES = [];
  function capVP(px, pz, dx, dz) {
    const cc = new THREE.PerspectiveCamera(66, imgAspect, 0.05, 600);
    cc.position.set(px, camY, pz); cc.lookAt(px + dx * 40, aimY, pz + dz * 40);
    cc.updateMatrixWorld(true); cc.updateProjectionMatrix();
    return new THREE.Matrix4().multiplyMatrices(cc.projectionMatrix, cc.matrixWorldInverse);
  }
  function nd(px, pz, dx, dz) { NODES.push({ vp: capVP(px, pz, dx, dz), pos: new THREE.Vector3(px, camY, pz), dir: new THREE.Vector3(dx, 0, dz) }); }
  const addV = (px, pz) => { nd(px, pz, 0, 1); nd(px, pz, 0, -1); };
  const addH = (px, pz) => { nd(px, pz, 1, 0); nd(px, pz, -1, 0); };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = wx(c), cz = wz(r);
    if (oN(r, c) || oS(r, c)) { addV(cx, cz); if (oN(r, c)) addV(cx, cz + hw); if (oS(r, c)) addV(cx, cz - hw); }
    if (oE(r, c) || oW(r, c)) { addH(cx, cz); if (oE(r, c)) addH(cx + hw, cz); if (oW(r, c)) addH(cx - hw, cz); }
  }

  // ---- corridor shader (top-K nodes / frame) ---------------------------------
  const selCap = [], selPos = [], selDir = [];
  for (let i = 0; i < KMAX; i++) { selCap.push(new THREE.Matrix4()); selPos.push(new THREE.Vector3()); selDir.push(new THREE.Vector3(0, 0, -1)); }
  const uView = new THREE.Vector3(0, 0, -1);
  const uN = cellW * 1.8, uF = cellW * 7.6;   // fog fade scaled to cell size
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uImg: { value: corridorTex }, uCap: { value: selCap }, uPos: { value: selPos }, uDir: { value: selDir },
      uK: { value: 0 }, uView: { value: uView }, uSig: { value: 15 }, uGain: { value: 1.25 }, uLift: { value: 0.02 },
      uFog: { value: new THREE.Color(0x1e1209) }, uN: { value: uN }, uF: { value: uF },
    },
    vertexShader: `varying vec3 vW; varying float vD;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
        vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      #define K ${KMAX}
      uniform sampler2D uImg; uniform mat4 uCap[K]; uniform vec3 uPos[K]; uniform vec3 uDir[K];
      uniform int uK; uniform vec3 uView; uniform float uSig,uN,uF,uGain,uLift; uniform vec3 uFog;
      varying vec3 vW; varying float vD;
      void main(){
        vec3 acc=vec3(0.0); float wsum=0.0;
        for(int i=0;i<K;i++){ if(i>=uK) break;
          float fm=max(0.0, dot(uView,uDir[i])); if(fm<=0.002) continue; fm*=fm;
          vec3 dp=vW-uPos[i]; float d2=dot(dp,dp);
          float t=1.0+d2/uSig; float w=fm/(t*t*t);
          vec4 c=uCap[i]*vec4(vW,1.0); if(c.w<=0.0) continue;
          vec2 uv=(c.xy/c.w)*0.5+0.5; if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) continue;
          acc+=w*texture2D(uImg,uv).rgb; wsum+=w; }
        vec3 col = wsum>0.0 ? acc/wsum : uFog;
        col=col*uGain+uLift;
        float f=clamp((vD-uN)/(uF-uN),0.0,1.0);
        gl_FragColor=vec4(mix(col,uFog,f),1.0);
      }`,
  });

  // ---- flat carved-wall CAP (head-on dead-ends) ------------------------------
  const capMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uImg: { value: corridorTex }, uGain: { value: 1.15 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D uImg; uniform float uGain; varying vec2 vUv;
      void main(){ vec2 t=vec2(0.05+0.24*vUv.x, 0.20+0.58*vUv.y);
        gl_FragColor=vec4(texture2D(uImg,t).rgb*uGain,1.0); }`,
  });

  // ---- carved-arch DOORWAY panel (open sides) --------------------------------
  // tone-matched + fogged so the arch blends into the corridor (no bright pop).
  const panelMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: doorTex }, uTone: { value: new THREE.Color(1.0, 0.99, 1.52) },
      uFog: { value: new THREE.Color(0x1e1209) }, uN: { value: uN }, uF: { value: uF },
    },
    vertexShader: `varying vec2 vUv; varying float vD;
      void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uTone,uFog; uniform float uN,uF; varying vec2 vUv; varying float vD;
      void main(){ vec4 c=texture2D(uMap,vUv); if(c.a<0.5) discard;
        vec3 col=c.rgb*uTone; float f=clamp((vD-uN)/(uF-uN),0.0,1.0);
        gl_FragColor=vec4(mix(col,uFog,f),1.0); }`,
  });

  const capQuad = (a, b, c, d) => quad(a, b, c, d, capMat, true);
  const panelQuad = (a, b, c, d) => quad(a, b, c, d, panelMat, true);
  const projQuad = (a, b, c, d) => quad(a, b, c, d, mat, false);

  // ---- build all cell meshes --------------------------------------------------
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = wx(c) - hw, x1 = wx(c) + hw, zN = wz(r) + hw, zS = wz(r) - hw;
    projQuad(V(x0, 0, zS), V(x1, 0, zS), V(x1, 0, zN), V(x0, 0, zN));   // floor
    projQuad(V(x0, H, zN), V(x1, H, zN), V(x1, H, zS), V(x0, H, zS));   // ceiling
    // internal walls drawn ONCE (owned by the S/E cell); boundary walls by their
    // only cell. A wall is a flat CAP when a corridor runs head-on into it.
    if (!oN(r, c) && r === 0) { const f = oS(r, c) ? capQuad : projQuad; f(V(x0, 0, zN), V(x1, 0, zN), V(x1, H, zN), V(x0, H, zN)); }
    if (!oS(r, c)) { const cap = oN(r, c) || (r + 1 < rows && oS(r + 1, c)); (cap ? capQuad : projQuad)(V(x1, 0, zS), V(x0, 0, zS), V(x0, H, zS), V(x1, H, zS)); }
    if (!oW(r, c) && c === 0) { const f = oE(r, c) ? capQuad : projQuad; f(V(x0, 0, zS), V(x0, 0, zN), V(x0, H, zN), V(x0, H, zS)); }
    if (!oE(r, c)) { const cap = oW(r, c) || (c + 1 < cols && oE(r, c + 1)); (cap ? capQuad : projQuad)(V(x1, 0, zN), V(x1, 0, zS), V(x1, H, zS), V(x1, H, zN)); }
    // OPEN sides = carved-arch doorway panel (solid wall + transparent arch).
    if (oS(r, c) && r + 1 < rows) panelQuad(V(x0, 0, zS), V(x1, 0, zS), V(x1, H, zS), V(x0, H, zS));
    if (oE(r, c) && c + 1 < cols) panelQuad(V(x1, 0, zS), V(x1, 0, zN), V(x1, H, zN), V(x1, H, zS));
  }

  // ---- per-frame top-K node selection (called from the engine loop) ----------
  const CULL2 = (cellW * 3.6) * (cellW * 3.6);
  const PROX = cellW * 1.6;
  let px = wx(entrance.c), pz = wz(entrance.r);
  function frameView(camPos, fwd) {
    if (camPos) { px = camPos.x; pz = camPos.z; }
    if (fwd) { const l = Math.hypot(fwd.x, fwd.z) || 1; uView.set(fwd.x / l, 0, fwd.z / l); }
    const scored = [];
    for (let i = 0; i < NODES.length; i++) {
      const n = NODES[i];
      const fm = Math.max(0, uView.x * n.dir.x + uView.z * n.dir.z); if (fm <= 0.02) continue;
      const dx = px - n.pos.x, dz = pz - n.pos.z, d2 = dx * dx + dz * dz; if (d2 > CULL2) continue;
      scored.push([fm * fm / (1 + d2 / PROX), i]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const k = Math.min(KMAX, scored.length);
    for (let j = 0; j < k; j++) { const n = NODES[scored[j][1]]; selCap[j].copy(n.vp); selPos[j].copy(n.pos); selDir[j].copy(n.dir); }
    mat.uniforms.uK.value = k;
  }

  return {
    group, junctionCells, retarget() {}, frameView,
    dispose() { disposeGroup(THREE, group); },
    entranceWorld: { x: wx(entrance.c), z: wz(entrance.r) },
    exitWorld: { x: wx(exit.c), z: wz(exit.r) }, cellW, H,
  };
}

function disposeGroup(THREE, group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { const a = Array.isArray(o.material) ? o.material : [o.material]; a.forEach((x) => x.dispose && x.dispose()); }
  });
}

export default buildGridWorld;
