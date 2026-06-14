// ===========================================================================
// LeaderboardPage — the standalone /leaderboard destination linked from Home.
// A single focused board at a time, switched with a game toggle (the two games
// use different metrics — Dino = fastest time, Monster Punch = highest score —
// so tabs read cleaner than two side-by-side boards and scale to more games).
// Reuses the shared Leaderboard.jsx; styling mirrors the start/result screens.
// ===========================================================================
import React, { useState } from 'react';
import Leaderboard from '../Leaderboard.jsx';
import { dinoScores, punchScores, PUNCH_LEVEL } from '../../net/gameClients.js';
import { DEFAULT_LEVEL as DINO_LEVEL } from '../../games/dino-survival/index.js';

// One entry per game with the board it should render. `showMeta:false` for Dino
// hides the 'Impossible · fastest' label (single difficulty); Punch keeps its
// 'Arena · highest' tag. `bg` themes the page behind the panel per game.
const TABS = [
  {
    id: 'dino', title: 'Dino Survival', tag: 'Fastest escape',
    client: dinoScores, level: DINO_LEVEL, label: null, showMeta: false,
    bg: '/assets/dino-survival/bg/trail.png',
  },
  {
    id: 'demon', title: 'Monster Punch', tag: 'Highest score',
    client: punchScores, level: PUNCH_LEVEL, label: 'Arena', showMeta: true,
    bg: '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png',
  },
];

export default function LeaderboardPage({ onExit, onPlay }) {
  const [tab, setTab] = useState(TABS[0].id);
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-realm text-ink">
      {/* Ambient background — swaps with the selected game */}
      <img src={active.bg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(90,30,110,.45)] via-[rgba(16,8,30,.78)] to-[rgba(8,4,16,.94)]" />

      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="min-h-full flex flex-col items-center justify-start px-3 py-6 sm:py-10">

          {/* Title */}
          <div className="text-center mb-5">
            <div className="text-[10px] tracking-[0.3em] text-magic/60 uppercase mb-1">SlayFit</div>
            <div className="font-display font-black text-3xl sm:text-4xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
              LEADERBOARDS
            </div>
            <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase">
              Top players worldwide
            </div>
          </div>

          {/* Game toggle */}
          <div className="flex gap-2 mb-5 p-1 rounded-2xl bg-realm/50 border border-magic/30">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold border transition
                  ${t.id === tab
                    ? 'bg-magic/30 border-magic text-white shadow-glow'
                    : 'bg-transparent border-transparent text-ink/70 hover:text-ink hover:border-magic/40'}`}
              >
                {t.title}
                <span className="block text-[10px] tracking-[0.14em] uppercase text-magic/70 font-normal mt-0.5">
                  {t.tag}
                </span>
              </button>
            ))}
          </div>

          {/* Board panel */}
          <div className="relative z-10 panel p-5 sm:p-7 w-[min(94vw,480px)]">
            <Leaderboard
              key={active.id}
              client={active.client}
              level={active.level}
              label={active.label}
              showMeta={active.showMeta}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-5 w-[min(94vw,480px)]">
            <button
              onClick={() => onExit && onExit()}
              className="flex-1 py-2.5 rounded-xl font-semibold text-ink/85 bg-realm/50 border border-magic/30 hover:border-magic/60 transition"
            >
              ← Home
            </button>
            <button
              onClick={() => onPlay && onPlay(active.id)}
              className="flex-1 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition"
            >
              Play {active.title}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
