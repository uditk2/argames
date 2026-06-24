// ===========================================================================
// Keeper — THEME + ASSET CONTRACT (the aesthetics seam). SINGLE SOURCE OF TRUTH.
// ===========================================================================
// This module merges the rich theme-pack `KEEPER_THEME` (colors aligned to the
// app's --magic/--realm/--gold/--fire, semantic `roles`, `layout` fractions,
// `intensity(level)`, `bgForLevel(level)`) WITH the game module's asset/sfx
// resolver behavior (`getAsset`, `getSfxUrl`) and tasteful procedural fallbacks
// so the game always runs — even before any art/audio file is dropped in.
//
// Colors read LIVE from the app's CSS vars in the browser (so a palette change
// in src/index.css retints Keeper too) and fall back to the brand literals when
// CSS is unavailable (e.g. canvas math during tests / SSR).
//
// ---------------------------------------------------------------------------
// ASSET CONTRACT — two upgrade paths, both optional:
//
//   (1) STADIUM BACKGROUND PNGs (preferred upgrade, OpenAI gpt-image-1):
//       run  OPENAI_API_KEY=sk-... node theme/generate-backgrounds.mjs
//       PNGs land in  theme/assets/bg/stadium-{day,night,finals}.png
//       (filenames are exactly KEEPER_THEME.assets). The Vite glob below picks
//       them up at build; KEEPER_THEME.bgForLevel(level) → getBackgroundUrl()
//       resolves the right one. Absent → drawBackground() paints the procedural
//       night-stadium art (see theme/background.js).
//
//   (2) LEGACY ASSET SLOTS (drop-in sprites / sfx samples):
//       src/games/keeper/assets/bg-stadium.(png|svg|…)   → getAsset('bg')
//       src/games/keeper/assets/glove.(svg|png|…)        → getAsset('glove')
//       src/games/keeper/assets/sfx/<name>.(mp3|ogg|wav) → getSfxUrl(name)
//       If neither glob nor /public is present, the resolvers return null and
//       the renderer/audio fall back to procedural art + Web-Audio synth.
// ===========================================================================

// --- Brand palette (mirrors src/index.css; read live from CSS vars) ---------
/** Brand channels mirrored from src/index.css (space-separated RGB). */
const FALLBACK = {
  magic: '255 182 39',
  fire: '255 122 60',
  fireBright: '255 194 94',
  gold: '255 213 74',
  shield: '87 227 255',
  ink: '250 244 233',
  realm: '10 6 18',
  realmTint: '36 22 12',
};

// CSS var name (kebab) for each token, for live reads in the browser.
const CSS_VAR = {
  magic: 'magic',
  fire: 'fire',
  fireBright: 'fire-bright',
  gold: 'gold',
  shield: 'shield',
  ink: 'ink',
  realm: 'realm',
  realmTint: 'realm-tint',
};

function channels(key) {
  let raw = '';
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      raw = getComputedStyle(document.documentElement)
        .getPropertyValue(`--${CSS_VAR[key]}-rgb`)
        .trim();
    }
  } catch {
    /* ignore — use fallback */
  }
  const parts = (raw || FALLBACK[key])
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  return parts.length === 3 ? parts : FALLBACK[key].split(/\s+/).map(Number);
}

const CH = Object.fromEntries(Object.keys(FALLBACK).map((k) => [k, channels(k)]));

/** rgb()/rgba() string builder. `a` optional (0..1). */
function mk([r, g, b]) {
  return (a) => (a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);
}

/** rgba(...) string helpers, e.g. rgba.gold(0.5). */
export const rgba = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, mk(v)]));

/** Solid color strings, e.g. COLOR.gold === 'rgb(255,213,74)'. */
export const COLOR = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, mk(v)()]));

/** Raw [r,g,b] channels, e.g. CHANNELS.magic === [255,182,39]. */
export const CHANNELS = CH;

// ===========================================================================
// ASSET RESOLVERS — Vite glob auto-discovery + optional /public fallbacks.
// ===========================================================================
// (a) Vite glob auto-discovery. Eagerly resolves to URL strings. Safe when the
// assets dirs are empty (returns {}). Globs BOTH the legacy `../assets/**`
// slots AND the theme-pack `./assets/bg/**` generated PNGs.
let GLOB = {};
let SHOOTER_MANIFEST = null;
try {
  // import.meta.glob is a Vite compile-time macro; in plain Node (tests) it's
  // undefined, so we guard. Single simple positive glob (no array/negative
  // pattern — that combination silently returned {} here), eager url strings.
  // eslint-disable-next-line no-undef
  if (typeof import.meta !== 'undefined' && import.meta.glob) {
    const all = import.meta.glob('./**/*.{png,jpg,jpeg,webp,svg,mp3,ogg,wav}', {
      eager: true, query: '?url', import: 'default',
    });
    // Keep everything except extractor review artifacts (underscore-prefixed
    // files/dirs like `_contact.png` / `_review/`).
    for (const k in all) { if (!/(^|\/)_/.test(k)) GLOB[k] = all[k]; }
    // Shooter manifest as a parsed JSON module (a `?url` json is NOT emitted).
    const mans = import.meta.glob('./assets/shooter/*.json', { eager: true, import: 'default' });
    SHOOTER_MANIFEST = mans['./assets/shooter/shooter_kick.json'] || null;
  }
} catch (e) {
  if (typeof console !== 'undefined') console.error('[keeper] asset glob failed:', e);
  GLOB = {}; SHOOTER_MANIFEST = null;
}

