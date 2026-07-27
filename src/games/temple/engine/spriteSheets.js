// ===========================================================================
// Temple Dash — sprite-sheet loader (extracted from templeEngine.js).
// ---------------------------------------------------------------------------
// Loads all sprite sheets (run/jump/duck) as arrays of THREE.Texture. Pure
// asset loading: takes THREE (so the engine controls the dep) and reads frame
// counts / dirs from ASSETS. No game state.
// ===========================================================================
import { ASSETS, getSelectedCharacter } from '../config.js';

// Load all sprite sheets (run/jump/duck) as arrays of THREE.Texture for the given
// character's sprite set. `sprites` defaults to the selected playable character
// (getSelectedCharacter().sprites); falls back to the legacy ASSETS sheets.
export function makeSpriteSheets(THREE, sprites) {
  const set = sprites || (getSelectedCharacter().sprites)
    || { run: ASSETS.run, jump: ASSETS.jump, duck: ASSETS.duck };
  const loader = new THREE.TextureLoader();
  const make = (cfg) => {
    const frames = [];
    for (let i = 0; i < cfg.count; i++) {
      const n = String(i).padStart(2, '0');
      // Frames ship as high-quality WebP (visually identical to the source PNGs
      // at ~1/10th the bytes — see public/assets/temple/char).
      const t = loader.load(`${cfg.dir}/r_${n}.${cfg.ext || 'webp'}`);
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      frames.push(t);
    }
    return { frames, count: cfg.count };
  };
  const sheets = { run: make(set.run), jump: make(set.jump), duck: make(set.duck) };
  if (set.lift) sheets.lift = make(set.lift);   // optional: L5 gem-claim lift (per character)
  return sheets;
}

export default makeSpriteSheets;
