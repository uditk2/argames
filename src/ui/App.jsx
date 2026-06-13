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
import { punchScores, PUNCH_LEVEL } from '../net/gameClients.js';
import { getName, getCountry, setCountry } from '../net/identity.js';

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
  const [game, setGame] = useState(null); // null = menu | 'demon' | 'dino'
  const pick = (g) => { if (g === 'dino') lockOrientation('portrait'); setGame(g); };  // demon locks landscape later, when its round starts
  return (
    <>
      {game === 'dino' ? (
        <><RotatePrompt want="portrait" /><DinoSurvival onExit={() => setGame(null)} /></>
      ) : game === 'demon' ? <DemonRealm />
        : <GameMenu onPick={pick} />}
    </>
  );
}

// Ask mobile players to rotate to the orientation a screen needs. `want` is the
// desired orientation; the prompt only shows on small screens that are in the
// WRONG orientation, and only while `enabled` (so menus/details don't nag).
function RotatePrompt({ want = 'landscape', enabled = true }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () => {
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      const small = Math.min(window.innerWidth, window.innerHeight) < 820;
      const wrong = want === 'landscape' ? isPortrait : !isPortrait;
      setShow(enabled && small && wrong);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, [want, enabled]);
  if (!show) return null;
  const toPortrait = want === 'portrait';
  return (
    <div className="fixed inset-0 z-[999] bg-realm/95 backdrop-blur-sm flex items-center justify-center p-6 text-center">
      <div className="panel p-8 max-w-[340px]">
        <svg viewBox="0 0 64 64" className="w-16 h-16 mx-auto mb-4 text-magic" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="22" y="6" width="20" height="40" rx="3" />
          <path d="M30 40h4" />
          <path d="M48 30a18 18 0 0 1-12 14M16 34a18 18 0 0 1 12-14" />
          <path d="M48 24v8h-8M16 40v-8h8" />
        </svg>
        <div className="font-display font-black text-xl text-ink">Rotate your device</div>
        <p className="text-magic/80 text-[13px] mt-2 leading-relaxed">Turn your phone to <b className="text-ink">{toPortrait ? 'portrait' : 'landscape'}</b> to play — {toPortrait ? 'this game runs in a tall, vertical view.' : 'this game needs a wide stage to look and play its best.'}</p>
      </div>
    </div>
  );
}

const GAMES = [
  { id: 'dino', title: 'Dino Survival', tagline: 'Outrun the beast. Reach the jeep.', img: '/assets/dino-survival/bg/trail.png', orientation: 'portrait' },
  { id: 'demon', title: 'Monster Punch', tagline: 'Punch monsters. Block. Burn.', img: '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png', orientation: 'landscape' },
];

function GameMenu({ onPick }) {
  return (
    <div className="w-screen h-screen overflow-hidden bg-realm text-ink flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <div className="font-display font-black text-4xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">SLAYFIT</div>
        <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase">Move to play · pick a game</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-[680px]">
        {GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => onPick(g.id)}
            className="group relative h-[210px] rounded-2xl overflow-hidden border border-magic/30 hover:border-magic/80 shadow-glow hover:shadow-glow-fire transition focus:outline-none focus:border-magic"
          >
            <img src={g.img} alt="" className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-[1.07]" />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(8,4,16,.95)] via-[rgba(16,8,30,.45)] to-[rgba(16,8,30,.15)]" />
            <div className="absolute bottom-0 left-0 right-0 p-5 text-left">
              <div className="font-display font-black text-2xl text-white drop-shadow-[0_2px_8px_rgba(0,0,0,.7)]">{g.title}</div>
              <div className="text-[12.5px] text-ink/85 mt-1">{g.tagline}</div>
            </div>
            <div className="absolute top-3 right-3 text-[10px] font-bold tracking-[0.18em] uppercase text-white/90 bg-black/40 border border-white/20 rounded-full px-2.5 py-1 opacity-0 group-hover:opacity-100 transition">Play ▸</div>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-magic/50 mt-8">Camera-powered · run &amp; move to play</div>
    </div>
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
      {/* landscape only matters once the punch round is running; details stay portrait-friendly */}
      <RotatePrompt want="landscape" enabled={screen === 'game'} />
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
