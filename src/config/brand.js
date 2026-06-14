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

  // --- SEO ---------------------------------------------------------------
  /** Production origin — used for canonical / OG / sitemap. TODO: set your real domain. */
  siteUrl: 'https://slayfit.fun',
  /** Keyword-rich <title> for crawlers + the live tab (set in main.jsx). */
  seoTitle: 'SlayFit — Fitness AR Games You Play With Your Webcam',
  /** Meta description for search snippets + social unfurls. */
  seoDescription:
    'SlayFit is a collection of free fitness AR games you play with your webcam — punch, block, dodge and run a real cardio workout. No equipment, no download, just your camera and your body.',
};

/** URL/file-safe slug derived from the name, e.g. "slayfit". */
export const BRAND_SLUG = BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
