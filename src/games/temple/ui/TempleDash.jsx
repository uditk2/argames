// ===========================================================================
// Temple Dash — top-level screen. Thin React shell around the framework-free
// Three.js engine (engine/templeEngine.js). React only:
//   • mounts the three canvases (scene / fx overlay / minimap),
//   • runs a multi-LEVEL CAMPAIGN with a shared 3-LIVES pool (see below),
//   • fetches each level's JSON map and starts the engine,
//   • forwards keyboard (↑ jump · ↓ duck · ←/→ turn · Enter primary action) and
//     on-screen buttons (mobile),
//   • renders the start overlay (with a level-select), the live HUD (level name
//     + hearts), transient cues, and the end panels (retry / next / complete /
//     game-over / victory),
//   • cleans the engine up on unmount and calls onExit() to return to the menu.
//
// CAMPAIGN / LIVES MODEL
// ----------------------
// The campaign is the ordered LEVELS array (../levels.js). Two pieces of React
// state drive it and PERSIST across level loads:
//   • lives      — a single shared pool (start 3) for the WHOLE run. Decrements
//                  once per death, only resets on a full GAME OVER restart or a
//                  victory replay. NOT per-level.
//   • levelIndex — which level of LEVELS is loaded.
// loadLevel(idx) is the single source of truth for (re)creating the engine; both
// the first start and Next-level go through it. The lives/level logic lives
// entirely here — the engine never sees it (it only reports phase/state).
// ===========================================================================
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { ASSETS, RUN_TO_MOVE, AVATAR_IDENTITY, CHARACTERS, getSelectedCharacter, setSelectedCharacter } from '../config.js';
import { assetUrl } from '../assetUrl.js';
// GRID ENGINE (default): the 3D world, the navigation and the minimap are all
// built from the SAME grid labyrinth, so every corridor the map shows is
// walkable — real junctions, real dead ends, multiple routes. The old linear
// engine (templeEngine — single scripted route) remains available for A/B via
// the ?engine=legacy query param.
import { createGridEngine } from '../engine/gridEngine.js';
import { createTempleEngine } from '../engine/templeEngine.js';
import { buildEngineMap } from '../engine/mazeGen.js';
import { LEVELS } from '../levels.js';
// Meta-progression (localStorage): per-level best time + stars, resume pointer,
// lifetime run/relic totals. A scoreboard only — never touches gameplay.
import * as progress from '../engine/progress.js';
// Folklore narrative copy (Syamantaka) — text only, shown on study/wizard/end screens.
import * as narrative from '../narrative.js';
// CrazyGames SDK v3 wrapper — every call is a guarded no-op unless the
// standalone build enables it (window.__CRAZYGAMES__ / VITE_CRAZYGAMES). The
// normal portal build is byte-for-byte unaffected in behavior. See
// ../crazygames/sdk.js.
import * as CG from '../crazygames/sdk.js';
// Unified analytics (GA + PostHog). Every call is a guarded no-op unless a
// provider is configured, so this is safe in every build.
import { event } from '../../../analytics/index.js';

const IS_PHONE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent || '');
// QA escape hatch (?nopause=1): disable the tab-hide/blur/rAF-stall HARD PAUSE so
// automated playtests and capture rigs can drive the game without focus fights.
// Normal players never see this; the auto-pause stays on by default.
const NO_AUTOPAUSE = (() => {
  try { return new URLSearchParams(window.location.search).has('nopause'); } catch { return false; }
})();
const START_LIVES = 3;

// ---- VOICE NARRATION (temple-voice TTS) ------------------------------------
// Plays a short narration clip for a beat if its audio file exists under
// assets/temple/vo/<lang>/<key>.mp3 (generated via Google Cloud TTS — see
// narrative.js for the bilingual script). Gracefully no-ops when the file isn't
// present yet or autoplay is blocked, so the game is fully playable without VO.
const VO_LANG = (() => { try { return (navigator.language || 'en').toLowerCase().startsWith('hi') ? 'hi' : 'en'; } catch { return 'en'; } })();
let _voAudio = null;
function playVO(key) {
  try {
    if (_voAudio) { try { _voAudio.pause(); } catch { /* ignore */ } _voAudio = null; }
    const a = new Audio(assetUrl(`assets/temple/vo/${VO_LANG}/${key}.mp3`));
    a.volume = 0.9; _voAudio = a;
    a.play().catch(() => { /* no file yet / autoplay blocked — silent */ });
  } catch { /* no VO */ }
}
const WIZ_STEPS = 2;   // slim, atmospheric onboarding: (0) mystical premise → (1) the goal + Play.
                       // Controls are taught JUST-IN-TIME in-run (L1 = turns only; jump/duck
                       // introduced in the levels where beams/blades first appear), which keeps
                       // the intro short — a long tutorial is a portal-submission rejection risk.

