// ScorePanel HUD — score + slain + kcal (top-right, matches mockup).
import React from 'react';

export default function ScorePanel({ score, slain, kcal }) {
  return (
    <div className="absolute top-2 sm:top-4 right-3 sm:right-5 text-right pointer-events-none">
      <div className="text-[9px] sm:text-[11px] tracking-[0.14em] uppercase text-magic/80">Score</div>
      <div className="font-display font-black text-[22px] sm:text-[34px] leading-none text-white text-glow">
        {score.toLocaleString()}
      </div>
      <div className="flex gap-3 sm:gap-5 justify-end mt-1 sm:mt-2">
        <div>
          <div className="text-[9px] sm:text-[11px] uppercase text-magic/80">Slain</div>
          <div className="text-sm sm:text-lg font-bold text-gold">{slain}</div>
        </div>
        <div>
          <div className="text-[9px] sm:text-[11px] uppercase text-magic/80">Kcal</div>
          <div className="text-sm sm:text-lg font-bold text-fire-bright">{Math.round(kcal)}</div>
        </div>
      </div>
    </div>
  );
}
