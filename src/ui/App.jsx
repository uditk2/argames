// ===========================================================================
// App — top-level screen router. Holds the only React-side game-session state
// (which screen, chosen settings, final results). All game LOGIC lives in the
// pure engine; React just renders state and routes between screens.
// ===========================================================================

import React, { useState, useEffect, useCallback } from 'react';
import StartScreen from './screens/StartScreen.jsx';
import GameScreen from './screens/GameScreen.jsx';
import ResultsScreen from './screens/ResultsScreen.jsx';
import { DEFAULT_DURATION, DEFAULT_BODYWEIGHT_KG } from '../config/game.config.js';
import { DEFAULT_AVATAR_ID } from '../config/avatars.js';
import DinoSurvival from '../games/dino-survival/index.js';
import Keeper from '../games/keeper/index.js';
import Home from './screens/Home.jsx';
import LeaderboardPage from './screens/LeaderboardPage.jsx';
import { track } from '../analytics/ga.js';
import { punchScores, PUNCH_LEVEL } from '../net/gameClients.js';
import { getName, getCountry, setCountry } from '../net/identity.js';
import { routeForPath, routeForGame, applyRouteHead } from '../config/seo-routes.js';

// Best-effort: on a phone, go fullscreen + lock to a target orientation (Android
// Chrome). iOS Safari ignores orientation.lock — the RotatePrompt overlay covers
// that. `want` is 'landscape' or 'portrait'.
async function lockOrientation(want) {
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 820;
  if (!mobile) return;
  try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock(want); } catch {}
}

// Top-level launcher: pick a game. (Each game is a self-contained module.)
// Orientation is per-context: the menu + details screens are portrait-friendly
// (no prompt). Dino Survival plays in PORTRAIT (its action is vertical); Monster
// Punch asks for LANDSCAPE only once its actual gameplay starts (see DemonRealm).
export default function App() {
  // The whole route (not just the game id) is derived from + synced to the URL,
  // so every screen has a shareable, indexable address: / = home, /brawler =
  // 'demon', /dino-survival = 'dino', /leaderboard = the standalone board page.
  // Tracking the full route (not only `game`) lets two game:null pages — home
  // and /leaderboard — be told apart.
  const [route, setRoute] = useState(
    () => routeForPath(typeof window !== 'undefined' ? window.location.pathname : '/')
  );

  // Keep the <head> (title, description, canonical, OG) in sync with the route.
  useEffect(() => { applyRouteHead(route); }, [route]);

  // Back/forward buttons: re-derive the route from the URL.
  useEffect(() => {
    const onPop = () => setRoute(routeForPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Navigate to a path: push it (so refresh/share/back all work) then re-route.
  const go = useCallback((path) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(routeForPath(path));
  }, []);

  const pick = (g) => {
    // GA: one event per launch tagged with the game id, so the Events report
    // ranks which game is played most. (Orientation handled by the native wrapper.)
    track('game_start', { game_id: g, game_name: g === 'dino' ? 'Dino Survival' : g === 'keeper' ? 'Keeper' : 'Monster Punch' });
    go(routeForGame(g).path);
  };
  const goHome = () => go('/');
  const openLeaderboard = () => go('/leaderboard');

  if (route.view === 'leaderboard') {
    return <LeaderboardPage onExit={goHome} onPlay={pick} />;
  }

  return (
    <>
      {route.game === 'dino' ? <DinoSurvival onExit={goHome} />
        : route.game === 'keeper' ? <Keeper onExit={goHome} />
        : route.game === 'demon' ? <DemonRealm />
        : <Home onPlay={pick} onOpenLeaderboard={openLeaderboard} />}
    </>
  );
}

function DemonRealm() {
  const [screen, setScreen] = useState('start'); // 'start' | 'game' | 'results'
  const [settings, setSettings] = useState({
    durationSec: DEFAULT_DURATION,
    bodyweightKg: DEFAULT_BODYWEIGHT_KG,
    avatarId: DEFAULT_AVATAR_ID,
    mode: 'camera', // 'camera' | 'demo'
  });
  const [results, setResults] = useState(null);
  const [clip, setClip] = useState(null);   // instant-replay clip from GameScreen
  const [board, setBoard] = useState(null); // leaderboard rows from the submit (no extra call)

  const startGame = useCallback((chosen) => {
    lockOrientation('landscape');                 // wide stage for the punch arena — lock on the Start gesture
    setClip(null); setBoard(null);
    setSettings((s) => ({ ...s, ...chosen }));
    setScreen('game');
  }, []);

  const finishGame = useCallback((finalState, replayClip = null) => {
    const score = finalState.score;
    const durationSec = finalState.config.durationSec;
    setResults({
      score, slain: finalState.slain, kcal: Math.round(finalState.kcal),
      durationSec, bestCombo: finalState.bestCombo,
      punches: finalState.punches, blocks: finalState.blocks,
    });
    setClip(replayClip || null);
    setScreen('results');

    // Server is the scorekeeper: instant local PB, then one POST returns the
    // authoritative isPB + leaderboard (higher score is better).
    const run = { score, timeS: durationSec };
    const { improved } = punchScores.mergeLocalBest(PUNCH_LEVEL, run);
    setResults((r) => (r ? { ...r, isNew: improved } : r));
    punchScores.submitRun(PUNCH_LEVEL, run, { player: getName() || null, country: getCountry() })
      .then((srv) => {
        if (!srv) return;
        if (srv.country) setCountry(srv.country);
        if (srv.leaderboard) setBoard(srv.leaderboard);
        setResults((r) => (r && r.score === score ? { ...r, isNew: srv.isPB } : r));
      });
  }, []);

  const playAgain = useCallback(() => setScreen('start'), []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-realm text-ink">
      {/* orientation gating removed on web — handled by the native app wrapper. */}
      {screen === 'start' && (
        <StartScreen initial={settings} onStart={startGame} />
      )}
      {screen === 'game' && (
        <GameScreen settings={settings} onFinish={finishGame} onQuit={playAgain} />
      )}
      {screen === 'results' && results && (
        <ResultsScreen results={results} clip={clip} board={board} onPlayAgain={playAgain} />
      )}
    </div>
  );
}
