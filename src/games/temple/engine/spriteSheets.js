// ===========================================================================
// Temple Dash — sprite-sheet loader (extracted from templeEngine.js).
// ---------------------------------------------------------------------------
// Loads all sprite sheets (run/jump/duck) as arrays of THREE.Texture. Pure
// asset loading: takes THREE (so the engine controls the dep) and reads frame
// counts / dirs from ASSETS. No game state.
// ===========================================================================
import { ASSETS } from '../config.js';

// Load all sprite sheets (run/jump/duck) as arrays of THREE.Texture.
export function makeSpriteSheets(THREE) {
  const loader = new THREE.TextureLoader();
  const make = (cfg) => {
    const frames = [];
    for (let i = 0; i < cfg.count; i++) {
      const n = String(i).padStart(2, '0');
      const t = loader.load(`${cfg.dir}/r_${n}.png`);
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      frames.push(t);
    }
    return { frames, count: cfg.count };
  };
  return { run: make(ASSETS.run), jump: make(ASSETS.jump), duck: make(ASSETS.duck) };
}

export default makeSpriteSheets;
