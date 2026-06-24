// ===========================================================================
// Keeper engine smoke test (no framework). Run: node engine/keeperEngine.smoke.mjs
// Covers the level-clearance model:
//   • a level CLEARS at >= 60% saves and advances
//   • the run ENDS when a level finishes below 60% (or becomes unreachable)
//   • score === levelsCleared
//   • difficulty is monotonic across levels (goal width up, keeper reach down,
//     keeper lean down, flight time down, curve up, corner prob up)
//   • a SAVED shot returns a contact point + the engine produces a deflection
// ===========================================================================
import { createKeeperEngine } from './keeperEngine.js';
import { levelCurve, RAMP, CLEAR_THRESHOLD } from '../config.js';
import { keeperSave, closestOnSeg } from './geometry.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok  -', msg); }
  else { console.error('  FAIL -', msg); failures++; }
}
function section(t) { console.log('\n# ' + t); }

// A fake stage/goal the engine resolves shots against.
const STAGE = { W: 1280, H: 720 };
const goal = { x0: 320, x1: 960, y0: 86, y1: 648, cx: 640, cy: 367, gw: 640, gh: 562 };

// Drive a deterministic engine. `outcome(shotIndex)` => true=save, false=goal.
// `onSave` lets a test inject a contact/part so we can verify deflection.
function runWithOutcomes(outcomes, { onSave } = {}) {
  let idx = 0;
  const eng = createKeeperEngine({ random: () => 0.5 });
  eng.setStage(STAGE.W, STAGE.H, goal);
  const saveTest = () => {
    const save = outcomes[Math.min(idx, outcomes.length - 1)];
    idx++;
    if (save) return onSave ? onSave() : { saved: true, dist: 0, contact: { x: 640, y: 400 }, part: 'torso' };
    return { saved: false, dist: 120 };
  };
  let now = 0; const dt = 0.05;
  eng.start(now);
  // pump frames until 'over' or we run out of shots/patience.
  for (let i = 0; i < 6000 && eng.phase !== 'over'; i++) {
    now += dt * 1000;
    eng.update(dt, now, saveTest);
    // stop once we've consumed all scripted outcomes and the engine settles.
    if (idx >= outcomes.length && (eng.phase === 'idle' || eng.phase === 'resolved')) {
      // let a few more frames flush the final resolve, then bail if still alive.
      if (i > outcomes.length * 80) break;
    }
  }
  return { eng, snap: eng.snapshot(), result: eng.result(), shotsTaken: idx };
}

// --------------------------------------------------------------------------
section('config: clear threshold is ceil(0.6 * SHOTS_PER_LEVEL)');
const expectedNeed = Math.ceil(0.6 * RAMP.SHOTS_PER_LEVEL);
assert(CLEAR_THRESHOLD === expectedNeed, `CLEAR_THRESHOLD=${CLEAR_THRESHOLD} === ${expectedNeed}`);

// --------------------------------------------------------------------------
section('level clears at >= 60% and advances');
// Save exactly the threshold of the first level, miss the rest, then start
// failing level 2 so the run ends. We script two full levels of outcomes.
{
  const SPL = RAMP.SHOTS_PER_LEVEL, NEED = CLEAR_THRESHOLD;
  // Level 1: NEED saves then (SPL-NEED) goals -> exactly clears.
  const lvl1 = [...Array(NEED).fill(true), ...Array(SPL - NEED).fill(false)];
  // Level 2: all goals -> fails immediately (unreachable), run ends.
  const lvl2 = Array(SPL).fill(false);
  const { result } = runWithOutcomes([...lvl1, ...lvl2]);
  assert(result.levelsCleared === 1, `cleared exactly 1 level (got ${result.levelsCleared})`);
  assert(result.score === result.levelsCleared, `score === levelsCleared (${result.score})`);
}

// --------------------------------------------------------------------------
section('run ENDS at < 60% in a level');
{
  const SPL = RAMP.SHOTS_PER_LEVEL, NEED = CLEAR_THRESHOLD;
  // Save NEED-1 then goals: by end of level, below threshold -> over, 0 cleared.
  const below = NEED - 1;
  const lvl1 = [...Array(below).fill(true), ...Array(SPL - below).fill(false)];
  const { result, eng } = runWithOutcomes(lvl1);
  assert(result.levelsCleared === 0, `cleared 0 levels (got ${result.levelsCleared})`);
  assert(eng.phase === 'over', `engine ended in 'over' (got '${eng.phase}')`);
}

// --------------------------------------------------------------------------
section('run ENDS early when clearance becomes mathematically impossible');
{
  // SHOTS_PER_LEVEL=6, NEED=4: 3 goals in a row leaves 3 shots, max 3 saves < 4.
  const SPL = RAMP.SHOTS_PER_LEVEL, NEED = CLEAR_THRESHOLD;
  const impossibleGoals = SPL - NEED + 1;   // goals that make NEED unreachable
  const lvl1 = Array(impossibleGoals).fill(false);
  const { eng, shotsTaken } = runWithOutcomes(lvl1);
  assert(eng.phase === 'over', `ended in 'over' once unreachable (phase='${eng.phase}')`);
  assert(shotsTaken <= SPL, `ended within the level (${shotsTaken} <= ${SPL} shots)`);
  assert(shotsTaken === impossibleGoals, `ended right at the unreachable point (${shotsTaken} === ${impossibleGoals})`);
}

