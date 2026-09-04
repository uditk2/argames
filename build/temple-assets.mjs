// ===========================================================================
// SHARED asset manifest + packaging plugin for every standalone Relic Hunter
// build (CrazyGames, and the portal-neutral one).
// ---------------------------------------------------------------------------
// This lives in ONE place on purpose. The CrazyGames build previously carried
// its own hand-written copy of this list; the game kept growing, the list did
// not, and the packaged zip silently shipped without half its assets — broken
// on-platform while still perfect in dev, because public/ serves everything
// locally. A second build config with a second copy of the list would rot the
// same way, so both configs import this module instead.
//
// Keep the list in sync with the runtime call sites:
//   grep -rhoE "assets/temple/[A-Za-z0-9_./-]*" src/ | sort -u
//
// copyFile/copyDir HARD-FAIL on a missing source rather than skipping it, so a
// stale entry breaks the build loudly instead of shipping a 404.
// ===========================================================================
import { resolve } from 'node:path';
import fs from 'node:fs';

// Raster art ships as high-quality WebP (converted from the source PNG/JPG at
// ~1/10th the bytes, visually identical). Deliberately EXCLUDES the unused
// lion_fire*/obs_firejet art and the unplayed music beds.
export const TEMPLE_FLAT = [
  'boulder_hero.webp', 'corridor_bright.webp', 'corridor_dark.webp', 'crack_floor.webp',
  'doorway_panel.webp', 'exit_light.webp', 'fire_jet_sheet.webp', 'gem_hero.webp',
  'lion_head.webp', 'map_frame.webp',
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
export const TEMPLE_DIRS = [
  'char/run', 'char/jump', 'char/duck',
  'char/mira/run', 'char/mira/jump', 'char/mira/duck', 'char/mira/lift',
  'char/vikram/run', 'char/vikram/jump', 'char/vikram/duck',
  'vo',
];

// Site-wide files the HTML references. `privacy.html` is NOT optional: the
// consent banner (src/ui/ConsentNotice.jsx) links to ./privacy.html, and that
// banner is what satisfies the portals' user-consent rules — a 404 behind it
// defeats the purpose. It is self-contained (no css/js of its own).
export const ROOT_FILES = ['favicon.svg', 'favicon.ico', 'privacy.html'];

function copyFile(label, from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`[${label}] missing asset: ${from}\n  → fix the path in public/, or drop the entry from build/temple-assets.mjs`);
  }
  fs.mkdirSync(resolve(to, '..'), { recursive: true });
  fs.copyFileSync(from, to);
}
function copyDir(label, from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`[${label}] missing asset dir: ${from}\n  → fix the path in public/, or drop the entry from build/temple-assets.mjs`);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name === '.DS_Store') continue;
    const s = resolve(from, name);
    const d = resolve(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(label, s, d);
    // Char frames ship as WebP; skip the superseded source PNGs so the packaged
    // build doesn't carry ~50MB of dead sprite art.
    else if (!name.endsWith('.png')) fs.copyFileSync(s, d);
  }
}

/**
 * Vite plugin: copy the curated asset set in, rename the entry HTML to
 * index.html, and print a size report. Runs after Vite writes the bundle.
 *
 * @param {object} o
 * @param {string} o.root      project root
 * @param {string} o.outDir    build output dir (relative to root)
 * @param {string} o.entryHtml the input HTML's filename, renamed to index.html
 * @param {string} o.label     prefix for log/error lines
 * @param {string} [o.note]    extra text appended to the size report
 */
export function packageTempleBuild({ root, outDir, entryHtml, label, note = '' }) {
  const PUBLIC = resolve(root, 'public');
  return {
    name: 'package-temple-build',
    apply: 'build',
    closeBundle() {
      const dst = resolve(root, outDir);
      const tSrc = resolve(PUBLIC, 'assets/temple');
      const tDst = resolve(dst, 'assets/temple');
      for (const f of TEMPLE_FLAT) copyFile(label, resolve(tSrc, f), resolve(tDst, f));
      for (const d of TEMPLE_DIRS) copyDir(label, resolve(tSrc, d), resolve(tDst, d));
      for (const f of ROOT_FILES) copyFile(label, resolve(PUBLIC, f), resolve(dst, f));

      // ENTRY FILE — Vite names the output after the input HTML. Every portal
      // serves an uploaded bundle as a directory and looks for index.html, so
      // rename it. All refs inside are relative (base: './'), so this is safe.
      const src = resolve(dst, entryHtml);
      if (fs.existsSync(src)) fs.renameSync(src, resolve(dst, 'index.html'));
      if (!fs.existsSync(resolve(dst, 'index.html'))) {
        throw new Error(`[${label}] no index.html in the output — the zip root needs one.`);
      }

      let bytes = 0, files = 0;
      (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
          const p = resolve(dir, name);
          const st = fs.statSync(p);
          if (st.isDirectory()) walk(p); else { bytes += st.size; files += 1; }
        }
      })(dst);
      console.log(`\n[${label}] ${outDir}/ → ${(bytes / 1024 / 1024).toFixed(1)} MB across ${files} files${note ? '  ' + note : ''}\n`);
    },
  };
}
