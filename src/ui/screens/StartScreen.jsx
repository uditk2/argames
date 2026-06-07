// ===========================================================================
// StartScreen — choose duration + bodyweight, see the (registry-driven)
// avatar, then Start (camera) or Demo mode (no camera). Styled to match the
// magical mockup.
// ===========================================================================

import React, { useState } from 'react';
import { DURATION_PRESETS } from '../../config/game.config.js';
import { AVATARS, getAvatar } from '../../config/avatars.js';
import { BRAND } from '../../config/brand.js';
import { trackGameStarted } from '../../analytics/ga.js';

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

export default function StartScreen({ initial, onStart }) {
  const [durationSec, setDurationSec] = useState(initial.durationSec);
  const [bodyweightKg, setBodyweightKg] = useState(initial.bodyweightKg);
  const [avatarId, setAvatarId] = useState(initial.avatarId);
  const avatar = getAvatar(avatarId);

  const begin = (mode) => {
    trackGameStarted({ durationSec, mode, avatarId });
    onStart({ durationSec, bodyweightKg: Number(bodyweightKg) || 70, avatarId, mode });
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* Ambient background */}
      <img
        src="/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(90,30,110,.45)] via-[rgba(16,8,30,.7)] to-[rgba(8,4,16,.92)]" />
      <div className="absolute left-1/2 top-[58%] w-[520px] h-[520px] -ml-[260px] -mt-[260px] rounded-full border-2 border-dashed border-magic/30 animate-spin-slow shadow-[0_0_60px_rgb(var(--magic-rgb)/.2)_inset]" />

      {/* Card */}
      <div className="relative z-10 panel p-8 w-[min(92vw,460px)]">
        <div className="text-center mb-6">
          <div className="font-display font-black text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
            {BRAND.wordmark}
          </div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase">
            {BRAND.tagline}
          </div>
        </div>

        {/* Avatar preview (read from registry) */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 -m-6 rounded-full bg-magic/30 blur-2xl animate-pulse-soft" />
            <img
              src={avatar.sprites.idle}
              alt={avatar.name}
              className="relative h-40 object-contain drop-shadow-[0_0_16px_rgb(var(--magic-rgb)/.55)]"
            />
          </div>
          <div className="mt-2 text-sm text-ink/90">{avatar.name}</div>
          {AVATARS.length > 1 && (
            <select
              value={avatarId}
              onChange={(e) => setAvatarId(e.target.value)}
              className="mt-2 bg-realm/60 border border-magic/40 rounded-lg px-2 py-1 text-sm"
            >
              {AVATARS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Duration presets */}
        <div className="mb-5">
          <div className="text-[11px] tracking-[0.14em] uppercase text-magic/80 mb-2">
            Workout length
          </div>
          <div className="grid grid-cols-4 gap-2">
            {DURATION_PRESETS.map((sec) => (
              <button
                key={sec}
                onClick={() => setDurationSec(sec)}
                className={`py-2 rounded-xl text-sm font-semibold border transition
                  ${durationSec === sec
                    ? 'bg-magic/30 border-magic text-white shadow-glow'
                    : 'bg-realm/40 border-magic/30 text-ink/80 hover:border-magic/60'}`}
              >
                {fmt(sec)}
              </button>
            ))}
          </div>
        </div>

        {/* Bodyweight */}
        <div className="mb-6">
          <div className="text-[11px] tracking-[0.14em] uppercase text-magic/80 mb-2">
            Bodyweight (kg) — for kcal
          </div>
          <input
            type="number"
            min="30"
            max="250"
            value={bodyweightKg}
            onChange={(e) => setBodyweightKg(e.target.value)}
            className="w-full bg-realm/50 border border-magic/40 rounded-xl px-3 py-2 text-ink focus:outline-none focus:border-magic"
          />
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={() => begin('camera')}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition"
          >
            Start — enter the realm (camera)
          </button>
          <button
            onClick={() => begin('demo')}
            className="w-full py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-shield/40 hover:border-shield transition"
          >
            Demo mode (no camera)
          </button>
        </div>

        <p className="mt-4 text-[11px] text-center text-magic/60 leading-relaxed">
          Punch what flies in · arms up to block.
          Camera needs HTTPS or localhost.
        </p>
      </div>
    </div>
  );
}