// --------------------------------------------------------------------------
section('score === levelsCleared across multiple cleared levels');
{
  const SPL = RAMP.SHOTS_PER_LEVEL;
  // Clear 3 full levels (all saves), then fail level 4.
  const clear = Array(SPL).fill(true);
  const fail = Array(SPL).fill(false);
  const { result } = runWithOutcomes([...clear, ...clear, ...clear, ...fail]);
  assert(result.levelsCleared === 3, `cleared 3 levels (got ${result.levelsCleared})`);
  assert(result.score === 3, `score === 3 (got ${result.score})`);
  assert(result.saves === SPL * 3, `saves total = ${SPL * 3} (got ${result.saves})`);
}

// --------------------------------------------------------------------------
section('difficulty is monotonic across levels');
{
  let ok = true; const N = 14;
  for (let L = 1; L < N; L++) {
    const a = levelCurve(L), b = levelCurve(L + 1);
    // goal width UP (until cap), reach DOWN (until floor), lean DOWN, flight DOWN,
    // curve UP, corner UP — each non-strict where capped.
    if (!(b.widthFrac >= a.widthFrac)) ok = false;
    if (!(b.reach <= a.reach)) ok = false;
    if (!(b.leanAmp <= a.leanAmp)) ok = false;
    if (!(b.flightT <= a.flightT)) ok = false;
    if (!(b.curve >= a.curve)) ok = false;
    if (!(b.cornerProb >= a.cornerProb)) ok = false;
  }
  assert(ok, 'each level: width↑ reach↓ lean↓ flightT↓ curve↑ corner↑ (monotonic)');
  // And the headline trio strictly moves at least once early on.
  const c1 = levelCurve(1), c5 = levelCurve(5);
  assert(c5.widthFrac > c1.widthFrac, `goal width grows (L1 ${c1.widthFrac.toFixed(3)} -> L5 ${c5.widthFrac.toFixed(3)})`);
  assert(c5.reach < c1.reach, `keeper reach shrinks (L1 ${c1.reach.toFixed(3)} -> L5 ${c5.reach.toFixed(3)})`);
  assert(c5.flightT < c1.flightT, `flight time shrinks / faster (L1 ${c1.flightT.toFixed(3)} -> L5 ${c5.flightT.toFixed(3)})`);
}

// --------------------------------------------------------------------------
section('a saved shot produces a contact point + deflection');
{
  // Build a landmark set where the keeper torso covers the goal centre so a
  // central shot is saved by the real keeperSave (returns a contact point).
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  // shoulders (11,12) and hips (23,24) form a torso quad around centre.
  lm[11] = { x: 0.40, y: 0.42, visibility: 1 };
  lm[12] = { x: 0.60, y: 0.42, visibility: 1 };
  lm[23] = { x: 0.42, y: 0.62, visibility: 1 };
  lm[24] = { x: 0.58, y: 0.62, visibility: 1 };
  const res = keeperSave(lm, goal.cx, goal.cy, 30, goal, 0.5, STAGE.H, levelCurve(1).reach, levelCurve(1).leanAmp);
  assert(res.saved === true, 'central shot is saved by the body shield');
  assert(res.contact && Number.isFinite(res.contact.x) && Number.isFinite(res.contact.y), `save returns a finite contact point (${res.contact ? `${res.contact.x.toFixed(0)},${res.contact.y.toFixed(0)}` : 'none'})`);

  // closestOnSeg sanity (used for limb contact points).
  const seg = closestOnSeg(0, 0, -1, 0, 1, 0);
  assert(Math.abs(seg.x) < 1e-9 && Math.abs(seg.y) < 1e-9, 'closestOnSeg finds the nearest point on a segment');

  // Now feed that save into the engine and confirm a 'deflect' state with a
  // non-zero deflection velocity is produced.
  const eng = createKeeperEngine({ random: () => 0.5 });
  eng.setStage(STAGE.W, STAGE.H, goal);
  let now = 0; const dt = 0.02; eng.start(now);
  const saveTest = (bx, by, r) => keeperSave(lm, bx, by, r, goal, 0.5, STAGE.H, levelCurve(1).reach, levelCurve(1).leanAmp);
  let sawDeflect = false, deflectVel = 0, ballMoved = false; let lastBall = null;
  for (let i = 0; i < 400; i++) {
    now += dt * 1000;
    eng.update(dt, now, saveTest);
    const b = eng.ballState();
    if (b && b.st === 'deflect') {
      sawDeflect = true;
      deflectVel = Math.hypot(b.vx || 0, b.vy || 0);
      if (lastBall && b.st === 'deflect' && lastBall.st === 'deflect') {
        if (Math.hypot(b.x - lastBall.x, b.y - lastBall.y) > 0.01) ballMoved = true;
      }
      lastBall = { x: b.x, y: b.y, st: b.st };
    } else if (b) lastBall = { x: b.x, y: b.y, st: b.st };
    if (sawDeflect && i > 200) break;
  }
  assert(sawDeflect, 'a saved shot enters the deflect (ricochet) state');
  assert(deflectVel > 0, `the deflect has a non-zero velocity (|v|=${deflectVel.toFixed(0)} px/s)`);
  assert(ballMoved, 'the ball visibly moves while deflecting off the body');
}

// --------------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
