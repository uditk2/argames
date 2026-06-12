-- ===========================================================================
-- SlayFit — Neon (Postgres) schema
-- ---------------------------------------------------------------------------
-- Run once against your Neon database to create the scores table.
--   neon SQL editor  ->  paste this file  ->  Run
--   or:  psql "$DATABASE_URL" -f db/schema.sql
--
-- Design notes:
--  * One row per finished run (an append-only event log). "Personal best" and
--    "leaderboard" are just queries over this table — we never UPDATE a best,
--    we INSERT a run and read the min/max back. Keeps writes trivial + auditable.
--  * `client_id` is an anonymous per-browser id (uuid generated client-side and
--    kept in localStorage). It is NOT auth — just lets a player see *their* runs
--    across sessions without accounts. Swap for a real user id later if you add
--    Neon Auth / accounts.
--  * `game` column makes this reusable for future SlayFit modes (not just dino).
-- ===========================================================================

-- One table, many games (the `game` column namespaces them). Two leaderboard
-- "metrics" are supported:
--   * time-based  (dino-survival): rank by fastest escape time_s
--   * score-based (monster-punch): rank by highest score
-- Metric-specific columns are nullable so a row only fills what its game needs.
create table if not exists scores (
  id          bigint generated always as identity primary key,
  game        text        not null default 'dino-survival',
  level       text        not null,                      -- per-game bucket (dino: EASY..IMPOSSIBLE; monster: DEFAULT)
  escaped     boolean,                                   -- [time] reached the jeep?
  time_s      real,                                      -- [time] escape time / [score] workout length (seconds)
  pct         smallint    not null default 0,            -- [time] distance reached (0..100) when caught
  score       integer,                                   -- [score] points (higher is better)
  player      text,                                      -- optional display name (nullable)
  country     text,                                      -- ISO-3166 alpha-2, detected server-side at play start
  client_id   text,                                      -- anonymous per-browser id (not auth)
  created_at  timestamptz not null default now()
);

-- Best ESCAPE time per (game, level): fast "min(time_s) where escaped" lookups.
create index if not exists scores_best_escape_idx
  on scores (game, level, time_s)
  where escaped;

-- Best DISTANCE per (game, level) for runs that didn't escape.
create index if not exists scores_best_pct_idx
  on scores (game, level, pct desc)
  where not escaped;

-- Best SCORE per (game, level): fast "max(score)" + top-N desc (monster-punch).
create index if not exists scores_best_score_idx
  on scores (game, level, score desc)
  where score is not null;

-- A player's own history.
create index if not exists scores_client_idx
  on scores (client_id, created_at desc);
