// ===========================================================================
// CrazyGames SDK v3 — tiny SAFE wrapper for the STANDALONE Temple Collapse build.
// ---------------------------------------------------------------------------
// Every export is a guarded no-op when the SDK isn't present, so the normal
// SlayFit portal build (and localhost, and any non-CrazyGames host) behaves
// EXACTLY as before whether or not this module is loaded. Nothing here throws.
//
// ENABLE FLAG
//   The wrapper only does anything when it is "enabled". It is enabled when
//   EITHER:
//     • the Vite build sets   import.meta.env.VITE_CRAZYGAMES === 'true', or
//     • the host HTML sets     window.__CRAZYGAMES__ = true   before boot.
//   The standalone entry (src/crazygames-main.jsx) sets the window flag, so the
//   portal build never enables it and never needs the <script> tag.
//
// SDK MODEL (from CrazyGames official docs)
//   • init()                          — once, on boot.
//   • game.gameplayStart()/Stop()     — fire when a run begins / ends. Lets the
//                                        platform time load size + pause ads.
//   • ad.requestAd('midgame', cbs)    — interstitial between levels.
//   • ad.requestAd('rewarded', cbs)   — opt-in reward (revive). Must pause+mute
//                                        gameplay; resume on finish/error.
//   All calls are wrapped so an adblock / missing SDK / thrown error never
//   breaks the game — ads simply resolve as "not shown" and play continues.
// ===========================================================================

// --- enable flag ------------------------------------------------------------
function envEnabled() {
  try {
    // Vite statically replaces import.meta.env.* — guarded for non-Vite hosts.
    if (import.meta && import.meta.env && import.meta.env.VITE_CRAZYGAMES === 'true') return true;
  } catch {}
  return false;
}
function winEnabled() {
  try { return typeof window !== 'undefined' && window.__CRAZYGAMES__ === true; } catch {}
  return false;
}
export function isEnabled() {
  return envEnabled() || winEnabled();
}

// Grab the SDK object only if it's actually there (feature-detect).
function sdk() {
  try {
    if (typeof window === 'undefined') return null;
    return (window.CrazyGames && window.CrazyGames.SDK) || null;
  } catch { return null; }
}

let _initDone = false;
let _initOk = false;
let _initPromise = null;

// Awaitable "the SDK has settled" — resolves true/false once init() has finished
// (or immediately if it was never started). Callers that need post-init state,
// e.g. game.settings, should await this instead of racing the fire-and-forget
// initSdk() in the entry module.
export function whenReady() {
  return _initPromise || Promise.resolve(_initOk);
}

// --- init -------------------------------------------------------------------
// Awaitable. Resolves once whether or not the SDK is present. On any host that
// isn't CrazyGames the SDK throws / is absent — we swallow it and log the mode.
export function initSdk() {
  if (!isEnabled()) { console.info('[CrazyGames] wrapper disabled — portal/local mode, SDK no-op.'); return Promise.resolve(false); }
  if (_initDone) return _initPromise || Promise.resolve(_initOk);
  _initDone = true;
  _initPromise = (async () => {
    const s = sdk();
    if (!s || typeof s.init !== 'function') {
      console.info('[CrazyGames] SDK not present — running in absent/no-op mode (game unaffected).');
      return false;
    }
    try {
      await s.init();
      _initOk = true;
      console.info('[CrazyGames] SDK initialized (environment:', s.environment || 'unknown', ').');
      return true;
    } catch (e) {
      console.info('[CrazyGames] SDK init failed — continuing in no-op mode.', e && e.message);
      return false;
    }
  })();
  return _initPromise;
}

// --- gameplay events --------------------------------------------------------
// Required to "earn": tell the platform when active play starts / stops so it
// can time the load and pause ads during gameplay. Both are safe no-ops when
// disabled or when the SDK / game module is missing.
export function gameplayStart() {
  if (!isEnabled() || !_initOk) return;
  try { sdk()?.game?.gameplayStart?.(); } catch {}
}
export function gameplayStop() {
  if (!isEnabled() || !_initOk) return;
  try { sdk()?.game?.gameplayStop?.(); } catch {}
}

// --- platform settings ------------------------------------------------------
// The portal owns a global audio switch: `SDK.game.settings.muteAudio`. Per the
// v3 Game-module docs the game MUST silence itself when it is true, and that
// setting TAKES PRIORITY over the in-game mute toggle (an unmute in our own UI
// must not override it). Both helpers are safe no-ops off-platform.
//
//   getSettings()            → { muteAudio: boolean } (empty object if absent)
//   onSettingsChange(cb)     → unsubscribe function
export function getSettings() {
  if (!isEnabled() || !_initOk) return {};
  try { return sdk()?.game?.settings || {}; } catch { return {}; }
}
export function onSettingsChange(cb) {
  if (!isEnabled() || !_initOk) return () => {};
  const g = sdk()?.game;
  if (!g || typeof g.addSettingsChangeListener !== 'function') return () => {};
  const listener = (s) => { try { cb(s || {}); } catch {} };
  try { g.addSettingsChangeListener(listener); } catch { return () => {}; }
  return () => { try { g.removeSettingsChangeListener?.(listener); } catch {} };
}

// --- celebration ------------------------------------------------------------
// Portal-side confetti for a genuinely big moment (campaign complete). Docs say
// to use it sparingly, so it is called exactly once per finished campaign.
export function happytime() {
  if (!isEnabled() || !_initOk) return;
  try { sdk()?.game?.happytime?.(); } catch {}
}

// --- ads --------------------------------------------------------------------
// requestAd('midgame'|'rewarded', callbacks). We wrap it in a Promise that
// ALWAYS resolves — on adFinished, adError, or a thrown/absent SDK — so callers
// can simply `await midgameAd()` and continue regardless of the outcome.
// `onStart`/`onStop` let the caller pause+mute the game around a video ad.
function requestAd(type, { onStart, onStop } = {}) {
  return new Promise((resolve) => {
    if (!isEnabled() || !_initOk) { resolve({ shown: false, reason: 'disabled' }); return; }
    const s = sdk();
    if (!s || !s.ad || typeof s.ad.requestAd !== 'function') { resolve({ shown: false, reason: 'absent' }); return; }
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; try { onStop && onStop(); } catch {} resolve(r); };
    // Safety timeout: if the SDK never calls back (rare), don't hang the game.
    const guard = setTimeout(() => done({ shown: false, reason: 'timeout' }), 20000);
    try {
      s.ad.requestAd(type, {
        adStarted: () => { try { onStart && onStart(); } catch {} },
        adFinished: () => { clearTimeout(guard); done({ shown: true, reason: 'finished' }); },
        adError: (err) => { clearTimeout(guard); console.info('[CrazyGames] adError — continuing.', err && (err.message || err)); done({ shown: false, reason: 'error' }); },
      });
    } catch (e) {
      clearTimeout(guard);
      console.info('[CrazyGames] requestAd threw — continuing.', e && e.message);
      done({ shown: false, reason: 'threw' });
    }
  });
}

// MIDGAME (interstitial) — placed on the between-levels transition. Awaitable;
// resolves even on adError so the next level always loads.
export function midgameAd(opts) {
  return requestAd('midgame', opts);
}

// REWARDED (opt-in) — e.g. a revive on Game Over. Resolves { shown: true } only
// when the player actually watched it through (adFinished). Never blocks play.
export function rewardedAd(opts) {
  return requestAd('rewarded', opts);
}

export default {
  isEnabled, initSdk, whenReady, gameplayStart, gameplayStop, midgameAd, rewardedAd,
  getSettings, onSettingsChange, happytime,
};
