// ===========================================================================
// Preconfigured score clients, one per game. Import these instead of calling
// createScoreClient ad hoc, so a game's metric + cache key are defined once.
//   * dino-survival : TIME metric  (fastest escape wins)
//   * monster-punch : SCORE metric (highest score wins)
// cachePrefix values preserve each game's original localStorage keys.
// ===========================================================================
import { createScoreClient } from './scores.js';

export const dinoScores = createScoreClient('dino-survival', {
  metric: 'time',
  cachePrefix: 'slayfit_dino_survival_v1',
});

export const punchScores = createScoreClient('monster-punch', {
  metric: 'score',
  cachePrefix: 'slayfit_monster_punch_v1',
});

// Keeper (AR goalkeeping): SCORE metric (most LEVELS CLEARED wins — save >=60%
// of each level's shots to advance), single global board.
export const keeperScores = createScoreClient('keeper', {
  metric: 'score',
  cachePrefix: 'slayfit_keeper_v1',
});

// Single-board games (no difficulty levels).
export const PUNCH_LEVEL = 'DEFAULT';
export const KEEPER_LEVEL = 'DEFAULT';
