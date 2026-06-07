// ===========================================================================
// DEMON REGISTRY
// ---------------------------------------------------------------------------
// Each demon TYPE is data only. The spawner (engine/spawner.js) picks a type
// weighted by `spawnWeight`; the render layer animates `frames`. Toughness is
// implied purely by `size` + `hitsToKill` (no on-screen numbers).
//
// >>> TO ADD A NEW DEMON TYPE: append an object below. <<<
//
//   {
//     id:         unique key
//     name:       internal label
//     frames:     [served URLs] cycled for the flap animation
//     hitFrame:   (optional) sprite shown for a beat when struck (recoil flash)
//     size:       on-screen diameter in px (bigger = tougher feel)
//     hitsToKill: punches (CONNECTS) required to slay — drives the HP pips
//     spawnWeight: relative spawn frequency (higher = more common, rarer brutes)
//     points:     score awarded on kill (× current combo)
//     radius:     (optional) normalized hit radius override (0..1 of stage W).
//                 If omitted, the engine derives it from `size` (see Demon.js).
//   }
//
// TIERS (small/common -> big/rare): imp 1-hit, fiend 2-hit, brute 4-hit,
// juggernaut 7-hit boss. Bigger hitsToKill => bigger size, slower, more points,
// lower spawnWeight. The spawner just reads this data.
// ===========================================================================

const F = (n) => `/assets/sprites/demon_fly_${n}.png`;
const HIT = '/assets/sprites/demon_hit_1.png';

export const DEMONS = [
  {
    id: 'imp',
    name: 'Imp (small)',
    frames: [F(3), F(4)],
    hitFrame: HIT,
    size: 70,
    hitsToKill: 1,
    spawnWeight: 6,
    points: 100,
  },
  {
    id: 'fiend',
    name: 'Fiend (medium)',
    frames: [F(2), F(1)],
    hitFrame: HIT,
    size: 105,
    hitsToKill: 2,
    spawnWeight: 4,
    points: 250,
  },
  {
    id: 'brute',
    name: 'Brute (big)',
    frames: [F(1), F(2)],
    hitFrame: HIT,
    size: 165,
    hitsToKill: 4,
    spawnWeight: 1.5,
    points: 600,
  },
  {
    id: 'juggernaut',
    name: 'Juggernaut (boss)',
    frames: [F(2), F(1)],
    hitFrame: HIT,
    size: 230,
    hitsToKill: 7,
    spawnWeight: 0.5,
    points: 1400,
  },
];

/** Pre-computed total weight (used by the weighted spawn picker). */
export const TOTAL_SPAWN_WEIGHT = DEMONS.reduce((s, d) => s + d.spawnWeight, 0);

/** Pick a demon type at random, weighted by spawnWeight. */
export function pickDemonType(rand = Math.random) {
  let r = rand() * TOTAL_SPAWN_WEIGHT;
  for (const d of DEMONS) {
    r -= d.spawnWeight;
    if (r <= 0) return d;
  }
  return DEMONS[0];
}
