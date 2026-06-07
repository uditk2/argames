// ===========================================================================
// THEME BRIDGE — reads the brand palette from the CSS variables defined in
// src/index.css so JavaScript (PixiJS WebGL, the <canvas> score card) shares
// ONE source of truth with the stylesheet. Change the colors in index.css and
// everything — UI, energy FX, share card — retints together.
//
//   COLOR.magic   -> 0xRRGGBB number (for PixiJS tints / Graphics fills)
//   rgba.magic(a) -> 'rgba(r,g,b,a)' string (for 2D canvas / inline styles)
// ===========================================================================

// Fallbacks mirror index.css so this never throws server-side or pre-paint.
const FALLBACK = {
  magic: '255 182 39',
  fire: '255 122 60',
  'fire-bright': '255 194 94',
  gold: '255 213 74',
  shield: '87 227 255',
  ink: '250 244 233',
  realm: '10 6 18',
  'realm-tint': '36 22 12',
};

function channels(name) {
  let raw = '';
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}-rgb`).trim();
    }
  } catch {
    /* ignore — use fallback */
  }
  const parts = (raw || FALLBACK[name]).split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
  return parts.length === 3 ? parts : FALLBACK[name].split(/\s+/).map(Number);
}

function toNum([r, g, b]) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

// Resolve once at module load (after the stylesheet has applied).
const CH = {
  magic: channels('magic'),
  fire: channels('fire'),
  fireBright: channels('fire-bright'),
  gold: channels('gold'),
  shield: channels('shield'),
  ink: channels('ink'),
  realm: channels('realm'),
  realmTint: channels('realm-tint'),
};

/** Numeric 0xRRGGBB colors for PixiJS tints / Graphics. */
export const COLOR = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, toNum(v)]));

/** rgba() string builders for 2D canvas / inline styles. `a` optional (0..1). */
export const rgba = Object.fromEntries(
  Object.entries(CH).map(([k, [r, g, b]]) => [k, (a) => (a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`)])
);
