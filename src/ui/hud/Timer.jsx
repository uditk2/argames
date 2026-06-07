// Timer HUD — big countdown + progress bar (matches mockup, top-center).
import React from 'react';
import { formatTime } from '../../engine/timer.js';

export default function Timer({ timeLeftMs, progress }) {
  return (
    <div className="absolute top-2 sm:top-4 left-1/2 -translate-x-1/2 text-center pointer-events-none">
      <div className="font-display font-black text-[28px] sm:text-[46px] leading-none text-white text-glow">
        {formatTime(timeLeftMs)}
      </div>
      <div className="text-[9px] sm:text-[11px] tracking-[0.22em] uppercase text-magic/80 mt-0.5">
        time left
      </div>
      <div className="w-[130px] sm:w-[220px] h-1.5 mx-auto mt-1.5 sm:mt-2 rounded bg-white/15 overflow-hidden">
        <i
          className="block h-full rounded bg-gradient-to-r from-magic to-shield shadow-glow transition-[width] duration-300"
          style={{ width: `${Math.min(100, (1 - progress) * 100)}%` }}
        />
      </div>
    </div>
  );
}