export default function TempleDash({ onExit }) {
  const canvasRef = useRef(null), fxRef = useRef(null), mmRef = useRef(null);
  const engRef = useRef(null);
  const [screen, setScreen] = useState('intro');     // intro | playing
  const [hud, setHud] = useState({ distance: 0, clears: 0, phase: 'ready' });
  // READING PHASE (start of level only — NEVER mid-play): study the map before the
  // run. `reading` = { secs } while the timer/engine are held. PEEK (mid-play) = the
  // player pulls the map to the front WITHOUT freezing (timer keeps running).
  const [reading, setReading] = useState(null);
  const readingRef = useRef(null);
  useEffect(() => { readingRef.current = reading; }, [reading]);
  const [peek, setPeek] = useState(false);
  // HARD PAUSE — tab-hide / window blur / rAF starvation (portal QA tab-switches
  // during review; without this the sim slides into slow-motion mush). Mirrored in
  // a ref so the stable window handlers installed in loadLevel see the live value.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const beginRunRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const [wizStep, setWizStep] = useState(0);   // onboarding wizard step (0..WIZ_STEPS-1)
  const readTimerRef = useRef(null);
  const [cue, setCue] = useState(null);              // { text, color, id }
  const cueTimer = useRef(null);
  // Meta-progression views: stars earned per level (for the journey strip), and the
  // result of the most recent clear (for the win panels). Refreshed from progress.js.
  const [starsByLevel, setStarsByLevel] = useState(() => progress.getStarsByLevel());
  const [summary, setSummary] = useState(() => progress.getSummary());
  const [lastResult, setLastResult] = useState(null);   // { stars, best, isBestTime }
  // Selected playable hunter (persisted in localStorage; the engine reads it at
  // avatar creation, so choosing on the wizard takes effect on the next run).
  const [character, setCharacterState] = useState(() => getSelectedCharacter().id);
  const pickCharacter = useCallback((id) => { setSelectedCharacter(id); setCharacterState(id); }, []);
  const refreshProgress = useCallback(() => { setStarsByLevel(progress.getStarsByLevel()); setSummary(progress.getSummary()); }, []);

  // --- campaign state (persists across level loads) ---
  const [lives, setLives] = useState(START_LIVES);
  const [levelIndex, setLevelIndex] = useState(0);
  // Rewarded-ad REVIVE (CrazyGames): one continue per campaign run. `reviving`
  // guards the button while the ad request is in flight. livesRef mirrors lives
  // so the engine-driven onState callback can read the current count without a
  // stale closure (and without firing side-effects inside a setState updater,
  // which StrictMode double-invokes).
  const [reviveUsed, setReviveUsed] = useState(false);
  const [reviving, setReviving] = useState(false);
  const livesRef = useRef(START_LIVES);
  useEffect(() => { livesRef.current = lives; }, [lives]);
  // RUN-TO-MOVE toggle (read at engine creation via a ref so loadLevel sees the latest).
  const [runToMove, setRunToMove] = useState(RUN_TO_MOVE);
  const runToMoveRef = useRef(RUN_TO_MOVE);
  useEffect(() => { runToMoveRef.current = runToMove; }, [runToMove]);
  // Lives are decremented in the engine's onState callback (NOT a React effect —
  // effects double-invoke under StrictMode and were draining 2 lives per death).
  // lastPhaseRef tracks the previous phase so we decrement only on the EDGE into
  // 'over' (the engine pushes 'over' every frame during the crush; only the first
  // counts). Reset to a non-'over' phase on each (re)load/restart.
  const lastPhaseRef = useRef('ready');

  const teardown = useCallback(() => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
    if (readTimerRef.current) { clearInterval(readTimerRef.current); readTimerRef.current = null; }
    const e = engRef.current; if (e) { try { e.dispose(); } catch {} }
    engRef.current = null;
    if (window.__templeResize) { window.removeEventListener('resize', window.__templeResize); window.__templeResize = null; }
    if (window.__templeVis) { document.removeEventListener('visibilitychange', window.__templeVis); window.__templeVis = null; }
    if (window.__templeBlur) { window.removeEventListener('blur', window.__templeBlur); window.__templeBlur = null; }
    if (window.__templeKey) { window.removeEventListener('keydown', window.__templeKey); window.__templeKey = null; }
    if (window.__templeKeyUp) { window.removeEventListener('keyup', window.__templeKeyUp); window.__templeKeyUp = null; }
  }, []);
  useEffect(() => teardown, [teardown]);

  const flashCue = useCallback((text, color) => {
    const id = Math.random();
    setCue({ text, color: color || '#ffd99a', id });
    if (cueTimer.current) clearTimeout(cueTimer.current);
    cueTimer.current = setTimeout(() => setCue((c) => (c && c.id === id ? null : c)), 650);
  }, []);

  const sendInput = useCallback((action) => {
    if (pausedRef.current) return;   // no queued actions while hard-paused
    const e = engRef.current; if (e) e.input(action);
  }, []);

  // ONE attach point for the minimap <canvas> — used by BOTH the corner HUD map and
  // the study-phase map inside the reading overlay. Whichever canvas is mounted last
  // becomes the engine's minimap surface (engine repaints immediately on attach).
  const attachMM = useCallback((el) => {
    if (!el) return;   // unmount — the replacement canvas re-attaches in the same commit
    mmRef.current = el;
    if (engRef.current && engRef.current.setMinimapCanvas) engRef.current.setMinimapCanvas(el);
  }, []);

  // HARD PAUSE / RESUME. Pause freezes the rAF loop AND the study countdown; the end
  // panels ('over'/'won') already hold the game, so no pause is needed there.
  const pauseGame = useCallback(() => {
    const e = engRef.current; if (!e || pausedRef.current) return;
    const ph = lastPhaseRef.current;
    if (ph === 'over' || ph === 'won') return;
    e.pauseLoop();
    if (readTimerRef.current) { clearInterval(readTimerRef.current); readTimerRef.current = null; }
    pausedRef.current = true; setPaused(true);
  }, []);
  const resumeGame = useCallback(() => {
    pausedRef.current = false; setPaused(false);
    const e = engRef.current; if (!e) return;
    e.resumeLoop();
    // the study countdown was suspended — restart it from the remaining seconds
    const r = readingRef.current;
    if (r && !readTimerRef.current) {
      let left = r.secs;
      readTimerRef.current = setInterval(() => {
        left -= 1;
        if (left <= 0) beginRunRef.current && beginRunRef.current(); else setReading({ secs: left });
      }, 1000);
    }
  }, []);

  // Release the start-of-level reading hold and begin the run (auto-called when the
  // reading countdown ends, or immediately when the player taps GO).
  const beginRun = useCallback(() => {
    if (readTimerRef.current) { clearInterval(readTimerRef.current); readTimerRef.current = null; }
    const e = engRef.current; if (e) e.setReadingHold(false);
    setReading(null);
  }, []);
  // resumeGame (defined above beginRun) restarts the countdown through this ref.
  useEffect(() => { beginRunRef.current = beginRun; }, [beginRun]);

  // ---- TOUCH SWIPE CONTROLS (mobile) -----------------------------------------
  // The natural runner control: swipe ↑ = jump, ↓ = duck, ←/→ = turn, and a quick
  // TAP = jump. Only active during play; ignores touches that begin on a button/HUD.
  const touchRef = useRef(null);
  const onTouchStart = useCallback((e) => {
    if (screen !== 'playing') return;
    if (e.target.closest && e.target.closest('button')) { touchRef.current = null; return; }
    const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, [screen]);
  const onTouchEnd = useCallback((e) => {
    const s = touchRef.current; touchRef.current = null;
    if (!s || screen !== 'playing') return;   // engine ignores actions during over/won
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    const ax = Math.abs(dx), ay = Math.abs(dy), TH = 26;
    if (ax < TH && ay < TH) { sendInput('jump'); return; }     // tap = jump
    if (ax > ay) sendInput(dx > 0 ? 'right' : 'left');         // horizontal swipe = turn
    else sendInput(dy > 0 ? 'duck' : 'jump');                  // down = duck, up = jump
  }, [screen, sendInput]);

  // ---------------------------------------------------------------------------
  // loadLevel(idx) — the ONE place that (re)creates the engine. Tears down any
  // existing run, fetches LEVELS[idx].map, and wires the canvases + handlers.
  // Used by both first-start and Next-level so the create/teardown logic is never
  // duplicated. Does NOT touch lives (the caller owns the lives pool).
  // ---------------------------------------------------------------------------
  const loadLevel = useCallback(async (idx) => {
    teardown();
    setScreen('playing');
    setHud({ distance: 0, clears: 0, phase: 'ready' });
    lastPhaseRef.current = 'ready';           // fresh level → next 'over' edge counts
    pausedRef.current = false; setPaused(false);   // a fresh level never starts paused
    CG.gameplayStart();                       // CrazyGames: a run/level begins (guarded no-op off-platform)
    event('temple_level_start', { level: idx + 1, name: (LEVELS[idx] && LEVELS[idx].name) || '' });

    // Levels are now GENERATED from a real grid labyrinth (mazeGen) — route, hazards,
    // pacing, reading time and ending all derive from the maze, keyed per level.
    const map = buildEngineMap(idx);

    // Let React commit the 'playing' DOM BEFORE we create the engine. NOTE: the
    // minimap canvas may STILL be null here (the L1 "black map" bug — one rAF is
    // not a commit guarantee); that's fine now, because the canvas ref callback
    // below late-attaches it via eng.setMinimapCanvas() whenever it mounts.
    await new Promise((r) => requestAnimationFrame(r));
    if (canvasRef.current == null) return;   // unmounted mid-load (3D canvas is required)

    // engine pick: grid (default, world == minimap) vs legacy linear (?engine=legacy)
    const makeEngine = (() => {
      try {
        return new URLSearchParams(window.location.search).get('engine') === 'legacy'
          ? createTempleEngine : createGridEngine;
      } catch { return createGridEngine; }
    })();
    const eng = makeEngine({
      canvas: canvasRef.current,
      fxCanvas: fxRef.current,
      minimapCanvas: mmRef.current,
      map,
      // On phones the player reacts with SWIPES, so auto-run (holding a RUN button while
      // swiping is awkward). Run-to-move (hold) stays for desktop/webcam.
      runToMove: IS_PHONE ? false : runToMoveRef.current,
      onCue: (text, color) => flashCue(text, color),
      // rAF starvation (window occluded WITHOUT a visibilitychange — capture rigs,
      // fully-covered windows): the engine detects the stall; we hard-pause with the
      // overlay instead of letting the sim mush along at clamped-dt slow motion.
      // no handler in ?nopause runs — the engine then clamps dt instead of skipping
      onStall: NO_AUTOPAUSE ? null : () => pauseGame(),
      onState: (st) => {
        setHud(st);
        // decrement once, on the transition INTO 'over' (edge-detected via ref).
        if (st.phase === 'over' && lastPhaseRef.current !== 'over') {
          CG.gameplayStop();   // CrazyGames: active play ended (death) — pause/allow ads.
          const after = Math.max(0, livesRef.current - 1);
          setLives(after);
          event('temple_death', {
            cause: st.cause || 'unknown', distance: st.distance, clears: st.clears,
            level: idx + 1, lives_left: after,
          });
          if (after <= 0) event('temple_game_over', { distance: st.distance, clears: st.clears, level: idx + 1 });
        }
        // CrazyGames: also stop on the edge into 'won' (level clear / escape). The
        // between-levels midgame ad is fired from nextLevel, AFTER this stop.
        if (st.phase === 'won' && lastPhaseRef.current !== 'won') {
          CG.gameplayStop();
          const last = idx >= LEVELS.length - 1;
          // record best time + stars for this level (time left on the clock vs budget).
          const budget = (engRef.current && engRef.current.budgetS) || 0;
          const res = progress.recordClear(idx, st.timeLeft != null ? st.timeLeft : 0, budget);
          if (last) progress.recordVictory();
          setLastResult(res);
          refreshProgress();
          event(last ? 'temple_campaign_complete' : 'temple_level_complete', {
            level: idx + 1, distance: st.distance, clears: st.clears, lives_left: livesRef.current,
            stars: res.stars, best_time: res.best,
          });
        }
        lastPhaseRef.current = st.phase;
      },
    });
    engRef.current = eng;

    const onResize = () => eng.resize();
    window.addEventListener('resize', onResize); window.__templeResize = onResize;

    // Tab-hide / window blur → HARD PAUSE with an overlay. Deliberately NO auto-resume
    // on return — the player (or a portal reviewer) comes back to an explicit PAUSED
    // screen and resumes by click/Enter, never to a silently desynced run.
    const onVis = () => { if (document.hidden && !NO_AUTOPAUSE) pauseGame(); };
    document.addEventListener('visibilitychange', onVis); window.__templeVis = onVis;
    const onBlur = () => { if (!NO_AUTOPAUSE) pauseGame(); };
    window.addEventListener('blur', onBlur); window.__templeBlur = onBlur;

    const onKey = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;   // normalize WASD/space
      if (k === 'ArrowUp' || k === 'w' || k === ' ') { e.preventDefault(); sendInput('jump'); }
      else if (k === 'ArrowDown' || k === 's') { e.preventDefault(); sendInput('duck'); }
      else if (k === 'ArrowLeft' || k === 'a') { e.preventDefault(); sendInput('left'); }
      else if (k === 'ArrowRight' || k === 'd') { e.preventDefault(); sendInput('right'); }
      else if (k === 'q') { e.preventDefault(); sendInput('uturn'); }   // Q = turn around (mid-corridor about-face)
      else if (k === 'Shift' || k === 'Control') { e.preventDefault(); sendInput('runStart'); }   // RUN-TO-MOVE: hold either Shift or Ctrl (left/right) to run
      else if (k === 'm') { e.preventDefault(); setPeek(true); }   // HOLD M = pull the map to the front (mid-play, no freeze)
      else if (k === 'Enter') { e.preventDefault(); primaryActionRef.current && primaryActionRef.current(); }
    };
    window.addEventListener('keydown', onKey); window.__templeKey = onKey;
    const onKeyUp = (e) => {
      if (e.key === 'Shift' || e.key === 'Control') sendInput('runStop');
      if (e.key === 'm' || e.key === 'M') setPeek(false);   // release the map peek
    };
    window.addEventListener('keyup', onKeyUp); window.__templeKeyUp = onKeyUp;

    eng.start();

    // READING PHASE — hold the run and let the player study the map first (start of
    // level ONLY; never mid-play). Auto-releases after readTime, or on GO.
    const rt = (map && map.params && map.params.readTime != null) ? map.params.readTime : 0;
    if (rt > 0) {
      eng.setReadingHold(true);
      setReading({ secs: rt });
      if (readTimerRef.current) clearInterval(readTimerRef.current);
      let left = rt;
      readTimerRef.current = setInterval(() => {
        left -= 1;
        if (left <= 0) { beginRun(); } else setReading({ secs: left });
      }, 1000);
    }
  }, [teardown, flashCue, sendInput, beginRun, pauseGame, refreshProgress]);

  // Start the campaign fresh: full lives, level 0, revive available again.
  const startCampaign = useCallback((fromIdx = 0) => {
    setLives(START_LIVES);
    livesRef.current = START_LIVES;
    setLevelIndex(fromIdx);
    setReviveUsed(false);
    setReviving(false);
    setLastResult(null);
    progress.recordCampaignStart();
    refreshProgress();
    event('temple_campaign_start', { from_level: fromIdx + 1 });
    loadLevel(fromIdx);
  }, [loadLevel, refreshProgress]);

  // REWARDED-AD REVIVE (CrazyGames only) — one continue per campaign run. Shown
  // on Game Over. Watching the rewarded video grants a life and retries the
  // current level; a skip/adblock/error just leaves the Game Over screen intact.
  // Rewarded ads must be a deliberate opt-in, so this is click-only (never mapped
  // to the Enter/Space primary, which stays "Restart").
  const doRevive = useCallback(async () => {
    if (reviving || reviveUsed) return;
    setReviving(true);
    event('temple_revive_started', { level: levelIndex + 1 });
    const r = await CG.rewardedAd({});
    setReviving(false);
    if (r && r.shown) {
      event('temple_revive_watched', { level: levelIndex + 1 });
      setReviveUsed(true);
      setLives(1);
      livesRef.current = 1;
      lastPhaseRef.current = 'ready';   // next death edge counts again
      CG.gameplayStart();               // SDK compliance: a new play segment begins after the ad
      sendInput('restart');             // resume the current level with the granted life
    } else {
      event('temple_revive_failed', { level: levelIndex + 1, reason: (r && r.reason) || 'unknown' });
    }
  }, [reviving, reviveUsed, levelIndex, sendInput]);

  const phase = hud.phase;
  const over = phase === 'over';
  const won = phase === 'won';
  const falling = !!hud.falling;   // pit plunge — fade the live HUD too (it ends shortly)
  const ended = over || won || falling;   // run is finished (death OR escape) OR plunging — hide live HUD chrome
  const isLastLevel = levelIndex >= LEVELS.length - 1;
  const levelName = (LEVELS[levelIndex] && LEVELS[levelIndex].name) || '';

  // Retrying the same level: restart the current engine run. The engine pushes a
  // 'run' state on restart, which moves lastPhaseRef off 'over' so the next death
  // edge counts again.
  const retryLevel = useCallback(() => {
    lastPhaseRef.current = 'ready';
    sendInput('restart');
  }, [sendInput]);

  const nextLevel = useCallback(async () => {
    const next = levelIndex + 1;
    setLevelIndex(next);
    // CrazyGames: a compliant MIDGAME (interstitial) ad on the between-levels
    // transition. gameplayStop() already fired on the 'won' edge, so no active
    // play is interrupted. Awaitable + resolves even on adError/adblock, so the
    // next level always loads. Guarded no-op off-platform → instant on the portal.
    await CG.midgameAd();
    loadLevel(next);          // KEEP current lives
  }, [levelIndex, loadLevel]);

  const restartCampaign = useCallback(() => startCampaign(0), [startCampaign]);

  const backToMenu = useCallback(() => {
    CG.gameplayStop();   // CrazyGames: leaving an in-progress run to a menu ends active play.
    teardown();
    onExit && onExit();
  }, [teardown, onExit]);

  // Enter-key target: the primary action of whichever end-panel is showing.
  // Held in a ref so the (stable) keydown handler always calls the latest one.
  const primaryActionRef = useRef(null);
  useEffect(() => {
    if (paused) {
      primaryActionRef.current = resumeGame;   // Enter resumes from the PAUSED overlay
    } else if (over) {
      primaryActionRef.current = lives > 0 ? retryLevel : restartCampaign;
    } else if (won) {
      primaryActionRef.current = isLastLevel ? restartCampaign : nextLevel;
    } else {
      primaryActionRef.current = () => sendInput('restart');
    }
  }, [paused, resumeGame, over, won, lives, isLastLevel, retryLevel, restartCampaign, nextLevel, sendInput]);

  // Desktop: let keyboard players start the dash with Space/Enter (no mouse needed).
  // Skip when a <details>/<summary> or button is focused so those keys still toggle/activate.
  useEffect(() => {
    if (screen !== 'intro' || IS_PHONE) return;
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'SUMMARY' || tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      if (wizStep >= WIZ_STEPS - 1) startCampaign(0);
      else setWizStep((s) => Math.min(WIZ_STEPS - 1, s + 1));   // advance the wizard
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, startCampaign, wizStep]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-[#ffe9c8] font-body select-none"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
      {/* 3D scene */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {/* 2D boulder / vignette overlay */}
      <canvas ref={fxRef} className="absolute inset-0 w-full h-full block pointer-events-none z-[3]" />

      {/* Brand */}
      <div className="absolute top-3.5 left-4 z-[5]">
        <div className="font-display font-black text-lg bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">SLAYFIT</div>
        <div className="text-[9px] tracking-[0.24em] uppercase" style={{ color: '#ffb454' }}>Temple Collapse</div>
      </div>

      {screen === 'playing' && (
        <>
          {/* minimap — a carved stone maze inside an ornate gold temple frame. FADES OUT
              on death/escape. ENLARGES + centres on a mid-play PEEK (hold the map to
              the front — no freeze). During the START-OF-LEVEL reading phase this
              corner map is NOT rendered at all — the reading overlay below owns the
              map (large + centered, in normal flex flow), so the study screen can
              never show a small/dimmed corner map or overlap the header. */}
          {!reading && (() => {
            const cornerSz = IS_PHONE ? 158 : 216;
            const bigSz = IS_PHONE ? Math.min(300, window.innerWidth - 40) : 360;
            const style = peek
              ? { left: '50%', top: '44%', transform: 'translate(-50%,-50%)', width: bigSz, height: bigSz, zIndex: 30, opacity: 1 }
              : { right: 10, top: 52, width: cornerSz, height: cornerSz, zIndex: 4, opacity: ended ? 0 : 1 };
            return (
              <div className="absolute" style={{ transition: 'all 300ms ease', pointerEvents: 'none', ...style }}>
                {/* late-attach via attachMM: on the FIRST level this canvas mounts on the
                    same render that creates the engine (fixes the L1 black minimap). */}
                <FramedMap attachMM={attachMM} />
              </div>
            );
          })()}

          {/* HUD top-center: level name + lives hearts. NOT RENDERED during the reading
              overlay (which has its own header) — conditional render, not opacity, so a
              stacked duplicate title can never appear on the study screen. */}
          {!reading && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[5] text-center transition-opacity duration-500"
              style={{ textShadow: '0 1px 4px #000', opacity: ended ? 0 : 1 }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#ffb454' }}>
                Level {levelIndex + 1} · {levelName}
              </div>
              <LivesRow lives={lives} />
            </div>
          )}

          {/* HUD: distance + clears — a compact header sitting ABOVE the framed minimap so
              they never overlap or clip (fades out on death/escape). */}
          <div className="absolute top-2.5 right-4 text-right z-[5] flex items-baseline gap-2 transition-opacity duration-500"
            style={{ textShadow: '0 1px 4px #000', opacity: (ended || reading) ? 0 : 1 }}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#ffb454' }}>
              {hud.clears} {hud.clears === 1 ? 'clear' : 'clears'}
            </span>
            <span className="font-black text-xl tabular-nums" style={{ color: '#ffd99a' }}>{hud.distance} m</span>
          </div>

          {/* HUD: COLLAPSE TIMER (left side) — seconds remaining before the temple
              blows apart. Turns red/urgent in the last few seconds and while the
              beam-block fuse is burning. Value + urgency come from onState. */}
          {!ended && !reading && <CollapseTimer timeLeft={hud.timeLeft} urgent={hud.timeUrgent} armed={hud.timeArmed} />}

          {/* transient cue */}
          {cue && (
            <div key={cue.id} className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 z-[6] pointer-events-none font-black"
              style={{ fontSize: IS_PHONE ? 44 : 64, color: cue.color, letterSpacing: '0.05em', textShadow: '0 2px 10px #000, 0 0 24px #ffae4a', animation: 'temple-cue 650ms ease-out forwards' }}>
              {cue.text}
            </div>
          )}

          {/* desktop controls hint */}
          {!IS_PHONE && !ended && !reading && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[4] text-[12px]" style={{ color: '#d9b98a', textShadow: '0 1px 3px #000' }}>
              ← → turn · ↑ jump · ↓ duck · hold M for map · beat the clock
            </div>
          )}

          {/* mobile: SWIPE controls (no buttons) — a subtle hint, fades with the cues */}
          {IS_PHONE && !ended && !reading && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[4] text-[11px] text-center pointer-events-none px-4"
              style={{ color: '#d9b98a', textShadow: '0 1px 3px #000' }}>
              swipe&nbsp; ↑ jump&nbsp; ↓ duck&nbsp; ← → turn&nbsp; · tap to jump · ↩ turn around
            </div>
          )}

          {/* MUTE toggle */}
          {!ended && (
            <button onClick={() => { const e = engRef.current; if (e) setMuted(e.toggleMuted()); }}
              className="absolute bottom-3 left-3 z-[6] pointer-events-auto w-9 h-9 rounded-lg flex items-center justify-center active:scale-95 transition"
              style={{ background: 'rgba(28,19,11,0.7)', border: '1px solid #ffb45444', textShadow: '0 1px 3px #000' }}
              aria-label={muted ? 'Unmute' : 'Mute'}>
              <span style={{ fontSize: 16 }}>{muted ? '🔇' : '🔊'}</span>
            </button>
          )}

          {/* mobile MAP PEEK — hold to pull the maze to the front mid-play (no freeze). */}
          {IS_PHONE && !ended && !reading && (
            <button
              onPointerDown={(e) => { e.preventDefault(); setPeek(true); }}
              onPointerUp={(e) => { e.preventDefault(); setPeek(false); }}
              onPointerLeave={() => setPeek(false)}
              onPointerCancel={() => setPeek(false)}
              className="absolute bottom-16 right-3 z-[6] pointer-events-auto select-none px-4 py-2.5 rounded-2xl font-black text-[13px] text-[#ffe9c8] active:scale-95 transition"
              style={{ background: 'rgba(28,19,11,0.82)', border: '1px solid #ffb45455', textShadow: '0 1px 3px #000' }}>
              🗺 MAP
            </button>
          )}

          {/* mobile U-TURN — a mid-corridor about-face (keyboard players use Q). */}
          {IS_PHONE && !ended && !reading && (
            <button
              onPointerDown={(e) => { e.preventDefault(); sendInput('uturn'); }}
              className="absolute bottom-3 right-3 z-[6] pointer-events-auto select-none px-4 py-2.5 rounded-2xl font-black text-[13px] text-[#ffe9c8] active:scale-95 transition"
              style={{ background: 'rgba(28,19,11,0.82)', border: '1px solid #ffb45455', textShadow: '0 1px 3px #000' }}
              aria-label="Turn around">
              ↩ U-TURN
            </button>
          )}

          {/* READING PHASE overlay — shown before EVERY level: the 6-step journey
              (where you are / covered / upcoming, incl. the artifact + escape levels)
              at the top, then study the route, then GO. Start of level only. */}
          {reading && (
            <div className="absolute inset-0 z-[20] flex flex-col items-center justify-between py-7"
              style={{ background: 'rgba(6,4,2,0.74)' }}>
              <div className="text-center px-4 w-full">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] mb-1.5" style={{ color: '#ffb454' }}>
                  Level {levelIndex + 1} of 6 · {levelName}
                </div>
                {narrative.LEVEL_LINES[levelIndex] && (
                  <div className="text-[12px] italic mb-3 max-w-[420px] mx-auto leading-snug" style={{ color: '#e8c79a' }}>
                    “{narrative.LEVEL_LINES[levelIndex].en}”
                  </div>
                )}
                <LevelJourney current={levelIndex} starsByLevel={starsByLevel} />
              </div>
              {/* THE map — the point of the study phase. In normal flex flow between the
                  header and the GO block: always large, always centered, can't overlap
                  either, and fills what used to be an empty void. Sized against BOTH
                  axes so short viewports shrink it instead of colliding. */}
              <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center py-2 gap-1.5">
                <div className="relative" style={{ width: 'min(50vh, 400px, 92vw)', aspectRatio: '1 / 1' }}>
                  <FramedMap attachMM={attachMM} />
                </div>
                {/* the study map is framed as a recovered palm-leaf fragment (folklore
                    8c): the temple's own record, assembling one piece per trial. */}
                <div className="text-[10px] uppercase tracking-[0.16em] font-semibold" style={{ color: '#c9a878' }}>
                  🗺 Palm-leaf fragment · {levelIndex + 1} of 6 recovered
                </div>
              </div>
              <div className="text-center px-6 pb-2">
                <div className="font-display font-black text-2xl" style={{ color: '#ffd45a', textShadow: '0 2px 12px #000' }}>STUDY THE ROUTE</div>
                <div className="text-[13px] mt-1.5 mb-4 max-w-[340px] mx-auto" style={{ color: '#ffd99a' }}>
                  Read the maze and plan your turns to the <span style={{ color: '#ffe6a4' }}>exit</span>. Wrong turns cost time — mid-run, hold <b>M</b>{IS_PHONE ? ' / MAP' : ''} to peek again.
                </div>
                <button onClick={beginRun}
                  className="px-7 py-3 rounded-xl font-black text-white text-lg bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">
                  GO — {reading.secs}s
                </button>
              </div>
            </div>
          )}

          {/* PAUSED overlay — tab-hide / blur / rAF-starvation hard pause. Explicit
              resume (click / button / Enter); never auto-resumes on refocus. */}
          {paused && (
            <div className="absolute inset-0 z-[40] flex flex-col items-center justify-center gap-4 cursor-pointer"
              style={{ background: 'rgba(4,3,2,0.8)' }} onClick={resumeGame}>
              <div className="font-display font-black text-5xl" style={{ color: '#ffd45a', textShadow: '0 2px 16px #000' }}>PAUSED</div>
              <div className="text-[13px]" style={{ color: '#d9b98a', textShadow: '0 1px 3px #000' }}>The collapse holds its breath.</div>
              <button onClick={resumeGame}
                className="px-8 py-3 rounded-xl font-black text-white text-lg bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">
                ▶ Resume
              </button>
              <div className="text-[11px]" style={{ color: '#8a765a' }}>click anywhere or press Enter</div>
            </div>
          )}

          {/* DEATH overlay — retry (lives left) or GAME OVER (no lives) */}
          {over && (lives > 0 ? (
            <RetryPanel
              cause={hud.cause}
              distance={hud.distance}
              clears={hud.clears}
              lives={lives}
              onRetry={retryLevel}
              onExit={onExit ? backToMenu : null}
            />
          ) : (
            <GameOverPanel
              distance={hud.distance}
              clears={hud.clears}
              canRevive={CG.isEnabled() && !reviveUsed}
              reviving={reviving}
              onRevive={doRevive}
              onRestart={restartCampaign}
              onExit={onExit ? backToMenu : null}
            />
          ))}

          {/* WIN overlay — level complete (not last) or full victory (last) */}
          {won && (isLastLevel ? (
            <VictoryPanel
              distance={hud.distance}
              clears={hud.clears}
              lives={lives}
              summary={summary}
              onRestart={restartCampaign}
              onExit={onExit ? backToMenu : null}
            />
          ) : (
            <LevelCompletePanel
              levelName={levelName}
              lives={lives}
              result={lastResult}
              onNext={nextLevel}
              onExit={onExit ? backToMenu : null}
            />
          ))}
        </>
      )}

      {/* INTRO */}
      {screen === 'intro' && (
        <div className="absolute inset-0 z-[20] flex items-center justify-center p-4">
          {/* key-art backdrop so the wizard isn't floating on a black void */}
          <div className="absolute inset-0" aria-hidden="true"
            style={{ backgroundImage: `url(${assetUrl('assets/temple/corridor_dark.webp')})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(0.34) saturate(0.95)' }} />
          <div className="absolute inset-0" aria-hidden="true"
            style={{ background: 'radial-gradient(circle at 50% 38%, rgba(30,19,9,0.25), rgba(6,4,2,0.9))' }} />
          <div className="panel w-[min(94vw,460px)] text-center overflow-hidden relative z-[1]" style={{ padding: 0 }}>
            {/* HEADER — title + step dots + skip */}
            <div className="pt-5 px-6">
              <div className="font-display font-black text-[26px] leading-none bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">TEMPLE COLLAPSE</div>
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {Array.from({ length: WIZ_STEPS }).map((_, i) => (
                  <div key={i} style={{ width: i === wizStep ? 20 : 7, height: 7, borderRadius: 7, background: i <= wizStep ? '#ffd45a' : '#ffffff2a', transition: 'all 220ms' }} />
                ))}
              </div>
              {wizStep < WIZ_STEPS - 1 && (
                <button onClick={() => startCampaign(0)} className="absolute top-4 right-4 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#ffb45499' }}>Skip ›</button>
              )}
            </div>

            {/* STEP BODY — one focused, illustrated step at a time */}
            <div className="px-6 py-5 flex flex-col justify-center" style={{ minHeight: 320 }}>
              {/* STEP 0 — the mystical premise (one narrated line; the temple's voice). */}
              {wizStep === 0 && (
                <div>
                  <img src={assetUrl('assets/temple/stone_door.webp')} alt="" width={150} height={150} draggable={false}
                    className="mx-auto mb-4 select-none" style={{ objectFit: 'contain', filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))' }} />
                  <div className="text-[10px] font-black uppercase tracking-[0.26em] mb-1" style={{ color: '#ffb454' }}>A thousand years, sealed</div>
                  <div className="font-display font-black text-[22px] mb-1" style={{ color: '#ffe9c8' }}>The Syamantaka</div>
                  <p className="text-[13.5px] italic leading-snug px-3" style={{ color: '#e8c79a' }}>
                    “Surya's gem has kept this temple standing. You've come to take it anyway.”
                  </p>
                  <CharacterPicker selected={character} onPick={pickCharacter} />
                  <VOButton k="premise" />
                </div>
              )}
              {/* STEP 1 — the goal + the six-trial journey; controls are learned in-run. */}
              {wizStep === 1 && (
                <div>
                  <div className="mb-3"><LevelJourney current={0} starsByLevel={starsByLevel} /></div>
                  <div className="text-[10px] font-black uppercase tracking-[0.26em] mb-1" style={{ color: '#ffb454' }}>Six trials · one way out</div>
                  <div className="font-display font-black text-[21px] mb-2" style={{ color: '#ffe9c8' }}>Read the map. Reach the light.</div>
                  <p className="text-[13.5px] leading-snug px-3" style={{ color: '#ffd99a' }}>
                    Study the route, then run — before the temple comes down. Some paths lead nowhere.
                  </p>
                  <VOButton k="goal" />
                  {(summary.relics > 0 || summary.totalStars > 0 || summary.runs > 0) && (
                    <div className="mt-3 text-[11px] font-semibold tracking-[0.06em]" style={{ color: '#ffd45a' }}>
                      ★ {summary.totalStars}/{summary.maxStars} · {summary.relics} {summary.relics === 1 ? 'relic' : 'relics'} recovered · {summary.runs} {summary.runs === 1 ? 'run' : 'runs'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* NAV — Back / Next, or Play on the last step */}
            <div className="px-6 pb-5 flex items-center gap-2">
              {wizStep > 0 ? (
                <button onClick={() => setWizStep(wizStep - 1)}
                  className="px-4 py-3 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Back</button>
              ) : onExit ? (
                <button onClick={onExit}
                  className="px-4 py-3 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">Exit</button>
              ) : <div className="w-[64px]" />}
              {wizStep < WIZ_STEPS - 1 ? (
                <button onClick={() => setWizStep(wizStep + 1)}
                  className="flex-1 py-3 rounded-xl font-black text-white text-lg bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">Next ›</button>
              ) : (
                <div className="flex-1 flex flex-col gap-2">
                  <button onClick={() => startCampaign(0)}
                    className="w-full py-3 rounded-xl font-black text-white text-lg bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">▶ {summary.furthest > 0 ? 'New run' : 'Play'}</button>
                  {summary.furthest > 1 && summary.furthest < 6 && (
                    <button onClick={() => startCampaign(Math.min(summary.furthest, LEVELS.length - 1))}
                      className="w-full py-2.5 rounded-xl font-bold text-[#ffe9c8] transition hover:brightness-110"
                      style={{ background: 'rgba(28,19,11,0.7)', border: '1px solid #ffb45455' }}>
                      Resume · Level {Math.min(summary.furthest + 1, 6)}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes temple-cue {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(1.15); }
          12%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%,-50%) scale(1.0); }
        }
        @keyframes temple-timer-pulse {
          0%, 100% { transform: scale(1.0); opacity: 1; }
          50%      { transform: scale(1.12); opacity: 0.78; }
        }
      `}</style>
    </div>
  );
}

// ===========================================================================
// END PANELS — each a small self-contained component. The lives/level decisions
// (which panel, what the primary button does) are made by the parent; these only
// render. All share the existing warm-gold panel styling.
// ===========================================================================

// FRAMED MAP — the minimap <canvas> inside the ornate gold frame. Shared by the
// corner HUD map and the study-phase map (one is mounted at a time; attachMM hands
// whichever canvas is live to the engine, which repaints immediately on attach).
// Backing store is 380px (drawn at 190 logical units, 2× scaled in minimap.js) so
// the map stays CRISP at study size instead of a blurry 190px upscale.
function FramedMap({ attachMM }) {
  return (
    <>
      <canvas ref={attachMM} width={380} height={380}
        className="absolute rounded-md"
        style={{ left: '13.6%', top: '13.6%', width: '72.7%', height: '72.7%', background: 'radial-gradient(circle at 50% 42%, #241910 0%, #110b06 100%)' }} />
      <img src={assetUrl('assets/temple/map_frame.webp')} alt="" aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{ filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))' }} />
    </>
  );
}

