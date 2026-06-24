// ===========================================================================
// Keeper — CORE ENGINE (pure, framework-free, unit-testable).
// ---------------------------------------------------------------------------
// Level-clearance goalkeeping. The engine owns:
//   • the shooter AI (when/where the next ball is aimed)
//   • ball flight incl. a LATERAL CURVE (swerve) that grows with level
//   • the level ramp (faster + curvier shots, wider goal, smaller keeper)
//   • the 60%-per-level CLEAR gate + game-over, and scoring
//     (score = number of LEVELS CLEARED)
//   • a brief SAVE deflect so the ball visibly ricochets off the keeper
//
// It has NO knowledge of the canvas or pose. The host (React layer):
//   1. calls update(dt, now) every frame
//   2. when a shot is ready to be JUDGED, the engine asks the host to test the
//      save via the injected `saveTest(bx, by, ballR)` callback (so all the
//      pose/keeper geometry stays in the rendering layer), then records it. The
//      saveTest returns { saved, dist, contact?:{x,y}, part? } on a save.
//   3. reads ballState()/snapshot() to render.
//
// Coordinates: the engine works in NORMALISED goal space where it can, but the
// ball's target/launch are resolved against a goalRect the host passes in via
// setStage(). This keeps physics testable while letting the host own the goal.
// ===========================================================================
import { BALL, RAMP, levelCurve } from '../config.js';

