// ===========================================================================
// Leaderboard — themed top-N for any game, driven by a score client.
// ---------------------------------------------------------------------------
// Pass the game's score client (from createScoreClient) so this component is
// game-agnostic: it reads `client.metric` to know how to fetch, sort, and format.
//   * metric 'time'  -> value is time_s, shown as "12.3s" (lower is better)
//   * metric 'score' -> value is score, shown as "4,120"  (higher is better)
//
// Provide `rows` to render preloaded data (e.g. the list submitRun returned —
// no extra request); omit it to fetch the full top-N for `level`. Row shape:
//   time : { player, country, time_s, mine }
//   score: { player, country, score,  mine }
// Styling mirrors the start/result screens (magic / realm / gold palette).
// ===========================================================================
import React, { useEffect, useState } from 'react';
import { flagEmoji } from '../net/identity.js';

const MEDAL = ['🥇', '🥈', '🥉'];

function formatValue(r, metric) {
  if (metric === 'score') return Number(r.score ?? 0).toLocaleString();
  return `${Number(r.time_s ?? 0).toFixed(1)}s`;
}

function Row({ r, rank, metric }) {
  const mine = !!r.mine;
  return (
    <li className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
      mine ? 'bg-magic/25 border border-magic/60 shadow-glow' : 'border border-transparent'
    }`}>
      <span className={`w-7 shrink-0 text-center font-display font-black ${rank < 3 ? 'text-base' : 'text-[13px] text-ink/60'}`}>
        {rank < 3 ? MEDAL[rank] : `#${rank + 1}`}
      </span>
      <span className="text-lg leading-none shrink-0" title={r.country || ''}>
        {r.country ? flagEmoji(r.country) : '🌐'}
      </span>
      <span className={`flex-1 truncate text-[13px] ${mine ? 'text-white font-semibold' : 'text-ink/90'}`}>
        {r.player || 'Anonymous'}{mine && <span className="text-magic/80 text-[11px] font-normal"> · you</span>}
      </span>
      <span className={`font-display font-black tabular-nums ${mine ? 'text-gold' : 'text-ink'}`}>
        {formatValue(r, metric)}
      </span>
    </li>
  );
}

export default function Leaderboard({ client, level, label, rows: preloaded = null, limit = 100, compact = false, onClose }) {
  const metric = client?.metric || 'time';
  const [rows, setRows] = useState(preloaded || []);
  const [loading, setLoading] = useState(!preloaded);

  useEffect(() => {
    if (preloaded) { setRows(preloaded); setLoading(false); return; }
    if (!client) return;
    let live = true; setLoading(true);
    client.fetchState(level, limit).then((st) => {
      if (!live) return;
      setRows(st?.leaderboard || []);
      setLoading(false);
    });
    return () => { live = false; };
  }, [client, level, limit, preloaded]);

  const sub = metric === 'score' ? 'highest' : 'fastest';

  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[420px]' : 'max-w-[460px]'}`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-black text-xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
          {compact ? 'Top Players' : 'Leaderboard'}
        </div>
        <div className="text-[11px] tracking-[0.18em] uppercase text-magic/80">{label ? `${label} · ${sub}` : sub}</div>
      </div>

      <div className="rounded-xl bg-realm/50 border border-magic/30 p-1.5">
        {loading ? (
          <p className="text-magic/80 text-[13px] text-center py-6">Summoning the rankings…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink/60 text-[13px] text-center py-6">No scores yet — be the first on the board.</p>
        ) : (
          <ol className={`space-y-0.5 ${compact ? '' : 'max-h-[46vh] overflow-y-auto pr-1'}`}>
            {rows.map((r, i) => <Row key={i} r={r} rank={i} metric={metric} />)}
          </ol>
        )}
      </div>

      {onClose && (
        <button onClick={onClose}
          className="mt-3 w-full py-2.5 rounded-xl font-semibold text-ink/85 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">
          ← Back
        </button>
      )}
    </div>
  );
}
