// ===========================================================================
// HomeScreen — top-level mode picker: the solo "Demon Onslaught" (the existing
// boxer game) or "Versus (2P)" (WebRTC duel). Keeps the two games cleanly
// separate; each is its own screen/flow.
// ===========================================================================

import React from 'react';
import { BRAND } from '../../config/brand.js';

export default function HomeScreen({ onSolo, onVersus }) {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <img src="/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(90,30,110,.45)] via-[rgba(16,8,30,.7)] to-[rgba(8,4,16,.92)]" />

      <div className="relative z-10 panel p-8 w-[min(92vw,460px)]">
        <div className="text-center mb-6">
          <div className="font-display font-black text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
            {BRAND.wordmark}
          </div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase">{BRAND.tagline}</div>
        </div>

        <div className="space-y-3">
          <button onClick={onSolo}
            className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition text-left px-5">
            <div className="text-lg">Demon Onslaught</div>
            <div className="text-[12px] font-normal text-white/80">Solo · punch the swarm, beat the clock</div>
          </button>
          <button onClick={onVersus}
            className="w-full py-4 rounded-xl font-semibold bg-realm/50 border border-shield/50 hover:border-shield transition text-left px-5">
            <div className="text-lg text-ink">Versus <span className="text-shield">(2P)</span></div>
            <div className="text-[12px] font-normal text-ink/70">Peer-to-peer duel · KO your opponent</div>
          </button>
        </div>

        <p className="mt-5 text-[11px] text-center text-magic/60">Camera needs HTTPS or localhost.</p>
      </div>
    </div>
  );
}