// Shared shell so every panel matches the original overlay (centered, dim, panel).
function Overlay({ children, bg, border }) {
  return (
    <div className="absolute inset-0 z-[10] flex items-center justify-center p-4">
      <div className="text-center panel p-6 w-[min(94vw,460px)]" style={{ background: bg, borderColor: border }}>
        {children}
      </div>
    </div>
  );
}

// COLLAPSE TIMER — the seconds remaining before the temple comes down. Engine
// computes (engine/collapse.js); this only displays. Red + pulsing when urgent
// (last few seconds OR the beam-block fuse burning). Shows mm:ss.
function CollapseTimer({ timeLeft, urgent, armed }) {
  const t = Math.max(0, Math.ceil(timeLeft != null ? timeLeft : 0));
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  // Until the countdown ARMS (after the start grace), show a dashed idle state so a
  // frozen number doesn't read as broken.
  const label = !armed ? '– –' : (mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : String(ss));
  const color = !armed ? '#8a765a' : urgent ? '#ff2e22' : '#ffd99a';
  return (
    <div className="absolute top-[64px] left-3.5 z-[5] text-left flex items-center gap-2 rounded-xl px-3 py-1.5"
      style={{ textShadow: '0 1px 4px #000', background: 'rgba(20,12,7,0.72)', border: `1px solid ${urgent ? '#ff2e2288' : '#ffb45433'}`, opacity: armed ? 1 : 0.72 }}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] leading-tight" style={{ color: !armed ? '#8a765a' : urgent ? '#ff6a52' : '#ffb454' }}>
        Collapse<br />in
      </span>
      <span className="font-black text-3xl tabular-nums leading-none"
        style={{ color, textShadow: urgent ? '0 0 12px #ff2e2288, 0 1px 4px #000' : '0 1px 4px #000', animation: (armed && urgent) ? 'temple-timer-pulse 600ms ease-in-out infinite' : 'none' }}>
        {label}
      </span>
    </div>
  );
}

