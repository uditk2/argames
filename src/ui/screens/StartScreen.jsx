// ===========================================================================
// StartScreen — choose duration + bodyweight, see the (registry-driven)
// avatar, then Start (camera) or Demo mode (no camera). Styled to match the
// magical mockup.
// ===========================================================================

import React, { useState, useEffect } from 'react';
import { DURATION_PRESETS } from '../../config/game.config.js';
import { AVATARS, getAvatar } from '../../config/avatars.js';
import { BRAND } from '../../config/brand.js';
import { trackGameStarted } from '../../analytics/ga.js';
import { getName, setName, getCountry, setCountry, flagEmoji } from '../../net/identity.js';
import { punchScores, PUNCH_LEVEL } from '../../net/gameClients.js';
import Leaderboard from '../Leaderboard.jsx';

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

export default function StartScreen({ initial, onStart }) {
  const [durationSec, setDurationSec] = useState(initial.durationSec);
  const [bodyweightKg, setBodyweightKg] = useState(initial.bodyweightKg);
  const [avatarId, setAvatarId] = useState(initial.avatarId);
  const [name, setNameState] = useState(() => getName());
  const [country, setCountryState] = useState(() => getCountry());
  const [showBoard, setShowBoard] = useState(false);
  const [note, setNote] = useState('');
  const avatar = getAvatar(avatarId);

  // One server call: detect country (and warm the board) at the arena gate.
  useEffect(() => {
    if (country) return;
    let live = true;
    punchScores.fetchState(PUNCH_LEVEL).then((st) => {
      if (live && st?.country) { setCountry(st.country); setCountryState(st.country); }
    });
    return () => { live = false; };
  }, [country]);

  const begin = (mode) => {
    if (!name.trim()) { setNote('Name your fighter first.'); return; }
    setName(name);
    trackGameStarted({ durationSec, mode, avatarId });
    onStart({ durationSec, bodyweightKg: Number(bodyweightKg) || 70, avatarId, mode });
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Ambient background */}
      <img
        src="/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(90,30,110,.45)] via-[rgba(16,8,30,.7)] to-[rgba(8,4,16,.92)]" />
      <div className="absolute left-1/2 top-[58%] w-[520px] h-[520px] -ml-[260px] -mt-[260px] rounded-full border-2 border-dashed border-magic/30 animate-spin-slow shadow-[0_0_60px_rgb(var(--magic-rgb)/.2)_inset]" />

      {/* Scrollable layer over the fixed background: centers the card when it fits,
          scrolls when it's taller, so the whole form is reachable on portrait phones. */}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="min-h-full flex items-center justify-center p-3 sm:p-4">

      {/* Leaderboard overlay */}
      {showBoard && (
        <div className="relative z-10 panel p-6 sm:p-7 w-[min(92vw,480px)] my-auto">
          <Leaderboard client={punchScores} level={PUNCH_LEVEL} label="Arena" onClose={() => setShowBoard(false)} />
        </div>
      )}

      {/* Card */}
      {!showBoard && (
      <div className="relative z-10 panel p-6 sm:p-8 w-[min(92vw,460px)] my-auto">
        <div className="text-center mb-4 sm:mb-6">
          <div className="text-[10px] tracking-[0.3em] text-magic/60 uppercase mb-1">{BRAND.wordmark}</div>
          <div className="font-display font-black text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
            MONSTER PUNCH
          </div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase">
            {BRAND.tagline}
          </div>
        </div>

        {/* Avatar preview (read from registry) */}
        <div className="flex flex-col items-center mb-4 sm:mb-6">
          <div className="relative">
            <div className="absolute inset-0 -m-6 rounded-full bg-magic/30 blur-2xl animate-pulse-soft" />
            <img
              src={avatar.sprites.idle}
              alt={avatar.name}
              className="relative h-28 sm:h-40 object-contain drop-shadow-[0_0_16px_rgb(var(--magic-rgb)/.55)]"
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

        {/* Fighter name + detected origin — tagged onto your leaderboard score. */}
        <div className="mb-5">
          <div className="text-[11px] tracking-[0.14em] uppercase text-magic/80 mb-2">Fighter</div>
          <div className="relative">
            <input
              value={name}
              onChange={(e) => setNameState(e.target.value.slice(0, 40))}
              onBlur={(e) => setName(e.target.value)}
              placeholder="Name the champion…"
              maxLength={40}
              className="w-full py-2.5 pl-4 pr-10 rounded-xl bg-realm/50 border border-magic/40 text-ink placeholder:text-ink/40 focus:border-magic focus:outline-none focus:shadow-glow transition"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none" title={country || 'detecting origin'}>
              {country ? flagEmoji(country) : '🌐'}
            </span>
          </div>
          {note && <p className="text-fire-bright text-[11px] mt-1.5">{note}</p>}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={() => begin('camera')}
            disabled={!name.trim()}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
          >
            Start — enter the arena (camera)
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => begin('demo')}
              disabled={!name.trim()}
              className="flex-1 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-shield/40 hover:border-shield transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Demo mode
            </button>
            <button
              onClick={() => setShowBoard(true)}
              className="px-4 py-2.5 rounded-xl font-semibold text-gold/90 bg-realm/50 border border-gold/30 hover:border-gold/60 transition"
            >
              🏆 Ranks
            </button>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-center text-magic/60 leading-relaxed">
          Punch what flies in · arms up to block.
          Camera needs HTTPS or localhost.
        </p>
      </div>
      )}
        </div>
      </div>
    </div>
  );
}
