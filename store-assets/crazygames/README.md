# CrazyGames store assets — Temple Collapse

Launch/marketing assets for the CrazyGames submission of **Temple Collapse** (standalone build from `npm run build:crazygames`). Kept in the repo so they're versioned alongside the game.

## Contents
- `covers/` — the 3 required cover images (title composited in Cinzel Decorative):
  - `temple-collapse_cover_landscape_1920x1080.png` (16:9)
  - `temple-collapse_cover_portrait_800x1200.png` (2:3)
  - `temple-collapse_cover_square_800x800.png` (1:1)
- `videos/` — the 2 required preview videos, from real gameplay, 18s, muted, H.264, <50 MB:
  - `temple-collapse_preview_landscape_1080p.mp4` (16:9)
  - `temple-collapse_preview_portrait_2x3_1080p.mp4` (2:3, 1080×1620, blurred-fill)
- `screenshots/` — 6 peak-action 1920×1080 gallery stills (bonus; not required by Basic launch).
- `listing.md` — store listing copy (title, description, controls, tags, category).
- `asset-brief.md` — exact CrazyGames cover/video specs + the generation prompts used.
- `qa-checklist.md` — pre-submission QA checklist mapped to CrazyGames requirements.

## Submission facts (as entered)
- **Game name:** Temple Collapse
- **Engine:** HTML5 · **Launch:** Basic (ads enabled only after Full invite)
- **Category:** Adventure
- **Tags:** 3D, Running, Escape, Avoid, Survival
- **Progress save:** No · **Mobile:** supported, Landscape · **Audio-mute SDK / multiplayer:** N/A
- Consent notice + `public/privacy.html` cover the PostHog + GA analytics.

## Notes
- Cover art generated with ChatGPT, titles composited via ImageMagick (Cinzel Decorative).
- The raw ~50 MB gameplay screen-recording is intentionally NOT committed (kept out of git to avoid bloat); the trimmed previews above are derived from it.
- If more/heavier media is added later, consider Git LFS for `*.mp4`.
