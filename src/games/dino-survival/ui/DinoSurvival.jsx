// ===========================================================================
// Dino Survival — top-level screen. Wires the one-directional pipeline:
//   pose -> runDetector (cadence) -> survival engine -> scene (canvas) + HUD.
// Canvas-2D rendering (the PoC look), React only for screens/HUD/overlays.
// ===========================================================================
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { LEVELS, DEFAULT_LEVEL, RUNNER_IDLE_FRAME, RUNNER_OFF_DIST, RUNNER_RUN_START, RUNNER_RUN_LEN } from '../config.js';
import { createRunDetector, framed, playerMetrics } from '../vision/runDetector.js';
import { createPoseSource } from '../vision/poseSource.js';
import { createRunner } from '../render/runner.js';
import { createSurvival } from '../engine/survival.js';
import { createScene } from '../render/scene.js';
import { loadAssets } from '../render/assets.js';
import { createAudio } from '../audio/sfx.js';
import { clamp } from '../util.js';
import { createReplayBuffer } from '../../../recording/replayBuffer.js';
// Best-score persistence lives behind one module: instant localStorage cache +
// best-effort sync through /api/score (Neon). See src/net/scores.js.
import { dinoScores as scores } from '../../../net/gameClients.js';
import { getName, setName, getCountry, setCountry as persistCountry, flagEmoji } from '../../../net/identity.js';
import Leaderboard from '../../../ui/Leaderboard.jsx';
import { shareFile } from '../../../sharing/share.js';
import { openSocialShare, copyShareLink, shareText } from '../../../sharing/socialShare.js';

// phone vs desktop — only phones "hold the device away"; desktops "move back".
const IS_PHONE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent || '');

