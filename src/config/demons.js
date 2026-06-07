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
//     size:       on-screen diameter in px (bigger = tougher feel)
//     hitsToKill: punches required to slay
//     spawnWeight: relative spawn frequency (higher = more common)
//     points:     score awarded on kill
//   }
// ===========================================================================

const F = (n) => `/assets/sprites/demon_fly_${n}.png`;

export const DEMONS = [
  {
    id: 'imp',
    name: 'Imp (small)',
    frames: [F(3), F(4)],
    size: 70,
    hitsToKill: 1,
    spawnWeight: 5,
    points: 100,
  },
  {
    id: 'fiend',
    name: 'Fiend (medium)',
    frames: [F(2), F(1)],
    size: 100,
    hitsToKill: 2,
    spawnWeight: 3,
    points: 250,
  },
  {
    id: 'brute',
    name: 'Brute (big)',
    frames: [F(1), F(2)],
    size: 150,
    hitsToKill: 4,
    spawnWeight: 1,
    points: 600,
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