// (b) Optional /public fallbacks (set these if you ship files under /public).
const PUBLIC = {
  bg: null,        // e.g. '/assets/keeper/bg-stadium.png'
  glove: null,     // e.g. '/assets/keeper/glove.svg'
  sfx: {
    save: null, goal: null, whistle: null, levelup: null, ambience: null,
  },
};

// Resolve a logical asset name against the glob, trying common extensions.
function fromGlob(stem, exts) {
  for (const ext of exts) {
    const key = `./assets/${stem}.${ext}`;
    if (GLOB[key]) return GLOB[key];
  }
  return null;
}

const IMG_EXTS = ['svg', 'png', 'webp', 'jpg', 'jpeg'];
const SND_EXTS = ['mp3', 'ogg', 'wav'];

/** URL for an image asset slot ('bg' | 'glove'), or null to use the fallback. */
export function getAsset(name) {
  if (name === 'bg') return fromGlob('bg-stadium', IMG_EXTS) || PUBLIC.bg;
  if (name === 'glove') return fromGlob('glove', IMG_EXTS) || PUBLIC.glove;
  return null;
}

/** URL for a sound effect ('save'|'goal'|'whistle'|'levelup'|'ambience'), or null. */
export function getSfxUrl(name) {
  return fromGlob(`sfx/${name}`, SND_EXTS) || (PUBLIC.sfx && PUBLIC.sfx[name]) || null;
}

/**
 * Resolve a theme-pack background path (e.g. 'assets/bg/stadium-night.png',
 * as returned by KEEPER_THEME.bgForLevel / KEEPER_THEME.assets) into a runtime
 * URL the browser can load, or null if the PNG hasn't been generated yet.
 * The generator writes PNGs into theme/assets/bg/, which the glob above keys as
 * './theme/assets/bg/stadium-*.png'.
 */
export function getBackgroundUrl(relPath) {
  if (!relPath) return null;
  const file = String(relPath).split('/').pop();           // 'stadium-night.png'
  // Served from /public (copied there) — robust in dev AND build, unlike the
  // import.meta.glob which returns {} in this setup.
  return `/assets/keeper/bg/${file}`;
}

/**
 * SHOOTER kick-cycle sprite (optional upgrade; see assets/shooter/README.md).
 * The extractor (`assets/shooter/extract_shooter.py`) writes `kick_NN.png` frames
 * + a `shooter_kick.json` manifest into `assets/shooter/`; the Vite glob above
 * picks them up. Absent → resolvers return null and the renderer draws the
 * procedural silhouette instead.
 */
// Frames + manifest are served from /public (copied to public/assets/keeper/shooter/).
// The kick clip is fixed (14 frames), so the manifest is a constant — robust in
// dev AND build, and avoids the import.meta.glob path that returns {} here.
const SHOOTER_MANIFEST_CONST = { frames: 14, fps: 18, w: 537, h: 512, contactFrame: 7 };
/** Parsed shooter manifest object {frames,fps,w,h,contactFrame}, or null. */
export function getShooterManifest() {
  return SHOOTER_MANIFEST || SHOOTER_MANIFEST_CONST;
}
/** URLs for the N kick frames `kick_00.png … kick_(N-1).png` (in order). */
export function getShooterFrameUrls(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`/assets/keeper/shooter/kick_${String(i).padStart(2, '0')}.png`);
  }
  return out;
}

