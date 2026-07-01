# Temple Collapse — CrazyGames Submission

Standalone single-game build of **Temple Collapse** (route `/temple-collapse` on SlayFit)
with the CrazyGames SDK v3 integrated. This doc covers the manual portal steps that
can't be automated, plus what the build already satisfies.

## Build the upload artifact

```bash
npm run build:crazygames
# → vite build --config vite.crazygames.config.js
# Output: dist-crazygames/  (crazygames.html + assets/ , relative paths)
```

Then zip the **contents** of `dist-crazygames/` (not the folder itself — `crazygames.html`
must sit at the zip root) and upload that zip to CrazyGames.

```bash
cd dist-crazygames && zip -r ../temple-collapse-crazygames.zip . && cd ..
```

The entry HTML CrazyGames loads is **`crazygames.html`** (set it as the game's start page
if the portal asks; otherwise rename to `index.html` before zipping — CrazyGames looks for
`index.html` by default, so the simplest path is to rename `crazygames.html`→`index.html`
inside the zip).

## Manual portal steps (cannot be automated)

1. **Register / sign in** at https://developer.crazygames.com (CrazyGames Developer Portal).
2. **Create the game** → "Add game" → HTML5. Name: *Temple Collapse* (or *Temple Collapse:
   Maze Escape*). Category: Adventure / Runner. Add tags (runner, 3D, maze, temple, endless).
3. **Upload the build**: upload `temple-collapse-crazygames.zip` (from `dist-crazygames/`).
   The portal unzips and serves it in a QA iframe. Confirm it loads to the ▶ Play intro.
4. **Thumbnails / cover / description**:
   - Cover image + thumbnail (see CrazyGames size specs — typically 16:9 cover + square icon).
   - Short + long description (reuse the `/temple-collapse` SEO copy in
     `src/config/seo-routes.js`).
   - **Trailer**: the marketing agent is producing video under `marketing/` — upload that
     as the trailer/gameplay video when ready.
5. **Controls / instructions**: Desktop ← → turn, ↑ jump, ↓ duck (WASD + Space also work).
   Mobile: swipe up/down/left/right, tap = jump.
6. **Billing**: complete **Tipalti** billing setup, or choose **"Hold Payments"** to submit
   without billing configured yet (can be completed later).
7. **Submit for QA** → CrazyGames reviews → **Basic Launch** → (after metrics) **Full Launch**.

## Tech requirements — status

### Satisfied by this build
- ✅ **SDK v3 installed** — `crazygames.html` loads `https://sdk.crazygames.com/crazygames-sdk-v3.js`
  and calls `await SDK.init()` on boot (via `src/games/temple/crazygames/sdk.js` → `initSdk()`).
- ✅ **Gameplay events fired** — `gameplayStart()` when a run/level begins (in `loadLevel`),
  `gameplayStop()` on death, on level clear / victory (`won` edge), and on leaving to a menu.
- ✅ **Midgame (interstitial) ad between levels** — `await midgameAd()` in `nextLevel`, fired
  on the LevelComplete→next-level transition, AFTER `gameplayStop()`, so it never interrupts
  active gameplay.
- ✅ **Ad failure is graceful** — every SDK call is feature-detected + try/caught; `midgameAd()`
  resolves even on `adError` / adblock / missing SDK, so the next level always loads.
- ✅ **Works with SDK absent** — verified: with the CDN SDK blocked, the game still boots and
  plays; the wrapper logs "SDK not present — no-op mode" and throws nothing. The normal SlayFit
  portal build never loads the SDK (enable flag `window.__CRAZYGAMES__` / `VITE_CRAZYGAMES`).
- ✅ **Relative asset paths** — built with Vite `base: './'`; JS/CSS load via `./assets/…`.
- ✅ **Lands in gameplay in ~1 click** — the standalone renders ONLY `<TempleDash />`, which
  self-boots to its intro; one ▶ Play click starts the run. No portal/home/other games.
- ✅ **No custom in-game fullscreen button** — none added (CrazyGames provides its own).
- ✅ **Lean single-game bundle** — the build copies ONLY the temple assets this game references
  (excludes the three.js-heavy stadium/dino/keeper assets and stale `run_bak*` sprite backups
  and unused art). JS+CSS ≈ 190 kB gzipped.
- ✅ **rewardedAd() helper available** — `src/games/temple/crazygames/sdk.js` exports a guarded
  `rewardedAd()` (for a future "revive / +1 life" on Game Over). Not yet wired into a UI button.

### Not yet done / to confirm before Full Launch
- ⚠️ **Initial download size** — `dist-crazygames/` ≈ **52 MB**, above CrazyGames' ideal
  (<20 MB initial). The bulk is the character sprite frames (`char/run|jump|duck`, ~30 MB of
  PNGs) plus the photoreal corridor/hazard PNGs (~15 MB). To slim it: compress the PNGs
  (pngquant/oxipng), convert big textures to WebP, or reduce the sprite frame counts. This is
  the main thing to improve before Full Launch; it passes QA but hurts load-time metrics.
- ⚠️ **Rewarded "revive" on Game Over** — helper exists (`rewardedAd()`) but no button is wired
  in `GameOverPanel`. Optional stretch; add later if desired.
- ⚠️ **Mobile orientation** — Temple Collapse runs in either orientation with swipe controls;
  set the CrazyGames portal's orientation config (both / landscape) to match. No in-game lock
  is applied for the standalone build.
- ⚠️ **Custom thumbnails/cover/trailer** — supplied manually in the portal (see step 4).

## Key files (this task)
- `src/games/temple/crazygames/sdk.js` — guarded SDK v3 wrapper (init / gameplayStart / gameplayStop / midgameAd / rewardedAd).
- `src/games/temple/ui/TempleDash.jsx` — wired the events (guarded; portal behavior unchanged).
- `src/crazygames-main.jsx` — standalone entry: renders only `<TempleDash />`, sets the enable flag, inits the SDK.
- `crazygames.html` — standalone HTML: sets `window.__CRAZYGAMES__`, loads the SDK `<script>`.
- `vite.crazygames.config.js` — `base:'./'`, single entry, `dist-crazygames/` out, curated asset copy.
- `package.json` — `build:crazygames` script.
