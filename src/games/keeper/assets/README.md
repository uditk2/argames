# Keeper — assets & theme (the aesthetics seam)

The game reads **all** art/sound through `../theme.js` (the single source of
truth) and the self-contained theme pack in **`../theme/`**, and ships tasteful
**procedural fallbacks** so it runs fine with this folder empty.

No emoji in the UI — every glyph is an SVG icon from `../theme/icons.js`.

## Where things live

```
src/games/keeper/
  theme.js                  ← SINGLE SOURCE OF TRUTH: KEEPER_THEME tokens
                              (color/roles/layout/intensity/bgForLevel) +
                              getAsset / getSfxUrl / getBackgroundUrl resolvers
  theme/                    ← self-contained, dependency-free theme pack
    background.js           ← drawBackground / drawGoalFrame / drawBall /
                              drawKeeperGlow / loadBackgroundImage (procedural
                              floodlit night-stadium, net, ball)
    icons.js                ← ICON + icon(name,{size,color}) SVG glyphs (replace emoji)
    keeperAudio.js          ← createKeeperAudio() synth Web-Audio bank
    generate-backgrounds.mjs← OpenAI gpt-image-1 background upgrade (writes PNGs)
    preview.html            ← static eyeball test for art + icons + sounds
    assets/bg/              ← generated stadium PNGs land here (see below)
  render/scene.js           ← canvas renderer; calls the theme/background.js painters
  assets/                   ← THIS folder: legacy drop-in slots + audio adapter
    sounds.js               ← host-facing audio adapter over theme/keeperAudio.js
```

## Background art — procedural by default, OpenAI-upgradable

The renderer prefers a generated stadium PNG and falls back to procedural art:

1. **Default:** no PNGs → `theme/background.js` paints the procedural
   night-stadium (sky → floodlights → crowd bowl → perspective pitch), with the
   intensity ramping by level. Ships immediately, no external service.
2. **Upgrade (one command):**
   ```sh
   OPENAI_API_KEY=sk-... node src/games/keeper/theme/generate-backgrounds.mjs
   # or a single variant:
   OPENAI_API_KEY=sk-... node src/games/keeper/theme/generate-backgrounds.mjs night
   ```
   PNGs land in `theme/assets/bg/stadium-{day,night,finals}.png` (filenames are
   exactly `KEEPER_THEME.assets`). Vite globs them at build; the renderer resolves
   `KEEPER_THEME.bgForLevel(level)` → `getBackgroundUrl()` → loaded `<img>` and
   draws it cover-fit (night by default, finals at level ≥ 9). A missing file
   resolves `null` and the procedural scene is drawn instead — same call site.

## Legacy drop-in slots (`getAsset(name)`) — optional

| name    | file (any ext: svg/png/webp/jpg)        | fallback |
|---------|------------------------------------------|----------|
| `bg`    | `assets/bg-stadium.png`                  | procedural night-stadium (theme/background.js) |
| `glove` | `assets/glove.svg`                       | gold disc + `drawKeeperGlow` aura |

## Sound cues — synth by default

Audio is the synth Web-Audio bank in `theme/keeperAudio.js`, wrapped by
`assets/sounds.js` to keep the host-facing API the other SlayFit games use. No
sample files / no network (the dev static server lacks HTTP Range, which breaks
`<audio>` seeking). One-shots: `save goal whistle levelup click countdown go
cheer`; plus a crowd `startAmbience()` loop. Mute persists in
`localStorage['slayfit_keeper_muted']`.

Optional real-sample override: drop `assets/sfx/<name>.(mp3|ogg|wav)` and set the
`getSfxUrl` resolver to prefer it (the seam exists; the current adapter uses the
synth bank by default to stay dependency- and Range-free).

## Design tokens

`KEEPER_THEME` (in `../theme.js`) is the single token object. Colors read **live**
from the app's CSS vars (`--magic --fire --gold --shield --realm`) in the browser
and fall back to the brand literals for canvas math. Restyle the app palette in
`src/index.css` and Keeper retints automatically.