// ===========================================================================
// KEEPER_THEME — the consolidated token object (theme-pack's richer shape),
// extended with the game module's `labels` + a back-compat `colors` alias so
// existing call sites (Keeper.jsx's COL.save/goal/gold/magic/fire, …) keep
// working against the same single source of truth.
// ===========================================================================
export const KEEPER_THEME = {
  /** Brand colors as rgb() strings. */
  color: COLOR,
  /** Brand colors as alpha builders: theme.rgba.gold(0.4). */
  rgba,
  /** Raw channels for canvas math / gradients. */
  channels: CH,

  // --- Semantic roles used across the Keeper surfaces -----------------------
  roles: {
    skyTop: 'rgb(8,6,20)', // night sky zenith (slightly above --realm)
    skyHorizon: COLOR.realm, // deep horizon
    skyGlow: rgba.magic(0.16), // gold sky bloom over the stadium bowl
    pitch: 'rgb(14,26,16)', // floodlit grass (cool dark green, reads at night)
    pitchStripe: 'rgb(20,38,22)', // mown stripe (lighter band)
    pitchLine: rgba.ink(0.55), // painted pitch markings
    crowd: 'rgb(16,12,26)', // crowd silhouette mass
    crowdSpark: rgba.gold(0.5), // phone-light / flash speckle in the stands
    floodlight: rgba.fireBright(0.9), // floodlight lamp core
    floodlightBeam: rgba.gold(0.1), // volumetric light cone
    frame: COLOR.ink, // goal posts/crossbar (painted white)
    frameShadow: 'rgba(0,0,0,0.5)',
    net: rgba.ink(0.14), // goal net mesh
    netGlow: rgba.magic(0.1),
    ball: COLOR.ink, // ball body (off-white)
    ballPanel: 'rgb(28,24,40)', // ball pentagons
    keeper: rgba.magic(0.55), // keeper silhouette fill (molten gold)
    keeperLimb: rgba.gold(0.8), // keeper limbs
    keeperGlove: COLOR.gold, // gloves (bright gold)
    keeperGlow: rgba.magic(0.85), // keeper aura
    save: COLOR.gold, // SAVE banner + save pip
    saveGlow: rgba.gold(0.9),
    goal: COLOR.fire, // GOAL-conceded banner + pip (fire orange)
    goalGlow: rgba.fire(0.9),
    hudText: COLOR.ink,
    hudMuted: 'rgb(168,158,140)', // matches Home.jsx --muted
    panel: 'rgba(26, 18, 10, 0.55)', // matches --panel
    panelBorder: rgba.magic(0.4), // matches --panel-border
    levelUp: COLOR.gold,
    whistle: COLOR.ink,
  },

  // --- Back-compat color alias (the game module's original `colors` keys) ----
  // Maps the legacy renderer/HUD color names onto the brand-aligned roles so
  // existing call sites flow into the same single source of truth.
  get colors() {
    return {
      save: this.roles.save,         // gold — a save (theme-pack semantics)
      goal: this.roles.goal,         // fire orange — conceded
      gold: COLOR.gold,
      keeperFill: this.roles.keeper,
      keeperLimb: this.roles.keeperLimb,
      keeperGlow: this.roles.keeperGlow,
      glove: this.roles.keeperGlove,
      ball: this.roles.ball,
      net: this.roles.net,
      frame: this.roles.frame,
      magic: COLOR.magic,
      fire: COLOR.fire,
      realm: COLOR.realm,
    };
  },

  labels: {
    save: 'SAVE',
    goal: 'GOAL',
    incoming: 'SHOTS INCOMING',
    levelUp: 'LEVEL UP',
  },

  // --- Layout / sizing (fractions of the play surface) ----------------------
  // Mirror keeper-ar's goalRect(): x 0.13..0.87, y 0.12..0.90. NOTE: the game
  // engine derives the live goal rect from config.GOAL (centered, width grows
  // with level), so the renderer uses goalRect() for gameplay; these fractions
  // are kept for the theme-pack painters' net-cell / floodlight placement.
  layout: {
    goal: { x0: 0.13, x1: 0.87, y0: 0.12, y1: 0.9 },
    frameWidth: 0.012, // post thickness as a fraction of min(w,h)
    netCell: 26, // net mesh spacing in px (scaled by dpr)
    horizon: 0.62, // y-fraction where pitch meets crowd
    floodlights: [0.16, 0.5, 0.84], // x-fractions of the 3 floodlight masts
  },

  // --- Difficulty / level ramp aesthetics -----------------------------------
  // Visual intensity scales with level: more flashes, warmer sky, brighter
  // floodlights. `intensity(level)` returns 0..1 used by background.js.
  intensity(level = 1) {
    return Math.max(0, Math.min(1, (level - 1) / 11)); // saturates by ~level 12
  },

  // --- Typography -----------------------------------------------------------
  font: {
    display: "'Cinzel Decorative', serif", // big banners (matches .font-display)
    ui: "'Fredoka', system-ui, sans-serif", // HUD / body
    mono: 'ui-monospace, SFMono-Regular, monospace', // telemetry
  },

  // --- Asset filenames the runtime prefers when present (see THEME_CONTRACT) -
  assets: {
    bgDay: 'assets/bg/stadium-day.png',
    bgNight: 'assets/bg/stadium-night.png',
    bgFinals: 'assets/bg/stadium-finals.png',
  },

  /** Pick the bg asset path for a level — time-of-day progresses with difficulty:
   *  DAY for levels 1–3, NIGHT for 4–8, FINALS (floodlit, fiery) for 9+. */
  bgForLevel(level = 1) {
    if (level >= 9) return this.assets.bgFinals;
    if (level >= 4) return this.assets.bgNight;
    return this.assets.bgDay;
  },
};

export default KEEPER_THEME;
