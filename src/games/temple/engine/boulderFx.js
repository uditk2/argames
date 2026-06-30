// ===========================================================================
// Temple Dash — 2D boulder overlay + crush cinematic (extracted from templeEngine.js).
// ---------------------------------------------------------------------------
// All of this is fx-canvas (2D) + a couple of derived shake values the engine
// reads back for the 3D camera. It owns the cinematic's own mutable state
// (boulderRoll, crushT, escapeT, shakeX/Y, impactTime, dust pool + spawn guard)
// so the engine no longer has to thread it. The engine passes the rest of the
// game state into draw() each frame via an explicit `state` object.
//
//   createBoulderFx({ BOULDER, EXIT, ALIGN }) -> {  // ALIGN: optional A/B/C preset
//     reset(), clearCrush(),
//     get crushT, get shakeX, get shakeY,
//     draw(ctx, fxCanvas, state, dt),
//   }
//
// ALL tuned math is identical to the original drawOverlay/spawnDust/updateDust/
// drawDust — only relocated and fed via params.
// ===========================================================================

export function createBoulderFx({ BOULDER, EXIT, ALIGN }) {
  // Alignment variation (A/B/C composition). Defaults reproduce the original look
  // exactly: boulderScale 1 (no resizing) and the original PEEK_FAR/PEEK_NEAR.
  const ALIGN_BOULDER_SCALE = (ALIGN && ALIGN.boulderScale) || 1.0;
  const ALIGN_PEEK_FAR  = (ALIGN && ALIGN.peekFar  != null) ? ALIGN.peekFar  : 0.32;
  const ALIGN_PEEK_NEAR = (ALIGN && ALIGN.peekNear != null) ? ALIGN.peekNear : 0.55;
  // =========================================================================
  // CINEMATIC CRUSH — tunables (all 2D fx-canvas + avatar transforms; no assets)
  // -------------------------------------------------------------------------
  const CRUSH = {
    // Boulder motion (drives over the avatar, slams, then a small settle/bounce).
    accelPow: 2.2,        // ease-in exponent on the approach (higher = later acceleration -> harder slam)
    slamAt: 0.62,         // crushT at which the boulder fully covers the avatar (impact)
    overshoot: 0.06,      // how far past crushY the boulder dips on impact (fraction of screen H)
    bounceFreq: 9.0,      // settle/bounce oscillation frequency after the slam
    bounceDecay: 7.5,     // how fast the post-slam bounce decays
    passOver: 0.10,       // extra rise so the boulder clearly sits OVER the avatar line (fraction of H)
    // Screen shake — ramps with the approach, spikes at impact, then decays.
    shakeRamp: 8.0,       // px of shake just before impact (scales with approach)
    shakeImpact: 26.0,    // px shake spike at the slam moment
    shakeDecay: 9.0,      // decay rate of the impact spike
    camShake: 0.06,       // 3D-camera shake amount (world units) at peak
    // Impact flash.
    flashAt: 0.62,        // crushT where the white jolt flash fires (== slamAt)
    flashDur: 0.22,       // seconds the flash lingers
    // Dust / debris particles.
    maxParticles: 30,     // hard cap on the particle pool
    partCount: 26,        // how many to spawn at impact
    partLifeMin: 0.45,    // s
    partLifeMax: 1.10,    // s
    partSpeedMin: 220,    // px/s outward burst
    partSpeedMax: 620,
    partGravity: 900,     // px/s^2 settle
    partDrag: 1.8,        // velocity damping per second
    partRMin: 2.5,        // px radius
    partRMax: 8.0,
  };

  // ---- cinematic state (owned here) -----------------------------------------
  const dust = [];
  let dustSpawned = false;     // one-shot guard so we burst once per crush
  let impactTime = -1;         // tnow at the slam (for flash + cam shake timing)
  let shakeX = 0, shakeY = 0;  // current fx-canvas shake offset (decays to 0)
  let boulderRoll = 0;         // constant boulder spin
  let crushT = 0;              // crush animation progress
  let escapeT = 0;             // turn-escape slide timer

  // Full reset (resetGame): clears every owned value to a fresh-run state.
  function reset() {
    dust.length = 0; dustSpawned = false; impactTime = -1; shakeX = 0; shakeY = 0;
    crushT = 0; escapeT = 0;
    // boulderRoll is a constant spin; original resetGame left it running, keep it.
  }
  // Partial reset used by die()/dieBlade()/getStuck(): rewind the crush, clear dust.
  function clearCrush() {
    crushT = 0; dust.length = 0; dustSpawned = false; impactTime = -1;
  }
  // Turn-escape resets escapeT (matches the original escapeT = 0 on a turn).
  function resetEscape() { escapeT = 0; }

  // ---- dust / debris particles (simple 2D, capped at CRUSH.maxParticles) -----
  function spawnDust(ox, oy, r) {
    const n = Math.min(CRUSH.partCount, CRUSH.maxParticles - dust.length);
    for (let i = 0; i < n; i++) {
      const ang = Math.PI + (Math.random() - 0.5) * Math.PI * 1.6;   // mostly sideways/up
      const spd = CRUSH.partSpeedMin + Math.random() * (CRUSH.partSpeedMax - CRUSH.partSpeedMin);
      const life = CRUSH.partLifeMin + Math.random() * (CRUSH.partLifeMax - CRUSH.partLifeMin);
      // ochre vs grey debris mix.
      const ochre = Math.random() < 0.55;
      dust.push({
        x: ox + (Math.random() - 0.5) * r * 0.8,
        y: oy + (Math.random() - 0.5) * r * 0.3,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - Math.random() * 180,   // initial upward kick
        life, age: 0,
        rad: CRUSH.partRMin + Math.random() * (CRUSH.partRMax - CRUSH.partRMin),
        col: ochre ? [188, 146, 84] : [120, 112, 104],
      });
    }
  }
  function updateDust(dt, H2) {
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.age += dt;
      if (p.age >= p.life) { dust.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - CRUSH.partDrag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + CRUSH.partGravity * dt;   // settle downward
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > H2 + 20) { dust.splice(i, 1); }       // fell off-screen, cull
    }
  }
  function drawDust(fc) {
    for (let i = 0; i < dust.length; i++) {
      const p = dust[i];
      const a = Math.max(0, 1 - p.age / p.life);      // fade out over life
      fc.globalAlpha = a;
      fc.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`;
      fc.beginPath(); fc.arc(p.x, p.y, p.rad * (0.6 + 0.4 * a), 0, 7); fc.fill();
    }
    fc.globalAlpha = 1;
  }

  // ---- overlay draw (was drawOverlay) ---------------------------------------
  // `state` carries everything the engine owns that this needs to read:
  //   phase, deathCause, boulderDropped, boulderGone, boulderHeat, presence,
  //   escapeDir, s, SCHAR, total, winT, stuckT, sliceT, boulderReady, boulderImg.
  function draw(fc, fxCanvas, state, dt) {
    if (!fc) return;
    const {
      phase, deathCause, boulderDropped, boulderGone, boulderHeat, presence,
      escapeDir, s, SCHAR, total, winT, stuckT, sliceT, boulderReady, boulderImg, atExit,
    } = state;
    const tnow = performance.now() * 0.001;
    const W2 = fxCanvas.width, H2 = fxCanvas.height;
    fc.clearRect(0, 0, W2, H2);
    boulderRoll += dt * BOULDER.rollSpeed;
    // The boulder rolls over only for a PRE-DROP death (the first-turn fail, while the
    // boulder is still present) — NOT a blade kill (instant slice) and NOT any post-drop
    // death (the boulder is gone for good, so those are plain fade/impact deaths).
    // Boulder crush is retired (beams are a recoverable stumble; turn-misses are pits or
    // maze dead-ends). It only ever plays for a genuine pre-drop 'over' crush — NEVER for
    // a beam stumble (phase 'stuck'), so a block stays purely a time loss, not a death.
    const crushing = !boulderDropped && phase === 'over' && deathCause !== 'blade' && deathCause !== 'pit';
    if (crushing) {
      crushT = Math.min(1, crushT + dt * BOULDER.crushSpeed);
    }

    // Turn-escape: on the FIRST turn the boulder overshoots straight past the junction
    // and slides off-screen + fades (the SLIDE, ESCAPE_SLIDE s). After that it is GONE
    // FOR GOOD — there is NO re-entry / rebuild. `boulderGone` stays true (and the run's
    // hazards become purely beams/blades/walls) until resetGame.
    const ESCAPE_SLIDE = 0.6;                 // s for the off-screen slide+fade
    if (boulderGone && phase === 'run') {
      escapeT += dt;
    }

    // `base` is the boulder's on-screen reference diameter. The alignment preset
    // scales it so BOTH the resting boulder and the crush cinematic grow/shrink
    // together (crush radius + restY are derived from `base`, so the slam still
    // rolls in correctly from the resting size in every variation).
    const base = Math.min(W2, H2) * BOULDER.baseFrac * ALIGN_BOULDER_SCALE;
    // ---- proximity / depth cue (Issue 2): a single smooth `danger` 0..1 drives the
    // resting size + screen Y monotonically. presence gates heat so a post-turn
    // boulder reads far/small until it rebuilds. smoothstep keeps the closing readable.
    const dangerRaw = Math.max(0, Math.min(1, boulderHeat * presence));
    const danger = dangerRaw * dangerRaw * (3 - 2 * dangerRaw);   // smoothstep
    // resting diameter grows from far (farScale) toward full base as danger climbs.
    const restFrac = BOULDER.farScale + BOULDER.nearGrow * danger;
    const restR = (base / 2) * restFrac;
    // restY (display): the boulder is ALWAYS visible peeking up from the bottom — a
    // far/low slab at danger 0, climbing higher and bigger as it closes. PEEK = how
    // much of the boulder shows above the screen bottom (far -> near).
    const PEEK_FAR = ALIGN_PEEK_FAR, PEEK_NEAR = ALIGN_PEEK_NEAR;
    let restYDisplay = H2 + restR - base * (PEEK_FAR + PEEK_NEAR * danger);
    // SINK the boulder BELOW the feet line at low danger so it reads as a thing chasing
    // from BEHIND/BELOW, never a crisp ornate disc directly under the runner's feet. The
    // sink eases out as danger climbs (then it's allowed to rise toward the runner).
    {
      const sink = (BOULDER.sinkFrac != null ? BOULDER.sinkFrac : 0.34) * base * (1 - danger);
      restYDisplay += sink;
    }
    // GUARANTEED GAP: clamp so the boulder's TOP (restYDisplay - restR) never rises
    // above the runner's feet line + one-tile gap — you can always see floor between
    // them. Pushing the centre DOWN (larger y) keeps the boulder readable as "behind me".
    {
      const feetY = H2 * (BOULDER.feetLineFrac != null ? BOULDER.feetLineFrac : 0.72);
      const gap = H2 * (BOULDER.minGapFrac != null ? BOULDER.minGapFrac : 0.10);
      const minCentreY = feetY + gap + restR;          // top = centre - restR >= feetY + gap
      if (restYDisplay < minCentreY) restYDisplay = minCentreY;
    }
    // The CRUSH cinematic always rolls in from the full-size resting line (it must not
    // be scaled down by a low post-turn danger) — it ignores presence entirely.
    const heatLift = boulderHeat * base * 0.10;
    const restY = crushing ? (H2 + base * 0.40 - heatLift) : restYDisplay;
    // crushY is lifted by passOver so the boulder clearly ends up OVER the avatar line.
    const crushY = H2 * 0.42 - H2 * CRUSH.passOver;

    // ---- boulder approach: ease-in (accelerate), slam at slamAt, then settle/bounce.
    // `approach` 0..1 maps crushT in [0, slamAt] with an ease-in power curve.
    const approach = Math.min(1, crushT / CRUSH.slamAt);
    const accel = Math.pow(approach, CRUSH.accelPow);     // ease-in: slow then rushes in
    let cy = restY + (crushY - restY) * accel;
    // After the slam, add a decaying overshoot bounce (boulder settles onto the spot).
    let bounce = 0;
    if (crushT >= CRUSH.slamAt) {
      const tb = (crushT - CRUSH.slamAt) / Math.max(1e-3, (1 - CRUSH.slamAt)); // 0..1 post-slam
      bounce = Math.sin(tb * CRUSH.bounceFreq) * Math.exp(-tb * CRUSH.bounceDecay);
      cy += bounce * H2 * CRUSH.overshoot;                 // first dip = the slam impact
    }
    // Radius: the crush slams in at full base size (* crushScale); the resting boulder
    // uses the danger-scaled restR so it reads further back when pressure is low.
    const scale = 1 + accel * BOULDER.crushScale;
    const r = crushing ? (base / 2 * scale) : restR;

    // ---- screen shake: ramps with the approach, spikes at impact, decays to 0.
    // Mark impact time once, when the boulder fully covers the runner.
    if (crushing && impactTime < 0 && crushT >= CRUSH.slamAt) impactTime = tnow;
    let shakeMag = 0;
    if (crushing) {
      const ramp = CRUSH.shakeRamp * accel;                                  // build-up before impact
      const sinceImpact = impactTime >= 0 ? (tnow - impactTime) : 1e9;
      const spike = CRUSH.shakeImpact * Math.exp(-sinceImpact * CRUSH.shakeDecay); // decaying spike
      shakeMag = ramp + spike;
    }
    // jitter (different freqs on each axis), smoothed toward target so it decays to 0.
    const sx = Math.sin(tnow * 91.0) * shakeMag;
    const sy = Math.cos(tnow * 79.0) * shakeMag * 0.7;
    shakeX += (sx - shakeX) * Math.min(1, dt * 30);
    shakeY += (sy - shakeY) * Math.min(1, dt * 30);
    if (!crushing) { shakeX *= Math.max(0, 1 - dt * 12); shakeY *= Math.max(0, 1 - dt * 12); }

    // ---- dust/debris: burst once at impact, then animate + settle.
    if (crushing && !dustSpawned && crushT >= CRUSH.slamAt) {
      dustSpawned = true;
      spawnDust(W2 / 2, crushY + r * 0.55, r);
    }
    updateDust(dt, H2);

    // overall ease — drives the dark 'over'/'stuck' fade. For a crush it follows the
    // smoothstep of crushT; for a post-drop (non-boulder) death there's no crushT, so we
    // ramp it off a short timer (stuckT / sliceless) so 'over' still reads with a fade.
    const overT = Math.max(crushT, (phase === 'over') ? Math.min(1, stuckT * 1.6) : 0);
    const ease = (overT < 1) ? overT * overT * (3 - 2 * overT) : 1;

    // The FIRST turn sends the boulder sliding off-screen (straight) + fading; after that
    // `boulderDropped` is latched and the boulder is GONE FOR GOOD — it must never draw
    // again (no phantom at rest when we leave 'run'). So once dropped, alpha is forced 0.
    const sliding = boulderGone && phase === 'run';
    const ep = sliding ? Math.min(1, escapeT / ESCAPE_SLIDE) : 0;
    const cx = W2 / 2 + escapeDir * ep * W2 * 0.95;
    // DANGER FADE-IN (Issue 3): below `fadeIn` the resting boulder is fully invisible; it
    // fades up across [fadeIn .. fadeIn+fadeBand]. The crush/slide ignore this (they own
    // their own visibility) so only the AT-REST chase boulder is gated.
    const fIn = BOULDER.fadeIn != null ? BOULDER.fadeIn : 0.30;
    const fBand = BOULDER.fadeBand != null ? BOULDER.fadeBand : 0.25;
    const restVis = crushing ? 1 : Math.max(0, Math.min(1, (danger - fIn) / Math.max(1e-3, fBand)));
    const alpha = boulderDropped ? 0 : (sliding ? Math.max(0, 1 - ep * 1.25) : restVis);
    const gone = sliding;

    // ---- ground-shadow / dust band (Issue 2 readability aid): a soft elliptical
    // shadow under the boulder whose width + darkness track `danger`, so the player
    // can gauge "it's catching up" even before the boulder itself fills the frame.
    // Cheap (one radial gradient), only while running and visible.
    if (!crushing && alpha > 0.01 && phase === 'run' && danger > 0.02) {
      const shA = BOULDER.shadowMax * danger;
      const shY = cy + restR * 0.92;                 // just under the boulder
      const shW = restR * (1.4 + danger * 0.9);      // widens as it nears
      const shH = restR * 0.30;
      fc.save();
      fc.globalAlpha = alpha;
      fc.translate(cx, shY); fc.scale(1, shH / shW);
      const sg = fc.createRadialGradient(0, 0, 0, 0, 0, shW);
      sg.addColorStop(0, `rgba(10,6,3,${shA})`); sg.addColorStop(1, 'rgba(10,6,3,0)');
      fc.fillStyle = sg; fc.beginPath(); fc.arc(0, 0, shW, 0, 7); fc.fill();
      fc.restore();
    }

    // Apply the canvas shake to EVERYTHING drawn during the crush.
    fc.save();
    if (crushing) fc.translate(shakeX, shakeY);

    if (alpha > 0.01) {
      if (boulderReady) {
        fc.save(); fc.globalAlpha = alpha; fc.translate(cx, cy);
        const g = fc.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.15);
        g.addColorStop(0, 'rgba(40,26,14,0.0)'); g.addColorStop(1, 'rgba(20,12,6,0.55)');
        fc.fillStyle = g; fc.beginPath(); fc.arc(0, 0, r * 1.15, 0, 7); fc.fill();
        // MOTION-BLUR SMEAR (Issue 3): at higher danger, draw a couple of vertically
        // stretched, faded after-images BELOW/behind the boulder so it reads as hurtling
        // forward through dust rather than a crisp static disc. Strength tracks danger.
        if (!crushing) {
          const blur = (BOULDER.blurMax != null ? BOULDER.blurMax : 0.55) * danger;
          for (let k = 1; k <= 2; k++) {
            const t = k / 2;
            fc.save();
            fc.globalAlpha = alpha * blur * (1 - t * 0.5);
            fc.translate(0, r * 0.30 * k);                 // trailing below = where it came from
            fc.scale(1 + 0.06 * k, 1 + 0.22 * k * blur);   // stretch the trail vertically
            fc.rotate(boulderRoll - k * 0.12);
            fc.drawImage(boulderImg, -r, -r, r * 2, r * 2);
            fc.restore();
          }
        }
        fc.rotate(boulderRoll);
        fc.drawImage(boulderImg, -r, -r, r * 2, r * 2);
        fc.restore();
      } else {
        fc.save(); fc.globalAlpha = alpha; fc.translate(cx, cy); fc.fillStyle = '#6b5236';
        fc.beginPath(); fc.arc(0, 0, r, 0, 7); fc.fill(); fc.restore();
      }
    }

    // draw dust on top of the boulder's base (it kicks up around the impact).
    drawDust(fc);

    fc.restore();   // end shake transform

    // danger-gated red vignette: only flares once the boulder is genuinely close, so a
    // fresh post-turn boulder (low presence) doesn't fake pressure while it's still far.
    if (danger > 0.35 && phase === 'run' && !gone) {
      const vx = W2 / 2;
      const v = fc.createRadialGradient(vx, H2, H2 * 0.2, vx, H2 * 0.5, H2);
      v.addColorStop(0, `rgba(120,20,10,${(danger - 0.35) * 0.5})`); v.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = v; fc.fillRect(0, 0, W2, H2);
    }

    if (phase === 'over') {
      fc.fillStyle = `rgba(8,3,2,${0.55 * ease})`; fc.fillRect(0, 0, W2, H2);
    }

    // ---- ESCAPE light: a warm white/gold radial bloom that intensifies as the
    // avatar nears the exit (running) and bursts to a near-full whiteout on 'won'.
    // progress is based on the AVATAR position (s + SCHAR) so it tracks what you see.
    {
      const sp2 = s + SCHAR;
      // The bloom ONLY builds on the real exit corridor (atExit) — never in early/maze
      // halls, whose truncated active-path `total` would otherwise read as "near exit"
      // and flood the frame bright (Issue: washed-out, over-bright distant halls). On
      // 'won' the path is always fully resolved, so that case is naturally on the exit.
      const ramping = ((phase === 'run' && atExit) || phase === 'won');
      let exitGlow = 0;
      if (ramping) {
        const prog = Math.max(0, Math.min(1, (sp2 - (total - EXIT.ramp)) / EXIT.ramp));
        const eased = prog * prog * (3 - 2 * prog);              // smoothstep
        exitGlow = eased * EXIT.bloomMax;
      }
      // win whiteout: on 'won', flash bright then ease toward the overlay glow.
      let winFlash = 0;
      if (phase === 'won') {
        winFlash = Math.max(0, 1 - winT / EXIT.flashDur);        // 1 -> 0 over flashDur
        winFlash = winFlash * winFlash;
      }
      const glow = Math.max(exitGlow, phase === 'won' ? Math.max(exitGlow, 0.5) : 0);
      if (glow > 0.001) {
        const cxg = W2 / 2, cyg = H2 * 0.46;
        const g = fc.createRadialGradient(cxg, cyg, 0, cxg, cyg, Math.max(W2, H2) * 0.85);
        g.addColorStop(0, `rgba(255,250,235,${glow})`);
        g.addColorStop(0.55, `rgba(255,224,150,${glow * 0.6})`);
        g.addColorStop(1, 'rgba(255,210,120,0)');
        fc.fillStyle = g; fc.fillRect(0, 0, W2, H2);
      }
      if (winFlash > 0.001) {
        fc.fillStyle = `rgba(255,252,244,${winFlash})`; fc.fillRect(0, 0, W2, H2);
      }
    }

    // ---- impact flash: a brief white jolt right when the boulder slams home.
    if (crushing && impactTime >= 0) {
      const f = Math.max(0, 1 - (tnow - impactTime) / CRUSH.flashDur);
      if (f > 0) { fc.fillStyle = `rgba(255,246,235,${0.5 * f * f})`; fc.fillRect(0, 0, W2, H2); }
    }

    // BLADE nasty kill: red blood flash + a quick white slash streak.
    if (phase === 'over' && deathCause === 'blade') {
      const f = Math.max(0, 1 - sliceT * 2.2);
      fc.fillStyle = `rgba(150,8,6,${0.6 * f})`; fc.fillRect(0, 0, W2, H2);
      if (f > 0) {
        fc.save();
        fc.globalAlpha = f;
        fc.strokeStyle = 'rgba(255,238,232,0.95)';
        fc.lineWidth = 6 + 34 * (1 - f);
        fc.beginPath(); fc.moveTo(W2 * 0.16, H2 * 0.16); fc.lineTo(W2 * 0.84, H2 * 0.88); fc.stroke();
        fc.restore();
      }
    }
    // FIRE kill: a hot orange burn flash that fades (engulfed by the flame jet).
    if (phase === 'over' && deathCause === 'fire') {
      const f = Math.max(0, 1 - sliceT * 1.8);
      const g = fc.createRadialGradient(W2 / 2, H2 * 0.6, 0, W2 / 2, H2 * 0.6, Math.max(W2, H2) * 0.7);
      g.addColorStop(0, `rgba(255,170,40,${0.7 * f})`);
      g.addColorStop(0.5, `rgba(220,70,10,${0.55 * f})`);
      g.addColorStop(1, `rgba(120,20,4,${0.4 * f})`);
      fc.fillStyle = g; fc.fillRect(0, 0, W2, H2);
    }
  }

  return {
    CRUSH,
    reset, clearCrush, resetEscape,
    draw,
    get crushT() { return crushT; },
    get shakeX() { return shakeX; },
    get shakeY() { return shakeY; },
  };
}

export default createBoulderFx;
