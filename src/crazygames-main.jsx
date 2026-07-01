// ===========================================================================
// STANDALONE CrazyGames entry — Temple Collapse only.
// ---------------------------------------------------------------------------
// This is the entry for the single-game build shipped to CrazyGames. It renders
// ONLY <TempleDash /> full-screen (no SlayFit portal / home / other games), so
// players land directly in the game within ~1 click (its own "▶ Play" intro).
//
// The enable flag (window.__CRAZYGAMES__) is set by crazygames.html BEFORE this
// module loads, so the SDK wrapper is active for this build only. We init the
// SDK on boot; every downstream call is already guarded, so a missing/erroring
// SDK (adblock, wrong host, localhost demo mode) never breaks the game.
//
// No onExit prop is passed → TempleDash hides its "Back" button, so there is no
// way out of the single game (correct for a standalone CrazyGames build).
// ===========================================================================
import React from 'react';
import { createRoot } from 'react-dom/client';
import TempleDash from './games/temple/index.js';
import './index.css';
import { initSdk } from './games/temple/crazygames/sdk.js';

// Belt-and-suspenders: ensure the flag is on even if the HTML changes.
if (typeof window !== 'undefined') window.__CRAZYGAMES__ = true;

// Init the CrazyGames SDK (awaitable, but we don't block the first paint on it —
// it resolves to a no-op off-platform and logs its mode). Fire-and-forget.
initSdk();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TempleDash />
  </React.StrictMode>
);