// Lives as ankh life-tokens (full glowing gold = remaining, cracked stone = lost).
function LivesRow({ lives }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mt-1">
      {Array.from({ length: START_LIVES }).map((_, i) => {
        const alive = i < lives;
        return (
          <img
            key={i}
            src={alive ? assetUrl('assets/temple/life_full.webp') : assetUrl('assets/temple/life_lost.webp')}
            alt={alive ? 'life' : 'life lost'}
            width={20}
            height={20}
            className="select-none"
            draggable={false}
            style={{ opacity: alive ? 1 : 0.85 }}
          />
        );
      })}
    </div>
  );
}

function PrimaryBtn({ onClick, children }) {
  return (
    <button onClick={onClick}
      className="px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">
      {children}
    </button>
  );
}

function BackBtn({ onExit }) {
  if (!onExit) return null;
  return (
    <button onClick={onExit}
      className="px-4 py-2.5 rounded-xl font-semibold text-ink/85 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">
      Back
    </button>
  );
}

// DEATH with lives remaining — a calm "RUN OVER" with the cause demoted to a
// small in-voice subtitle (still teaches what got you; just not shouty).
function RetryPanel({ cause, distance, clears, lives, onRetry, onExit }) {
  return (
    <Overlay bg="rgba(12,6,3,0.78)" border="#ffb45433">
      <div className="font-display font-black text-4xl" style={{ color: '#ff8a5a', textShadow: '0 2px 12px #000' }}>
        RUN OVER
      </div>
      <div className="mt-1 text-[13px] italic" style={{ color: '#e8c79a' }}>{narrative.causeSubtitle(cause)}</div>
      <div className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#ffb454' }}>
        {lives} {lives === 1 ? 'life' : 'lives'} left
      </div>
      <div className="mt-2 text-[15px]" style={{ color: '#ffd99a' }}>{distance} m · {clears} {clears === 1 ? 'clear' : 'clears'}</div>
      <LivesRow lives={lives} />
      <div className="flex gap-2 justify-center flex-wrap mt-5">
        <PrimaryBtn onClick={onRetry}>Retry level</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
  );
}

