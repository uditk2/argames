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

// Only the temple assets actually referenced by the game. This list is an
// ALLOWLIST and is the single thing that decides what ships — keep it in sync
// with `assetUrl('assets/temple/...')` call sites:
//
//   grep -rhoE "assets/temple/[A-Za-z0-9_./-]*" src/ | sort -u
//
// A missing entry means a 404 ON THE PORTAL ONLY (public/ still serves it in dev
// and in the portal build), which is invisible until QA plays the packaged zip —
// so `copyFile` below HARD-FAILS the build on a missing source file rather than
// silently skipping it. Deliberately EXCLUDES the stale run_bak / run_bak29 dirs,
// the unused lion_fire*/obs_firejet/obs_blade art, and the two unused music beds
// (music.mp3, music_trailer.mp3 — ~6.8 MB; only music_chase.mp3 is played).
const TEMPLE_FLAT = [
  // Raster art ships as high-quality WebP (converted from the source PNG/JPG at
  // ~1/10th the bytes, visually identical). Keeps the initial download small.
  'boulder_hero.webp', 'corridor_bright.webp', 'corridor_dark.webp', 'crack_floor.webp',
  'doorway_panel.webp', 'exit_light.webp', 'fire_jet_sheet.webp', 'gem_hero.webp',
  'life_full.webp', 'life_lost.webp', 'lion_head.webp', 'map_frame.webp',
  'obs_beam.webp', 'obs_blade_head.webp', 'stone_door.webp', 'tex_floor.webp',
  'tex_wall.webp',
  // Gem-claim sunburst clip (GemClaimFX plays webm, falls back to mp4).
  'gem_claim.webm', 'gem_claim.mp4',
  'level1.json', 'level2.json', 'level3_maze.json', 'level4_maze.json',
  'level5_maze.json', 'level6_maze.json', 'map.json',
  // Audio: the CC0 SFX set + the one music bed that is actually played.
  // Mirror of SAMPLES/MUSIC in src/games/temple/engine/audio.js.
  'audio/back.ogg', 'audio/blade.ogg', 'audio/clear.ogg', 'audio/collapse.ogg',
  'audio/die.ogg', 'audio/door.ogg', 'audio/duck.ogg', 'audio/footstep.ogg',
  'audio/jump.ogg', 'audio/lose.ogg', 'audio/pickup.ogg', 'audio/stumble.ogg',
  'audio/turn.ogg', 'audio/win.ogg', 'audio/music_chase.mp3',
];
// Copied whole. Char sprite sets: the legacy default plus the two playable
// hunters (Mira also has the L5 'lift' set); `vo/` is the bilingual narration.
const TEMPLE_DIRS = [
  'char/run', 'char/jump', 'char/duck',
  'char/mira/run', 'char/mira/jump', 'char/mira/duck', 'char/mira/lift',
  'char/vikram/run', 'char/vikram/jump', 'char/vikram/duck',
  'vo',
];
// Site-wide files the HTML references. `privacy.html` is NOT optional here: the
// consent banner (src/ui/ConsentNotice.jsx) links to ./privacy.html, and that
// banner is what satisfies the CrazyGames User Consent rule — a 404 behind it
// defeats the purpose. It is self-contained (no css/js of its own).
const ROOT_FILES = ['favicon.svg', 'favicon.ico', 'privacy.html'];

function copyFile(from, to) {
  if (!fs.existsSync(from)) {
    // Hard-fail: a silently-skipped asset is a 404 that only shows up once QA
    // plays the uploaded zip on the portal.
    throw new Error(`[crazygames build] missing asset: ${from}\n  → fix the path in public/, or drop the entry from vite.crazygames.config.js`);
  }
  fs.mkdirSync(resolve(to, '..'), { recursive: true });
  fs.copyFileSync(from, to);
}
function copyDir(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`[crazygames build] missing asset dir: ${from}\n  → fix the path in public/, or drop the entry from vite.crazygames.config.js`);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name === '.DS_Store') continue;
    const s = resolve(from, name);
    const d = resolve(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    // Char frames now ship as WebP; skip the superseded source PNGs so the
    // packaged build doesn't carry ~50MB of dead sprite art.
    else if (!name.endsWith('.png')) fs.copyFileSync(s, d);
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

      // ENTRY FILE — Vite names the output after the input HTML, so we get
      // `crazygames.html`. The CrazyGames SDK docs describe the game entry as
      // "your game's index.html", and the uploaded zip is served as a directory,
      // so rename it. All refs inside are relative (base: './'), so the rename
      // is safe.
      const src = resolve(dst, 'crazygames.html');
      if (fs.existsSync(src)) fs.renameSync(src, resolve(dst, 'index.html'));
      if (!fs.existsSync(resolve(dst, 'index.html'))) {
        throw new Error('[crazygames build] no index.html in the output — CrazyGames needs one at the zip root.');
      }

      // Size report — the two numbers CrazyGames actually enforces
      // (≤250 MB total / ≤1500 files, and the ≤50 MB & ≤20 MB download tiers).
      let bytes = 0, files = 0;
      (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
          const p = resolve(dir, name);
          const st = fs.statSync(p);
          if (st.isDirectory()) walk(p); else { bytes += st.size; files += 1; }
        }
      })(dst);
      const mb = (bytes / 1024 / 1024).toFixed(1);
      console.log(`\n[crazygames build] ${outDir}/ → ${mb} MB across ${files} files  (limits: 250 MB / 1500 files; mobile-homepage tier: 20 MB)\n`);
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