const rnd = (a) => a[0] + Math.random() * (a[1] - a[0]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Saves needed to clear a level of `shotsPerLevel` shots (60% rounded up). */
export function clearThreshold(shotsPerLevel = RAMP.SHOTS_PER_LEVEL) {
  return Math.ceil(RAMP.CLEAR_FRAC * shotsPerLevel);
}

/**
 * @param {Object} [opts]
 * @param {() => number} [opts.random] injectable RNG (0..1) for deterministic tests
 */
export function createKeeperEngine(opts = {}) {
  const random = opts.random || Math.random;
  // phase: 'idle' -> waiting to launch | 'wind' -> telegraph | 'fly' -> in flight
  //        | 'deflect' -> ball bouncing off the keeper after a save
  //        | 'resolved' -> brief banner hold | 'over'
  let phase = 'over';
  const SPL = RAMP.SHOTS_PER_LEVEL;
  const NEED = clearThreshold(SPL);
  let level = 1;                 // current (in-progress) level, 1-based
  let levelsCleared = 0;         // SCORE — fully cleared levels
  let saves = 0, shots = 0;      // lifetime totals (secondary stats)
  let savesThisLevel = 0, shotsThisLevel = 0;
  let curve = levelCurve(1);
  let shot = null;               // active shot descriptor
  let nextAt = 0;                // performance.now() at which the next shot launches
  let deflectUntil = 0;          // performance.now() the deflect bounce ends
  let lastResult = null;         // { result:'save'|'goal', dist, zone, tx, ty, ... }
  let bannerUntil = 0;
  let stage = { W: 1280, H: 720, goal: null };
  let onResolve = null;          // host hook (result) => void
  let events = [];               // telemetry

  function setStage(W, H, goal) { stage = { W, H, goal }; }
  function setResolveHook(fn) { onResolve = fn; }

  function reset() {
    phase = 'idle';
    level = 1; levelsCleared = 0; saves = 0; shots = 0;
    savesThisLevel = 0; shotsThisLevel = 0;
    curve = levelCurve(1);
    shot = null; lastResult = null; bannerUntil = 0; deflectUntil = 0; events = [];
    nextAt = 0;   // launch immediately on first update once started
  }

  // Pick an aim point in normalised goal space: tx in [-1,1] (L..R),
  // ty in [0,1] (top..bottom of mouth). Higher levels aim at corners more.
  function aimZone() {
    const corner = random() < curve.cornerProb;
    const tx = corner
      ? (random() < 0.5 ? -1 : 1) * (0.55 + random() * 0.35)
      : (random() * 2 - 1) * 0.5;
    const ty = corner
      ? (random() < 0.5 ? 0.16 : 0.82)
      : 0.32 + random() * 0.45;
    return { tx, ty };
  }

  function launch(now) {
    const g = stage.goal; if (!g) return;
    const { tx, ty } = aimZone();
    const cx = g.cx;
    // curve.swerve: signed lateral bow (fraction of goal width) — direction random.
    const swerveMag = curve.curve * (0.6 + random() * 0.4);
    const swerveDir = random() < 0.5 ? -1 : 1;
    shot = {
      st: 'wind',
      t: 0,
      windT: rnd(BALL.WINDUP_S),
      flightT: curve.flightT,
      sx: cx, sy: g.y0 + (g.y1 - g.y0) * 0.84,           // spawn on the green grass — kicker's planted foot on the ground
      gx: cx + tx * (g.gw / 2) * 0.94, gy: g.y0 + ty * (g.y1 - g.y0),
      tx, ty,
      swerve: swerveDir * swerveMag * g.gw,              // px of lateral bow at mid-flight
      r0: Math.max(5, stage.H * BALL.R0_FRAC),
      r1: Math.max(20, stage.H * BALL.R1_FRAC),
      decided: false,
      // deflect (filled on a save): origin + velocity for the ricochet.
      dx: 0, dy: 0, dvx: 0, dvy: 0, dt: 0,
    };
    phase = 'wind';
    shots += 1; shotsThisLevel += 1;
  }

  // Can the level still be cleared given saves so far + shots remaining?
  function levelStillReachable() {
    const remaining = SPL - shotsThisLevel;       // shots not yet taken this level
    return savesThisLevel + remaining >= NEED;
  }

  /**
   * Resolve the current shot once it reaches the line.
   * @param {Function} saveTest (bx, by, ballR) => { saved, dist, contact?, part? }
   */
  function judge(saveTest, now) {
    const bx = shot.gx, by = shot.gy;
    const res = saveTest ? saveTest(bx, by, shot.r1) : { saved: false, dist: 1e9 };
    const result = res.saved ? 'save' : 'goal';
    const zone = (shot.tx < -0.3 ? 'L' : shot.tx > 0.3 ? 'R' : 'C')
      + (shot.ty < 0.4 ? 'hi' : shot.ty > 0.7 ? 'lo' : 'mid');
    const contact = res && res.contact ? { x: res.contact.x, y: res.contact.y } : null;
    lastResult = {
      result, dist: +(res.dist || 0).toFixed(0), zone,
      tx: +shot.tx.toFixed(2), ty: +shot.ty.toFixed(2), level,
      contact, part: res && res.part != null ? res.part : null,
    };
    events.push({ shot: shots, ...lastResult, contact: undefined, part: undefined, flightT: +shot.flightT.toFixed(2) });

    if (result === 'save') {
      saves += 1; savesThisLevel += 1;
      // Deflect: ricochet the ball away from the contact point. Reverse its
      // approach (it was diving toward the line), push outward from the keeper,
      // and add a touch of lift — then let it arc down under gravity.
      const cx = contact ? contact.x : bx, cy = contact ? contact.y : by;
      let ox = bx - cx, oy = by - cy;                 // outward (keeper -> ball)
      const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
      const speed = stage.H * BALL.DEFLECT_SPEED_FRAC;
      // approach direction was sx->gx (mostly downward-ish toward the line).
      const adx = shot.gx - shot.sx, ady = shot.gy - shot.sy;
      const al = Math.hypot(adx, ady) || 1;
      const rdx = -adx / al, rdy = -ady / al;         // reverse of approach
      // blend reverse-approach + outward push + upward lift.
      let vx = (rdx * 0.55 + ox * 0.65) ;
      let vy = (rdy * 0.55 + oy * 0.65) - 0.6;        // bias upward
      const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      shot.dx = bx; shot.dy = by;
      shot.dvx = vx * speed; shot.dvy = vy * speed;
      shot.dt = 0;
      shot.st = 'deflect';
      phase = 'deflect';
      deflectUntil = now + BALL.DEFLECT_S * 1000;
      shot.decided = true;
    } else {
      // conceded — ball continues into the net (renderer keeps drawing fly pos).
      shot.decided = true;
      phase = 'resolved';
      bannerUntil = now + BALL.RESOLVE_HOLD_MS;
    }
    if (onResolve) {
      onResolve({
        ...lastResult,
        saves, shots, level, levelsCleared,
        savesThisLevel, shotsThisLevel, need: NEED, shotsPerLevel: SPL,
      });
    }
  }

  // Called after a level's shots are exhausted OR it's mathematically lost.
  function endLevel(now, cleared) {
    if (cleared) {
      levelsCleared += 1;
      level += 1;
      savesThisLevel = 0; shotsThisLevel = 0;
      curve = levelCurve(level);
      phase = 'resolved';
      bannerUntil = now + BALL.RESOLVE_HOLD_MS;
    } else {
      phase = 'over';
    }
  }

  /**
   * Advance one frame.
   * @param {number} dt  seconds since last frame
   * @param {number} now performance.now()
   * @param {Function} saveTest (bx,by,ballR)=>{saved,dist,contact?,part?}
   * @returns {string} current phase
   */
  function update(dt, now, saveTest) {
    if (phase === 'over') return phase;

    if (phase === 'idle') {
      if (now >= nextAt) launch(now);
      return phase;
    }
    if (phase === 'deflect') {
      // integrate the bounce; the ball flies off-body for a brief readable beat.
      if (shot) {
        shot.dt += dt;
        shot.dvy += stage.H * BALL.DEFLECT_GRAVITY_FRAC * dt;
        shot.dx += shot.dvx * dt;
        shot.dy += shot.dvy * dt;
      }
      if (now >= deflectUntil) {
        shot = null;
        // The level is a FIXED block of SPL shots. It only resolves (clear /
        // advance) once that block is exhausted; otherwise the next shot comes.
        if (shotsThisLevel >= SPL) {
          endLevel(now, savesThisLevel >= NEED);   // saved enough -> clear, else over
        } else {
          phase = 'idle'; nextAt = now + BALL.NEXT_DELAY_MS;
        }
      }
      return phase;
    }
    if (phase === 'resolved') {
      if (now >= bannerUntil) {
        shot = null;
        // After a conceded goal, evaluate the fixed-block gate:
        //   • block exhausted -> clear (>=60%) or game over (<60%)
        //   • block not exhausted but clearance now impossible -> game over
        //   • otherwise -> next shot
        if (shotsThisLevel >= SPL) {
          if (savesThisLevel >= NEED) { endLevel(now, true); return phase; }
          phase = 'over'; return phase;
        }
        if (!levelStillReachable()) { phase = 'over'; return phase; }
        phase = 'idle'; nextAt = now + BALL.NEXT_DELAY_MS;
      }
      return phase;
    }
    if (!shot) return phase;

    shot.t += dt;
    if (shot.st === 'wind') {
      if (shot.t >= shot.windT) { shot.st = 'fly'; shot.t = 0; phase = 'fly'; }
    } else if (shot.st === 'fly') {
      if (shot.t >= shot.flightT && !shot.decided) judge(saveTest, now);
    }
    return phase;
  }

  /**
   * Current ball render state, or null. The host draws this.
   *   wind:    { st, x, y, r, windK }
   *   fly:     { st, x, y, r, windK, u }
   *   deflect: { st, x, y, r, vx, vy, k }  k = 0..1 progress (fades)
   */
  function ballState() {
    if (!shot) return null;
    if (shot.st === 'wind') {
      return { st: 'wind', x: shot.sx, y: shot.sy, r: shot.r0, windK: clamp(shot.t / shot.windT, 0, 1) };
    }
    if (shot.st === 'deflect') {
      const k = clamp(shot.dt / BALL.DEFLECT_S, 0, 1);
      return { st: 'deflect', x: shot.dx, y: shot.dy, r: shot.r1, vx: shot.dvx, vy: shot.dvy, k };
    }
    const u = clamp(shot.t / shot.flightT, 0, 1);
    const e = u * u;                                  // accelerate toward goal
    // lateral curve: a sinusoidal bow that's 0 at the ends and peaks mid-flight,
    // so the ball SWERVES then re-meets its target at the line.
    const bow = Math.sin(u * Math.PI) * shot.swerve;
    const x = shot.sx + (shot.gx - shot.sx) * e + bow;
    const y = shot.sy + (shot.gy - shot.sy) * e;
    const r = shot.r0 + (shot.r1 - shot.r0) * u;
    return { st: 'fly', x, y, r, windK: 1, u };
  }

  /**
   * Current shooter render state, or null. The host draws a stylized figure that
   * runs up + winds its kicking leg during 'wind', then plants & swings at the
   * wind→fly transition (the moment the ball leaves its foot).
   *   { st:'wind'|'fly'|'deflect', x, y, windK, kicked, dir, tx }
   *     x,y    foot/contact point the ball launches FROM (== ball spawn sx,sy)
   *     windK  0..1 wind-up progress (run-up + back-swing) during 'wind'
   *     kicked true once the leg has swung through (st !== 'wind')
   *     dir    -1|+1 horizontal aim direction (which way the shooter leans/kicks)
   *     tx     normalized aim x (-1..1) so the host can angle the body
   */
  function shooterState() {
    if (!shot) return null;
    const dir = shot.tx >= 0 ? 1 : -1;
    if (shot.st === 'wind') {
      return { st: 'wind', x: shot.sx, y: shot.sy, windK: clamp(shot.t / shot.windT, 0, 1), kicked: false, dir, tx: shot.tx };
    }
    // After the kick the shooter stays planted in follow-through. `kickK` rises
    // briefly so the host can animate the leg swinging through then settling.
    const kickK = clamp((shot.st === 'fly' ? shot.t : 0) / 0.22, 0, 1);
    return { st: shot.st, x: shot.sx, y: shot.sy, windK: 1, kicked: true, kickK, dir, tx: shot.tx };
  }

  function snapshot() {
    return {
      phase, level, levelsCleared,
      saves, shots,
      savesThisLevel, shotsThisLevel, need: NEED, shotsPerLevel: SPL,
      savePct: shots ? Math.round((saves / shots) * 100) : 0,
      curve: { ...curve }, lastResult,
    };
  }

  function start(now = 0) { reset(); phase = 'idle'; nextAt = now + 200; }

  function result() {
    return {
      score: levelsCleared, levelsCleared,
      saves, shots,
      savePct: shots ? Math.round((saves / shots) * 100) : 0,
      level,
      events: events.slice(),
    };
  }

  return {
    reset, start, update, ballState, shooterState, snapshot, result,
    setStage, setResolveHook,
    get phase() { return phase; },
    get level() { return level; },
    get levelsCleared() { return levelsCleared; },
    get saves() { return saves; },
  };
}
