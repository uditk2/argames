// ===========================================================================
// Dino Survival — RUN DETECTOR (the game's detection service).
// ---------------------------------------------------------------------------
// Reads running-in-place from MediaPipe Pose landmarks. Self-contained service
// for THIS game (mirrors how the app keeps each detector in its own module).
// Improve it from the run-tracker's recorded data and swap it here.
//
// Signals:
//   • cadence       — knee + ANKLE peak-detect along the TORSO axis
//                     (tilt-invariant), per-leg adaptive gate, fast idle snap.
//   • movement gate — requires real hip bounce before any step counts, so
//                     standing still (landmark jitter) does NOT read as running.
//   • framed()      — hips + knees visible (calibration + continuous check).
//   • playerMetrics() — torso length for normalising on-screen player size.
// ===========================================================================
import { clamp, lerp, vis, mid, LM } from '../util.js';

export function createRunDetector() {
  const cfg = { absFloor: 0.045, adaptFrac: 0.35, gateCap: 0.12, refractoryMs: 130, winMs: 3000, idleMs: 1100,
                moveFloor: 0.010,   // min hip-bounce before steps count — loosened so normal running
                                    // registers easily, but still enough that ARMS-only won't trigger it
                // gateCap: hard ceiling on the adaptive threshold so vigorous running can't
                // ratchet the bar up and then MISS your next (slightly smaller) steps.
                bands: { jog: 70, run: 120, sprint: 160 } };
  let base = { lGap: .2, rGap: .2, lGapA: .4, rGapA: .4, lProj: .2, rProj: .2, lProjA: .4, rProjA: .4, haveAxis: false };
  const ema = { L: 0, R: 0 }, peak = { L: -9, R: -9 }, trough = { L: 9, R: 9 },
        rising = { L: false, R: false }, lastStep = { L: 0, R: 0 }, recentAmp = { L: .05, R: .05 };
  const stamps = [], hipBuf = []; let stepFlash = 0, steps = 0, stepsL = 0, stepsR = 0;

  const axisOf = (lm) => { const sc = mid(lm[LM.lSh], lm[LM.rSh]), hc = mid(lm[LM.lHip], lm[LM.rHip]);
    if (!sc || !hc) return null; const ux = hc.x - sc.x, uy = hc.y - sc.y, len = Math.hypot(ux, uy);
    return len < 1e-3 ? null : { x: ux / len, y: uy / len }; };
  const projOf = (lm, k, h, a) => (lm[k].x - lm[h].x) * a.x + (lm[k].y - lm[h].y) * a.y;
  const vgap = (lm, k, h) => Math.abs(lm[k].y - lm[h].y);
  const shOk = (lm) => vis(lm[LM.lSh]) && vis(lm[LM.rSh]);

  function calibrate(lm) {
    base.lGap = Math.max(.08, vgap(lm, LM.lKnee, LM.lHip)); base.rGap = Math.max(.08, vgap(lm, LM.rKnee, LM.rHip));
    base.lGapA = Math.max(.12, vgap(lm, LM.lAnk, LM.lHip)); base.rGapA = Math.max(.12, vgap(lm, LM.rAnk, LM.rHip));
    const a = axisOf(lm);
    if (a && shOk(lm)) {
      base.lProj = Math.max(.05, projOf(lm, LM.lKnee, LM.lHip, a)); base.rProj = Math.max(.05, projOf(lm, LM.rKnee, LM.rHip, a));
      base.lProjA = Math.max(.1, projOf(lm, LM.lAnk, LM.lHip, a)); base.rProjA = Math.max(.1, projOf(lm, LM.rAnk, LM.rHip, a));
      base.haveAxis = true;
    } else base.haveAxis = false;
  }
  function jointLift(lm, j, h, projBase, gapBase, a) {
    if (!vis(lm[j])) return 0;
    if (a && shOk(lm)) return clamp((projBase - projOf(lm, j, h, a)) / projBase, 0, 1);
    return clamp((gapBase - vgap(lm, j, h)) / gapBase, 0, 1);
  }
  function liftSide(lm, w) {
    const a = base.haveAxis ? axisOf(lm) : null;
    const hip = w === 'L' ? LM.lHip : LM.rHip, knee = w === 'L' ? LM.lKnee : LM.rKnee, ank = w === 'L' ? LM.lAnk : LM.rAnk;
    const kl = jointLift(lm, knee, hip, w === 'L' ? base.lProj : base.rProj, w === 'L' ? base.lGap : base.rGap, a);
    const al = jointLift(lm, ank, hip, w === 'L' ? base.lProjA : base.rProjA, w === 'L' ? base.lGapA : base.rGapA, a);
    return Math.max(kl, al);
  }
  function leg(side, v, now) {
    ema[side] = lerp(ema[side], v, 0.5); const x = ema[side];
    const gate = Math.min(cfg.gateCap, Math.max(cfg.absFloor, cfg.adaptFrac * recentAmp[side])); const hys = Math.max(.01, gate * .3);
    if (rising[side]) {
      if (x > peak[side]) peak[side] = x;
      else if (x < peak[side] - hys) {
        const amp = peak[side] - trough[side];
        if (amp >= gate && now - lastStep[side] > cfg.refractoryMs) {
          stamps.push(now); lastStep[side] = now; steps++; if (side === 'L') stepsL++; else stepsR++; stepFlash = now;
          recentAmp[side] = Math.max(amp, recentAmp[side] * .85 + amp * .15);
        }
        rising[side] = false; trough[side] = x;
      }
    } else { if (x < trough[side]) trough[side] = x; else if (x > trough[side] + hys) { rising[side] = true; peak[side] = x; } }
    recentAmp[side] = Math.max(cfg.absFloor, recentAmp[side] * .995); return x;   // decay faster so the gate recovers in ~1-2s, not ~10s
  }
  // MOVEMENT GATE: is the body actually bouncing (running), or just standing/jittering?
  function isMoving(lm, now) {
    const hc = mid(lm[LM.lHip], lm[LM.rHip]); if (!hc) return true;
    hipBuf.push({ t: now, y: hc.y }); while (hipBuf.length && now - hipBuf[0].t > 700) hipBuf.shift();
    if (hipBuf.length < 4) return true;
    let mn = 9, mx = -9; for (const s of hipBuf) { if (s.y < mn) mn = s.y; if (s.y > mx) mx = s.y; }
    return (mx - mn) > cfg.moveFloor;
  }
  function update(lm, now) {
    let moving = false;
    if (lm) {
      moving = isMoving(lm, now);
      if (moving) { leg('L', liftSide(lm, 'L'), now); leg('R', liftSide(lm, 'R'), now); }
      else { ema.L = lerp(ema.L, liftSide(lm, 'L'), 0.3); ema.R = lerp(ema.R, liftSide(lm, 'R'), 0.3); rising.L = rising.R = false; }
    }
    while (stamps.length && now - stamps[0] > cfg.winMs) stamps.shift();
    const last = stamps.length ? stamps[stamps.length - 1] : -1;
    let spm = Math.round((stamps.length / (cfg.winMs / 1000)) * 60);
    if (last < 0 || now - last > cfg.idleMs) spm = 0;
    const b = cfg.bands;
    const band = spm >= b.sprint ? 'SPRINT' : spm >= b.run ? 'RUNNING' : spm >= b.jog ? 'JOGGING' : spm >= Math.max(20, b.jog * .4) ? 'WALKING' : 'IDLE';
    const gate = (s) => Math.min(cfg.gateCap, Math.max(cfg.absFloor, cfg.adaptFrac * recentAmp[s]));
    return { spm, steps, band, pace: clamp(spm / (b.sprint * 1.15), 0, 1), flash: now - stepFlash < 90,
      // diagnostics for telemetry: movement gate, smoothed leg-lift, adaptive threshold
      diag: { mv: moving ? 1 : 0, lL: +ema.L.toFixed(3), lR: +ema.R.toFixed(3), gL: +gate('L').toFixed(3), gR: +gate('R').toFixed(3) } };
  }
  function tap(now) { stamps.push(now); stepFlash = now; steps++; (steps % 2 ? stepsL++ : stepsR++); }   // demo (keyboard) input
  function reset() { steps = stepsL = stepsR = 0; stamps.length = 0; hipBuf.length = 0; rising.L = rising.R = false; peak.L = peak.R = -9; trough.L = trough.R = 9; recentAmp.L = recentAmp.R = .05; }
  function stats() { return { steps, stepsL, stepsR }; }
  return { cfg, calibrate, update, tap, reset, stats };
}

// hips + knees visible — gates calibration and the continuous framing check.
export function framed(lm) {
  for (const i of [LM.lHip, LM.rHip, LM.lKnee, LM.rKnee]) if (!vis(lm && lm[i])) return false;
  return true;
}
// torso length + hip position, for normalising the player's on-screen size.
export function playerMetrics(lm) {
  if (!lm) return null;
  const sc = mid(lm[LM.lSh], lm[LM.rSh]), hc = mid(lm[LM.lHip], lm[LM.rHip]);
  if (!sc || !hc || !vis(lm[LM.lSh]) || !vis(lm[LM.rSh]) || !vis(lm[LM.lHip]) || !vis(lm[LM.rHip])) return null;
  return { torso: Math.hypot(sc.x - hc.x, sc.y - hc.y), hipx: hc.x, hipy: hc.y };
}
