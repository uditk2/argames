// ===========================================================================
// BRAND — single source of truth for the app's NAME and taglines.
// Change these and the whole product rebrands: HUD logo, start/results screens,
// the document title, the shareable score card, and social share text.
// (Colors live in src/index.css; this file is the naming counterpart.)
// ===========================================================================

export const BRAND = {
  /** Display name (mixed case) — used in prose, share text, document title. */
  name: 'SlayFit',
  /** All-caps wordmark — used for the on-screen logo. */
  wordmark: 'SLAYFIT',
  /** Short tagline shown under the logo / in metadata. */
  tagline: 'Punch · Block · Burn',
  /** One-line descriptor used on the score card + share copy. */
  descriptor: 'webcam workout brawler',
};

/** URL/file-safe slug derived from the name, e.g. "slayfit". */
export const BRAND_SLUG = BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
