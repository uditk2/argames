// ===========================================================================
// Keeper (AR goalkeeping) — top-level screen. Wires the one-directional pipe:
//   pose -> keeper geometry -> engine (shooter/ball/ramp/clear) -> canvas + HUD.
// Canvas-2D rendering; React only for screens / HUD / overlays. Mirrors the
// Dino Survival module's structure (intro -> loading -> playing -> result),
// and calls onExit() to return to the menu. Score = LEVELS CLEARED (save >=60%
// of each level's shots to advance; drop below and the run ends).
// ===========================================================================
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { KEEPER_LEVEL, KEEPER, levelCurve, RAMP, CLEAR_THRESHOLD } from '../config.js';
import { createPoseSource } from '../vision/poseSource.js';
import { createKeeperEngine } from '../engine/keeperEngine.js';
import { goalRect, keeperPoint, keeperSave, vis } from '../engine/geometry.js';
import { drawBackground, drawGoal, drawShooter, drawKeeper, drawBall, drawImpact, preloadAssets } from '../render/scene.js';
import { createKeeperAudio } from '../assets/sounds.js';
import { KEEPER_THEME } from '../theme.js';
import { icon } from '../theme/icons.js';
import { createReplayBuffer } from '../../../recording/replayBuffer.js';
import { keeperScores as scores } from '../../../net/gameClients.js';
import { getName, setName, getCountry, setCountry as persistCountry, flagEmoji } from '../../../net/identity.js';
import Leaderboard from '../../../ui/Leaderboard.jsx';
import { shareFile, downloadBlob } from '../../../sharing/share.js';
import { openSocialShare, copyShareLink, shareText } from '../../../sharing/socialShare.js';

const IS_PHONE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent || '');
const COL = KEEPER_THEME.colors;

