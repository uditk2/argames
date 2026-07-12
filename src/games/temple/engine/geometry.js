// ===========================================================================
// Temple Dash — stateless TIP / geometry helpers (extracted from templeEngine.js).
// ---------------------------------------------------------------------------
// The prototype builds the corridor by TIP-projecting a photoreal texture onto
// hand-placed quads. These helpers are pure geometry/material builders — they
// take THREE (and, for the scene-bound ones, the scene + default texture) and
// hold NO game state.
//   • WD            — world-direction basis indexed by a heading `q`.
//   • makeGeometry  — factory returning { P, capVP, mkMat, quad } bound to
//                     THREE + scene + the default corridor texture/fog.
// ===========================================================================

// World direction basis used by the prototype's `place()` — q indexes a heading.
export function makeWD(THREE) {
  return [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
  ];
}

// Build the scene-bound geometry helpers. `defaultTex`/`defaultFog` are used as
// `mkMat`'s fallbacks (the dark corridor image); callers pass the photoreal exit
// texture explicitly for the exit hall.
export function makeGeometry({ THREE, scene, WD, defaultTex, defaultTile = null, defaultFog = 0x0b0603, bright = 1 }) {
  const P = (lx, ly, lz, o, q) => {
    const f = WD[q], r = WD[(q + 1) % 4];
    return new THREE.Vector3(o.x + f.x * (-lz) + r.x * lx, ly, o.z + f.z * (-lz) + r.z * lx);
  };
  function capVP(pos, look) {
    const c = new THREE.PerspectiveCamera(66, 1672 / 941, 0.1, 500);
    c.position.copy(pos); c.lookAt(look);
    c.updateMatrixWorld(true); c.updateProjectionMatrix();
    return new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  }
  // TIP-projection material. `tex` defaults to the dark corridor image but can be
  // the photoreal sunlit `exitImg` for the appended final corridor (Option A). The
  // exit hall floods with daylight so its far fog is warmer/lighter than the dark stone.
  // TIP↔tiled HYBRID tuning (Fable #7a): inside the projection, blend toward the
  // world-planar stone tile wherever the photo's texels are stretched (the smear at
  // grazing angles), keeping the photo's low-frequency color as baked lighting so the
  // photoreal gradients survive. Live-tune with ?blendlo=..&blendhi=..&tilegain=.. ;
  // ?hybrid=0 disables it (pure TIP) for an A/B.
  const _hq = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
  const _hn = (k, d) => { const v = parseFloat(_hq.get(k)); return isFinite(v) ? v : d; };
  const HYB_LO = _hn('blendlo', 0.12), HYB_HI = _hn('blendhi', 0.45), HYB_GAIN = _hn('tilegain', 2.2);
  const HYB_ON = _hq.get('hybrid') === '0' ? 0.0 : 1.0;

  // Per-texture SHARED size vector for uImgSize: every material built from `tex`
  // references the SAME Vector2, so one onLoad update (templeEngine's TIP loaders)
  // propagates to all of them. Defaults match the shipped TIP photos (1672×941).
  function imgSizeVec(t) {
    if (!t) return new THREE.Vector2(1672, 941);
    if (!t.userData.__imgSize) {
      t.userData.__imgSize = new THREE.Vector2(
        (t.image && t.image.width) || 1672,
        (t.image && t.image.height) || 941,
      );
    }
    return t.userData.__imgSize;
  }

  function mkMat(cap, tex = defaultTex, fog = defaultFog) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      extensions: { derivatives: true },   // fwidth() — core on WebGL2, extension on WebGL1
      uniforms: {
        uImg: { value: tex }, uCap: { value: cap }, uFog: { value: new THREE.Color(fog) },
        uN: { value: 20 }, uF: { value: 62 },
        // OFF-PROJECTION FALLBACK: a tiling stone texture (set when available) so surfaces
        // outside the TIP capture (far hall ends, a turn opening seen at an angle) render as
        // dark textured stone instead of a flat black/tan "box". null -> the old dark fill.
        uTile: { value: defaultTile }, uHasTile: { value: defaultTile ? 1.0 : 0.0 },
        uImgSize: { value: imgSizeVec(tex) },
        uBlendLo: { value: HYB_LO }, uBlendHi: { value: HYB_HI }, uTileGain: { value: HYB_GAIN }, uHybrid: { value: HYB_ON },
        uBright: { value: bright },
      },
      vertexShader: `varying vec3 vW;varying float vD;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uImg;uniform sampler2D uTile;uniform float uHasTile;uniform mat4 uCap;uniform vec3 uFog;uniform float uN,uF;uniform vec2 uImgSize;uniform float uBlendLo,uBlendHi,uTileGain,uHybrid,uBright;varying vec3 vW;varying float vD;
        void main(){float f=clamp((vD-uN)/(uF-uN),0.0,1.0);
        vec4 c=uCap*vec4(vW,1.0);vec2 uv=(c.xy/c.w)*0.5+0.5;
        if(c.w<=0.0||uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){
          // off-projection: dark TEXTURED stone (planar from world pos) fading into the fog.
          vec3 fb=vec3(0.05,0.03,0.018);
          if(uHasTile>0.5){vec2 tuv=vec2(vW.x*0.16+vW.z*0.11, vW.y*0.2+vW.z*0.06);fb=texture2D(uTile,tuv).rgb*vec3(0.34,0.27,0.19);}
          gl_FragColor=vec4(mix(fb*uBright,uFog,f),1.0);return;}
        vec3 photo=texture2D(uImg,uv).rgb;
        vec3 col=photo;
        if(uHasTile>0.5){
          vec2 fw=fwidth(uv*uImgSize);
          float stretch=max(fw.x,fw.y);
          float b=(1.0-smoothstep(uBlendLo,uBlendHi,stretch))*uHybrid;
          if(b>0.0){
            vec2 tuv=vec2(vW.x*0.16+vW.z*0.11, vW.y*0.2+vW.z*0.06);
            vec3 tile=texture2D(uTile,tuv).rgb;
            vec3 lighting=texture2D(uImg,uv,5.0).rgb;   // blurred photo = its baked lighting
            vec3 tileLit=tile*lighting*uTileGain;
            col=mix(photo,tileLit,b);
          }
        }
        gl_FragColor=vec4(mix(col*uBright,uFog,f),1.0);}`,
    });
  }
  // quad(a,b,c,d,m) builds two triangles for the planar quad a->b->c->d.
  // OPTIONAL `uvRepeat` ({u,v} or [u,v]) adds a `uv` BufferAttribute so the
  // TILED MeshStandardMaterial path can tile a texture. TIP callers omit it
  // (no UVs are written, so the TIP path is byte-for-byte unchanged). The UVs
  // map a->(0,0) b->(u,0) c->(u,v) d->(0,v): i.e. the a->b edge is the U axis
  // and the a->d edge is the V axis, repeated `u`/`v` times.
  function quad(a, b, c, d, m, uvRepeat) {
    const v = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    if (uvRepeat) {
      const ru = Array.isArray(uvRepeat) ? uvRepeat[0] : uvRepeat.u;
      const rv = Array.isArray(uvRepeat) ? uvRepeat[1] : uvRepeat.v;
      // a(0,0) b(ru,0) c(ru,rv) ; a(0,0) c(ru,rv) d(0,rv)
      const uv = new Float32Array([0, 0, ru, 0, ru, rv, 0, 0, ru, rv, 0, rv]);
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeVertexNormals();   // MeshStandard needs normals to catch torch light
    }
    const mesh = new THREE.Mesh(g, m);
    scene.add(mesh);
    return mesh;   // callers may keep it (grid TIP re-aiming swaps materials); legacy callers ignore it
  }
  return { P, capVP, mkMat, quad };
}
