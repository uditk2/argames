// ===========================================================================
// Vite config for the PORTAL-NEUTRAL build of Relic Hunter.
// ---------------------------------------------------------------------------
// Identical packaging to the CrazyGames build (relative paths, curated assets,
// index.html at the root) but with NO portal SDK wired in — see portable.html
// and src/portable-main.jsx. Upload dist-portable/ anywhere that takes a plain
// HTML5 bundle, or use it as the base for a different portal's SDK.
//
// The asset manifest is imported from build/temple-assets.mjs and SHARED with
// vite.crazygames.config.js. Do not fork it: the CrazyGames build once carried
// its own copy, the list went stale as the game grew, and the packaged bundle
// shipped without half its assets — invisible locally, broken on the portal.
//
// Build:  npm run build:portable
// Output: dist-portable/  (zip its CONTENTS for the upload)
// ===========================================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { packageTempleBuild } from './build/temple-assets.mjs';

const ROOT = resolve(import.meta.dirname);
const OUT_DIR = 'dist-portable';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [
    react(),
    packageTempleBuild({
      root: ROOT,
      outDir: OUT_DIR,
      entryHtml: 'portable.html',
      label: 'portable build',
      note: '(no portal SDK — upload anywhere)',
    }),
  ],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    rollupOptions: { input: resolve(ROOT, 'portable.html') },
  },
});
