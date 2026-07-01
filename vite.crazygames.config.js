// ===========================================================================
// Vite config for the STANDALONE CrazyGames build of Temple Collapse.
// ---------------------------------------------------------------------------
// Differences from the main vite.config.js (which is untouched):
//   • base: './'        — RELATIVE asset paths (CrazyGames hosts the build in a
//                         subframe; JS/CSS must load via ./assets/...).
//   • single entry      — crazygames.html → src/crazygames-main.jsx, which
//                         renders ONLY <TempleDash /> (no portal / other games).
//   • outDir            — dist-crazygames/ (kept separate from the portal dist).
//   • VITE_CRAZYGAMES   — defined 'true' so the SDK wrapper's env branch is on
//                         (belt-and-suspenders alongside the window flag in the
//                         HTML). The portal build never sees this define.
//   • publicDir: false + a copy plugin — instead of dumping the whole 100MB+
//                         public/ (dino, keeper, big stadium PNGs belong to OTHER
//                         games), we copy ONLY the temple assets this build
//                         actually references, plus favicons. Keeps the initial
//                         download small and excludes stale backups.
//
// Build:  npm run build:crazygames   (→ vite build --config vite.crazygames.config.js)
// Output: dist-crazygames/  (zip its contents for the CrazyGames upload)
// ===========================================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import fs from 'node:fs';

const ROOT = resolve(import.meta.dirname);
const PUBLIC = resolve(ROOT, 'public');

// Only the temple assets actually referenced by the game (see grep of
// src/games/temple for /assets/temple/*). The three char sprite dirs are copied
// whole; everything else is a flat file. Deliberately EXCLUDES the stale
// run_bak / run_bak29 dirs and the unused lion_fire*/obs_firejet/obs_blade art.
const TEMPLE_FLAT = [
  'boulder_hero.png', 'corridor_dark.png', 'crack_floor.png', 'exit_light.jpg',
  'fire_jet_sheet.png', 'life_full.png', 'life_lost.png', 'lion_head.png',
  'map_frame.png', 'obs_beam.png', 'obs_blade_head.png', 'tex_floor.jpg',
  'tex_wall.jpg',
  'level1.json', 'level2.json', 'level3_maze.json', 'map.json',
];
const TEMPLE_DIRS = ['char/run', 'char/jump', 'char/duck'];
// Site-wide files the HTML references.
const ROOT_FILES = ['favicon.svg', 'favicon.ico'];

function copyFile(from, to) {
  fs.mkdirSync(resolve(to, '..'), { recursive: true });
  fs.copyFileSync(from, to);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = resolve(from, name);
    const d = resolve(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy the curated asset set into the finished build. Runs after Vite writes the
// bundle so nothing clobbers it.
function copyTempleAssets(outDir) {
  return {
    name: 'copy-temple-assets',
    apply: 'build',
    closeBundle() {
      const dst = resolve(ROOT, outDir);
      const tSrc = resolve(PUBLIC, 'assets/temple');
      const tDst = resolve(dst, 'assets/temple');
      for (const f of TEMPLE_FLAT) {
        const from = resolve(tSrc, f);
        if (fs.existsSync(from)) copyFile(from, resolve(tDst, f));
      }
      for (const d of TEMPLE_DIRS) {
        const from = resolve(tSrc, d);
        if (fs.existsSync(from)) copyDir(from, resolve(tDst, d));
      }
      for (const f of ROOT_FILES) {
        const from = resolve(PUBLIC, f);
        if (fs.existsSync(from)) copyFile(from, resolve(dst, f));
      }
    },
  };
}

const OUT_DIR = 'dist-crazygames';

export default defineConfig({
  base: './',
  publicDir: false,
  define: { 'import.meta.env.VITE_CRAZYGAMES': JSON.stringify('true') },
  plugins: [react(), copyTempleAssets(OUT_DIR)],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(ROOT, 'crazygames.html'),
    },
  },
});
