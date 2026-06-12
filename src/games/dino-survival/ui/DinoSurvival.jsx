// ===========================================================================
// Dino Survival — top-level screen. Wires the one-directional pipeline:
//   pose -> runDetector (cadence) -> survival engine -> scene (canvas) + HUD.
// Canvas-2D rendering (the PoC look), React only for screens/HUD/overlays.
// ===========================================================================
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { LEVELS, DEFAULT_LEVEL } from '../config.js';
import { createRunDetector, framed, playerMetrics } from '../vision/runDetector.js';
import { createPoseSource } from '../vision/poseSource.js';
import { createPlayerCutout } from '../vision/cutout.js';
import { createSurvival } from '../engine/survival.js';
import { createScene } from '../render/scene.js';
import { loadAssets } from '../render/assets.js';
import { createReplayBuffer } from '../../../recording/replayBuffer.js';
// Best-score persistence lives behind one module: instant localStorage cache +
// best-effort sync through /api/score (Neon). See src/net/scores.js.
import { dinoScores as scores } from '../../../net/gameClients.js';
import { getName, setName, getCountry, setCountry as persistCountry, flagEmoji } from '../../../net/identity.js';
import Leaderboard from '../../../ui/Leaderboard.jsx';

export default function DinoSurvival({ onExit }) {
  const canvasRef = useRef(null), videoRef = useRef(null), caughtVideoRef = useRef(null), G = useRef({});
  const [screen, setScreen] = useState('intro');         // intro | loading | playing | result
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [hud, setHud] = useState({ t: 0, pace: 0, spm: 0, distPct: 0 });
  const [calib, setCalib] = useState(null);              // { msg, sub, ok } | null
  const [legsWarn, setLegsWarn] = useState(false);
  const [result, setResult] = useState(null);
  const [best, setBest] = useState(() => scores.getCachedBest(DEFAULT_LEVEL));
  const [showRig, setShowRig] = useState(true);
  const [clip, setClip] = useState(null);
  const [note, setNote] = useState('');
  const [dbg, setDbg] = useState(null);                  // telemetry/debug readout (null = off)
  const [name, setNameState] = useState(() => getName());     // player display name (cookie-backed)
  const [country, setCountry] = useState(() => getCountry());  // ISO-2, detected at play start
  const [showBoard, setShowBoard] = useState(false);           // leaderboard overlay on intro
  const [board, setBoard] = useState(null);                    // top rows from last submit (no extra call)

  // teardown
  const teardown = useCallback(() => {
    const g = G.current; if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    if (g.demoTimer) clearInterval(g.demoTimer);
    if (g.caughtTimer) clearTimeout(g.caughtTimer);
    try { caughtVideoRef.current && caughtVideoRef.current.pause(); } catch {}
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
    const assets = await loadAssets();
    const cv = canvasRef.current; const ctx = cv.getContext('2d');
    const fit = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; }; fit();
    const det = createRunDetector(), surv = createSurvival(LEVELS[level]), scene = createScene(assets), cutout = createPlayerCutout();
    let phase = mode === 'camera' ? 'calibrating' : 'countdown';
    let countTo = 0, calStart = 0, lastT = performance.now(), camNear = 0, bgPos = 0, escDone = false;
    let latestLM = null, latestVid = null, latestMask = null, pm = null, pace = 0, spm = 0, buildTick = 0;

    const g = G.current = { mode, ctx, cv, det, surv, scene, cutout, fit };
    window.addEventListener('resize', fit);

    // pose / demo input
    if (mode === 'camera') {
      try {
        const pose = createPoseSource(videoRef.current); g.pose = pose;
        await pose.startCamera(); await pose.init();
        pose.start((lm, vid, mask) => {
          latestLM = lm; latestVid = vid; latestMask = mask;
          if (mask && vid && buildTick++ % 2 === 0) cutout.build(vid, mask);   // rebuild cutout at ~half rate (frees CPU)
          if (phase === 'calibrating') {
            if (framed(lm)) { if (!calStart) calStart = performance.now(); det.calibrate(lm);
              setCalib({ msg: 'Stand tall & still', sub: 'Capturing your standing pose…', ok: true });
              if (performance.now() - calStart > 1200) { phase = 'countdown'; countTo = performance.now() + 3000; setCalib(null); }
            } else { calStart = 0; setCalib({ msg: 'Step back', sub: 'Get your hips, knees AND feet in frame', ok: false }); }
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
      replay.start({ video: mode === 'camera' ? videoRef.current : null, pixiCanvas: cv, demoBg: mode === 'demo' ? true : null }); } catch { g.replay = null; }

    surv.reset();
    setScreen('playing');
    let hudAcc = 0;

    const loop = () => {
      const now = performance.now(); const dt = Math.min(60, now - lastT); lastT = now; const W = cv.width, H = cv.height;
      const lm = latestLM;
      const c = mode === 'camera' ? det.update(lm, now) : det.update(null, now);
      pace = c.pace; spm = c.spm; pm = playerMetrics(lm);
      const legsOK = mode !== 'camera' || framed(lm);
      const warn = mode === 'camera' && phase === 'running' && !legsOK; setLegsWarn(warn);

      if (phase === 'countdown' && countTo - now <= 0) { phase = 'running'; }
      if (phase === 'running' && legsOK) {
        const s = surv.step(pace, dt);
        if (s.phase === 'escaped') { phase = 'escaped'; scene.beginEscape(now); }
        else if (s.phase === 'caught') { phase = 'caught'; playCaught(); }
      }
      const snap = surv.snapshot();

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
        const done = scene.drawEscape(ctx, W, H, groundY, now, cutout, pm);
        if (done && !escDone) { escDone = true; finish(); }
      } else {
        const near = scene.drawDino(ctx, W, H, groundY, snap.gap, now);
        camNear += (near - camNear) * 0.12;                 // smoothed closeness for the camera
        // Player: live segmentation cutout + rig overlay. We know the composite
        // looks pasted-on (different light/perspective from the painted scene) and
        // will replace it with the Grok-learned avatar — but keep it visible for
        // now so tracking is verifiable. Rig toggles via the HUD button.
        if (cutout.has()) { cutout.draw(ctx, W, H, groundY, pm, 1, 0.5); if (showRig) cutout.drawRig(ctx, W, H, groundY, pm, lm); }
        else scene.drawSilhouette(ctx, W, H, groundY, pace, now);
        // (side foliage props removed — they showed hard rectangular edges.)
        if (near > 0.74) { ctx.fillStyle = `rgba(180,20,30,${(near - 0.74) * 0.8})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
      }
      if (g.debug) scene.drawGuides(ctx, W, H);            // ground + vanishing-point guides (ride with the camera)
      // countdown overlay (inside the camera so it rides along too)
      if (phase === 'countdown') { const n = Math.ceil((countTo - now) / 1000); ctx.fillStyle = 'rgba(7,6,15,.4)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '900 120px system-ui'; ctx.fillText(n > 0 ? n : 'RUN!', W / 2, H / 2 + 30); }
      scene.endCamera(ctx);
      // speed lines stream in screen space, on top of the moving frame (top-speed accent).
      if (phase !== 'escaped') scene.drawSpeedLines(ctx, W, H, pace, now);

      hudAcc += dt; if (hudAcc > 100) { hudAcc = 0; setHud({ t: snap.t, pace, spm, distPct: snap.distPct });
        if (g.debug) { const gr = scene.getGround(); const nF = (assets.bgLoop && assets.bgLoop.length) || 1;
          setDbg({ pace: +pace.toFixed(2), spm, gap: +snap.gap.toFixed(2), near: +camNear.toFixed(2), dist: Math.round(snap.distPct * 100),
            bg: Math.floor(bgPos) % nF, legs: (mode !== 'camera' || framed(lm)), phase,
            g: gr.gFrac.toFixed(2), t: gr.tFrac.toFixed(2), a: gr.bgAnchor.toFixed(2) }); }
      }

      if (phase !== 'caught' && phase !== 'done') g.raf = requestAnimationFrame(loop);
    };

    // Caught -> play the dino-capture sting fullscreen, THEN show the result.
    function playCaught() {
      const v = caughtVideoRef.current;
      if (!v) { finish(); return; }
      setScreen('caught');
      const done = () => { v.removeEventListener('ended', done); if (G.current.caughtTimer) clearTimeout(G.current.caughtTimer); finish(); };
      v.addEventListener('ended', done);
      try { v.currentTime = 0; const p = v.play(); if (p && p.catch) p.catch(() => done()); } catch { done(); }
      G.current.caughtTimer = setTimeout(done, 5200);   // safety if 'ended' doesn't fire
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
      let cl = null; try { cl = G.current.replay && G.current.replay.getLastClip(); G.current.replay && G.current.replay.stop(); } catch {}
      setClip(cl || null);
      phase = 'done'; setScreen('result');
    }

    g.raf = requestAnimationFrame(loop);
  }

  // ---- share helpers ----
  async function dlOrShare(blob, name, title) {
    const file = new File([blob], name, { type: blob.type });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; } } catch {}
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function shareCard() {
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
    c.toBlob(b => dlOrShare(b, 'slayfit-dino-survival.png', 'SlayFit Dino Survival'), 'image/png');
  }
  function shareClip() { if (!clip || !clip.blob) return; dlOrShare(clip.blob, 'slayfit-dino-survival.webm', 'My Dino Survival run'); }

  const lvl = LEVELS[level];

  return (
    <div className="fixed inset-0 overflow-hidden bg-realm text-ink font-body">
      {/* ambient (shown on intro; the live scene covers it during play) */}
      <img src="/assets/dino-survival/bg/trail.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-[rgb(var(--realm-rgb)/.45)] via-[rgb(var(--realm-rgb)/.78)] to-[rgb(var(--realm-rgb)/.96)]" />
      <video ref={videoRef} playsInline muted className="absolute -left-[9999px] -top-[9999px]" />
      {/* caught cutscene: dino capture sting, shown only while screen === 'caught' */}
      <video ref={caughtVideoRef} src="/assets/dino-survival/cut/caught.mp4" playsInline muted preload="auto"
        className={`absolute inset-0 w-full h-full object-cover bg-black z-[15] ${screen === 'caught' ? '' : 'hidden'}`} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* telemetry / grounding tuner (toggle with 'G') */}
      {dbg && (
        <div className="absolute bottom-3 left-3 z-[20] font-mono text-[11px] leading-relaxed text-emerald-200 bg-black/70 border border-emerald-400/30 rounded-lg px-3 py-2 pointer-events-none">
          <div className="text-emerald-300 font-bold mb-1">TELEMETRY · {dbg.phase}</div>
          <div>pace {dbg.pace} · spm {dbg.spm} · legs {dbg.legs ? 'OK' : '—'}</div>
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

      {screen === 'playing' && (
        <>
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 text-center z-[5]" style={{ textShadow: '0 2px 10px #000' }}>
            <div className="font-black text-3xl text-gold tabular-nums text-glow">{hud.t.toFixed(1)}</div>
            <div className="text-[9px] tracking-[0.22em] uppercase text-ink/80">seconds</div>
          </div>
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
            <div className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2 z-[6] text-center rounded-xl px-4 py-2.5 font-extrabold text-white border border-fire/60" style={{ background: 'rgb(var(--fire-rgb)/.85)' }}>
              Step back — get your knees &amp; feet in frame
              <div className="text-[11px] font-medium opacity-90 mt-0.5">the detector can't read your stride otherwise</div>
            </div>
          )}
          {calib && (
            <div className="absolute left-1/2 bottom-[14%] -translate-x-1/2 text-center z-[6]">
              <div className="panel px-5 py-3">
                <div className="text-base font-bold text-ink">{calib.msg}</div>
                <div className={`text-xs mt-0.5 ${calib.ok ? 'text-shield' : 'text-magic/70'}`}>{calib.sub}</div>
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
          <div className="font-display font-black text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">DINO SURVIVAL</div>
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

          <div className="text-[11px] tracking-[0.16em] uppercase text-magic/80 mt-3 mb-2">Difficulty</div>
          <div className="flex gap-2 justify-center flex-wrap mb-4">
            {Object.values(LEVELS).map(L => (
              <button key={L.key} onClick={() => setLevel(L.key)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${level === L.key ? 'bg-magic/30 border-magic text-white shadow-glow' : 'bg-realm/40 border-magic/30 text-ink/80 hover:border-magic/60'}`}>{L.label}</button>
            ))}
          </div>
          {screen === 'loading'
            ? <p className="text-magic/80 text-[13px]">Summoning the oracle… loading pose + segmentation</p>
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
          <div className="font-display font-black text-3xl">
            <span className={result.escaped ? 'text-gold' : 'text-fire-bright'}>{result.escaped ? 'ESCAPED' : 'CAUGHT'}</span>
          </div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase mb-1">{lvl.label}</div>
          <div className="grid grid-cols-2 gap-2.5 my-4">
            {result.escaped
              ? (<><RC k="Escape time" v={result.timeS.toFixed(1) + 's'} /><RC k="Personal best" v={best.escape != null ? best.escape.toFixed(1) + 's' : '—'} /></>)
              : (<><RC k="Distance reached" v={result.pct + '%'} /><RC k="Survived" v={result.timeS.toFixed(1) + 's'} /></>)}
          </div>
          {result.isNew && <p className="text-gold font-extrabold mb-1.5">New personal best!</p>}

          {/* Top escapes — preloaded from the submit response, so no extra call. */}
          {board && board.length > 0 && (
            <div className="my-3">
              <Leaderboard client={scores} level={level} label={lvl.label} rows={board.slice(0, 5)} compact />
            </div>
          )}

          <div className="flex gap-2 justify-center flex-wrap mt-1.5">
            <button onClick={() => startGame(G.current.mode || 'camera')} className="px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">Run again</button>
            <button onClick={shareCard} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Share card</button>
            <button onClick={shareClip} disabled={!clip || !clip.blob} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition disabled:opacity-40">Share 10s clip</button>
            {onExit && <button onClick={onExit} className="px-4 py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">← Back</button>}
          </div>
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
const RC = ({ k, v }) => (
  <div className="rounded-xl bg-realm/60 border border-magic/20 p-2.5">
    <div className="text-[10px] tracking-[0.14em] uppercase text-magic/70">{k}</div>
    <div className="font-black text-2xl mt-0.5 text-ink">{v}</div>
  </div>
);
const Center = ({ children }) => (
  <div className="absolute inset-0 z-[8] flex items-center justify-center p-4">
    <div className="panel p-7 w-[min(94vw,520px)] text-center">{children}</div>
  </div>
);
