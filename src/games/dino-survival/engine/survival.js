// ===========================================================================
// Dino Survival — SURVIVAL ENGINE (pure, no DOM).
// ---------------------------------------------------------------------------
// The race: cover `goal` distance to the jeep before the escalating dino's gap
// hits zero. Advances ONLY while you're running and framed (the host gates it).
//   gap'  = kGain*(pace - (d0 + r*t))   -> caught when gap <= 0
//   dist += pace*dt                     -> escaped when dist >= goal
// ===========================================================================
import { clamp } from '../util.js';
import { SCROLL_SPEED, DINO_SPEED_SCALE } from '../config.js';

export function createSurvival(level) {
  let t = 0, dist = 0, gap = level.g0, scroll = 0, phase = 'ready', result = null;

  function reset() { t = 0; dist = 0; gap = level.g0; scroll = 0; phase = 'running'; result = null; }

  function step(pace, dtMs) {
    if (phase !== 'running') return snapshot();
    const dts = dtMs / 1000;
    t += dts;
    scroll += pace * dtMs * SCROLL_SPEED;
    const dinoSpeed = (level.d0 + level.r * t) * DINO_SPEED_SCALE;
    gap = clamp(gap + level.kGain * (pace - dinoSpeed) * dts, 0, 1);
    dist += pace * dts;
    if (dist >= level.goal) { phase = 'escaped'; result = { escaped: true, timeS: t, pct: 100 }; }
    else if (gap <= 0) { phase = 'caught'; result = { escaped: false, timeS: t, pct: Math.round(clamp(dist / level.goal, 0, 1) * 100) }; }
    return snapshot();
  }
  function snapshot() {
    return { t, dist, gap, scroll, near: clamp(1 - gap, 0, 1), distPct: clamp(dist / level.goal, 0, 1), phase, result };
  }
  return { reset, step, snapshot, get phase() { return phase; }, get result() { return result; }, level };
}
