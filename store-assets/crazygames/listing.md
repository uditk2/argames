# Relic Hunter — CrazyGames Store Listing (paste-ready)

Drop each block straight into the matching field in the CrazyGames Developer Portal.

**Rewritten 2026-09-04** against the shipped build. The previous version described
"Temple Collapse: Maze Escape", 3 levels, an idol, and `A · D` turning — all of that
predates the rename, the six-trial campaign, the Syamantaka Gem and the Mira/Vikram
character select. Everything below matches what actually ships in `dist-crazygames/`.

---

## Game title

**Relic Hunter: Temple Collapse**

*(Shorter alt if the field is tight: `Relic Hunter`. The in-game wordmark reads
RELIC HUNTER with TEMPLE COLLAPSE as the sub-line, so either matches the covers.)*

---

## Short description / tagline
*(one line — used in previews and search)*

> Lift the Syamantaka Gem, then outrun the temple you just brought down.

---

## Long description

Relic Hunter is a 3D temple maze runner. You play Mira or Vikram, a relic hunter
after the Syamantaka — Surya's sun-gem, which blesses a worthy keeper and ruins an
unworthy taker. Six trials stand between you and it, and the temple starts coming
down the moment you take it.

Every trial is a real labyrinth, not a corridor. You get a few seconds to study the
map before each run, then you commit: turn the right way at every junction while the
collapse timer burns down. Wrong turns cost time, dead ends make you back out, and
the temple does not wait. Hold M mid-run to steal another look at the map.

Between you and the exit: swinging blades to duck, fallen stone beams to jump,
cracked floors that give way, and guardian lion heads that spit fire. The game
teaches one input at a time — blades first, then jumps — so you are never guessing.
Three lives carry across the whole campaign. Take the gem on the fifth trial, then
run for daylight on the sixth with the temple collapsing behind you.

Photoreal torch-lit stone, a proper folklore premise, and controls that take one
second to learn. Free in your browser, no download, no install.

---

## How to play / Controls

**Desktop**
- **← / →** or **A / D** — turn left or right at junctions
- **↑ / W / Space** — jump (fallen beams, cracked floor, low fire)
- **↓ / S** — duck (swinging blades, high fire)
- **Q** — turn around when you hit a dead end
- **Hold M** — peek at the map mid-run
- **Enter** — confirm on menus

**Mobile**
- **Swipe ← / →** — turn
- **Swipe ↑ or tap** — jump
- **Swipe ↓** — duck

Study the map, take the right turns, dodge the traps, and reach the exit before the
collapse timer runs out.

---

## Features

- Six-trial campaign with three shared lives — memorise the maze, beat the clock
- Real labyrinths: multiple routes, genuine dead ends, a map you actually read
- Blades to duck, beams and gaps to jump, fire-spitting guardians, collapsing floors
- Two playable hunters (Mira and Vikram)
- A folklore premise drawn from the Syamantaka legend, narrated in-game
- Stars and best times per trial, so a cleared run is worth re-running
- Instant browser play, desktop and mobile

---

## Tags

Primary: **3D**, **Runner**, **Maze**, **Adventure**, **Action**

Secondary: **Escape**, **Arcade**, **Skill**, **Temple**

---

## Category

**Adventure**, with Runner / 3D as the leading tags — best discovery fit for a
temple-escape runner. (Action is the reasonable second choice.)

---

## Age rating

Mild peril only — blades, fire and collapsing stone, with no blood, gore or
realistic violence. Sits comfortably inside CrazyGames' **PEGI 12** baseline.

---

## Developer / studio

**SlayFit**

---

## Notes for the submission (not pasted into fields)

- **Do NOT paste the site SEO copy.** `src/config/seo-routes.js` ends with links to
  Keeper and Dino Survival; CrazyGames prohibits cross-promotion of other games in a
  listing. The copy above is deliberately free of it.
- **Assets to upload** — covers `marketing/crazygames/{landscape_1920x1080,
  portrait_800x1200,square_800x800}.png`; videos
  `store-assets/crazygames/videos/relic-hunter_preview_{landscape,portrait_2x3}_1080p.mp4`;
  screenshots `store-assets/crazygames/screenshots/` (6).
- **Build** — `relic-hunter-crazygames.zip` from `npm run build:crazygames`, 25 MB,
  `index.html` at the zip root.
- **Exclusivity** — the higher revenue share requires opting into launch exclusivity
  in the deal settings. Decline it if you intend to publish on other portals too.
- **Land-in-gameplay** — satisfied: the standalone opens on the intro with a single
  ▶ Play.