// DEATH with no lives left — distinct deep-red GAME OVER. On CrazyGames a
// once-per-run REWARDED-AD "Continue" is offered (canRevive): watching grants a
// life and resumes the level. Restart resets the campaign; both stay available.
function GameOverPanel({ distance, clears, canRevive, reviving, onRevive, onRestart, onExit }) {
  return (
    <Overlay bg="rgba(28,4,4,0.86)" border="#ff2e2255">
      <div className="font-display font-black text-4xl" style={{ color: '#ff2e22', textShadow: '0 2px 16px #000, 0 0 28px #ff2e2266' }}>
        GAME OVER
      </div>
      <div className="mt-1 text-[12px] tracking-[0.22em] uppercase" style={{ color: '#ff8a7a' }}>
        The temple keeps you
      </div>
      <div className="mt-3 text-[15px]" style={{ color: '#ffd9c8' }}>{distance} m · {clears} {clears === 1 ? 'clear' : 'clears'}</div>

      {canRevive && (
        <div className="mt-5">
          <button onClick={onRevive} disabled={reviving}
            className="w-full py-3 rounded-xl font-black text-[#0b0603] bg-gradient-to-r from-[#ffd45a] to-[#e8a33a] shadow-glow-fire hover:brightness-110 transition disabled:opacity-70 disabled:cursor-wait">
            {reviving ? 'Loading ad…' : '▶ Continue — watch ad'}
          </button>
          <div className="text-[11px] text-ink/45 mt-1">One free continue · keeps your run alive</div>
        </div>
      )}

      <div className="flex gap-2 justify-center flex-wrap mt-4">
        <PrimaryBtn onClick={onRestart}>Restart</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
  );
}

