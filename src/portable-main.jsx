// ===========================================================================
// PORTAL-NEUTRAL entry — Relic Hunter, no portal SDK.
// ---------------------------------------------------------------------------
// Same single-game standalone as src/crazygames-main.jsx, minus everything
// CrazyGames-specific: no SDK init, and crucially it does NOT set
// window.__CRAZYGAMES__, so the guarded wrapper in
// src/games/temple/crazygames/sdk.js reports isEnabled() === false. That means:
//   • no ad is ever requested (midgame or rewarded),
//   • the "Continue — watch ad" revive button never renders, so there is no
//     dead control on the Game Over panel,
//   • gameplayStart/Stop are silent no-ops.
//
// Use this bundle for any host that just serves an HTML5 folder (itch.io,
// Newgrounds, a static host), or as the starting point for a different
// portal's SDK — add that SDK's <script> to portable.html and its calls
// alongside the existing wrapper rather than replacing it.
//
// The consent notice stays: PostHog still collects data beyond any portal SDK,
// so the privacy notice + ./privacy.html link remain required wherever this
// runs. (PostHog itself is a no-op unless VITE_POSTHOG_KEY is set at build.)
// ===========================================================================
import React from 'react';
import { createRoot } from 'react-dom/client';
import TempleDash from './games/temple/index.js';
import ConsentNotice from './ui/ConsentNotice.jsx';
import './index.css';
import { initPostHog } from './analytics/index.js';

initPostHog();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <>
      <TempleDash />
      <ConsentNotice />
    </>
  </React.StrictMode>
);