export default function Keeper({ onExit }) {
  const canvasRef = useRef(null), videoRef = useRef(null), G = useRef({});
  const sfxRef = useRef(null);
  const [audioMuted, setAudioMuted] = useState(() => { try { return localStorage.getItem('slayfit_keeper_muted') === '1'; } catch { return false; } });
  const [camMode, setCamMode] = useState(false);
  const [screen, setScreen] = useState('intro');     // intro | loading | playing | result
  const [hud, setHud] = useState({ saves: 0, shots: 0, level: 1, levelsCleared: 0, savePct: 0, savesThisLevel: 0, shotsThisLevel: 0, need: CLEAR_THRESHOLD });
  const [calib, setCalib] = useState(null);          // { msg, sub, ok } | null
  const [banner, setBanner] = useState(null);        // { kind, text } | null transient
  const [result, setResult] = useState(null);
  const [best, setBest] = useState(() => scores.getCachedBest(KEEPER_LEVEL));
  const [clip, setClip] = useState(null);
  const [note, setNote] = useState('');
  const [name, setNameState] = useState(() => getName());
  const [country, setCountry] = useState(() => getCountry());
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState(null);
  const [shareNote, setShareNote] = useState('');

  const teardown = useCallback(() => {
    const g = G.current; if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    try { sfxRef.current && sfxRef.current.stopAll(); } catch {}
    if (g.clipUrl) { try { URL.revokeObjectURL(g.clipUrl); } catch {} }
    try { g.pose && g.pose.dispose(); } catch {}
    try { g.replay && g.replay.stop(); } catch {}
    if (g.onResize) window.removeEventListener('resize', g.onResize);
    if (g.onKey) window.removeEventListener('keydown', g.onKey);
    G.current = {};
  }, []);
  useEffect(() => teardown, [teardown]);

  // Best-score hydration + country detection in one server call (as dino does).
  useEffect(() => {
    setBest(scores.getCachedBest(KEEPER_LEVEL));
    let live = true;
    scores.fetchState(KEEPER_LEVEL).then((st) => {
      if (!live || !st) return;
      if (st.best) setBest(scores.reconcile(KEEPER_LEVEL, st.best));
      if (st.country) { persistCountry(st.country); setCountry(st.country); }
    });
    return () => { live = false; };
  }, []);

  function flashBanner(kind, text, ms = 850) {
    setBanner({ kind, text });
    const g = G.current; if (g.bannerT) clearTimeout(g.bannerT);
    g.bannerT = setTimeout(() => setBanner(null), ms);
  }

  async function startGame(mode) {
    teardown(); setScreen('loading'); setNote(''); setResult(null); setClip(null); setCamMode(mode === 'camera');
    preloadAssets();
    const cv = canvasRef.current; const ctx = cv.getContext('2d');
    const fit = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; }; fit();

    const eng = createKeeperEngine();
    const g = G.current = { mode, ctx, cv, eng, onResize: fit };
    window.addEventListener('resize', fit);

    // audio
    const sfx = sfxRef.current || (sfxRef.current = createKeeperAudio()); sfx.setMuted(audioMuted); g.sfx = sfx;

    // engine -> sound + banner hooks
    eng.setResolveHook((r) => {
      if (r.result === 'save') {
        sfx.play('save', 0.85); flashBanner('save', KEEPER_THEME.labels.save);
        // remember contact + part so the renderer can flash/flare the strike.
        if (r.contact) { g.lastContact = r.contact; g.lastPart = r.part; g.contactAt = performance.now(); }
      } else { sfx.play('goal', 0.9); flashBanner('goal', KEEPER_THEME.labels.goal); }
    });
    g.lastLevel = 1; g.lastCleared = 0; g.lastContact = null; g.lastPart = null; g.contactAt = 0;

    // pose state
    let latestLM = null, latestVid = null, leanBase = 0.5, phase = mode === 'camera' ? 'calibrating' : 'countdown';
    let countTo = 0;
    // current level's tuned curve (goal width, keeper reach/lean, etc.). These
    // shrink the keeper + widen the goal as levels climb. Refreshed each frame
    // from the engine snapshot so geometry tracks the live level.
    let lc = levelCurve(1);
    let widthFrac = lc.widthFrac;

    // keeper geometry, fed to the engine's save test + the renderer. reach +
    // leanAmp are LEVEL-DRIVEN (shrink with level) so coverage shrinks.
    const goalForNow = () => goalRect(cv.width, cv.height, widthFrac);
    const kp = (i) => keeperPoint(latestLM, i, goalForNow(), leanBase, lc.reach, lc.leanAmp);
    const saveTest = (bx, by, ballR) => keeperSave(latestLM, bx, by, ballR, goalForNow(), leanBase, cv.height, lc.reach, lc.leanAmp);

    // pose / demo input
    if (mode === 'camera') {
      try {
        const pose = createPoseSource(videoRef.current); g.pose = pose;
        await pose.startCamera(); await pose.init();
        pose.start((lm, vid) => {
          latestLM = lm; latestVid = vid;
          // recentre the lean baseline between shots; freeze during flight so a
          // deliberate lean still counts as a dive.
          if (lm && (eng.phase !== 'fly')) {
            const mxh = (lm[23].x + lm[24].x) / 2;
            leanBase += (mxh - leanBase) * KEEPER.LEAN_RECENTER;
          }
          if (phase === 'calibrating') evaluateReady(lm);
        });
      } catch (e) {
        setNote(location.protocol === 'file:' ? 'Camera needs localhost (serve.command).' : ('Camera unavailable: ' + (e.message || e)));
        setScreen('intro'); teardown(); return;
      }
    } else {
      // demo: a simple bot keeper that auto-saves ~60% so the loop is watchable
      countTo = performance.now() + 3000;
    }

    // ready gate (camera): head + shoulders + both arms visible, room to reach.
    let steadyMs = 0, lastReadyTs = 0;
    function visOK(lm, i) { const v = lm[i] && lm[i].visibility; return v == null ? true : v > 0.4; }
    function evaluateReady(lm) {
      if (!lm) { setCalib({ msg: 'Step into frame', sub: 'let the camera see your head, shoulders and arms', ok: false }); return; }
      const now = performance.now(); const dt = lastReadyTs ? (now - lastReadyTs) : 16; lastReadyTs = now;
      const visC = visOK(lm, 11) && visOK(lm, 12) && visOK(lm, 0) && visOK(lm, 23) && visOK(lm, 24) && lm[0].y > 0.03;
      const arms = visOK(lm, 15) && visOK(lm, 16);
      const sw = Math.abs(lm[11].x - lm[12].x); const room = sw > 0.10 && sw < 0.42;
      const ok = visC && arms && room;
      if (ok) {
        steadyMs += dt;
        setCalib({ msg: 'Hold it…', sub: `${Math.max(0, (800 - steadyMs) / 1000).toFixed(1)}s`, ok: true });
        if (steadyMs > 800) { setCalib(null); phase = 'countdown'; countTo = performance.now() + 3000; }
      } else {
        steadyMs = 0;
        setCalib({ msg: !visC ? 'Step back' : !arms ? 'Raise both arms' : sw <= 0.10 ? 'Step closer' : 'Step back a little',
          sub: !visC ? 'show your head & shoulders' : !arms ? 'both arms into frame' : 'room to reach & lean', ok: false });
      }
    }

    // replay buffer (webcam + scene composited, with the small webcam inset)
    try {
      const replay = createReplayBuffer(); g.replay = replay;
      replay.start({ video: mode === 'camera' ? videoRef.current : null, pixiCanvas: cv, demoBg: mode === 'demo' ? true : null, webcamInset: true });
    } catch { g.replay = null; }

    setScreen('playing');
    if (mode === 'camera') setCalib({ msg: 'Get in your goal', sub: IS_PHONE ? 'set your phone back so your upper body shows' : 'stand back so your arms & torso are in frame', ok: false });
    sfx.unlock(); sfx.resume();   // unlock() on the Start gesture. (Background music disabled — event SFX only.)
    let hudAcc = 0, lastT = performance.now(), lastCount = -1;

    const loop = () => {
      const now = performance.now(); const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
      const W = cv.width, H = cv.height;
      const snap0 = eng.snapshot();
      lc = snap0.curve;                 // live level curve (goal width, reach, lean)
      widthFrac = lc.widthFrac;
      const goal = goalForNow();
      eng.setStage(W, H, goal);
      // level-up cue: fire when the count of cleared levels climbs.
      if (snap0.levelsCleared > (g.lastCleared || 0)) {
        g.lastCleared = snap0.levelsCleared;
        sfx.play('levelup', 0.8); sfx.play('cheer');
        flashBanner('level', `${KEEPER_THEME.labels.levelUp} ${snap0.level}`, 900);
      }

      // ---- phase transitions ----
      if (phase === 'countdown') {
        if (mode === 'camera' && !latestLM) {
          // the keeper stepped out — don't start; wait for them to stand back in.
          phase = 'calibrating'; steadyMs = 0; lastCount = -1;
          setCalib({ msg: 'Waiting for you', sub: 'step back into frame and stand ready', ok: false });
        } else {
          const n = Math.ceil((countTo - now) / 1000);
          if (n !== lastCount && n > 0) { lastCount = n; sfx.play('countdown'); }   // 3..2..1 beeps
          if (countTo - now <= 0) { phase = 'play'; eng.start(now); sfx.play('whistle', 0.7); sfx.play('go'); flashBanner('go', KEEPER_THEME.labels.incoming, 800); }
        }
      }
      if (phase === 'play') {
        // demo: synth a save outcome by nudging a virtual keeper toward the ball.
        eng.update(dt, now, mode === 'camera' ? saveTest : demoSaveTest);
        if (eng.phase === 'over') { phase = 'done'; finish(); }
      }

      // ---- render ----
      const lvl = snap0.level;
      const ball = eng.ballState();
      const shooter = eng.shooterState();
      ctx.clearRect(0, 0, W, H);
      drawBackground(ctx, W, H, lvl, now);
      drawGoal(ctx, goal, lvl);
      // The shooter stands far up-pitch and kicks the ball toward us — drawn
      // behind the keeper + ball so the ball reads as flying out from its foot.
      drawShooter(ctx, shooter, H, now);
      // flare the limb that just made the save for the duration of the deflect.
      const deflecting = ball && ball.st === 'deflect';
      const flare = (deflecting && g.lastPart != null)
        ? { part: g.lastPart, k: 1 - (ball.k || 0) }    // bright at impact, fades out
        : null;
      if (latestLM && phase !== 'calibrating') drawKeeper(ctx, latestLM, kp, H, flare);
      drawBall(ctx, ball, now);
      // impact flash ring at the contact point during the deflect window.
      if (deflecting && g.lastContact) drawImpact(ctx, g.lastContact, ball.k || 0, H);

      // countdown overlay
      if (phase === 'countdown') {
        const n = Math.ceil((countTo - now) / 1000);
        ctx.fillStyle = 'rgba(7,6,15,.4)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '900 120px system-ui';
        ctx.fillText(n > 0 ? String(n) : 'GO', W / 2, H / 2 + 30);
      }
      // calibration: dim + draw self-view inset
      if (phase === 'calibrating') { ctx.fillStyle = 'rgba(7,6,15,0.55)'; ctx.fillRect(0, 0, W, H); drawCalibInset(ctx, W, H, latestLM, latestVid); }

      hudAcc += dt; if (hudAcc > 0.1) { hudAcc = 0; const s = eng.snapshot(); setHud({ saves: s.saves, shots: s.shots, level: s.level, levelsCleared: s.levelsCleared, savePct: s.savePct, savesThisLevel: s.savesThisLevel, shotsThisLevel: s.shotsThisLevel, need: s.need }); }

      if (phase !== 'done') g.raf = requestAnimationFrame(loop);
    };

    // demo keeper: deterministic-ish auto-save (~68% so it usually clears the
    // 60% gate), so the demo is watchable. Synthesizes a contact point near the
    // ball so the deflect + impact cue still play in demo mode.
    function demoSaveTest(bx, by, ballR) {
      const saved = Math.random() < 0.68;
      if (!saved) return { saved: false, dist: 40 + Math.random() * 80 };
      const ang = Math.random() * Math.PI * 2;
      const off = ballR * 0.6;
      return { saved: true, dist: 0, contact: { x: bx + Math.cos(ang) * off, y: by + Math.sin(ang) * off }, part: 'torso' };
    }

    function finish() {
      if (G.current.finished) return; G.current.finished = true;
      const r = eng.result();
      const durationSec = r.events.length ? Math.max(1, Math.round(r.shots * 1.4)) : 0;
      // SCORE = levels cleared (leaderboard metric). saves/shots/savePct/level secondary.
      const finalState = { score: r.score, levelsCleared: r.levelsCleared, timeS: durationSec, durationSec, saves: r.saves, shots: r.shots, savePct: r.savePct, level: r.level };
      setResult(finalState);
      sfx.play('whistle', 0.7); try { sfx.stopAmbience(); } catch {}   // final whistle, fade the crowd

      const { best: b, improved } = scores.mergeLocalBest(KEEPER_LEVEL, { score: r.score, timeS: durationSec });
      setBest(b); finalState.isNew = improved;
      scores.submitRun(KEEPER_LEVEL, { score: r.score, timeS: durationSec }, { player: getName() || null, country: getCountry() })
        .then((srv) => {
          if (!srv) return;
          if (srv.best) setBest(scores.reconcile(KEEPER_LEVEL, srv.best));
          if (srv.country) { persistCountry(srv.country); setCountry(srv.country); }
          if (srv.leaderboard) setBoard(srv.leaderboard);
          setResult((prev) => (prev && prev.score === r.score ? { ...prev, isNew: srv.isPB } : prev));
        });

      // replay clip — the shared end-card renderer is dino-specific, so we let
      // the clip finish on the live keeper scene and grab the last window.
      (async () => {
        const rep = G.current.replay; let cl = null;
        try {
          if (rep) {
            await new Promise((res) => setTimeout(res, 600));   // let the final SAVE/GOAL frame settle
            cl = await rep.getLastClip(); rep.stop();
          }
        } catch {}
        setClip(cl || null); G.current.clipUrl = cl ? cl.url : null;
      })();

      G.current.finalState = finalState;
      setScreen('result');
    }

    // --- guided calibration inset (webcam + skeleton + coaching) -------------
    function roundRect(c, x, y, w, h, rr) { c.beginPath(); c.moveTo(x + rr, y); c.arcTo(x + w, y, x + w, y + h, rr); c.arcTo(x + w, y + h, x, y + h, rr); c.arcTo(x, y + h, x, y, rr); c.arcTo(x, y, x + w, y, rr); c.closePath(); }
    function drawSkeleton(c, lm, map, col) {
      const bones = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];
      c.save(); c.lineWidth = 3; c.strokeStyle = col; c.lineCap = 'round'; c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 4;
      for (const [a, b] of bones) { const pa = map(lm[a]), pb = map(lm[b]); if (pa && pb && pa.v && pb.v) { c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke(); } }
      c.fillStyle = col;
      for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const p = map(lm[i]); if (p && p.v) { c.beginPath(); c.arc(p.x, p.y, 4.2, 0, 7); c.fill(); } }
      c.restore();
    }
    function drawCalibInset(c, W, H, lm, vidEl) {
      const bw = Math.min(W * 0.72, 300), bh = bw * 3 / 4;
      const bx = (W - bw) / 2, by = H * 0.42 - bh / 2, r = 18;
      const armsV = lm && lm[15] && lm[16];
      let big = calib?.msg || 'Get in your goal', sub = calib?.sub || '', good = !!calib?.ok;
      const col = good ? '#36ef76' : '#ffb627';
      c.save(); roundRect(c, bx, by, bw, bh, r); c.clip();
      c.fillStyle = '#0a0510'; c.fillRect(bx, by, bw, bh);
      let map = () => null;
      if (vidEl && vidEl.readyState >= 2 && vidEl.videoWidth) {
        const vw = vidEl.videoWidth, vh = vidEl.videoHeight;
        const s = Math.max(bw / vw, bh / vh), rw = vw * s, rh = vh * s;
        const ox = bx + (bw - rw) / 2, oy = by + (bh - rh) / 2;
        c.save(); c.translate(bx + bw, by); c.scale(-1, 1); c.drawImage(vidEl, (bw - rw) / 2, (bh - rh) / 2, rw, rh); c.restore();
        map = (p) => p ? { x: ox + p.x * rw, y: oy + p.y * rh, v: (p.visibility == null || p.visibility > 0.4) } : null;
      }
      if (lm) drawSkeleton(c, lm, map, col);
      const grd = c.createLinearGradient(0, by + bh - 66, 0, by + bh); grd.addColorStop(0, 'rgba(7,6,15,0)'); grd.addColorStop(1, 'rgba(7,6,15,.9)');
      c.fillStyle = grd; c.fillRect(bx, by + bh - 66, bw, 66);
      c.textAlign = 'center'; c.fillStyle = good ? '#7dffa0' : '#fff'; c.font = '800 22px system-ui'; c.fillText(big, bx + bw / 2, by + bh - 30);
      c.fillStyle = 'rgba(255,255,255,.82)'; c.font = '600 12px system-ui'; c.fillText(sub, bx + bw / 2, by + bh - 13);
      c.restore();
      c.save(); roundRect(c, bx, by, bw, bh, r); c.lineWidth = 3; c.strokeStyle = col; c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 16; c.stroke(); c.restore();
    }

    g.raf = requestAnimationFrame(loop);
  }

  // ---- share helpers ----
  // headline = levels cleared (reach level X); save% + saves/shots are secondary.
  const keeperStats = () => ({ g: 'keeper', levelsCleared: result ? (result.levelsCleared ?? result.score ?? 0) : 0, saves: result ? result.saves : 0, shots: result ? result.shots : 0, savePct: result ? result.savePct : 0, timeS: result ? result.durationSec : 0, level: result ? result.level : 1 });
  const noteMethod = (m) => (m === 'share' ? 'Shared!' : m === 'download' ? 'Downloaded (share sheet unavailable)' : 'Sharing not supported here');

  function buildCardBlob() {
    return new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const g = c.getContext('2d');
      const grd = g.createRadialGradient(540, 250, 0, 540, 250, 1100); grd.addColorStop(0, '#14331f'); grd.addColorStop(0.7, '#0a160e'); grd.addColorStop(1, '#060b08');
      g.fillStyle = grd; g.fillRect(0, 0, 1080, 1080); g.textAlign = 'center';
      const lvlsCleared = result?.levelsCleared ?? result?.score ?? 0;
      g.fillStyle = COL.magic; g.font = '900 46px system-ui'; g.fillText('SLAYFIT · KEEPER', 540, 150);
      g.fillStyle = COL.save; g.font = '900 110px system-ui'; g.fillText('LEVELS CLEARED', 540, 360);
      g.fillStyle = '#fff'; g.font = '900 240px system-ui'; g.fillText(String(lvlsCleared), 540, 660);
      g.fillStyle = '#cfc7e6'; g.font = '600 46px system-ui'; g.fillText(`reached level ${result?.level ?? 1} · ${result?.savePct ?? 0}% save rate`, 540, 820);
      g.fillStyle = COL.fire; g.font = '800 40px system-ui'; g.fillText('keep the ball out · slayfit', 540, 980);
      c.toBlob((b) => resolve(b), 'image/png');
    });
  }
  async function shareCard() {
    setShareNote('');
    try { const b = await buildCardBlob(); if (!b) return; const res = await shareFile({ blob: b, filename: 'slayfit-keeper.png', title: 'SlayFit Keeper', text: shareText(keeperStats()) }); setShareNote(noteMethod(res.method)); }
    catch { setShareNote('Could not share the image.'); }
  }
  async function shareClip() {
    if (!clip || !clip.blob) return; setShareNote('');
    const ext = ((clip.mime || clip.blob.type || '').includes('mp4')) ? 'mp4' : 'webm';
    try { const res = await shareFile({ blob: clip.blob, filename: `slayfit-keeper.${ext}`, title: 'My Keeper run', text: shareText(keeperStats()) }); setShareNote(noteMethod(res.method)); }
    catch { setShareNote('Could not share the clip.'); }
  }
  function downloadClip() {
    if (!clip || !clip.blob) return;
    const ext = ((clip.mime || clip.blob.type || '').includes('mp4')) ? 'mp4' : 'webm';
    const ok = downloadBlob(clip.blob, `slayfit-keeper.${ext}`);
    setShareNote(ok ? 'Clip downloaded.' : 'Could not download the clip.');
  }
  function onSocial(network, label) { const ok = openSocialShare(network, keeperStats()); setShareNote(ok ? `Opening ${label}…` : `Couldn't open ${label}.`); }
  async function onCopyLink() { const ok = await copyShareLink(keeperStats()); setShareNote(ok ? 'Share link copied!' : "Couldn't copy the link."); }

  const toggleMute = useCallback(() => {
    const sfx = sfxRef.current; let m;
    if (sfx) m = sfx.toggle();
    else { m = !audioMuted; try { localStorage.setItem('slayfit_keeper_muted', m ? '1' : '0'); } catch {} }
    setAudioMuted(m);
  }, [audioMuted]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-realm text-ink font-body">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(80% 70% at 50% 20%, #14331f 0%, #0a160e 60%, #060b08 100%)' }} />
      <video ref={videoRef} playsInline muted autoPlay
        className="absolute z-[6] object-cover bg-black pointer-events-none"
        style={selfViewStyle(camMode && screen === 'playing' && !calib ? 'run' : 'hidden')} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Brand */}
      <div className="absolute top-3.5 left-4 z-[5]">
        <div className="font-display font-black text-lg bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">SLAYFIT</div>
        <div className="text-[9px] tracking-[0.24em] text-magic/80 uppercase">Keeper</div>
      </div>

      {/* Mute */}
      <button onClick={toggleMute} title={audioMuted ? 'Unmute' : 'Mute'} aria-label={audioMuted ? 'Unmute' : 'Mute'}
        className="absolute top-3.5 right-3.5 z-[25] pointer-events-auto cursor-pointer panel w-9 h-9 flex items-center justify-center leading-none"
        style={{ marginTop: screen === 'playing' ? '52px' : '0', color: audioMuted ? 'rgba(250,244,233,0.55)' : COL.gold }}>
        <Icon name={audioMuted ? 'soundOff' : 'soundOn'} size={18} />
      </button>

      {/* Keyframes for the SAVE/GOAL callout pop-in + fade-out (scoped, injected once). */}
      <style>{`
        @keyframes kpr-callout {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.55); }
          18%  { opacity: 1; transform: translate(-50%,-50%) scale(1.12); }
          32%  { transform: translate(-50%,-50%) scale(1.0); }
          74%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(1.04); }
        }
      `}</style>

      {/* transient CALLOUT (SAVE / GOAL big & iconic) + minor banners (LEVEL / GO) */}
      {banner && screen === 'playing' && (() => {
        const isCallout = banner.kind === 'save' || banner.kind === 'goal';
        const col = banner.kind === 'save' ? COL.save : banner.kind === 'goal' ? COL.goal : banner.kind === 'level' ? COL.gold : COL.save;
        if (isCallout) {
          // Big centered pop-in callout with the matching theme icon glyph.
          const glyph = banner.kind === 'save' ? 'save' : 'goal';
          return (
            <div className="absolute left-1/2 top-1/2 z-[9] pointer-events-none flex flex-col items-center"
              style={{ animation: 'kpr-callout 850ms cubic-bezier(.22,1.2,.36,1) forwards', willChange: 'transform, opacity' }}>
              <Icon name={glyph} size={IS_PHONE ? 86 : 120} color={col} />
              <div className="font-black leading-none mt-1"
                style={{ fontSize: IS_PHONE ? 84 : 128, color: col, letterSpacing: '0.04em',
                  textShadow: `0 6px 30px #000, 0 0 28px ${col}` }}>
                {banner.text}
              </div>
            </div>
          );
        }
        // Lighter banner for LEVEL / GO / INCOMING.
        return (
          <div className="absolute left-0 right-0 top-[38%] text-center z-[8] pointer-events-none font-black"
            style={{ fontSize: banner.kind === 'go' ? 54 : 56, textShadow: '0 4px 24px #000', color: col }}>
            {banner.text}
          </div>
        );
      })()}

      {screen === 'playing' && (
        <>
          {/* HUD (right): levels cleared (big) + overall save% */}
          <div className="absolute top-3 right-3.5 text-right z-[5]" style={{ textShadow: '0 2px 10px #000' }}>
            <div className="font-black text-3xl text-gold tabular-nums flex items-center justify-end gap-1.5">
              <Icon name="level" size={22} color={COL.gold} />{hud.levelsCleared} <span className="text-base text-ink/60">cleared</span>
            </div>
            <div className="text-[11px] text-ink/70 flex items-center justify-end gap-1">
              <Icon name="save" size={12} color={COL.save} />{hud.shots ? hud.savePct + '% saved' : '—'}
            </div>
          </div>
          {/* HUD (center): current level + this-level progress toward the 60% clear */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-center z-[5]" style={{ textShadow: '0 2px 10px #000' }}>
            <div className="font-black text-2xl text-magic tabular-nums flex items-center justify-center gap-1">
              <Icon name="level" size={20} color={COL.magic} />LV {hud.level}
            </div>
            <div className="mt-1 text-[12px] font-bold text-ink/85 tabular-nums flex items-center justify-center gap-1">
              <Icon name="save" size={13} color={COL.save} />
              {hud.savesThisLevel} / {hud.need} to clear
              <span className="text-ink/45 ml-1">· shot {hud.shotsThisLevel}/{RAMP.SHOTS_PER_LEVEL}</span>
            </div>
          </div>
        </>
      )}

      {/* LEADERBOARD overlay (intro + result) — opened by the "Ranks" button */}
      {showBoard && (screen === 'intro' || screen === 'result') && (
        <Center>
          <Leaderboard client={scores} level={KEEPER_LEVEL} showMeta={false} onClose={() => setShowBoard(false)} />
        </Center>
      )}

      {/* INTRO */}
      {!showBoard && (screen === 'intro' || screen === 'loading') && (
        <Center>
          <div className="font-display font-black text-2xl sm:text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">KEEPER</div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-1 uppercase mb-3">Reach · Dive · Save</div>
          <p className="text-ink/70 text-[13px] leading-relaxed">
            You're the keeper. Your body is scaled to fill the goal — <b className="text-ink">reach and lean to dive</b> and stop the shots. Every level the ball gets faster, swerves harder, the goal grows wider and your reach shrinks, so keep moving.
          </p>
          <ol className="text-left text-ink/80 text-[13px] leading-7 my-3 mx-auto max-w-[420px] list-decimal pl-5 marker:text-magic">
            <li>Stand back so your <b className="text-ink">head, shoulders and both arms</b> are in frame.</li>
            <li><b className="text-ink">Reach</b> an arm or leg toward where the ball is going.</li>
            <li><b className="text-ink">Lean</b> left or right to dive — your movement is amplified across the goal.</li>
            <li>Each level is {RAMP.SHOTS_PER_LEVEL} shots — <b className="text-ink">save 60%</b> ({Math.ceil(0.6 * RAMP.SHOTS_PER_LEVEL)} of {RAMP.SHOTS_PER_LEVEL}) to clear it. Drop below and the run ends. Score = levels cleared.</li>
          </ol>
          {note && <p className="text-fire-bright text-xs">{note}</p>}

          <div className="text-[11px] tracking-[0.16em] uppercase text-magic/80 mt-3 mb-2">Keeper</div>
          <div className="flex items-center gap-2 mx-auto max-w-[420px]">
            <div className="relative flex-1">
              <input value={name} onChange={(e) => setNameState(e.target.value.slice(0, 40))} onBlur={(e) => setName(e.target.value)} placeholder="Name the keeper…" maxLength={40}
                className="w-full py-2.5 pl-4 pr-10 rounded-xl bg-realm/50 border border-magic/30 text-ink placeholder:text-ink/40 focus:border-magic focus:outline-none focus:shadow-glow transition" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none" title={country || 'detecting origin'}>{country ? flagEmoji(country) : <Globe size={18} color="rgba(255,182,39,0.8)" />}</span>
            </div>
          </div>

          <div className="mb-4" />
          {screen === 'loading'
            ? <p className="text-magic/80 text-[13px]">Warming up the keeper… loading pose tracking</p>
            : (<div className="space-y-2">
                <button onClick={() => { if (!name.trim()) { setNote('Name your keeper first.'); return; } setName(name); startGame('camera'); }} disabled={!name.trim()}
                  className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed">Start — get in goal (camera)</button>
                <div className="flex gap-2">
                  <button onClick={() => { if (!name.trim()) { setNote('Name your keeper first.'); return; } setName(name); startGame('demo'); }} disabled={!name.trim()} className="flex-1 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-shield/40 hover:border-shield transition disabled:opacity-40 disabled:cursor-not-allowed">Demo (auto)</button>
                  <button onClick={() => setShowBoard(true)} className="px-4 py-2.5 rounded-xl font-semibold text-gold/90 bg-realm/50 border border-gold/30 hover:border-gold/60 transition">Ranks</button>
                  {onExit && <button onClick={onExit} className="px-4 py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Back</button>}
                </div>
              </div>)}
        </Center>
      )}

      {/* RESULT */}
      {!showBoard && screen === 'result' && result && (
        <Center>
          <div className="font-display font-black text-2xl sm:text-3xl"><span className="text-gold">{result.levelsCleared ?? result.score ?? 0} {(result.levelsCleared ?? result.score ?? 0) === 1 ? 'LEVEL' : 'LEVELS'} CLEARED</span></div>
          <div className="text-[11px] tracking-[0.24em] text-magic/80 mt-0.5 uppercase mb-1">reached level {result.level} · {result.savePct}% save rate</div>
          <div className="grid grid-cols-2 gap-2 my-2.5">
            <RC k="Levels cleared" v={String(result.levelsCleared ?? result.score ?? 0)} />
            <RC k="Save rate" v={result.savePct + '%'} />
            <RC k="Saves / shots" v={`${result.saves} / ${result.shots}`} />
            <RC k="Best (levels)" v={best && best.score != null ? String(best.score) : '—'} />
          </div>
          {result.isNew && <p className="text-gold font-extrabold mb-1.5">New personal best!</p>}

          {clip && clip.url && (
            <div className="my-3">
              <video src={clip.url} autoPlay loop muted playsInline controls className="mx-auto rounded-xl border border-magic/30 max-h-[38vh] w-auto bg-black" />
              <p className="text-[11px] text-magic/60 mt-1">Your last seconds — share or download it below</p>
            </div>
          )}

          <div className="flex gap-2 justify-center flex-wrap mt-1.5">
            <button onClick={() => startGame(G.current.mode || 'camera')} className="px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">Play again</button>
            <button onClick={shareClip} disabled={!clip || !clip.blob} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition disabled:opacity-40">Share clip</button>
            <button onClick={downloadClip} disabled={!clip || !clip.blob} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition disabled:opacity-40">Download clip</button>
            <button onClick={shareCard} className="px-4 py-2.5 rounded-xl font-semibold text-ink/90 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Share image</button>
            <button onClick={() => setShowBoard(true)} className="px-4 py-2.5 rounded-xl font-semibold text-gold/90 bg-realm/50 border border-gold/30 hover:border-gold/60 transition">Ranks</button>
            {onExit && <button onClick={onExit} className="px-4 py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Back</button>}
          </div>

          <div className="flex gap-1.5 justify-center flex-wrap items-center mt-2.5">
            <span className="text-[11px] text-magic/60 mr-0.5">Post to:</span>
            {[['x', 'X'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp']].map(([k, label]) => (
              <button key={k} onClick={() => onSocial(k, label)} className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold text-magic bg-realm/60 border border-magic/30 hover:bg-realm/90 hover:border-magic/60 transition">{label}</button>
            ))}
            <button onClick={onCopyLink} className="text-[11px] px-2.5 py-1.5 rounded-lg font-semibold text-magic bg-realm/60 border border-magic/30 hover:bg-realm/90 hover:border-magic/60 transition">Copy link</button>
          </div>
          {shareNote && <p className="text-[12px] text-magic/80 mt-2">{shareNote}</p>}
          {(!clip || !clip.blob) && <p className="text-[11px] text-magic/60 mt-2">clip capture unavailable on this browser</p>}
        </Center>
      )}
    </div>
  );
}

function selfViewStyle(mode) {
  if (mode === 'run') {
    return { right: '14px', bottom: '14px', transform: 'scaleX(-1)', width: 'min(34vw, 190px)', aspectRatio: '4 / 3', borderRadius: '10px', border: '2px solid rgba(160,107,255,.85)', boxShadow: '0 6px 22px rgba(0,0,0,.5)', opacity: 0.94 };
  }
  return { left: '-9999px', top: '-9999px', width: '2px', height: '2px', opacity: 0 };
}

// Render a theme-pack SVG glyph inline (replaces emoji). `color` accepts a CSS
// color or var; size is px. dangerouslySetInnerHTML is safe here — `icon()`
// returns our own static, parameter-free SVG strings.
const Icon = ({ name, size = 16, color = 'currentColor', className = '' }) => (
  <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true"
    style={{ width: size, height: size, lineHeight: 0 }}
    dangerouslySetInnerHTML={{ __html: icon(name, { size, color }) }} />
);

// Small globe glyph for the "origin detecting" fallback (replaces 🌐). Kept
// local (not a sport icon) so the identity flagEmoji path stays shared across games.
const Globe = ({ size = 16, color = 'currentColor' }) => (
  <span className="inline-flex items-center justify-center" aria-hidden="true" style={{ width: size, height: size, lineHeight: 0 }}
    dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>` }} />
);

const RC = ({ k, v }) => (
  <div className="rounded-xl bg-realm/60 border border-magic/20 p-2.5">
    <div className="text-[10px] tracking-[0.14em] uppercase text-magic/70">{k}</div>
    <div className="font-black text-2xl mt-0.5 text-ink">{v}</div>
  </div>
);
const Center = ({ children }) => (
  <div className="absolute inset-0 z-[20] flex items-center justify-center p-2 sm:p-4">
    <div className="panel p-3.5 sm:p-6 w-[min(96vw,560px)] max-h-[94dvh] overflow-y-auto text-center">{children}</div>
  </div>
);