export default function DinoSurvival({ onExit }) {
  const canvasRef = useRef(null), videoRef = useRef(null), caughtVideoRef = useRef(null), escapeVideoRef = useRef(null), G = useRef({});
  const assetsRef = useRef(null);   // cache loaded images across runs (avoid re-decoding ~50MB every game)
  const sfxRef = useRef(null);      // procedural Web Audio engine (reused across runs)
  const [audioMuted, setAudioMuted] = useState(() => { try { return localStorage.getItem('slayfit_dino_muted') === '1'; } catch { return false; } });
  const [screen, setScreen] = useState('intro');         // intro | loading | playing | result
  const [level] = useState(DEFAULT_LEVEL);   // single difficulty (Impossible)
  const [hud, setHud] = useState({ t: 0, pace: 0, spm: 0, distPct: 0 });
  const [calib, setCalib] = useState(null);              // { msg, sub, ok } | null
  const [legsWarn, setLegsWarn] = useState(false);
  const [result, setResult] = useState(null);
  const [best, setBest] = useState(() => scores.getCachedBest(DEFAULT_LEVEL));
  const [showRig, setShowRig] = useState(true);
  const [clip, setClip] = useState(null);
  const [note, setNote] = useState('');
  const [dbg, setDbg] = useState(null);                  // telemetry/debug readout (null = off)
  const [keepRun, setKeepRun] = useState(false);         // "keep running!" nudge (off-pose / stopped mid-chase)
  const [analytics, setAnalytics] = useState(null);      // post-run analytics card data
  const [name, setNameState] = useState(() => getName());     // player display name (cookie-backed)
  const [country, setCountry] = useState(() => getCountry());  // ISO-2, detected at play start
  const [showBoard, setShowBoard] = useState(false);           // leaderboard overlay on intro
  const [board, setBoard] = useState(null);                    // top rows from last submit (no extra call)
  const [shareNote, setShareNote] = useState('');              // small status line under the share buttons

  // teardown
  const teardown = useCallback(() => {
    const g = G.current; if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    if (g.demoTimer) clearInterval(g.demoTimer);
    if (g.csTimer) clearTimeout(g.csTimer);
    try { sfxRef.current && sfxRef.current.stopAll(); } catch {}
    if (g.audioTimers) g.audioTimers.forEach(clearTimeout);
    if (g.clipUrl) { try { URL.revokeObjectURL(g.clipUrl); } catch {} }   // free the previous run's replay blob
    try { caughtVideoRef.current && caughtVideoRef.current.pause(); } catch {}
    try { escapeVideoRef.current && escapeVideoRef.current.pause(); } catch {}
    try { g.pose && g.pose.dispose(); } catch {}
    try { g.replay && g.replay.stop(); } catch {}
    if (g.onKey) window.removeEventListener('keydown', g.onKey);
    if (g.dbgKey) window.removeEventListener('keydown', g.dbgKey);
    G.current = {};
  }, []);
  useEffect(() => teardown, [teardown]);

  // One server call per level handles BOTH best-score hydration and country
  // detection (the score endpoint reports the edge-detected country), so there
  // is no separate geo round-trip. Cached best shows instantly; server reconciles.
  useEffect(() => {
    setBest(scores.getCachedBest(level));
    let live = true;
    scores.fetchState(level).then((st) => {
      if (!live || !st) return;
      if (st.best) setBest(scores.reconcile(level, st.best));
      if (st.country) { persistCountry(st.country); setCountry(st.country); }
    });
    return () => { live = false; };
  }, [level]);

  async function startGame(mode) {
    teardown(); setScreen('loading'); setNote(''); setResult(null); setClip(null);
    // load assets ONCE and reuse across runs (re-decoding ~97 images each game was
    // churning ~50MB of bitmaps — a likely cause of cross-run memory pressure).
    if (!assetsRef.current) assetsRef.current = await loadAssets();
    const assets = assetsRef.current;
    const cv = canvasRef.current; const ctx = cv.getContext('2d');
    const fit = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; }; fit();
    const det = createRunDetector(), surv = createSurvival(LEVELS[level]), scene = createScene(assets), runner = createRunner(assets, RUNNER_IDLE_FRAME);
    let phase = mode === 'camera' ? 'calibrating' : 'countdown';
    let countTo = 0, calStart = 0, lastT = performance.now(), camNear = 0, bgPos = 0, runnerPos = 0, escDone = false;
    let spmSum = 0, spmSqSum = 0, spmCnt = 0, spmMax = 0, activeMs = 0, calAccum = 0; const WEIGHT_KG = 70;  // for analytics (avg/peak cadence, consistency, calories)
    let frameCnt = 0, tAcc = 0;   // for the downloadable telemetry trace (diagnosing detection failures)
    let latestLM = null, latestVid = null, latestMask = null, pm = null, pace = 0, spm = 0, buildTick = 0;

    const g = G.current = { mode, ctx, cv, det, surv, scene, runner, fit, assets, tlog: [] };
    window.addEventListener('resize', fit);

    // audio: reuse one procedural engine across runs; reset per-run cue state
    const sfx = sfxRef.current || (sfxRef.current = createAudio()); sfx.setMuted(audioMuted); g.sfx = sfx;
    g.audioTimers = []; g.au = { lastCount: 99, nextFootfall: 0, nextSnarl: 0, roared: false };
    const startChase = () => { sfx.startLoop('music', 0.42); sfx.startLoop('run', 0); };
    // per-frame cues while running: footsteps track pace; music + dino threat scale with near (=1-gap)
    const chaseAudio = (now, near) => {
      sfx.setLoop('run', pace > 0.05 ? clamp(0.18 + pace * 0.5, 0, 0.7) : 0, 0.75 + pace * 0.85);
      sfx.setLoop('music', 0.40 + near * 0.18);
      // (dino footfalls are triggered on the animation's foot-strike, not here)
      // (periodic snarl removed — it read as an ugly recurring thud)
      if (near > 0.74 && !g.au.roared) { g.au.roared = true; sfx.play('roar', 0.9, 1.0); }
      else if (near < 0.6 && g.au.roared) { g.au.roared = false; }
    };

    // pose / demo input
    if (mode === 'camera') {
      try {
        const pose = createPoseSource(videoRef.current); g.pose = pose;
        await pose.startCamera(); await pose.init();
        pose.start((lm, vid, mask) => {
          latestLM = lm; latestVid = vid;   // segmentation removed — avatar is a baked sprite now
          if (phase === 'calibrating') {
            const aVis = (i) => lm && lm[i] && (lm[i].visibility == null || lm[i].visibility > 0.4);
            const fullBody = framed(lm) && aVis(27) && aVis(28);   // hips+knees+ankles all in frame
            if (fullBody) {
              if (!g.calDone) { det.calibrate(lm); g.calDone = true; }   // capture the standing baseline once
              // legs track far better once they're MOVING, so we start on a few
              // detected steps rather than a still full-body pose.
              if (det.stats().steps >= 3) { phase = 'countdown'; countTo = performance.now() + 3000; setCalib(null); }
              else setCalib({ msg: 'Run in place to start', sub: 'keep going — capturing your stride', ok: true });
            } else { g.calDone = false; setCalib({ msg: 'Step back a little', sub: IS_PHONE ? 'set your phone further back so your whole body shows' : 'move back so your whole body shows', ok: false }); }
          }
        });
      } catch (e) {
        setNote(location.protocol === 'file:' ? 'Camera needs localhost (serve.command).' : ('Camera unavailable: ' + (e.message || e)));
        setScreen('intro'); teardown(); return;
      }
    } else {
      countTo = performance.now() + 3000;
      const onKey = (e) => { const k = e.key.toLowerCase(); if (k === 'f' || k === 'j') det.tap(performance.now()); };
      g.onKey = onKey; window.addEventListener('keydown', onKey);
    }

    // debug/telemetry: 'g' toggles the ground guides + telemetry; arrows nudge the
    // ground line / vanishing point live; [ ] shift the background vertical anchor.
    const dbgKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'm') { toggleMute(); return; }           // mute/unmute
      if (k === 't') { downloadTelemetry(); return; }   // grab the trace anytime (even if detection died)
      if (k === 'g') { g.debug = !g.debug; scene.setDebug(g.debug); if (!g.debug) setDbg(null); return; }
      if (!g.debug) return;
      const gr = scene.getGround();
      if (e.key === 'ArrowUp') { scene.setGround(gr.gFrac - 0.01, gr.tFrac); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { scene.setGround(gr.gFrac + 0.01, gr.tFrac); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { scene.setGround(gr.gFrac, gr.tFrac - 0.01); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { scene.setGround(gr.gFrac, gr.tFrac + 0.01); e.preventDefault(); }
      else if (e.key === '[') scene.setBgAnchor(gr.bgAnchor - 0.03);
      else if (e.key === ']') scene.setBgAnchor(gr.bgAnchor + 0.03);
    };
    g.dbgKey = dbgKey; window.addEventListener('keydown', dbgKey);

    // 10s instant-replay (composites webcam + scene canvas)
    try { const replay = createReplayBuffer(); g.replay = replay;
      replay.start({ video: mode === 'camera' ? videoRef.current : null, pixiCanvas: cv, demoBg: mode === 'demo' ? true : null, webcamInset: true }); } catch { g.replay = null; }

    surv.reset();
    setScreen('playing');
    sfx.resume(); sfx.stopAll();   // (jungle ambience bed removed per feedback)
    // lazy-load: start buffering the catch/escape clips now (a run lasts several
    // seconds, so they're ready by the time one fires) instead of on page load.
    try { caughtVideoRef.current && caughtVideoRef.current.load(); } catch {}
    try { escapeVideoRef.current && escapeVideoRef.current.load(); } catch {}
    let hudAcc = 0;

    const loop = () => {
      const now = performance.now(); const dt = Math.min(60, now - lastT); lastT = now; const W = cv.width, H = cv.height;
      const lm = latestLM;
      const c = mode === 'camera' ? det.update(lm, now) : det.update(null, now);
      pace = c.pace; spm = c.spm; pm = playerMetrics(lm);
      const legsOK = mode !== 'camera' || framed(lm);
      const warn = mode === 'camera' && phase === 'running' && !legsOK; setLegsWarn(warn);

      if (phase === 'countdown') {
        const n = Math.ceil((countTo - now) / 1000);
        if (n !== g.au.lastCount) { g.au.lastCount = n; if (n > 0) sfx.play('beep', 0.5, 1); }   // 3-2-1
        if (countTo - now <= 0) { phase = 'running'; sfx.play('beep', 0.7, 0.7); startChase(); }  // GO + loops up
      }
      if (phase === 'running' && legsOK) {
        const s = surv.step(pace, dt);
        if (s.phase === 'escaped') { phase = 'escaped'; playEscape(); }
        else if (s.phase === 'caught') { phase = 'caught'; playCaught(); }
      }
      const snap = surv.snapshot();
      if (phase === 'running') chaseAudio(now, snap.near);   // footsteps / music swell / dino threat
      let keepRunWarn = false;
      // accumulate run analytics while actually running
      if (phase === 'running') {
        if (spm > 0) { spmSum += spm; spmSqSum += spm * spm; spmCnt++; if (spm > spmMax) spmMax = spm; activeMs += dt; }
        const met = Math.max(3, Math.min(12, 3 + spm * 0.045));                 // high-knees MET scales with cadence
        calAccum += met * 3.5 * WEIGHT_KG / 200 * (dt / 60000);                 // kcal = MET·3.5·kg/200 per min
      }

      // ---- render ----
      // Whole-frame car-cam carries the motion (jeep ahead, looking back). pace
      // drives vehicle bob/vibration + the forward parallax; closeness (camNear)
      // drives the zoom-punch + shake. drawDino returns the live closeness.
      scene.beginCamera(ctx, W, H, { pace, near: camNear, now });
      // Moving world = the seamless trail loop, indexed by distance you've covered:
      // running advances bgPos, stopping freezes it. (~12 frames/sec at full pace.)
      bgPos += pace * dt * 0.012;
      const groundY = scene.drawBgSeq(ctx, W, H, bgPos);   // float pos -> crossfaded frames (smooth + seamless wrap)
      if (phase === 'escaped') {
        // fullscreen escape video handles the win cutscene (loop stops below)
      } else if (phase !== 'calibrating') {   // calibration shows the live skeleton instead (below)
        const near = scene.drawDino(ctx, W, H, groundY, snap.gap, now);
        camNear += (near - camNear) * 0.12;                 // smoothed closeness for the camera
        // stomp lands on the dino's actual foot-plant (scene reports the strike),
        // louder/heavier as it closes in; only audible during the live chase.
        const strike = scene.consumeStrike();
        if (phase === 'running' && strike > 0 && near > 0.12) sfx.play('footfall', (0.1 + near * 0.7) * strike, 0.9 + near * 0.2);
        // Player avatar. While RUNNING, the cycle advances with your pace — the SAME
        // measure that drives the ground — so the runner always moves in lockstep
        // with the world. While idle, we pose-match your live skeleton (arms/standing
        // follow you), falling back to standing if the pose is off (ducking/arbitrary).
        // Telemetry is the authority on run-vs-idle; pose-matching only refines WITHIN
        // "you're moving". Running (pace) -> run cycle. Some cadence (spm>0) -> pose-match
        // your body. No cadence (spm===0, standing) -> stand, so it can't grab a run frame.
        let rIdx, offPose = false;
        if (pace > 0.05) { runnerPos += pace * dt * 0.012; rIdx = RUNNER_RUN_START + (runnerPos % RUNNER_RUN_LEN); }   // seamless single-stride loop, ~natural rate
        else if (mode === 'camera' && lm && spm > 0) {
          rIdx = runner.pickFrame(lm);
          if (runner.matchDist() > RUNNER_OFF_DIST) { rIdx = RUNNER_IDLE_FRAME; offPose = true; }
        } else rIdx = RUNNER_IDLE_FRAME;
        scene.drawDust(ctx, W, H, groundY, pace, now, dt);   // sand kicked up behind the runner
        runner.draw(ctx, W, H, groundY, rIdx, showRig);
        // gentle nudge if you've stopped running mid-chase
        keepRunWarn = phase === 'running' && mode === 'camera' && (offPose || spm === 0);
        if (near > 0.74) { ctx.fillStyle = `rgba(180,20,30,${(near - 0.74) * 0.8})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
      }
      if (g.debug) scene.drawGuides(ctx, W, H);            // ground + vanishing-point guides (ride with the camera)
      // countdown overlay (inside the camera so it rides along too)
      if (phase === 'countdown') { const n = Math.ceil((countTo - now) / 1000); ctx.fillStyle = 'rgba(7,6,15,.4)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '900 120px system-ui'; ctx.fillText(n > 0 ? n : 'RUN!', W / 2, H / 2 + 30); }
      scene.endCamera(ctx);
      // speed lines stream in screen space, on top of the moving frame (top-speed accent).
      if (phase !== 'escaped' && phase !== 'calibrating') scene.drawSpeedLines(ctx, W, H, pace, now);
      // CALIBRATION: lightly dim the scene; the small animated runner figure in the
      // calib panel is the cue (green when your whole body is in frame).
      if (phase === 'calibrating') { ctx.fillStyle = 'rgba(7,6,15,0.5)'; ctx.fillRect(0, 0, W, H); }

      hudAcc += dt; if (hudAcc > 100) { hudAcc = 0; setHud({ t: snap.t, pace, spm, distPct: snap.distPct }); setKeepRun(keepRunWarn);
        if (g.debug) { const gr = scene.getGround(); const nF = (assets.bgLoop && assets.bgLoop.length) || 1;
          setDbg({ pace: +pace.toFixed(2), spm, band: c.band, steps: c.steps, flash: c.flash, md: +runner.matchDist().toFixed(1), gap: +snap.gap.toFixed(2), near: +camNear.toFixed(2), dist: Math.round(snap.distPct * 100),
            bg: Math.floor(bgPos) % nF, legs: (mode !== 'camera' || framed(lm)), phase,
            g: gr.gFrac.toFixed(2), t: gr.tFrac.toFixed(2), a: gr.bgAnchor.toFixed(2) }); }
      }

      // ---- telemetry trace (1 sample/sec): fps, pose errors, heap, cadence ----
      frameCnt++; tAcc += dt;
      if (tAcc >= 1000) {
        g.tlog.push({ ms: Math.round(now), t: +snap.t.toFixed(1), phase, fps: Math.round(frameCnt * 1000 / tAcc),
          pace: +pace.toFixed(2), spm, steps: c.steps, lm: lm ? 1 : 0, framed: (mode !== 'camera' || framed(lm)) ? 1 : 0,
          mv: c.diag?.mv, lL: c.diag?.lL, lR: c.diag?.lR, gL: c.diag?.gL, gR: c.diag?.gR,
          poseErr: (g.pose && g.pose.errors) ? g.pose.errors() : 0,
          heapMB: (performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
        if (g.tlog.length > 1800) g.tlog.shift();   // cap ~30min
        frameCnt = 0; tAcc = 0;
      }

      if (phase !== 'caught' && phase !== 'escaped' && phase !== 'done') g.raf = requestAnimationFrame(loop);
    };

    // Generic: play a fullscreen cutscene video, then finish() -> result screen.
    function playCutscene(v, screenName, safetyMs) {
      if (!v) { finish(); return; }
      setScreen(screenName);
      const done = () => { v.removeEventListener('ended', done); if (G.current.csTimer) clearTimeout(G.current.csTimer); finish(); };
      v.addEventListener('ended', done);
      try { v.currentTime = 0; const p = v.play(); if (p && p.catch) p.catch(() => done()); } catch { done(); }
      G.current.csTimer = setTimeout(done, safetyMs);
    }
    function playEscape() {
      sfx.stopLoop('run'); sfx.stopLoop('music'); sfx.play('engine', 0.75, 1.0);     // jeep turns over
      g.audioTimers.push(setTimeout(() => sfx.play('door', 0.85), 1100));            // door shuts
      g.audioTimers.push(setTimeout(() => sfx.play('engine', 0.95, 1.12), 2300));    // peel-off
      playCutscene(escapeVideoRef.current, 'escaped', 5400);   // clip ~4.83s
    }

    // Caught -> play the dino lunge/capture sting fullscreen, THEN show the result.
    function playCaught() {
      sfx.stopLoop('run'); sfx.stopLoop('music');
      sfx.play('roar', 1.0, 0.95); sfx.play('footfall', 0.9, 0.8);                   // lunge
      g.audioTimers.push(setTimeout(() => sfx.play('chomp', 1.0), 500));             // the bite — "consuming"
      playCutscene(caughtVideoRef.current, 'caught', 3600);   // catch clip ~3.1s (from f9: lunge -> grab -> bite)
    }

    function finish() {
      if (G.current.finished) return; G.current.finished = true;
      const r = surv.result; setResult(r);
      // 1) instant local update (works offline). 2) the server is the scorekeeper:
      // one POST returns the authoritative best + personal-best flag + country, so
      // we trust its isPB over the local guess and need no further calls.
      const { best: b, improved } = scores.mergeLocalBest(level, r);
      setBest(b); r.isNew = improved;
      const lv = level;
      scores.submitRun(lv, r, { player: getName() || null, country: getCountry() })
        .then((srv) => {
          if (!srv) return;                       // offline -> keep local result
          if (srv.best) setBest(scores.reconcile(lv, srv.best));
          if (srv.country) { persistCountry(srv.country); setCountry(srv.country); }
          if (srv.leaderboard) setBoard(srv.leaderboard);
          setResult((prev) => (prev === r ? { ...r, isNew: srv.isPB } : prev));
        });
      // getLastClip is async (rebases MP4 timestamps so the clip starts at 0, no
      // dead lead-in); collect it, then update state.
      (async () => {
        let cl = null;
        try { if (G.current.replay) { cl = await G.current.replay.getLastClip(); G.current.replay.stop(); } } catch {}
        setClip(cl || null); G.current.clipUrl = cl ? cl.url : null;   // tracked so we can revoke it next run (off-heap blob leak)
      })();
      // ---- run analytics ----
      const st = det.stats(); const totLR = st.stepsL + st.stepsR;
      const avgCad = spmCnt ? Math.round(spmSum / spmCnt) : 0;
      const varc = spmCnt ? Math.max(0, spmSqSum / spmCnt - (spmSum / spmCnt) ** 2) : 0;
      setAnalytics({
        avgCad, peakCad: spmMax,
        consistency: avgCad ? Math.round(Math.max(0, 1 - Math.sqrt(varc) / avgCad) * 100) : 0,
        symL: totLR ? Math.round((st.stepsL / totLR) * 100) : 50,
        steps: st.steps, cals: Math.round(calAccum), activeS: Math.round(activeMs / 1000),
      });
      phase = 'done'; setScreen('result');
    }

    g.raf = requestAnimationFrame(loop);
  }

  // ---- telemetry export (diagnostics) ----
  function downloadTelemetry() {
    const g = G.current || {}; const tlog = g.tlog || [];
    const payload = {
      when: new Date().toISOString(), ua: navigator.userAgent,
      hasMemAPI: !!performance.memory,
      lastPoseErr: (g.pose && g.pose.lastError) ? g.pose.lastError() : '',
      poseErrTotal: (g.pose && g.pose.errors) ? g.pose.errors() : 0,
      samples: tlog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'slayfit-dino-telemetry.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---- share helpers ----
  // The run as the shape the sharing module understands (drives caption + the
  // /s page whose og:image is the dynamic dino /api/og card).
  const dinoStats = () => ({ g: 'dino', escaped: !!(result && result.escaped), timeS: result ? result.timeS : 0, pct: result ? result.pct : 0 });
  const noteMethod = (m) => (m === 'share' ? 'Shared!' : m === 'download' ? 'Downloaded (share sheet unavailable)' : 'Sharing not supported here');

  // Build the portrait result card as a PNG blob (for direct file sharing).
  function buildCardBlob() {
    return new Promise((resolve) => {
      const a = G.current.assets || {}; const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const g = c.getContext('2d');
      g.fillStyle = '#0c0a1f'; g.fillRect(0, 0, 1080, 1080);
      if (a.bgTrail) { const im = a.bgTrail, s = Math.max(1080 / im.naturalWidth, 720 / im.naturalHeight); g.globalAlpha = .55; g.drawImage(im, (1080 - im.naturalWidth * s) / 2, 0, im.naturalWidth * s, im.naturalHeight * s); g.globalAlpha = 1; }
      g.fillStyle = '#000a'; g.fillRect(0, 0, 1080, 1080); g.textAlign = 'center';
      g.fillStyle = '#a06bff'; g.font = '900 46px system-ui'; g.fillText('SLAYFIT · DINO SURVIVAL — ' + LEVELS[level].label.toUpperCase(), 540, 150);
      if (result.escaped) { g.fillStyle = '#7dffa0'; g.font = '900 120px system-ui'; g.fillText('ESCAPED', 540, 410);
        g.fillStyle = '#fff'; g.font = '900 210px system-ui'; g.fillText(result.timeS.toFixed(1) + 's', 540, 660); }
      else { g.fillStyle = '#ff6b8a'; g.font = '900 120px system-ui'; g.fillText('CAUGHT', 540, 410);
        g.fillStyle = '#fff'; g.font = '900 210px system-ui'; g.fillText(result.pct + '%', 540, 660); }
      g.fillStyle = '#cfc7e6'; g.font = '600 46px system-ui'; g.fillText(result.escaped ? ('Personal best: ' + (best.escape != null ? best.escape.toFixed(1) + 's' : '—')) : 'Can you reach the jeep?', 540, 880);
      g.fillStyle = '#ff7a3c'; g.font = '800 40px system-ui'; g.fillText('outrun the beast · slayfit', 540, 980);
      c.toBlob((b) => resolve(b), 'image/png');
    });
  }
  // Share the result card image as a FILE (native share sheet on mobile — incl.
  // Instagram/WhatsApp/X — or download on desktop).
  async function shareCard() {
    setShareNote('');
    try { const b = await buildCardBlob(); if (!b) return; const res = await shareFile({ blob: b, filename: 'slayfit-dino-survival.png', title: 'SlayFit Dino Survival', text: shareText(dinoStats()) }); setShareNote(noteMethod(res.method)); }
    catch { setShareNote('Could not share the image.'); }
  }
  // Share the 10s replay clip as a FILE (same native-sheet path).
  async function shareClip() {
    if (!clip || !clip.blob) return;
    setShareNote('');
    const ext = ((clip.mime || clip.blob.type || '').includes('mp4')) ? 'mp4' : 'webm';
    try { const res = await shareFile({ blob: clip.blob, filename: `slayfit-dino-survival.${ext}`, title: 'My Dino Survival run', text: shareText(dinoStats()) }); setShareNote(noteMethod(res.method)); }
    catch { setShareNote('Could not share the clip.'); }
  }
  // Post to a social network — opens the /s page whose OG preview is the dino card.
  function onSocial(network, label) { const ok = openSocialShare(network, dinoStats()); setShareNote(ok ? `Opening ${label}…` : `Couldn't open ${label}.`); }
  async function onCopyLink() { const ok = await copyShareLink(dinoStats()); setShareNote(ok ? 'Share link copied!' : "Couldn't copy the link."); }

  // master mute — drives the audio engine (if running) and persists either way
  const toggleMute = useCallback(() => {
    const sfx = sfxRef.current; let m;
    if (sfx) m = sfx.toggle();
    else { m = !audioMuted; try { localStorage.setItem('slayfit_dino_muted', m ? '1' : '0'); } catch {} }
    setAudioMuted(m);
  }, [audioMuted]);

  const lvl = LEVELS[level];

  return (
    <div className="fixed inset-0 overflow-hidden bg-realm text-ink font-body">
      {/* ambient (shown on intro; the live scene covers it during play) */}
      <img src="/assets/dino-survival/bg/trail.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgb(var(--realm-rgb)/.45)] via-[rgb(var(--realm-rgb)/.78)] to-[rgb(var(--realm-rgb)/.96)]" />
      <video ref={videoRef} playsInline muted className="absolute -left-[9999px] -top-[9999px]" />
      {/* caught cutscene: dino capture sting — fades in over the cut, and stays frozen
          on its last frame as the result backdrop when you were caught. */}
      <video ref={caughtVideoRef} src="/assets/dino-survival/cut/caught.mp4" playsInline muted preload="none"
        className="absolute inset-0 w-full h-full object-cover bg-black z-[15]"
        style={{ opacity: (screen === 'caught' || (screen === 'result' && result && !result.escaped)) ? 1 : 0, transition: 'opacity .3s ease', pointerEvents: 'none' }} />
      {/* escape cutscene: jeep getaway — fades in, then freezes on its last frame as
          the result backdrop when you escaped. */}
      <video ref={escapeVideoRef} src="/assets/dino-survival/cut/escaped.mp4" playsInline muted preload="none"
        className="absolute inset-0 w-full h-full object-cover bg-black z-[15]"
        style={{ opacity: (screen === 'escaped' || (screen === 'result' && result && result.escaped)) ? 1 : 0, transform: (screen === 'escaped' || (screen === 'result' && result && result.escaped)) ? 'scale(1)' : 'scale(0.9)', transformOrigin: 'center center', transition: 'opacity .3s ease, transform .45s ease', pointerEvents: 'none' }} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* telemetry / grounding tuner (toggle with 'G') */}
      {dbg && (
        <div className="absolute bottom-3 left-3 z-[20] font-mono text-[11px] leading-relaxed text-emerald-200 bg-black/70 border border-emerald-400/30 rounded-lg px-3 py-2 pointer-events-none">
          <div className="text-emerald-300 font-bold mb-1">TELEMETRY · {dbg.phase}</div>
          <div>pace {dbg.pace} · spm {dbg.spm} · <span className={dbg.flash ? 'text-yellow-300' : ''}>{dbg.band}</span></div>
          <div>steps {dbg.steps} · legs {dbg.legs ? 'OK' : '— STEP BACK'} · poseΔ {dbg.md}</div>
          <div>gap {dbg.gap} · near {dbg.near} · dist {dbg.dist}% · bg#{dbg.bg}</div>
          <div className="text-cyan-300 mt-1">gFrac {dbg.g} [↑↓] · tFrac {dbg.t} [←→] · bgAnchor {dbg.a} [ [ ] ]</div>
          <div className="text-white/50 mt-1">G to toggle</div>
        </div>
      )}

      {/* Brand */}
      <div className="absolute top-3.5 left-4 z-[5]">
        <div className="font-display font-black text-lg bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">SLAYFIT</div>
        <div className="text-[9px] tracking-[0.24em] text-magic/80 uppercase">Dino Survival</div>
      </div>

      {/* Mute toggle (also 'M') — always available */}
      <button onClick={toggleMute} title={audioMuted ? 'Unmute (M)' : 'Mute (M)'} aria-label={audioMuted ? 'Unmute' : 'Mute'}
        className="absolute top-3.5 right-3.5 z-[25] pointer-events-auto cursor-pointer panel w-9 h-9 flex items-center justify-center text-base leading-none"
        style={{ marginTop: screen === 'playing' ? '52px' : '0' }}>{audioMuted ? '🔇' : '🔊'}</button>

      {screen === 'playing' && (
        <>
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 text-center z-[5]" style={{ textShadow: '0 2px 10px #000' }}>
            <div className="font-black text-3xl text-gold tabular-nums text-glow">{hud.t.toFixed(1)}</div>
            <div className="text-[9px] tracking-[0.22em] uppercase text-ink/80">seconds</div>
          </div>
          {/* live cadence coach — centered + large so you can read it while running */}
          {hud.spm > 0 && (
            <div className="absolute top-[62%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-[5]" style={{ textShadow: '0 2px 10px #000' }}>
              <div className={`text-xl md:text-2xl font-extrabold px-6 py-2.5 rounded-full border-2 backdrop-blur-sm ${hud.spm >= 170 ? 'text-emerald-200 border-emerald-400/70 bg-emerald-500/25'
                : hud.spm >= 145 ? 'text-amber-100 border-amber-300/60 bg-amber-500/25'
                : 'text-white border-fire/70 bg-fire/30'}`}>
                {hud.spm >= 170 ? `cadence ✓ ${hud.spm}` : hud.spm >= 145 ? `↑ faster · ${hud.spm}` : `lift your knees · ${hud.spm}`}
              </div>
            </div>
          )}
          <div className="absolute top-3 right-3.5 flex gap-2 z-[5]">
            <Stat v={Math.round(hud.pace * 100) + '%'} k="pace" /><Stat v={hud.spm} k="spm" />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-12 w-[min(82vw,620px)] z-[5]">
            <div className="relative h-[18px] rounded-[10px] bg-black/40 border border-magic/30 overflow-hidden">
              <div className="h-full rounded-[10px] transition-[width] duration-100 bg-gradient-to-r from-shield via-magic to-fire" style={{ width: (hud.distPct * 100).toFixed(0) + '%' }} />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-sm bg-gold shadow-glow" />
            </div>
            <div className="flex justify-between text-[10px] tracking-[0.16em] uppercase text-ink/80 mt-1.5" style={{ textShadow: '0 1px 4px #000' }}>
              <span>the beast</span><span>the jeep — run!</span>
            </div>
          </div>
          <button onClick={() => setShowRig(r => !r)} className="absolute top-12 left-4 z-[6] pointer-events-auto cursor-pointer panel px-2.5 py-1 text-[11px] font-bold text-ink/90">{showRig ? 'rig: on' : 'rig: off'}</button>
          {legsWarn && (
            <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 z-[6] text-center rounded-2xl px-7 py-4 text-2xl md:text-3xl font-extrabold text-white border-2 border-fire/70" style={{ background: 'rgb(var(--fire-rgb)/.9)', textShadow: '0 2px 10px #000' }}>
              Step back<div className="text-base md:text-lg font-semibold opacity-90 mt-1">get your knees &amp; feet in frame</div>
            </div>
          )}
          {keepRun && !legsWarn && (
            <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 z-[6] text-center rounded-2xl px-8 py-5 text-3xl md:text-4xl font-extrabold text-white border-2 border-magic/70 animate-pulse" style={{ background: 'rgb(var(--fire-rgb)/.85)', textShadow: '0 2px 10px #000' }}>
              Keep running! 🦖
            </div>
          )}
          {calib && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-[6]">
              <div className="panel px-6 py-4">
                <RunnerFigure ready={calib.ok} />
                <div className={`text-lg md:text-xl font-extrabold mt-1 ${calib.ok ? 'text-emerald-300' : 'text-ink'}`}>{calib.msg}</div>
                <div className={`text-xs md:text-sm mt-0.5 ${calib.ok ? 'text-emerald-300/80' : 'text-magic/70'}`}>{calib.sub}</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* LEADERBOARD overlay (from intro) */}
      {showBoard && screen === 'intro' && (
        <Center>
          <Leaderboard client={scores} level={level} label={LEVELS[level].label} onClose={() => setShowBoard(false)} />
        </Center>
      )}

      {/* INTRO */}
      {!showBoard && (screen === 'intro' || screen === 'loading') && (
        <Center>
          <div className="font-display font-black text-2xl sm:text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">DINO SURVIVAL</div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase mb-3">Run · Escape · Survive</div>
          <p className="text-ink/70 text-[13px] leading-relaxed">
            A beast is hunting you through the jungle. <b className="text-ink">Run in place</b> to race down the trail and reach the waiting jeep before it catches you — faster running, faster getaway.
          </p>
          <ol className="text-left text-ink/80 text-[13px] leading-7 my-3 mx-auto max-w-[420px] list-decimal pl-5 marker:text-magic">
            <li>Stand back so your <b className="text-ink">hips, knees and feet</b> are in frame.</li>
            <li>Tilt your screen ~15° down so your legs stay visible.</li>
            <li>On <b className="text-fire-bright">RUN!</b>, run in place — pump your knees to go faster.</li>
            <li>Reach the jeep to escape, then beat your best time.</li>
          </ol>
          {note && <p className="text-fire-bright text-xs">{note}</p>}

          {/* Adventurer name + detected origin — tagged onto your leaderboard run. */}
          <div className="text-[11px] tracking-[0.16em] uppercase text-magic/80 mt-3 mb-2">Adventurer</div>
          <div className="flex items-center gap-2 mx-auto max-w-[420px]">
            <div className="relative flex-1">
              <input
                value={name}
                onChange={(e) => setNameState(e.target.value.slice(0, 40))}
                onBlur={(e) => setName(e.target.value)}
                placeholder="Name the legend…"
                maxLength={40}
                className="w-full py-2.5 pl-4 pr-10 rounded-xl bg-realm/50 border border-magic/30 text-ink placeholder:text-ink/40 focus:border-magic focus:outline-none focus:shadow-glow transition"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none" title={country || 'detecting origin'}>
                {country ? flagEmoji(country) : '🌐'}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-magic/60 mt-1.5 mb-1">
            {country ? <>Running for {flagEmoji(country)} {country} · saved on this device</> : 'Detecting your realm…'}
          </p>

          <div className="mb-4" />
          {screen === 'loading'
            ? <p className="text-magic/80 text-[13px]">Summoning the oracle… loading pose tracking</p>
            : (<div className="space-y-2">
                <button
                  onClick={() => { if (!name.trim()) { setNote('Name your adventurer first.'); return; } setName(name); startGame('camera'); }}
                  disabled={!name.trim()}
                  className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100">Start — enter the jungle (camera)</button>
                <div className="flex gap-2">
                  <button onClick={() => { if (!name.trim()) { setNote('Name your adventurer first.'); return; } setName(name); startGame('demo'); }} disabled={!name.trim()} className="flex-1 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-shield/40 hover:border-shield transition disabled:opacity-40 disabled:cursor-not-allowed">Demo (keyboard)</button>
                  <button onClick={() => setShowBoard(true)} className="px-4 py-2.5 rounded-xl font-semibold text-gold/90 bg-realm/50 border border-gold/30 hover:border-gold/60 transition">🏆 Ranks</button>
                  {onExit && <button onClick={onExit} className="px-4 py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">← Back</button>}
                </div>
                <p className="text-[11px] text-magic/60 pt-1">Demo: tap <kbd className="px-1.5 rounded bg-white/10 border border-white/20">F</kbd> / <kbd className="px-1.5 rounded bg-white/10 border border-white/20">J</kbd> alternately to run.</p>
              </div>)}
        </Center>
      )}

      {/* RESULT */}
      {screen === 'result' && result && (
        <Center>
          <div className="font-display font-black text-2xl sm:text-3xl">
            <span className={result.escaped ? 'text-gold' : 'text-fire-bright'}>{result.escaped ? 'ESCAPED' : 'CAUGHT'}</span>
          </div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-0.5 uppercase mb-1">{lvl.label}</div>
          <div className="grid grid-cols-2 gap-2 my-2.5">
            {result.escaped
              ? (<><RC k="Escape time" v={result.timeS.toFixed(1) + 's'} /><RC k="Personal best" v={best.escape != null ? best.escape.toFixed(1) + 's' : '—'} /></>)
              : (<><RC k="Distance reached" v={result.pct + '%'} /><RC k="Survived" v={result.timeS.toFixed(1) + 's'} /></>)}
          </div>
          {result.isNew && <p className="text-gold font-extrabold mb-1.5">New personal best!</p>}

          {/* Run analytics — cadence is the metric that improves running performance. */}
          {analytics && (
            <div className="my-3 w-full max-w-[420px] mx-auto">
              <div className="text-[11px] tracking-[0.2em] uppercase text-magic/70 mb-1.5">Run analytics</div>
              <div className="grid grid-cols-3 gap-2">
                <RC k="Avg cadence" v={analytics.avgCad + ' spm'} />
                <RC k="Peak" v={analytics.peakCad + ' spm'} />
                <RC k="Calories" v={'~' + analytics.cals} />
                <RC k="L / R balance" v={analytics.symL + ' / ' + (100 - analytics.symL)} />
                <RC k="Consistency" v={analytics.consistency + '%'} />
                <RC k="Active" v={analytics.activeS + 's'} />
              </div>
              <p className="text-[11px] text-magic/70 mt-2 leading-relaxed">
                {analytics.avgCad >= 170 ? 'Strong cadence — elite runners hold 170–180 spm.'
                  : analytics.avgCad > 0 ? `Try ~${Math.min(180, analytics.avgCad + 5)} spm next run — +5 spm is ~5% more efficient for the same effort.`
                  : 'Drive your knees higher to register a cadence.'}
                {Math.abs(analytics.symL - 50) >= 8 && ` Your stride leaned ${analytics.symL > 50 ? 'left' : 'right'} (${analytics.symL}/${100 - analytics.symL}) — aim for even.`}
              </p>
            </div>
          )}

          {/* Top escapes — preloaded from the submit response, so no extra call. */}
          {board && board.length > 0 && (
            <div className="my-3">
              <Leaderboard client={scores} level={level} label={lvl.label} rows={board.slice(0, 5)} compact />
            </div>
          )}

          <div className="flex gap-2 justify-center flex-wrap mt-1.5">
            <button onClick={() => startGame(G.current.mode || 'camera')} className="px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">Run again</button>
            <button onClick={shareClip} disabled={!clip || !clip.blob} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition disabled:opacity-40">Share clip</button>
            <button onClick={shareCard} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Share image</button>
            {onExit && <button onClick={onExit} className="px-4 py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">← Back</button>}
            <button onClick={downloadTelemetry} title="download run telemetry (debug)" className="px-3 py-2.5 rounded-xl font-semibold text-ink/50 bg-realm/40 border border-magic/20 hover:border-magic/50 transition text-xs">⬇ telemetry</button>
          </div>

          {/* Post to a social network — opens a link whose preview is the dynamic dino OG card. */}
          <div className="flex gap-1.5 justify-center flex-wrap items-center mt-2.5">
            <span className="text-[11px] text-magic/60 mr-0.5">Post to:</span>
            {[['x', 'X'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp']].map(([k, label]) => (
              <button key={k} onClick={() => onSocial(k, label)} className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold text-magic bg-realm/60 border border-magic/30 hover:bg-realm/90 hover:border-magic/60 transition">{label}</button>
            ))}
            <button onClick={onCopyLink} className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold text-magic bg-realm/60 border border-magic/30 hover:bg-realm/90 hover:border-magic/60 transition">Copy link</button>
          </div>
          {shareNote && <p className="text-[12px] text-magic/80 mt-2">{shareNote}</p>}
          <p className="text-[10px] text-magic/40 mt-1 leading-relaxed">X / Facebook / LinkedIn open a link preview of your result card. “Share clip” &amp; “Share image” post the file directly — the share sheet on mobile (Instagram, WhatsApp, X…) or a download on desktop.</p>
          {(!clip || !clip.blob) && <p className="text-[11px] text-magic/60 mt-2">clip capture unavailable on this browser</p>}
        </Center>
      )}
    </div>
  );
}

const Stat = ({ v, k }) => (
  <div className="panel px-3 py-2 min-w-[74px] text-center">
    <div className="font-black text-xl leading-none text-ink">{v}</div>
    <div className="text-[9px] tracking-[0.14em] uppercase text-magic/70 mt-1">{k}</div>
  </div>
);

// Small "run in place" stick-figure for calibration — always animates the run so
// it demos what to do, and turns GREEN once your whole body is in frame.
const RunnerFigure = ({ ready }) => (
  <svg viewBox="0 0 100 150" className="w-14 h-20 mx-auto" style={{ color: ready ? '#36ef76' : '#cdb3ff' }} aria-hidden="true">
    <style>{`
      @keyframes df_bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
      @keyframes df_lA{0%,100%{transform:rotate(26deg)}50%{transform:rotate(-26deg)}}
      @keyframes df_lB{0%,100%{transform:rotate(-26deg)}50%{transform:rotate(26deg)}}
      @keyframes df_aA{0%,100%{transform:rotate(-36deg)}50%{transform:rotate(36deg)}}
      @keyframes df_aB{0%,100%{transform:rotate(36deg)}50%{transform:rotate(-36deg)}}
      .df_fig{animation:df_bob .5s infinite ease-in-out}
      .df_lA,.df_lB,.df_aA,.df_aB{transform-box:view-box}
      .df_lA{transform-origin:50px 88px;animation:df_lA .5s infinite ease-in-out}
      .df_lB{transform-origin:50px 88px;animation:df_lB .5s infinite ease-in-out}
      .df_aA{transform-origin:50px 48px;animation:df_aA .5s infinite ease-in-out}
      .df_aB{transform-origin:50px 48px;animation:df_aB .5s infinite ease-in-out}
    `}</style>
    <g className="df_fig" stroke="currentColor" strokeWidth="7" strokeLinecap="round" fill="none">
      <circle cx="50" cy="18" r="12" fill="currentColor" stroke="none" />
      <line x1="50" y1="30" x2="50" y2="88" />
      <line className="df_aA" x1="50" y1="48" x2="74" y2="66" />
      <line className="df_aB" x1="50" y1="48" x2="26" y2="66" />
      <line className="df_lA" x1="50" y1="88" x2="64" y2="130" />
      <line className="df_lB" x1="50" y1="88" x2="36" y2="130" />
    </g>
  </svg>
);
const RC = ({ k, v }) => (
  <div className="rounded-xl bg-realm/60 border border-magic/20 p-2.5">
    <div className="text-[10px] tracking-[0.14em] uppercase text-magic/70">{k}</div>
    <div className="font-black text-2xl mt-0.5 text-ink">{v}</div>
  </div>
);
const Center = ({ children }) => (
  <div className="absolute inset-0 z-[20] flex items-center justify-center p-2 sm:p-4">
    {/* landscape-phone friendly: cap height + scroll so it never overflows a short viewport */}
    <div className="panel p-3.5 sm:p-6 w-[min(96vw,560px)] max-h-[94dvh] overflow-y-auto text-center">{children}</div>
  </div>
);
