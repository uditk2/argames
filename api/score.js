// ===========================================================================
// SCORES ENDPOINT — /api/score   (the server is the scorekeeper, multi-game)
// ---------------------------------------------------------------------------
// One client<->server round-trip per game. The POST that ends a run returns
// everything the UI needs (best, isPB, country, leaderboard), so results
// screens make no further calls.
//
// Two leaderboard METRICS, chosen per game via the GAMES registry:
//   * 'time'  (dino-survival): rank by fastest escape time_s (lower is better)
//   * 'score' (monster-punch): rank by highest score        (higher is better)
//
// POST /api/score
//   time : { game, level, escaped, timeS, pct?, player?, clientId? }
//   score: { game, level, score, timeS?(duration), player?, clientId? }
//   -> { ok, best, isPB, country, leaderboard }
//
// GET /api/score?game=..&level=..&limit=..[&clientId=..]
//   -> { best, leaderboard, mine, country }
//
// All DB access goes through the shared `sql` helper (api/_db.js). The browser
// never sees DATABASE_URL.
// ===========================================================================

import { sql, dbReady, applyCors, json, requireWrite, overRateLimit } from './_db.js';

// Per-game config: which metric, and which level buckets are valid.
const GAMES = {
  'dino-survival': { metric: 'time',  levels: new Set(['EASY', 'MEDIUM', 'HARD', 'IMPOSSIBLE']) },
  'monster-punch': { metric: 'score', levels: new Set(['DEFAULT']) },
};

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const safeStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const MIN_ESCAPE_S = 3;        // time-metric plausibility floor
const MAX_SCORE = 100_000_000; // score-metric sanity ceiling

function resolveGame(rawGame, rawLevel) {
  const game = safeStr(rawGame, 40) || 'dino-survival';
  const cfg = GAMES[game];
  if (!cfg) return { error: 'bad game' };
  const level = String(rawLevel || '').toUpperCase();
  if (!cfg.levels.has(level)) return { error: 'bad level' };
  return { game, level, metric: cfg.metric };
}

// ISO-2 country the EDGE saw (harder to spoof than a body field).
function edgeCountry(req, bodyCountry = null) {
  const h = req.headers || {};
  const raw = h['x-vercel-ip-country'] || h['cf-ipcountry'] || null;
  if (typeof raw === 'string' && /^[A-Za-z]{2}$/.test(raw) && raw.toUpperCase() !== 'XX') {
    return raw.toUpperCase();
  }
  return safeStr(bodyCountry, 2)?.toUpperCase() || null;
}

// Optional community feed: post an escape to a Discord channel via webhook.
// POST-ONLY by design — the on-site leaderboard stays in Neon and we never read
// back from Discord (auth/rate-limits/CORS make that fragile). No-op unless
// DISCORD_WEBHOOK_URL is set; always best-effort so it can't break scoring.
async function postDiscord(req, { game, level, player, timeS, pct, escaped, isPB, country }) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || game !== 'dino-survival' || !escaped) return;
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const params = new URLSearchParams({ g: 'dino', esc: '1', dt: String(Math.round(timeS * 10)), pct: String(pct || 0) });
    const link = host ? `${proto}://${host}/s?${params.toString()}` : null;
    const who = (player && player.trim()) || 'A runner';
    const embed = {
      title: `${who} escaped the beast in ${timeS.toFixed(1)}s 🦖`,
      description: `${level}${isPB ? ' · new personal best!' : ''}${country ? ` · ${country}` : ''}`,
      color: 0xff7a3c,
      ...(link ? { url: link } : {}),
    };
    const body = { username: 'Dino Survival', embeds: [embed], ...(link ? { content: link } : {}) };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);   // don't let a slow webhook hold the response
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).catch(() => {});
    clearTimeout(t);
  } catch { /* best-effort: never break score submission */ }
}

// Best for a game+level, shaped by metric.
async function bestFor(game, level, metric) {
  if (metric === 'score') {
    const r = await sql`
      select max(score) as score
      from scores
      where game = ${game} and level = ${level} and score is not null`;
    return { score: r[0]?.score ?? null };
  }
  const r = await sql`
    select
      min(time_s) filter (where escaped)               as escape,
      coalesce(max(pct) filter (where not escaped), 0) as pct
    from scores
    where game = ${game} and level = ${level}`;
  return { escape: r[0]?.escape ?? null, pct: r[0]?.pct ?? 0 };
}