// WIN on a non-last level — gold/green LEVEL COMPLETE, advances keeping lives.
function LevelCompletePanel({ levelName, lives, result, onNext, onExit }) {
  return (
    <Overlay bg="rgba(10,12,7,0.82)" border="#9be7a055">
      <div className="font-display font-black text-3xl" style={{ color: '#ffb454', textShadow: '0 2px 16px #000, 0 0 26px #9be7a066' }}>
        LEVEL COMPLETE
      </div>
      <div className="mt-1 text-[13px]" style={{ color: '#9be7a0' }}>{levelName} escaped</div>
      {result && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <Stars n={result.stars} size={22} />
          <div className="text-[11px]" style={{ color: '#ffd99a' }}>
            Best {progress.formatTime(result.best)}{result.isBestTime && <span style={{ color: '#9be7a0' }}> · new best!</span>}
          </div>
        </div>
      )}
      <div className="mt-3 text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#ffd99a' }}>
        {lives} {lives === 1 ? 'life' : 'lives'} remaining
      </div>
      <LivesRow lives={lives} />
      <div className="flex gap-2 justify-center flex-wrap mt-5">
        <PrimaryBtn onClick={onNext}>Next level</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
  );
}

// WIN on the LAST level — full victory; Play again resets the campaign.
function VictoryPanel({ distance, clears, lives, summary, onRestart, onExit }) {
  return (
    <Overlay bg="rgba(10,12,7,0.84)" border="#ffd86655">
      <div className="font-display font-black text-3xl" style={{ color: '#ffd866', textShadow: '0 2px 18px #000, 0 0 30px #ffd86677' }}>
        YOU ESCAPED THE TEMPLE
      </div>
      <div className="mt-1 text-[12px] tracking-[0.22em] uppercase" style={{ color: '#9be7a0' }}>
        Campaign complete
      </div>
      <div className="mt-2 text-[12.5px] italic max-w-[380px] mx-auto leading-snug" style={{ color: '#e8c79a' }}>
        “{narrative.VICTORY_LINE.en}”
      </div>
      <div className="mt-3 text-[15px]" style={{ color: '#ffe9c8' }}>
        {distance} m · {clears} {clears === 1 ? 'clear' : 'clears'} · {lives} {lives === 1 ? 'life' : 'lives'} left
      </div>
      {summary && (
        <div className="mt-2 text-[12px]" style={{ color: '#ffd45a' }}>
          ★ {summary.totalStars}/{summary.maxStars} stars · {summary.relics} {summary.relics === 1 ? 'relic' : 'relics'} recovered
        </div>
      )}
      <LivesRow lives={lives} />
      <div className="flex gap-2 justify-center flex-wrap mt-5">
        <PrimaryBtn onClick={onRestart}>Play again</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
  );
}

