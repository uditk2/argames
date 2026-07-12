// ===========================================================================
// Relic Hunter — CAMPAIGN PROGRESS (localStorage-backed meta-progression).
// ---------------------------------------------------------------------------
// The between-session memory the game was missing: per-level BEST TIME + a 1–3
// STAR rating (time vs par), how far the campaign has been reached (Resume), and
// lifetime totals (runs started, relics recovered). Purely a scoreboard — it
// never touches gameplay; the engine and campaign flow are unchanged. Every read
// and write is guarded, so a blocked/absent localStorage just yields empty stats.
//
//   starsFor(timeLeftS, budgetS)      -> 0..3  (more time to spare = more stars)
//   recordClear(idx, timeLeftS, bud)  -> { stars, best, isBestTime }  (also bumps furthest)
//   recordCampaignStart()             -> bump the lifetime run counter
//   recordVictory()                   -> bump the lifetime relic (full-clear) counter
//   getLevel(idx)                     -> { stars, bestTime } | null
//   getStarsByLevel()                 -> { [idx]: stars }
//   getSummary()                      -> { runs, relics, furthest, totalStars, maxStars }
//   formatTime(s)                     -> "m:ss"
//   resetAll()                        -> wipe (dev/testing)
// ===========================================================================

const KEY = 'relichunter.progress.v1';
const LEVEL_COUNT = 6;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { levels: {}, runs: 0, relics: 0, furthest: 0 };
    const p = JSON.parse(raw);
    return { levels: p.levels || {}, runs: p.runs || 0, relics: p.relics || 0, furthest: p.furthest || 0 };
  } catch { return { levels: {}, runs: 0, relics: 0, furthest: 0 }; }
}
function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* SSR / private mode */ } }

// Stars from the time left on the clock at the moment of escape, as a fraction of
// the level's budget: a comfortable escape is 3 stars, a squeaker is 1.
export function starsFor(timeLeftS, budgetS) {
  const b = (budgetS && budgetS > 0) ? budgetS : 1;
  const frac = Math.max(0, Math.min(1, (timeLeftS || 0) / b));
  if (frac >= 0.40) return 3;
  if (frac >= 0.15) return 2;
  return 1;
}

// Record a level clear. `timeLeftS` = seconds left on the collapse timer at escape,
// `budgetS` = that level's total time. Keeps the BEST (most time to spare) run.
export function recordClear(idx, timeLeftS, budgetS) {
  const p = load();
  const stars = starsFor(timeLeftS, budgetS);
  const timeTaken = Math.max(0, (budgetS || 0) - (timeLeftS || 0));
  const prev = p.levels[idx] || { stars: 0, bestTime: Infinity };
  const isBestTime = timeTaken < (prev.bestTime != null ? prev.bestTime : Infinity);
  p.levels[idx] = {
    stars: Math.max(prev.stars || 0, stars),
    bestTime: isBestTime ? Math.round(timeTaken * 10) / 10 : prev.bestTime,
  };
  if (idx + 1 > p.furthest) p.furthest = Math.min(LEVEL_COUNT, idx + 1);
  save(p);
  return { stars, best: p.levels[idx].bestTime, isBestTime };
}

export function recordCampaignStart() { const p = load(); p.runs = (p.runs || 0) + 1; save(p); return p.runs; }
export function recordVictory() { const p = load(); p.relics = (p.relics || 0) + 1; p.furthest = LEVEL_COUNT; save(p); return p.relics; }

export function getLevel(idx) {
  const p = load(); const l = p.levels[idx];
  if (!l) return null;
  return { stars: l.stars || 0, bestTime: (l.bestTime != null && isFinite(l.bestTime)) ? l.bestTime : null };
}

export function getStarsByLevel() {
  const p = load(); const out = {};
  for (const k of Object.keys(p.levels)) out[k] = p.levels[k].stars || 0;
  return out;
}

export function getSummary() {
  const p = load();
  let totalStars = 0;
  for (const k of Object.keys(p.levels)) totalStars += (p.levels[k].stars || 0);
  return { runs: p.runs || 0, relics: p.relics || 0, furthest: p.furthest || 0, totalStars, maxStars: LEVEL_COUNT * 3 };
}

export function formatTime(s) {
  const t = Math.max(0, Math.round(s || 0));
  const m = Math.floor(t / 60), ss = t % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function resetAll() { save({ levels: {}, runs: 0, relics: 0, furthest: 0 }); }

export default {
  starsFor, recordClear, recordCampaignStart, recordVictory,
  getLevel, getStarsByLevel, getSummary, formatTime, resetAll,
};
