// ===========================================================================
// SCORES CLIENT — src/net/scores.js
// ---------------------------------------------------------------------------
// A per-game client factory. Each game gets its own client bound to a metric:
//   * 'time'  -> lower is better (escape time);  run = { escaped, timeS, pct }
//   * 'score' -> higher is better (points);      run = { score, timeS? }
//
//   const scores = createScoreClient('dino-survival', {
//     metric: 'time', cachePrefix: 'slayfit_dino_survival_v1',
//   });
//
// The client hides where data lives: it always keeps a localStorage cache
// (instant, offline-proof) and, when /api/score is reachable, the SERVER is the
// scorekeeper — a single submitRun() POST returns the authoritative best, the
// personal-best flag, the detected country, and the leaderboard, so results
// screens need no further calls. Nothing here throws on network failure.
//
// Best shape by metric:
//   time  -> { escape: Number|null, pct: Number }
//   score -> { score: Number|null }
// ===========================================================================

const API = '/api/score';
const CLIENT_KEY = 'slayfit_client_id';

// Optional shared secret (see api/_db.js requireWrite). Set VITE_SCORE_KEY at
// build time to send it; note it ships in the bundle, so it's a soft guard.
const SCORE_KEY = import.meta.env?.VITE_SCORE_KEY || '';

// --- anonymous per-browser id (NOT auth — shared across all games) ----------
export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `c_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function createScoreClient(game, { metric = 'time', cachePrefix } = {}) {
  const PREFIX = cachePrefix || `slayfit_${game.replace(/-/g, '_')}_v1`;
  const cacheKey = (lv) => `${PREFIX}_${lv}`;
  const empty = () => (metric === 'score' ? { score: null } : { escape: null, pct: 0 });

  // --- local cache ----------------------------------------------------------
  function getCachedBest(level) {
    try { return JSON.parse(localStorage.getItem(cacheKey(level))) || empty(); }
    catch { return empty(); }
  }
  function writeCache(level, best) {
    try { localStorage.setItem(cacheKey(level), JSON.stringify(best)); } catch {}
  }

  // Fold a finished run into a best object -> { best, improved }.
  function foldRun(best, run) {
    if (metric === 'score') {
      const cur = best?.score ?? null;
      const s = Number(run.score) || 0;
      if (cur == null || s > cur) return { best: { score: s }, improved: true };
      return { best: { score: cur }, improved: false };
    }
    const next = { escape: best?.escape ?? null, pct: best?.pct ?? 0 };
    let improved = false;
    if (run.escaped) {
      if (next.escape == null || run.timeS < next.escape) { next.escape = run.timeS; improved = true; }
    } else if (run.pct > next.pct) {
      next.pct = run.pct; improved = true;
    }
    return { best: next, improved };
  }

  function mergeLocalBest(level, run) {
    const { best, improved } = foldRun(getCachedBest(level), run);
    if (improved) writeCache(level, best);
    return { best, improved };
  }

  // Merge a server best into the cache (take the better of the two).
  function reconcile(level, serverBest) {
    if (!serverBest) return getCachedBest(level);
    const local = getCachedBest(level);
    let merged;
    if (metric === 'score') {
      merged = { score: Math.max(serverBest.score || 0, local.score || 0) };
    } else {
      const escape =
        serverBest.escape == null ? local.escape
        : local.escape == null ? serverBest.escape
        : Math.min(serverBest.escape, local.escape);
      merged = { escape, pct: Math.max(serverBest.pct || 0, local.pct || 0) };
    }
    writeCache(level, merged);
    return merged;
  }

  // --- backend (best-effort, never throw) -----------------------------------
  function runBody(level, run) {
    if (metric === 'score') {
      return { game, level, score: Math.round(Number(run.score) || 0), timeS: run.timeS ?? null };
    }
    return { game, level, escaped: !!run.escaped, timeS: run.timeS, pct: run.pct || 0 };
  }

  // One POST ends the run and returns { best, isPB, country, leaderboard } | null.
  async function submitRun(level, run, { player = null, country = null } = {}) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SCORE_KEY ? { 'x-slayfit-key': SCORE_KEY } : {}),
        },
        body: JSON.stringify({ ...runBody(level, run), player, country, clientId: clientId() }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.ok === false) return null;
      return {
        best: data.best ?? null,
        isPB: !!data.isPB,
        country: data.country ?? null,
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
      };
    } catch {
      return null; // offline / db-unconfigured -> caller stays on local cache
    }
  }

  // One GET fetches best + leaderboard + detected country together (so there's
  // no separate /api/geo round-trip). -> { best, leaderboard, country } | null
  async function fetchState(level, limit = 10) {
    try {
      const res = await fetch(`${API}?game=${encodeURIComponent(game)}&level=${level}&limit=${limit}&clientId=${encodeURIComponent(clientId() || '')}`);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        best: data?.best ?? null,
        leaderboard: Array.isArray(data?.leaderboard) ? data.leaderboard : [],
        country: data?.country ?? null,
      };
    } catch {
      return null;
    }
  }

  return { game, metric, getCachedBest, mergeLocalBest, foldRun, reconcile, submitRun, fetchState };
}
