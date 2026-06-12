// ===========================================================================
// SHARED DB HELPER — api/_db.js   (underscore => not a routable endpoint)
// ---------------------------------------------------------------------------
// One place that knows how to talk to Neon. Every serverless function imports
// `sql` from here instead of constructing its own connection, so credentials
// and driver config live in exactly one spot.
//
// Driver: @neondatabase/serverless — talks to Neon over HTTP (fetch), so it
// works in both Vercel Node functions AND Edge, and needs no connection pool
// to keep warm. The connection string NEVER reaches the browser: it is read
// from the DATABASE_URL env var, which only exists server-side.
//
// Auth note: we deliberately do NOT use Neon Auth here. End-user identity is a
// separate concern; DB-credential safety is handled by keeping DATABASE_URL
// server-side. The `requireWrite()` hook below is where you'd later bolt on a
// shared-secret / rate-limit / signed-request check for write endpoints.
// ===========================================================================

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Fail loud at cold-start in prod; in local dev without a DB the score
  // endpoints will 503 and the client falls back to localStorage (see
  // src/net/scores.js), so the game still runs.
  console.warn('[db] DATABASE_URL is not set — score persistence disabled.');
}

// Tagged-template query fn: sql`select ... ${value}` is automatically
// parameterised (no string interpolation => no SQL injection).
export const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

export const dbReady = () => sql != null;

// ---------------------------------------------------------------------------
// Small CORS / method helpers so each endpoint stays tiny.
// ---------------------------------------------------------------------------
export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// WRITE GUARD HOOK — synchronous, header-based checks.
// Returns null to allow, or a string reason to reject (=> 403).
//
// Shared secret (opt-in): if SCORE_KEY is set in the server env, the client must
// send a matching `x-slayfit-key` header. If SCORE_KEY is unset the check is
// skipped, so the endpoint keeps working until you choose to lock it down.
//
// HONEST LIMITATION: the client key ships inside the JS bundle (VITE_SCORE_KEY),
// so a determined user can read it. This only stops low-effort/bot abuse that
// hasn't inspected your bundle. The always-on per-client RATE LIMIT (in
// api/score.js) and the plausibility floor are the load-bearing defenses; real
// trust requires authenticated accounts + server-validated runs.
// ---------------------------------------------------------------------------
export function requireWrite(req) {
  const expected = process.env.SCORE_KEY;
  if (!expected) return null; // not configured -> open
  const got = req.headers?.['x-slayfit-key'];
  if (got !== expected) return 'forbidden';
  return null;
}

// Per-client rate limit using the scores table itself (no extra infra): how
// many runs has this client written in the last `windowS` seconds? Returns true
// if the caller is over `max` and should be rejected (429). Best-effort: on any
// DB hiccup we fail OPEN (return false) so real players are never blocked.
export async function overRateLimit(clientId, { max = 12, windowS = 60 } = {}) {
  if (!sql || !clientId) return false;
  try {
    const r = await sql`
      select count(*)::int as n
      from scores
      where client_id = ${clientId}
        and created_at > now() - (${windowS} || ' seconds')::interval`;
    return (r[0]?.n ?? 0) >= max;
  } catch {
    return false;
  }
}