// Top-N, shaped by metric. `mine` marks the caller's rows without exposing ids.
async function topN(game, level, metric, limit, clientId = null) {
  if (metric === 'score') {
    return sql`
      select player, country, score, created_at,
             (${clientId}::text is not null and client_id = ${clientId}) as mine
      from scores
      where game = ${game} and level = ${level} and score is not null
      order by score desc
      limit ${limit}`;
  }
  return sql`
    select player, country, time_s, created_at,
           (${clientId}::text is not null and client_id = ${clientId}) as mine
    from scores
    where game = ${game} and level = ${level} and escaped
    order by time_s asc
    limit ${limit}`;
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!dbReady()) {
    return json(res, 503, { ok: false, reason: 'db-unconfigured', country: edgeCountry(req) });
  }

  try {
    // ----- READ ----------------------------------------------------------
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = resolveGame(q.game, q.level);
      if (g.error) return json(res, 400, { error: g.error });
      const limit = Math.max(1, Math.min(100, parseInt(q.limit, 10) || 10));
      const clientId = safeStr(q.clientId, 64);

      const [best, leaderboard] = await Promise.all([
        bestFor(g.game, g.level, g.metric),
        topN(g.game, g.level, g.metric, limit, clientId),
      ]);

      let mine = null;
      if (clientId) {
        mine = await sql`
          select level, escaped, time_s, pct, score, created_at
          from scores
          where game = ${g.game} and client_id = ${clientId}
          order by created_at desc
          limit 10`;
      }
      return json(res, 200, { best, leaderboard, mine, country: edgeCountry(req) });
    }

    // ----- WRITE (authoritative score-keeping) ---------------------------
    if (req.method === 'POST') {
      const reason = requireWrite(req);
      if (reason) return json(res, 403, { error: reason });

      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const g = resolveGame(b.game, b.level);
      if (g.error) return json(res, 400, { error: g.error });

      const player = safeStr(b.player, 40);
      const clientId = safeStr(b.clientId, 64);
      const country = edgeCountry(req, b.country);

      // Always-on abuse guard: cap runs per client per minute (fails open).
      if (await overRateLimit(clientId)) {
        return json(res, 429, { error: 'too many submissions, slow down' });
      }

      let isPB = false;

      if (g.metric === 'score') {
        const score = Math.round(Number(b.score));
        if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
          return json(res, 400, { error: 'bad score' });
        }
        const durS = Number(b.timeS);
        const timeS = Number.isFinite(durS) && durS >= 0 ? durS : null;

        let prevBest = null;
        if (clientId) {
          const p = await sql`
            select max(score) as s
            from scores
            where game = ${g.game} and level = ${g.level} and client_id = ${clientId} and score is not null`;
          prevBest = p[0]?.s ?? null;
        }
        isPB = prevBest == null || score > prevBest;

        await sql`
          insert into scores (game, level, score, time_s, pct, player, country, client_id)
          values (${g.game}, ${g.level}, ${score}, ${timeS}, 0, ${player}, ${country}, ${clientId})`;
      } else {
        const escaped = !!b.escaped;
        const timeS = Number(b.timeS);
        if (!Number.isFinite(timeS) || timeS < 0 || timeS > 36000) {
          return json(res, 400, { error: 'bad timeS' });
        }
        if (escaped && timeS < MIN_ESCAPE_S) {
          return json(res, 422, { error: 'implausible time' });
        }
        const pct = clampPct(b.pct);

        let prevEscape = null;
        if (clientId) {
          const p = await sql`
            select min(time_s) as t
            from scores
            where game = ${g.game} and level = ${g.level} and client_id = ${clientId} and escaped`;
          prevEscape = p[0]?.t ?? null;
        }
        isPB = escaped && (prevEscape == null || timeS < prevEscape);

        await sql`
          insert into scores (game, level, escaped, time_s, pct, player, country, client_id)
          values (${g.game}, ${g.level}, ${escaped}, ${timeS}, ${pct}, ${player}, ${country}, ${clientId})`;

        // optional Discord community feed (no-op unless DISCORD_WEBHOOK_URL is set)
        await postDiscord(req, { game: g.game, level: g.level, player, timeS, pct, escaped, isPB, country });
      }

      const [best, leaderboard] = await Promise.all([
        bestFor(g.game, g.level, g.metric),
        topN(g.game, g.level, g.metric, 10, clientId),
      ]);
      return json(res, 200, { ok: true, best, isPB, country, leaderboard });
    }

    return json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error('[api/score]', err);
    return json(res, 500, { error: 'server error' });
  }
}
