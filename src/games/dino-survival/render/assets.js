// ===========================================================================
// Dino Survival — ASSET LOADER. Loads the scene images into an Image map.
// Missing files resolve silently (the scene null-checks), so the game still
// runs if an optional frame (e.g. run2/run3) isn't present.
// ===========================================================================
import { ASSET_SRC, DINO_RUN_FRAMES, BG_LOOP_FRAMES, RUNNER_FRAMES, RUNNER_RIG_URL } from '../config.js';

const loadImg = (src, set) => new Promise((res) => { const im = new Image(); im.onload = () => { set(im); res(); }; im.onerror = () => res(); im.src = src; });

export function loadAssets() {
  const out = { dinoRunFrames: [], bgLoop: [], runnerFrames: [], runnerRig: null };
  const single = Object.entries(ASSET_SRC).map(([k, src]) => loadImg(src, (im) => { out[k] = im; }));
  const frames = DINO_RUN_FRAMES.map((src, i) => loadImg(src, (im) => { out.dinoRunFrames[i] = im; }));
  const bg = BG_LOOP_FRAMES.map((src, i) => loadImg(src, (im) => { out.bgLoop[i] = im; }));
  const runr = RUNNER_FRAMES.map((src, i) => loadImg(src, (im) => { out.runnerFrames[i] = im; }));
  const rig = fetch(RUNNER_RIG_URL).then(r => r.json()).then(j => { out.runnerRig = j; }).catch(() => {});
  return Promise.all([...single, ...frames, ...bg, ...runr, rig]).then(() => {
    out.dinoRunFrames = out.dinoRunFrames.filter(Boolean);
    out.bgLoop = out.bgLoop.filter(Boolean);
    out.runnerFrames = out.runnerFrames.filter(Boolean);
    return out;
  });
}
