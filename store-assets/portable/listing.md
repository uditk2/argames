# Relic Hunter: Temple Collapse — portal-neutral listing

Copy and assets for every portal that takes a plain HTML5 bundle. Upload
`relic-hunter-portable.zip` (built by `npm run build:portable`, then zip the
CONTENTS of `dist-portable/` so `index.html` sits at the zip root).

This bundle has **no portal SDK**: no ads are requested, and the "Continue —
watch ad" revive button does not render, so there is no dead control on the
Game Over panel. See `src/portable-main.jsx`.

**Do not upload this bundle to CrazyGames.** That portal gets
`dist-crazygames/`, which carries the SDK it requires. See
`marketing/CRAZYGAMES-SUBMISSION.md`.

## Fields

**Title:** Relic Hunter: Temple Collapse

**Tagline / short description (under 140 chars):**
> Study the maze. Run it from memory. Take Surya's sun-gem before the temple comes down.

**Description:**
> You are a relic hunter after the Syamantaka, Surya's sun-gem. Take it and the temple starts coming down.
>
> Six trials, each one a real maze. Study the map for a few seconds, then run it from memory. Turn wrong and you lose time you do not have. Hold M mid-run for another look.
>
> Blades to duck. Fallen beams and cracked floors to jump. Lion heads that spit fire. Three lives across the whole campaign. Grab the gem on trial five, then run for daylight on six.
>
> Free in your browser. No download.

**Controls:**
> Left / Right arrow or A / D: turn at junctions
> Up / W or Space: jump
> Down / S: duck
> Q: turn around at a dead end
> Hold M: peek at the map
> Enter: confirm
>
> Touch: swipe up / down / left / right, tap to jump.

**Genre / category:** Action, Adventure — endless-runner-adjacent maze runner
**Tags:** 3d, runner, maze, temple, adventure, escape, obstacle, skill, browser
**Made with:** React, Three.js, Vite
**Player count:** Singleplayer
**Input:** Keyboard, Touch
**Age rating:** suitable for 12+ (no gore, no profanity; peril and fire hazards)

## Embed settings (itch.io)

- Kind of project: **HTML**
- Uploaded file: `relic-hunter-portable.zip`, ticked **"This file will be played in the browser"**
- Viewport: **1280 x 720**, with **fullscreen button** enabled
- Mobile friendly: yes (touch controls exist), orientation **default**
- Embed in page (not click-to-launch), so the intro is visible on load

## Assets

- Screenshots: `store-assets/portable/screenshots/*.png` (6, 1920x1080).
  Captured 2026-09-07 against the packaged `dist-portable/` build served over
  HTTP. Four are direct PNG captures via the localhost-only `?level=N` deep
  link; the blade and gem shots are frames of the real recorded level-5 run
  (the hazards need actual play to reach). No cursor, no consent banner.
  The old `store-assets/crazygames/screenshots/` set is SUPERSEDED — it shows
  the pre-rename avatar, a visible mouse cursor and the old HUD.
- Cover / thumbnail: `marketing/crazygames/square_800x800.png` (1:1) or
  `landscape_1920x1080.png` (16:9). itch.io wants 630x500; crop from the
  landscape.
- Preview videos: `store-assets/crazygames/videos/relic-hunter_preview_*.mp4`.

## Where this bundle can go

| Portal | SDK needed | Self-serve | Notes |
|---|---|---|---|
| itch.io | none | yes, instant | zip with `index.html` at root; 1000-file limit, we ship ~300 |
| Newgrounds | none | yes, instant | same zip; `index.html` must be top-level or it warns |
| GameDistribution | their GD SDK | yes | needs SDK work before it earns; can wait |
| GameMonetize | their SDK | yes | same |
| Poki | Poki SDK | no, selective | application / referral |
| Y8 | optional API | yes | accepts plain HTML5 |

Priority is reach, not revenue: itch.io and Newgrounds take this bundle as-is.
