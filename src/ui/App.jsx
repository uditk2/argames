// ===========================================================================
// App — top-level screen router. Holds the only React-side game-session state
// (which screen, chosen settings, final results). All game LOGIC lives in the
// pure engine; React just renders state and routes between screens.
// ===========================================================================

import React, { useState, useCallback } from 'react';
import StartScreen from './screens/StartScreen.jsx';
import GameScreen from './screens/GameScreen.jsx';
import ResultsScreen from './screens/ResultsScreen.jsx';
import { DEFAULT_DURATION, DEFAULT_BODYWEIGHT_KG } from '../config/game.config.js';
import { DEFAULT_AVATAR_ID } from '../config/avatars.js';

export default function App() {
  const [screen, setScreen] = useState('start'); // 'start' | 'game' | 'results'
  const [settings, setSettings] = useState({
    durationSec: DEFAULT_DURATION,
    bodyweightKg: DEFAULT_BODYWEIGHT_KG,
    avatarId: DEFAULT_AVATAR_ID,
    mode: 'camera', // 'camera' | 'demo'
  });
  const [results, setResults] = useState(null);
  const [clip, setClip] = useState(null); // instant-replay clip from GameScreen

  const startGame = useCallback((chosen) => {
    setClip(null);
    setSettings((s) => ({ ...s, ...chosen }));
    setScreen('game');
  }, []);

  const finishGame = useCallback((finalState, replayClip = null) => {
    setResults({
      score: finalState.score,
      slain: finalState.slain,
      kcal: Math.round(finalState.kcal),
      durationSec: finalState.config.durationSec,
      bestCombo: finalState.bestCombo,
      punches: finalState.punches,
      blocks: finalState.blocks,
    });
    setClip(replayClip || null);
    setScreen('results');
  }, []);

  const playAgain = useCallback(() => setScreen('start'), []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-realm text-ink">
      {screen === 'start' && (
        <StartScreen initial={settings} onStart={startGame} />
      )}
      {screen === 'game' && (
        <GameScreen settings={settings} onFinish={finishGame} onQuit={playAgain} />
      )}
      {screen === 'results' && results && (
        <ResultsScreen results={results} clip={clip} onPlayAgain={playAgain} />
      )}
    </div>
  );
}
