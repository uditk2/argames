#!/usr/bin/env bash
# =============================================================================
# build-grotto-demo.sh
# Build a SELF-CONTAINED, relative-path HTML5 bundle of the Dino Survival
# KEYBOARD demo (no webcam / no AR needed) for upload to itch-style HTML5
# storefronts such as The Grotto (enterthegrotto.xyz).
#
# It does NOT modify any tracked game source. It writes a few temp entry files
# (prefixed ._grotto_), builds a dino-only bundle into an output dir, rewrites
# the runtime "/assets/..." paths to be relative so the game works from any
# subpath/iframe, prunes assets unused by Dino Survival, zips it, and removes
# the temp files on exit (success or failure).
#
# Usage:
#   scripts/build-grotto-demo.sh [OUT_DIR] [ZIP_PATH]
# Defaults:
#   OUT_DIR  = <repo>/dist-grotto
#   ZIP_PATH = <repo>/dino-survival-grotto.zip
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-$ROOT/dist-grotto}"
ZIP="${2:-$ROOT/dino-survival-grotto.zip}"

# NOTE: temp names must NOT start with a dot — the entry HTML basename becomes
# the emitted JS/CSS filename, and many static hosts refuse to serve dotfiles.
TMP_HTML="$ROOT/grotto_tmp_dino.html"
TMP_ENTRY="$ROOT/grotto_tmp_dino_entry.jsx"
TMP_CFG="$ROOT/grotto_tmp_vite.config.mjs"

cleanup() { rm -f "$TMP_HTML" "$TMP_ENTRY" "$TMP_CFG"; }
trap cleanup EXIT

# --- 1. Throwaway entry: render ONLY Dino Survival (no router, no home) -------
cat > "$TMP_ENTRY" <<'EOF'
import React from 'react';
import { createRoot } from 'react-dom/client';
import DinoSurvival from './src/games/dino-survival/index.js';
import { getName, setName } from './src/net/identity.js';
import './src/index.css';

// Pre-seed a player name so the storefront visitor can hit "Demo (keyboard)"
// immediately (the Start button is disabled until a name exists).
try { if (!getName || !getName()) setName('Player'); } catch {}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DinoSurvival onExit={() => window.location.reload()} />
  </React.StrictMode>
);
EOF

# --- 2. Throwaway HTML shell -------------------------------------------------
cat > "$TMP_HTML" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Dino Survival</title>
    <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#root{height:100%}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/grotto_tmp_dino_entry.jsx"></script>
  </body>
</html>
EOF

# --- 3. Throwaway Vite config (relative base => works from any subpath) -------
cat > "$TMP_CFG" <<EOF
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '$OUT',
    emptyOutDir: true,
    rollupOptions: { input: '$TMP_HTML' },
  },
});
EOF

# --- 4. Build ----------------------------------------------------------------
echo "==> Building dino-only bundle to $OUT"
npx vite build --config "$TMP_CFG"

# --- 5. Post-process the OUTPUT only -----------------------------------------
# 5a. entry html -> index.html (storefronts expect index.html at the zip root)
mv "$OUT/grotto_tmp_dino.html" "$OUT/index.html"

# 5b. make runtime asset URLs relative so they resolve under any host subpath
find "$OUT/assets" -name '*.js' -type f -print0 \
  | xargs -0 sed -i 's#/assets/dino-survival#./assets/dino-survival#g'

# 5c. drop assets/extras NOT used by Dino Survival (Monster Punch + SEO files)
find "$OUT/assets" -mindepth 1 -maxdepth 1 -type d ! -name 'dino-survival' -exec rm -rf {} +
rm -f "$OUT/og-cover.png" "$OUT/robots.txt" "$OUT/sitemap.xml"

# --- 6. Zip ------------------------------------------------------------------
rm -f "$ZIP"
( cd "$OUT" && zip -qr "$ZIP" . )

echo "==> Done."
echo "    Bundle dir: $OUT"
echo "    Zip:        $ZIP ($(du -h "$ZIP" | cut -f1))"
