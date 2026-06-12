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

// Monster Punch has a single global board (no difficulty levels).
export const PUNCH_LEVEL = 'DEFAULT';