// CHARACTER PICKER — choose your hunter on the wizard's first step. One tile per
// playable character (the legacy 'classic' sheet is hidden), each showing a
// back-view run frame + name; the pick persists to localStorage and the engine
// reads it at the next run. Selecting is instant and requires no reload.
function CharacterPicker({ selected, onPick }) {
  const ids = Object.keys(CHARACTERS).filter((id) => id !== 'classic');
  const sel = CHARACTERS[selected] || CHARACTERS[ids[0]];
  return (
    <div className="mt-3">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] mb-1.5" style={{ color: '#ffb454' }}>Choose your hunter</div>
      <div className="flex items-stretch justify-center gap-2">
        {ids.map((id) => {
          const c = CHARACTERS[id]; const on = id === selected;
          return (
            <button key={id} onClick={() => onPick(id)}
              className="flex flex-col items-center rounded-xl px-3 py-2 transition active:scale-95"
              style={{ background: on ? 'rgba(255,180,60,0.16)' : 'rgba(28,19,11,0.6)', border: `2px solid ${on ? '#ffd45a' : '#ffffff1f'}`, boxShadow: on ? '0 0 12px rgba(255,180,60,0.4)' : 'none', minWidth: 88 }}>
              <img src={assetUrl(`assets/temple/char/${id}/run/r_00.webp`)} alt={c.name} draggable={false}
                className="select-none" style={{ height: 66, width: 'auto', objectFit: 'contain', filter: on ? 'none' : 'brightness(0.8) saturate(0.85)' }} />
              <span className="font-display font-black text-[13px] mt-0.5" style={{ color: on ? '#ffe6a4' : '#c9a878' }}>{c.name}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold" style={{ color: '#ffb454' }}>You are {sel.tagline}</div>
    </div>
  );
}

// A small "hear the temple" speaker chip — plays a beat's narration on tap (a
// user gesture, so it isn't blocked by autoplay policy). Silent if the VO file
// isn't present yet. Hidden entirely if the browser can't play audio.
function VOButton({ k }) {
  return (
    <button onClick={() => playVO(k)}
      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition hover:brightness-110"
      style={{ background: 'rgba(28,19,11,0.7)', border: '1px solid #ffb45444', color: '#ffd99a' }}>
      <span style={{ fontSize: 13 }}>🔊</span> Hear the temple
    </button>
  );
}

// A photoreal-ish keycap chip.
function KeyCap({ children }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md font-bold text-[13px] text-[#ffe9c8]"
      style={{ background: 'linear-gradient(#3a2b1c,#241a10)', border: '1px solid #ffb45455', boxShadow: '0 2px 0 #0008, inset 0 1px 0 #ffffff14' }}>
      {children}
    </span>
  );
}

// One action shown visually: its keycap(s) + what it does.
function ControlCard({ caps, label, sub }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl py-3 px-2"
      style={{ background: 'rgba(28,19,11,0.55)', border: '1px solid #ffffff14' }}>
      <div className="flex gap-1.5">{caps.map((c, i) => <KeyCap key={i}>{c}</KeyCap>)}</div>
      <div className="font-display font-black text-[15px]" style={{ color: '#ffb454' }}>{label}</div>
      <div className="text-[11px] text-ink/60">{sub}</div>
    </div>
  );
}

// Touch legend card — a swipe glyph (arrow) + verb, for the mobile intro.
function GestureCard({ glyph, label }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl py-3 px-2"
      style={{ background: 'rgba(28,19,11,0.55)', border: '1px solid #ffffff14' }}>
      <div className="flex flex-col items-center leading-none">
        <div className="text-[24px] font-black" style={{ color: '#ffd45a', textShadow: '0 0 10px rgba(255,180,60,0.5)' }}>{glyph}</div>
        <div className="text-[8px] uppercase tracking-[0.16em] text-ink/45 mt-0.5">swipe</div>
      </div>
      <div className="font-display font-black text-[15px]" style={{ color: '#ffb454' }}>{label}</div>
    </div>
  );
}

// ===========================================================================
// ONBOARDING MAZE VISUAL — a static sample of the in-game minimap, shown inside
// the same ornate gold frame the HUD uses. Mirrors minimap.js exactly (carved
// carved-stone corridors, red-X dead ends, gold glowing EXIT, green START, gold
// player arrow) so a new player learns WHERE to look and WHAT the goal is before
// the run. Purely decorative — no game state.
// ===========================================================================
// The corridors of the sample maze — a circuitous, INTERCONNECTED network (loops
// + unmarked dead-end branches). All drawn identically, so no branch is flagged
// as "wrong": the player has to trace start→exit themselves, exactly like the
// real thing. Purely a teaching illustration.
const INTRO_MAZE = [
  '30,128 30,84 62,84 62,60 40,60 40,40 84,40 84,62 108,62 108,40 120,40 120,24', // a valid route
  '30,84 30,60 40,60',      // loop back to the route (circuitous)
  '62,84 62,108 96,108',    // unmarked dead end
  '84,40 84,24 104,24',     // unmarked dead end
  '108,62 108,86 86,86',    // unmarked dead end
  '40,40 22,40',            // unmarked dead end
];

function IntroMap() {
  const size = IS_PHONE ? 200 : 240;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 150 150" className="absolute rounded-md"
        style={{ left: '13.6%', top: '13.6%', width: '72.7%', height: '72.7%',
          background: 'radial-gradient(circle at 50% 42%, #241910 0%, #110b06 100%)' }}>
        <defs>
          <radialGradient id="tc-exit-halo">
            <stop offset="0%" stopColor="rgba(255,224,140,0.55)" />
            <stop offset="100%" stopColor="rgba(255,210,110,0)" />
          </radialGradient>
        </defs>
        {/* carved-stone corridors: dark edge → warm stone → bevel highlight, every
            corridor identical (route and dead ends look the same on purpose). */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {INTRO_MAZE.map((p, i) => <polyline key={`e${i}`} points={p} stroke="#120c07" strokeWidth="13" />)}
          {INTRO_MAZE.map((p, i) => <polyline key={`s${i}`} points={p} stroke="#7e6038" strokeWidth="9" />)}
          <g transform="translate(0,-1.2)">
            {INTRO_MAZE.map((p, i) => <polyline key={`h${i}`} points={p} stroke="rgba(206,176,116,0.5)" strokeWidth="3.6" />)}
          </g>
        </g>
        {/* EXIT archway (gold, glowing) */}
        <circle cx="120" cy="24" r="15" fill="url(#tc-exit-halo)" />
        <path d="M113.5,31 L113.5,20.5 A6.5,6.5 0 0 1 126.5,20.5 L126.5,31 Z" fill="#ffe6a4" />
        <path d="M116.5,31 L116.5,21.5 A3.5,3.5 0 0 1 123.5,21.5 L123.5,31 Z" fill="rgba(34,18,6,0.95)" />
        <text x="120" y="12" fontSize="7.5" fontWeight="bold" fill="#ffe6a4" textAnchor="middle">EXIT</text>
        {/* START green disc + player arrow ("you") */}
        <circle cx="30" cy="130" r="5.5" fill="#7ef07e" />
        <circle cx="30" cy="130" r="2.3" fill="#122a0c" />
        <g transform="translate(30,116) rotate(-90)">
          <circle r="6.5" fill="#1c1208" />
          <path d="M6.5,0 L-3.5,-4.2 L-1.2,0 L-3.5,4.2 Z" fill="#ffd45a" />
        </g>
      </svg>
      <img src={assetUrl('assets/temple/map_frame.webp')} alt="" aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.55))' }} />
    </div>
  );
}

