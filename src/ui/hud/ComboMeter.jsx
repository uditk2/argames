// ComboMeter HUD — left-center, pulses (matches mockup). Hidden at combo 0.
import React from 'react';

export default function ComboMeter({ combo }) {
  if (!combo) return null;
  return (
    <div className="absolute top-1/2 left-2 sm:left-5 -translate-y-1/2 text-center pointer-events-none">
      <div className="text-[9px] sm:text-[11px] tracking-[0.2em] uppercase text-fire-bright/90">Combo</div>
      <div className="font-display font-black text-[28px] sm:text-[44px] text-fire-bright animate-pulse-soft drop-shadow-[0_0_20px_rgba(255,122,60,.9)]">
        ×{combo}
      </div>
    </div>
  );
}
