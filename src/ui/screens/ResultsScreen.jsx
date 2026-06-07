// ===========================================================================
// ResultsScreen — final score / slain / kcal / time, play again, and real
// social sharing: the 10s instant-replay clip + a generated score card.
// All share logic lives in the separate src/sharing/ module; this screen only
// presents previews and triggers it. Buttons degrade to a download when the
// Web Share API isn't available (common on desktop).
// ===========================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { shareReplay, shareScoreCard, buildScoreCard } from '../../sharing/index.js';

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ResultsScreen({ results, clip, onPlayAgain }) {
  const stats = [
    { label: 'Score', value: results.score.toLocaleString(), cls: 'text-white' },
    { label: 'Demons slain', value: results.slain, cls: 'text-gold' },
    { label: 'Calories', value: results.kcal, cls: 'text-fire-bright' },
    { label: 'Best combo', value: `×${results.bestCombo}`, cls: 'text-fire-bright' },
    { label: 'Punches', value: results.punches, cls: 'text-ink' },
    { label: 'Blocks', value: results.blocks, cls: 'text-shield' },
  ];

  const [card, setCard] = useState(null);     // { blob, url } score card preview
  const [busy, setBusy] = useState('');       // '' | 'clip' | 'card'
  const [note, setNote] = useState('');       // small status line

  // Playable object URL for the clip <video>. We build it HERE from clip.blob
  // (rather than reusing clip.url created in the replay buffer) so each mount
  // owns its own URL. Under React StrictMode (dev) the component mounts →
  // unmounts → mounts; a shared URL would be revoked by the first unmount's
  // cleanup, leaving the live <video> pointing at a dead blob (MEDIA format
  // error, dead play button). Per-mount URLs avoid that entirely.
  const [clipUrl, setClipUrl] = useState(null);
  const hasClip = !!clipUrl;

  // Build the score-card preview once on mount (feature-detects assets itself).
  useEffect(() => {
    let alive = true;
    let madeUrl = null;
    buildScoreCard(results)
      .then((c) => {
        if (!alive) {
          if (c?.url) URL.revokeObjectURL(c.url);
          return;
        }
        madeUrl = c.url;
        setCard(c);
      })
      .catch((e) => console.warn('[results] score card build failed:', e));
    return () => {
      alive = false;
      if (madeUrl) URL.revokeObjectURL(madeUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create a fresh playable URL from the clip blob for THIS mount, and revoke
  // only that one on unmount. Falls back to clip.url if a blob isn't present.
  useEffect(() => {
    if (!clip) { setClipUrl(null); return; }
    if (clip.blob) {
      const url = URL.createObjectURL(clip.blob);
      setClipUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setClipUrl(clip.url || null);
    return undefined;
  }, [clip]);

  const methodLabel = (m) =>
    m === 'share' ? 'Shared!' : m === 'download' ? 'Downloaded (share sheet unavailable)' : 'Sharing unsupported on this device';

  async function onShareClip() {
    if (!hasClip || busy) return;
    setBusy('clip');
    setNote('');
    try {
      const res = await shareReplay(clip, results);
      setNote(methodLabel(res.method));
    } catch (e) {
      console.warn(e);
      setNote('Could not share the clip.');
    } finally {
      setBusy('');
    }
  }

  async function onShareCard() {
    if (busy) return;
    setBusy('card');
    setNote('');
    try {
      // Reuse the already-built preview card if we have it.
      const res = await shareScoreCard(results, card ? { card } : {});
      setNote(methodLabel(res.method));
    } catch (e) {
      console.warn(e);
      setNote('Could not share the score card.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <img
        src="/assets/backgrounds/Fading_Sky-Night_03-1024x512.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(90,30,110,.5)] via-[rgba(16,8,30,.75)] to-[rgba(8,4,16,.95)]" />

      <div className="relative z-10 panel p-8 w-[min(94vw,560px)] max-h-[94vh] overflow-y-auto text-center">
        <div className="font-display font-black text-2xl bg-gradient-to-b from-[#ffe7a8] to-[#ff8c3c] bg-clip-text text-transparent">
          REALM CLEARED
        </div>
        <div className="text-[11px] tracking-[0.22em] uppercase text-magic/80 mt-1">
          {fmtDur(results.durationSec)} workout complete
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          {stats.map((s) => (
            <div key={s.label} className="panel py-3">
              <div className="text-[11px] uppercase tracking-wider text-magic/70">{s.label}</div>
              <div className={`font-display font-black text-2xl mt-1 ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Share previews */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {/* Instant replay */}
          <div className="panel p-2 flex flex-col">
            <div className="text-[11px] uppercase tracking-wider text-magic/70 mb-1.5">Instant replay</div>
            <div className="flex-1 rounded-lg overflow-hidden bg-realm/70 aspect-[3/4] flex items-center justify-center">
              {hasClip ? (
                <video
                  src={clipUrl}
                  controls
                  autoPlay
                  playsInline
                  muted
                  loop
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[11px] text-magic/50 px-2 text-center">
                  No clip captured (recording unavailable on this browser).
                </span>
              )}
            </div>
            <button
              onClick={onShareClip}
              disabled={!hasClip || !!busy}
              className="mt-2 text-[12px] px-3 py-1.5 rounded-lg font-semibold text-white bg-gradient-to-r from-magic to-fire disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition pointer-events-auto"
            >
              {busy === 'clip' ? 'Sharing…' : 'Share clip'}
            </button>
          </div>

          {/* Score card */}
          <div className="panel p-2 flex flex-col">
            <div className="text-[11px] uppercase tracking-wider text-magic/70 mb-1.5">Score card</div>
            <div className="flex-1 rounded-lg overflow-hidden bg-realm/70 aspect-[3/4] flex items-center justify-center">
              {card ? (
                <img src={card.url} alt="Score card" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[11px] text-magic/50">Conjuring card…</span>
              )}
            </div>
            <button
              onClick={onShareCard}
              disabled={!!busy}
              className="mt-2 text-[12px] px-3 py-1.5 rounded-lg font-semibold text-white bg-gradient-to-r from-fire to-magic disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition pointer-events-auto"
            >
              {busy === 'card' ? 'Sharing…' : 'Share score card'}
            </button>
          </div>
        </div>

        {note && <div className="mt-3 text-[12px] text-magic/80">{note}</div>}
        <div className="mt-1 text-[10px] text-magic/40">
          Clip is WebM. On desktop, Share saves a file; on mobile it opens the share sheet.
        </div>

        <button
          onClick={onPlayAgain}
          className="mt-5 w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition pointer-events-auto"
        >
          Play again
        </button>
      </div>
    </div>
  );
}
