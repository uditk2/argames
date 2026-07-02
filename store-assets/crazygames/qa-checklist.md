# Temple Collapse — CrazyGames "Full Launch" Submission QA Checklist

**Game:** Temple Collapse (3D temple maze‑runner)
**Build:** `npm run build:crazygames` → `dist-crazygames/` (Vite + React + Three.js)
**Entry:** `crazygames.html` → `src/crazygames-main.jsx` (renders only `<TempleDash/>`)
**SDK:** CrazyGames SDK v3, guarded wrapper `src/games/temple/crazygames/sdk.js`
**Audited:** 2026‑07‑01 against CrazyGames docs (Technical / Gameplay / Ads / Covers / Quality / Game SDK)

**Status legend:** ✅ pass · ⚠️ needs check / partial · ❌ gap (fix before submit) · ℹ️ manual (portal‑side, can't verify in code)

---

## Measured build facts (from a temp build to `/tmp/dist-cg-qa` + curated asset set)

| Metric | Measured | Limit | Verdict |
|---|---|---|---|
| JS chunk (`crazygames-*.js`) | **876 KB raw / 261 KB gzip** | (no hard cap; affects load) | ⚠️ one monolithic chunk; PostHog bundled in |
| CSS | 36 KB raw / 7 KB gzip | — | ✅ |
| HTML+JS+CSS subtotal | 0.88 MB | — | ✅ |
| Curated temple flat assets (13 PNG/JPG + 4 JSON) | 16.46 MB | — | — |
| Char sprite dirs (run 19 + jump 24 + duck 24 = 67 PNGs) | 29.69 MB | — | — |
| **Grand total build size** | **≈ 47.06 MB** | ≤ 250 MB total | ✅ (total) |
| **Initial download to first `gameplayStart`** | **≈ 47 MB (effectively the whole build — see note)** | **≤ 50 MB** | ⚠️ under 50 MB but tight |
| Mobile‑homepage initial‑download threshold | ≈ 47 MB | **≤ 20 MB** | ❌ not eligible for mobile homepage |
| **Total file count** | **≈ 89 files** | ≤ 1500 | ✅ |

> **Initial‑download note:** With the SDK integrated, initial download is measured from load start to the **first `gameplayStart` event**. `gameplayStart()` fires at the top of `loadLevel()` **before** the engine (and therefore the char sprites + wall/floor textures) is created. The Three.js `TextureLoader`/`Image` loads happen inside engine creation, i.e. *after* the first `gameplayStart`. So strictly the initial‑to‑first‑gameplayStart payload is the JS+CSS+HTML (~0.9 MB) plus whatever the browser has fetched by that instant — but in practice CrazyGames QA also times to a *playable* state and the ~46 MB of sprites/textures must load right after. Treat the effective initial payload as ≈ the full build and optimize accordingly. **Verify on the real device with the CrazyGames QA tool.**

---

## 1. Technical (`/requirements/technical/`)

| # | Requirement | Status | Note (grounded in code/build) |
|---|---|---|---|
| T1 | Total file size ≤ 250 MB | ✅ | ≈ 47 MB total. |
| T2 | File count ≤ 1500 | ✅ | ≈ 89 files (3 build + 17 flat + 67 sprites + 2 favicons). |
| T3 | Initial download ≤ 50 MB (to first `gameplayStart`) | ⚠️ | ≈ 47 MB build; JS is 261 KB gzip but 67 sprite PNGs (~30 MB) + textures (~16 MB) dominate. Under 50 MB but no headroom — **compress sprites** (WebP / atlas) before adding content. |
| T4 | Initial download ≤ 20 MB for **mobile‑homepage** eligibility | ❌ | ≈ 47 MB. Not eligible unless sprite/texture payload is cut ~60%. Action item if mobile placement matters. |
| T5 | **Relative paths only — never absolute** | ❌ | **GAP.** Vite `base:'./'` makes JS/CSS relative, but runtime asset URLs in `src/games/temple/config.js` are **absolute** (`/assets/temple/...`, 21 refs incl. `map: '/assets/temple/map.json'`, sprite dirs, and two `<img src="/assets/temple/...">` in `TempleDash.jsx`). On CrazyGames a leading `/` resolves to the CDN root, not the game subfolder → **assets will 404**. Change to `./assets/...` (or `import.meta.env.BASE_URL`). Must fix before submit. |
| T6 | Works on Chrome/Edge; Safari acceptable; smooth on 4 GB Chromebook | ℹ️ | Three.js/WebGL — verify FPS on a low‑end Chromebook; manual. |
| T7 | Supports mouse, keyboard, and touch (if mobile) | ✅ | Keyboard (arrows/WASD/Space/Shift), touch swipes+tap (`onTouchEnd`), `IS_PHONE` branch present. |
| T8 | Playable in landscape on desktop | ✅ | Full‑viewport canvas; no forced portrait. |
| T9 | Consistent physics across refresh rates (144/165 Hz) | ⚠️ | Verify engine uses delta‑time, not fixed per‑frame steps, on a high‑refresh monitor. Manual. |
| T10 | Mobile CSS: `user-select:none` (+ `-webkit-/-moz-/-ms-`) on `body` | ❌ | **GAP.** Not present in `crazygames.html` `<style>` or `src/index.css`. Add the 4 `user-select:none` lines to `body` to prevent tap‑hold magnifier/selection on tablets. |
| T11 | iOS AudioContext resume on `touchend` after interruption | ⚠️ | No Web Audio / `AudioContext` found in `src/games/temple/` (no in‑game audio detected). If audio is added later, wire the `touchend`→`resume()` guard. Currently N/A. |
| T12 | SDK integrated + init on boot | ✅ | `initSdk()` called in `crazygames-main.jsx`; wrapper awaits `window.CrazyGames.SDK.init()`; v3 script in `crazygames.html`. |
| T13 | Sitelock / domain whitelist | ℹ️ | No sitelock implemented (optional). If added, whitelist all CrazyGames domains. |
| T14 | **User Consent — Privacy Policy for extra data collection** | ❌ | **GAP / action item.** `posthog-js` is initialized (`src/analytics/posthog.js`, EU/US host, `capture_pageview`, `capture_pageleave`, `person_profiles:'identified_only'`) — this collects personal data **beyond** the CrazyGames SDK events. Per the User Consent rule, the game must show a **Terms & Conditions / Privacy Policy notice** to new players (simple in‑game notice or a link opening in a new tab — see Bloxd.io / Racing Limits examples). **No such notice exists in the intro screen.** Add one, or gate/disable PostHog. |

---

## 2. Gameplay (`/requirements/gameplay/`)

| # | Requirement | Status | Note |
|---|---|---|---|
| G1 | **Land new users in gameplay immediately — max 1 click** | ✅ | Standalone entry renders only `<TempleDash/>`; opens on the intro panel with a single **"▶ Play"** button → `startCampaign(0)` → `loadLevel(0)`. One click, no portal/menu maze. `onExit` not passed, so "Back" is hidden. |
| G2 | English localization present | ✅ | All UI copy English. |
| G3 | Uses SDK `locale` for translations, fallback English | ⚠️ | No `getSystemInfo`/`locale` usage; single‑language English only (acceptable — translations optional). |
| G4 | Intuitive controls; onboarding skippable & visual | ✅ | Intro shows a visual control legend (glyph cards) + one‑line goal + collapsible "How it works"; Space/Enter also starts. |
| G5 | Readable at 907×510 / 800×450 (mobile) etc. at DPR 1 | ⚠️ | HUD/overlays use small `text-[11px]/[12px]`; verify legibility at the smallest iframe sizes and DPR 1. Manual visual check. |
| G6 | Smooth performance, no crashes | ⚠️ | Manual playtest. |
| G7 | Originality (name/assets) | ℹ️ | "Temple Collapse" chosen for uniqueness (renamed from Temple Dash). Ensure sprite/texture art is owned/licensed. |
| G8 | **No custom in‑game fullscreen button** | ✅ | No `requestFullscreen`/fullscreen button in code. CrazyGames provides fullscreen. |
| G9 | No cross‑promotion of external/other games | ✅ | Standalone build renders only Temple Collapse; no portal links, no other‑game CTAs. |
| G10 | PEGI‑12 / suitable for 13+ | ✅ | Trap‑dodging runner; no gore/adult content. Confirm death visuals stay mild. |
| G11 | Restricted keys (Esc/Ctrl+W) not required for core play | ✅ | Uses arrows/WASD/Space/Shift/Ctrl/Enter; Esc not bound. Note Shift/Ctrl used for run‑to‑move on desktop — fine. |

---

## 3. Advertisement (`/requirements/ads/`)

| # | Requirement | Status | Note |
|---|---|---|---|
| A1 | **Ads only via CrazyGames SDK** (no external networks) | ✅ | Only `s.ad.requestAd('midgame'|'rewarded', …)` used in `sdk.js`. No third‑party ad network. |
| A2 | **Works with AdBlock — never block/penalize players** | ✅ | Wrapper Promise **always resolves**; `adError`/absent/`threw`/`timeout` → `{shown:false}` and play continues. Revive on error just leaves Game Over intact (no penalty). Revive button is gated by `CG.isEnabled()` so it doesn't appear as a dead button off‑platform. |
| A3 | Ads don't interrupt gameplay; shown at logical breaks | ✅ | Midgame ad fired in `nextLevel()` on the **between‑levels** transition, after `gameplayStop()` on the 'won' edge — not during active play, not on a nav/menu button. |
| A4 | Game paused during ad request/show | ✅ | Midgame ad is `await`ed before `loadLevel(next)`; no engine running during the transition (torn down). Rewarded revive sets `reviving` (disables button, shows "Loading ad…"). |
| A5 | Handle unfilled/`adError` — game continues | ✅ | Both `midgameAd()` and `rewardedAd()` resolve on `adError`; next level always loads; revive simply not granted. |
| A6 | **Game muted during video ad; unmute after** | ⚠️→N/A | No `onStart`/`onStop` mute wiring passed at call sites (`CG.midgameAd()`/`CG.rewardedAd({})` called with no mute callbacks). **Currently N/A** because no in‑game audio was found. If audio is added, pass `onStart`/`onStop` to mute/unmute (wrapper already supports it). |
| A7 | Midgame frequency handled by SDK (no manual gating) | ✅ | Requested at every level transition; SDK ignores if too soon. Correct per docs. |
| A8 | **Rewarded ad is opt‑in / click‑only (not auto)** | ✅ | `doRevive()` is bound only to the "▶ Continue — watch ad" button (`onRevive`), **not** to the Enter/Space primary (which stays Restart). Comment explicitly notes rewarded must be deliberate opt‑in. |
| A9 | Reward optional & clearly a video; not too frequent | ✅ | Revive offered **once per run** (`reviveUsed`), only on Game Over (out‑of‑lives) — not every death. Button labeled "Continue — watch ad"; alternative "Restart" always present, same panel. |
| A10 | Don't combine midgame + "watch rewarded to keep playing" between the same levels | ✅ | Midgame is between levels (win path); rewarded is out‑of‑lives revive (death path). Never both on the same transition. |
| A11 | Rewarded button consistent location, not misleading, alternative provided | ⚠️ | On Game Over panel: Continue(ad) + Restart both shown. **Verify** the two buttons are equal size/font/color weight (docs require the no‑ad option be visually equal). Review `GameOverPanel` styling manually. |
| A12 | In‑game banners: not during gameplay, ≤2/screen, don't block UI | ✅ (N/A) | No banner ads implemented. |
| A13 | (Basic‑launch caveat) no rewarded button without effect if ads disabled | ✅ | Revive button only rendered when `CG.isEnabled()`; resolves gracefully. |

---

## 4. Game Covers (`/requirements/game-covers/`) — portal upload, not in build

| # | Requirement | Status | Note |
|---|---|---|---|
| C1 | 3 cover images: landscape 1920×1080, portrait 800×1200, square 800×800 | ℹ️ | Manual — prepare in Developer Portal. |
| C2 | Consistent visuals across the 3; game title on cover; stylized font | ℹ️ | Manual. |
| C3 | No borders / no "New/Play/Updated" text / no store or app icons / no copyrighted art / not blurry | ℹ️ | Manual — avoid screenshot‑only covers. |
| C4 | Preview video: 15–20 s, ≤50 MB, 1080p landscape **and** portrait, no sound, no cursor/black bars/Play‑Now text | ℹ️ | Manual — mind the memory note re: the existing replay‑clip pipeline used elsewhere; produce fresh clean captures. |

---

## 5. Quality guidelines (`/requirements/quality/`) — recommended, not blocking

| # | Guideline | Status | Note |
|---|---|---|---|
| Q1 | Users reach gameplay fast; onboarding in‑gameplay, skippable, visual | ✅ | Single Play click; visual legend; collapsed detail. |
| Q2 | Clear goals; easy to learn; consistent controls | ✅ | One‑line goal ("reach the exit before the temple falls"); consistent turn/jump/duck. |
| Q3 | Buttons clearly labeled; not sized/delayed to push ads | ✅ | Primary CTAs are gameplay actions; ad button clearly labeled as ad. |
| Q4 | Responsive to input; well‑paced challenge | ⚠️ | Manual feel check. |
| Q5 | Audio comfortable/consistent | ℹ️ | No audio found — consider adding SFX/music (also then implement `muteAudio` + ad‑mute). |
| Q6 | High, consistent‑resolution visuals; no artifacts; consistent style | ⚠️ | Photoreal keyed sprites + Three.js — verify no compression artifacts / style mismatch. |
| Q7 | Key bindings adapt to layout (AZERTY) | ⚠️ | WASD only; ZQSD not mapped. Minor — arrows also work. |
| Q8 | `game.settings.muteAudio` respected (Full impl. requires for HTML5 w/ audio) | ⚠️ | No `addSettingsChangeListener`/`muteAudio` handling. N/A while silent; **required if audio is added**. |
| Q9 | `happytime()` on big achievements (e.g. campaign complete) | ℹ️ | Not called. Optional nicety — could fire on `temple_campaign_complete`. |
| Q10 | `setGameContext({level})` for actionable feedback | ℹ️ | Not used. Optional. |

---

## 6. SDK — Game module (`/sdk/game/`)

| # | Requirement | Status | Note |
|---|---|---|---|
| S1 | **`gameplayStart()` fires when a run/level begins** (required for Full Launch + monetization; used to time initial download) | ✅ | `CG.gameplayStart()` at top of `loadLevel(idx)` — fires on first start **and** every next level. Confirmed. |
| S2 | `gameplayStop()` on every break (death, level clear, back‑to‑menu) | ✅ | Fired on edge into `'over'`, edge into `'won'`, and in `backToMenu()`. Edge‑detected via `lastPhaseRef` (no double‑fire). |
| S3 | `gameplayStart()` again on resume/revive/next level | ✅ | Revive path calls `sendInput('restart')` on the still‑running engine (engine pushes a fresh 'run' state); next level re‑enters `loadLevel` → `gameplayStart`. **Verify** revive re‑triggers a start signal to the platform (currently relies on engine restart, not an explicit `gameplayStart()` in `doRevive`) — consider adding `CG.gameplayStart()` in `doRevive` after a successful watch for correctness. ⚠️ minor. |
| S4 | Don't call stop on focus loss/leaving area | ✅ | No visibility/blur‑driven `gameplayStop`; only game‑state edges. Correct. |
| S5 | `loadingStart/Stop` (optional) | ℹ️ | Not wired. Optional. |

---

## Top gaps / action items (fix before Full Launch submit)

1. ❌ **Relative asset paths (T5).** `src/games/temple/config.js` (+ 2 `<img>` in `TempleDash.jsx`) use absolute `/assets/temple/...` (21 refs). On CrazyGames these resolve to the CDN root and will **404**. Convert to `./assets/...` / `import.meta.env.BASE_URL`. **This will break the game on‑platform — highest priority.**
2. ❌ **Privacy/consent notice (T14).** PostHog collects data beyond SDK events. Add an in‑game Terms/Privacy notice (or link opening in a new tab) on the intro, or disable/gate PostHog. Required by User Consent rule.
3. ❌ **`user-select:none` on `body` (T10).** Missing; add the 4 lines to prevent mobile tap‑hold selection/magnifier.
4. ❌ **Mobile‑homepage size (T4).** ≈47 MB initial payload vs ≤20 MB. Only blocking if you want the mobile homepage; compress the 67 sprite PNGs (~30 MB) → WebP/atlas and textures (~16 MB) to also buy T3 headroom.
5. ⚠️ **Consider lazy‑loading / code‑splitting PostHog.** It's bundled into the single 876 KB (261 KB gzip) JS chunk; dynamic‑import it so it doesn't sit on the critical path to first frame.
6. ⚠️ **Rewarded button parity (A11)** and **explicit `gameplayStart()` on revive (S3)** — verify/clean up.
7. ℹ️ If audio is later added: wire `muteAudio` setting (Q8), ad‑mute via `onStart/onStop` (A6), and iOS `touchend` resume (T11).

**Green where it counts:** SDK init, `gameplayStart/Stop` wiring, single‑click land‑in‑gameplay, AdBlock‑safe ads via SDK only, opt‑in once‑per‑run rewarded revive, total size/file‑count limits.
