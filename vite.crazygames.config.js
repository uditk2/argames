// ===========================================================================
// Vite config for the STANDALONE CrazyGames build of Relic Hunter.
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
//   • publicDir: false + the shared packaging plugin — instead of dumping the
//                         whole 100MB+ public/ (dino, keeper, big stadium PNGs
//                         belong to OTHER games), it copies ONLY the temple
//                         assets this build references, plus favicons.
//
// The asset manifest lives in build/temple-assets.mjs and is SHARED with
// vite.portable.config.js — see the note there about why it is not duplicated.
//
// Build:  npm run build:crazygames
// Output: dist-crazygames/  (zip its CONTENTS for the upload)
// ===========================================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { packageTempleBuild } from './build/temple-assets.mjs';

const ROOT = resolve(import.meta.dirname);
const OUT_DIR = 'dist-crazygames';

export default defineConfig({
  base: './',
  publicDir: false,
  define: { 'import.meta.env.VITE_CRAZYGAMES': JSON.stringify('true') },
  plugins: [
    react(),
    packageTempleBuild({
      root: ROOT,
      outDir: OUT_DIR,
      entryHtml: 'crazygames.html',
      label: 'crazygames build',
      note: '(limits: 250 MB / 1500 files; mobile-homepage tier: 20 MB)',
    }),
  ],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    rollupOptions: { input: resolve(ROOT, 'crazygames.html') },
  },
});