// LEVEL JOURNEY — the 6-step campaign shown before every level: mazes 1-4, the
// ARTIFACT level (5), and the ESCAPE level (6). Covered steps are filled gold with
// a check, the current step glows, upcoming steps are dim. `current` is 0-based.
const JOURNEY_STEPS = [
  { n: 1, label: 'Halls' }, { n: 2, label: 'Blades' }, { n: 3, label: 'The Deep' },
  { n: 4, label: "Lion's Maw" }, { n: 5, label: 'Syamantaka', icon: '🏆' }, { n: 6, label: 'Daylight', icon: '🚪' },
];
// Three star sockets — filled gold up to `n`, empty (dim outline) beyond. The
// empty sockets are the deliberate open loop: the player sees exactly what's left
// to earn on each level.
function Stars({ n = 0, size = 9 }) {
  return (
    <div className="flex items-center justify-center gap-[1px]" style={{ height: size + 2 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ fontSize: size, lineHeight: 1, color: i < n ? '#ffd45a' : '#ffffff26', textShadow: i < n ? '0 0 5px rgba(255,180,60,0.6)' : 'none' }}>★</span>
      ))}
    </div>
  );
}

function LevelJourney({ current, starsByLevel = {} }) {
  return (
    <div className="flex items-center justify-center gap-0.5 sm:gap-1 mx-auto">
      {JOURNEY_STEPS.map((s, i) => {
        const done = i < current, cur = i === current;
        const bg = done ? '#e8a33a' : cur ? 'rgba(255,180,60,0.18)' : 'rgba(28,19,11,0.6)';
        const bd = done ? '#ffd45a' : cur ? '#ffd45a' : '#ffffff1f';
        const fg = done ? '#1c1208' : cur ? '#ffe6a4' : '#8a765a';
        const stars = starsByLevel[i] || 0;
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center" style={{ width: 46 }}>
              <div className="flex items-center justify-center rounded-full font-black"
                style={{
                  width: 30, height: 30, background: bg, color: fg,
                  border: `2px solid ${bd}`, fontSize: 13,
                  boxShadow: cur ? '0 0 12px rgba(255,180,60,0.55)' : 'none',
                  animation: cur ? 'temple-timer-pulse 1200ms ease-in-out infinite' : 'none',
                }}>
                {done ? '✓' : (s.icon || s.n)}
              </div>
              <div className="text-[8px] uppercase tracking-[0.08em] mt-1 font-bold" style={{ color: fg }}>{s.label}</div>
              <div className="mt-0.5"><Stars n={stars} size={8} /></div>
            </div>
            {i < JOURNEY_STEPS.length - 1 && (
              <div style={{ width: 10, height: 2, background: done ? '#ffd45a' : '#ffffff1f', marginTop: -22 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Tiny inline glyphs for the objective legend line.
function LegendDot({ color }) {
  return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: color, boxShadow: `0 0 6px ${color}` }} />;
}

function ExitGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2,13 L2,6 A5,5 0 0 1 12,6 L12,13 Z" fill="#ffe6a4" />
    </svg>
  );
}

function TButton({ label, onPress }) {
  // pointer-events re-enabled per button; fire on pointerdown for snappy input.
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      className="pointer-events-auto select-none px-4 py-3 rounded-2xl font-black text-base text-[#ffe9c8] active:scale-95 transition"
      style={{ background: 'rgba(28,19,11,0.82)', border: '1px solid #ffb45455', minWidth: 64, textShadow: '0 1px 3px #000' }}>
      {label}
    </button>
  );
}

// HOLD-to-run button (run-to-move): runs while pressed, stops on release/leave.
function THoldButton({ label, onStart, onStop }) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onStart(); }}
      onPointerUp={(e) => { e.preventDefault(); onStop(); }}
      onPointerLeave={() => onStop()}
      onPointerCancel={() => onStop()}
      className="pointer-events-auto select-none px-4 py-4 rounded-2xl font-black text-base text-[#0b0603] active:scale-95 transition"
      style={{ background: 'linear-gradient(#ffd45a,#e8a33a)', border: '1px solid #ffe9a0', minWidth: 84, boxShadow: '0 0 14px #ffae4a66' }}>
      {label}
    </button>
  );
}
