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
import { ASSETS, RUN_TO_MOVE } from '../config.js';
import { createTempleEngine } from '../engine/templeEngine.js';
import { LEVELS } from '../levels.js';

const IS_PHONE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent || '');
const START_LIVES = 3;

export default function TempleDash({ onExit }) {
  const canvasRef = useRef(null), fxRef = useRef(null), mmRef = useRef(null);
  const engRef = useRef(null);
  const [screen, setScreen] = useState('intro');     // intro | playing
  const [hud, setHud] = useState({ distance: 0, clears: 0, phase: 'ready' });
  const [cue, setCue] = useState(null);              // { text, color, id }
  const cueTimer = useRef(null);

  // --- campaign state (persists across level loads) ---
  const [lives, setLives] = useState(START_LIVES);
  const [levelIndex, setLevelIndex] = useState(0);
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
    const e = engRef.current; if (e) { try { e.dispose(); } catch {} }
    engRef.current = null;
    if (window.__templeResize) { window.removeEventListener('resize', window.__templeResize); window.__templeResize = null; }
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
    const e = engRef.current; if (e) e.input(action);
  }, []);

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

    const url = (LEVELS[idx] && LEVELS[idx].map) || ASSETS.map;
    let map = null;
    try { const res = await fetch(url); if (res.ok) map = await res.json(); } catch {}

    const eng = createTempleEngine({
      canvas: canvasRef.current,
      fxCanvas: fxRef.current,
      minimapCanvas: mmRef.current,
      map,
      runToMove: runToMoveRef.current,
      onCue: (text, color) => flashCue(text, color),
      onState: (st) => {
        setHud(st);
        // decrement once, on the transition INTO 'over' (edge-detected via ref).
        if (st.phase === 'over' && lastPhaseRef.current !== 'over') {
          setLives((l) => Math.max(0, l - 1));
        }
        lastPhaseRef.current = st.phase;
      },
    });
    engRef.current = eng;

    const onResize = () => eng.resize();
    window.addEventListener('resize', onResize); window.__templeResize = onResize;

    const onKey = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;   // normalize WASD/space
      if (k === 'ArrowUp' || k === 'w' || k === ' ') { e.preventDefault(); sendInput('jump'); }
      else if (k === 'ArrowDown' || k === 's') { e.preventDefault(); sendInput('duck'); }
      else if (k === 'ArrowLeft' || k === 'a') { e.preventDefault(); sendInput('left'); }
      else if (k === 'ArrowRight' || k === 'd') { e.preventDefault(); sendInput('right'); }
      else if (k === 'Shift' || k === 'Control') { e.preventDefault(); sendInput('runStart'); }   // RUN-TO-MOVE: hold either Shift or Ctrl (left/right) to run
      else if (k === 'Enter') { e.preventDefault(); primaryActionRef.current && primaryActionRef.current(); }
    };
    window.addEventListener('keydown', onKey); window.__templeKey = onKey;
    const onKeyUp = (e) => { if (e.key === 'Shift' || e.key === 'Control') sendInput('runStop'); };
    window.addEventListener('keyup', onKeyUp); window.__templeKeyUp = onKeyUp;

    eng.start();
  }, [teardown, flashCue, sendInput]);

  // Start the campaign fresh: full lives, level 0.
  const startCampaign = useCallback((fromIdx = 0) => {
    setLives(START_LIVES);
    setLevelIndex(fromIdx);
    loadLevel(fromIdx);
  }, [loadLevel]);

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

  const nextLevel = useCallback(() => {
    const next = levelIndex + 1;
    setLevelIndex(next);
    loadLevel(next);          // KEEP current lives
  }, [levelIndex, loadLevel]);

  const restartCampaign = useCallback(() => startCampaign(0), [startCampaign]);

  const backToMenu = useCallback(() => { teardown(); onExit && onExit(); }, [teardown, onExit]);

  // Enter-key target: the primary action of whichever end-panel is showing.
  // Held in a ref so the (stable) keydown handler always calls the latest one.
  const primaryActionRef = useRef(null);
  useEffect(() => {
    if (over) {
      primaryActionRef.current = lives > 0 ? retryLevel : restartCampaign;
    } else if (won) {
      primaryActionRef.current = isLastLevel ? restartCampaign : nextLevel;
    } else {
      primaryActionRef.current = () => sendInput('restart');
    }
  }, [over, won, lives, isLastLevel, retryLevel, restartCampaign, nextLevel, sendInput]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-[#ffe9c8] font-body select-none">
      {/* 3D scene */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {/* 2D boulder / vignette overlay */}
      <canvas ref={fxRef} className="absolute inset-0 w-full h-full block pointer-events-none z-[3]" />

      {/* Brand */}
      <div className="absolute top-3.5 left-4 z-[5]">
        <div className="font-display font-black text-lg bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">SLAYFIT</div>
        <div className="text-[9px] tracking-[0.24em] uppercase" style={{ color: '#ffb454' }}>Temple Dash</div>
      </div>

      {screen === 'playing' && (
        <>
          {/* minimap — a carved stone maze inside an ornate gold temple frame. FADES OUT
              on death/escape so it doesn't add to the void read during the overlay. */}
          <div className="absolute top-[58px] right-3 z-[4] transition-opacity duration-500"
            style={{ width: 176, height: 176, opacity: ended ? 0 : 1 }}>
            <canvas ref={mmRef} width={150} height={150}
              className="absolute rounded-md"
              style={{ left: 24, top: 24, width: 128, height: 128, background: 'radial-gradient(circle at 50% 42%, #241910 0%, #110b06 100%)' }} />
            <img src="/assets/temple/map_frame.png" alt="" aria-hidden="true"
              className="absolute inset-0 w-full h-full pointer-events-none select-none"
              style={{ filter: 'drop-shadow(0 2px 7px rgba(0,0,0,0.55))' }} />
          </div>

          {/* HUD top-center: level name + lives hearts (fades out on death/escape) */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[5] text-center transition-opacity duration-500"
            style={{ textShadow: '0 1px 4px #000', opacity: ended ? 0 : 1 }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#ffb454' }}>
              Level {levelIndex + 1} · {levelName}
            </div>
            <LivesRow lives={lives} />
          </div>

          {/* HUD: distance + clears — a compact header sitting ABOVE the framed minimap so
              they never overlap or clip (fades out on death/escape). */}
          <div className="absolute top-2.5 right-4 text-right z-[5] flex items-baseline gap-2 transition-opacity duration-500"
            style={{ textShadow: '0 1px 4px #000', opacity: ended ? 0 : 1 }}>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#ffb454' }}>
              {hud.clears} {hud.clears === 1 ? 'clear' : 'clears'}
            </span>
            <span className="font-black text-xl tabular-nums" style={{ color: '#ffd99a' }}>{hud.distance} m</span>
          </div>

          {/* HUD: COLLAPSE TIMER (left side) — seconds remaining before the temple
              blows apart. Turns red/urgent in the last few seconds and while the
              beam-block fuse is burning. Value + urgency come from onState. */}
          {!ended && <CollapseTimer timeLeft={hud.timeLeft} urgent={hud.timeUrgent} />}

          {/* transient cue */}
          {cue && (
            <div key={cue.id} className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 z-[6] pointer-events-none font-black"
              style={{ fontSize: IS_PHONE ? 44 : 64, color: cue.color, letterSpacing: '0.05em', textShadow: '0 2px 10px #000, 0 0 24px #ffae4a', animation: 'temple-cue 650ms ease-out forwards' }}>
              {cue.text}
            </div>
          )}

          {/* desktop controls hint */}
          {!IS_PHONE && !ended && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[4] text-[12px]" style={{ color: '#d9b98a', textShadow: '0 1px 3px #000' }}>
              {runToMove ? 'HOLD ⇧ Shift to run · ' : ''}← / → turn · ↑ jump beams, low fire & gaps · ↓ duck blades & high fire · beat the clock
            </div>
          )}

          {/* mobile on-screen buttons */}
          {IS_PHONE && !ended && (
            <div className="absolute bottom-4 inset-x-0 z-[7] flex items-center justify-between px-5 pointer-events-none">
              <div className="flex flex-col gap-3 items-start">
                <TButton label="◄" onPress={() => sendInput('left')} />
                {runToMove && <THoldButton label="RUN" onStart={() => sendInput('runStart')} onStop={() => sendInput('runStop')} />}
              </div>
              <div className="flex flex-col gap-3">
                <TButton label="▲ JUMP" onPress={() => sendInput('jump')} />
                <TButton label="▼ DUCK" onPress={() => sendInput('duck')} />
              </div>
              <TButton label="►" onPress={() => sendInput('right')} />
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
              onRestart={restartCampaign}
              onExit={onExit ? backToMenu : null}
            />
          ) : (
            <LevelCompletePanel
              levelName={levelName}
              lives={lives}
              onNext={nextLevel}
              onExit={onExit ? backToMenu : null}
            />
          ))}
        </>
      )}

      {/* INTRO */}
      {screen === 'intro' && (
        <div className="absolute inset-0 z-[20] flex items-center justify-center p-4">
          <div className="panel p-6 w-[min(96vw,520px)] text-center">
            <div className="font-display font-black text-3xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">TEMPLE DASH</div>
            <div className="text-[11px] tracking-[0.24em] mt-1 uppercase mb-3" style={{ color: '#ffb454' }}>Run · Turn · Survive</div>
            <p className="text-ink/75 text-[13px] leading-relaxed">
              Sprint through a collapsing temple with a boulder on your heels.
              Read the path: <b className="text-ink">jump</b> the fallen beams, low fire jets and broken-floor gaps, <b className="text-ink">duck</b> the swinging blades and high fire jets, and <b className="text-ink">turn</b> at the corners — a blade or fire is instant death, and miss a turn and you run off the edge into the pit. Don't dawdle: the temple is collapsing.
            </p>
            <p className="text-ink/60 text-[12px] mt-2">
              A {LEVELS.length}-level campaign with <b className="text-ink/85">3 shared lives</b>.
            </p>

            {/* visual controls — keycaps (arrows or WASD) */}
            <div className="my-5 grid grid-cols-3 gap-2.5">
              <ControlCard caps={['↑', 'W']} label="JUMP" sub="the beams" />
              <ControlCard caps={['↓', 'S']} label="DUCK" sub="the blades" />
              <ControlCard caps={['← →', 'A D']} label="TURN" sub="the corners" />
            </div>
            <div className="text-[11px] text-ink/55 mb-3">Arrow keys or <b className="text-ink/80">WASD</b> · Space also jumps · on phone, tap the on-screen buttons</div>

            {/* RUN-TO-MOVE toggle — you set the pace (effort = progress); off = classic auto-run. */}
            <button onClick={() => setRunToMove((v) => !v)}
              className="w-full mb-3 py-2.5 px-3 rounded-xl flex items-center justify-between text-[12px] transition"
              style={{ background: 'rgba(28,19,11,0.6)', border: `1px solid ${runToMove ? '#ffce6b88' : '#ffffff1a'}` }}>
              <span className="text-left">
                <b className="text-ink/90">Run-to-move</b>
                <span className="text-ink/55"> — you set the pace (hold ⇧ Shift / RUN). Off = auto-run.</span>
              </span>
              <span className="ml-2 font-black" style={{ color: runToMove ? '#ffce6b' : '#7a6a52' }}>{runToMove ? 'ON' : 'OFF'}</span>
            </button>

            <div className="space-y-2">
              <button onClick={() => startCampaign(0)}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110 transition">
                Start the dash
              </button>
              <div className="text-[11px] text-ink/45 pt-0.5">{LEVELS.length} levels · each tougher than the last · 3 shared lives</div>

              {onExit && (
                <button onClick={onExit}
                  className="w-full py-2.5 rounded-xl font-semibold text-ink/80 bg-realm/50 border border-magic/30 hover:border-magic/60 transition">
                  Back
                </button>
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
function CollapseTimer({ timeLeft, urgent }) {
  const t = Math.max(0, Math.ceil(timeLeft != null ? timeLeft : 0));
  const mm = Math.floor(t / 60);
  const ss = t % 60;
  const label = mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : String(ss);
  const color = urgent ? '#ff2e22' : '#ffd99a';
  return (
    <div className="absolute top-[64px] left-3.5 z-[5] text-left flex items-center gap-2 rounded-xl px-3 py-1.5"
      style={{ textShadow: '0 1px 4px #000', background: 'rgba(20,12,7,0.72)', border: `1px solid ${urgent ? '#ff2e2288' : '#ffb45433'}` }}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] leading-tight" style={{ color: urgent ? '#ff6a52' : '#ffb454' }}>
        Collapse<br />in
      </span>
      <span className="font-black text-3xl tabular-nums leading-none"
        style={{ color, textShadow: urgent ? '0 0 12px #ff2e2288, 0 1px 4px #000' : '0 1px 4px #000', animation: urgent ? 'temple-timer-pulse 600ms ease-in-out infinite' : 'none' }}>
        {label}
      </span>
    </div>
  );
}

// Lives as three ▲ icons (filled = remaining, dim = lost).
function LivesRow({ lives }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mt-1">
      {Array.from({ length: START_LIVES }).map((_, i) => (
        <span key={i} className="text-[18px] leading-none"
          style={{
            color: i < lives ? '#ff5a3c' : '#5a3a2a',
            textShadow: i < lives ? '0 0 8px #ff5a3c88' : 'none',
            opacity: i < lives ? 1 : 0.5,
          }}>▲</span>
      ))}
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

// DEATH with lives remaining — CRUSHED/SLICED + "N lives left" + Retry level.
function RetryPanel({ cause, distance, clears, lives, onRetry, onExit }) {
  return (
    <Overlay bg="rgba(12,6,3,0.78)" border="#ffb45433">
      <div className="font-display font-black text-4xl" style={{ color: '#ff5a3c', textShadow: '0 2px 12px #000' }}>
        {cause === 'blade' ? 'SLICED' : cause === 'fire' ? 'BURNED' : cause === 'collapse' ? 'ENTOMBED' : cause === 'blocked' ? 'BLOCKED' : cause === 'pit' ? 'FELL' : 'CRUSHED'}
      </div>
      <div className="mt-1 text-[13px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#ffb454' }}>
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

// DEATH with no lives left — distinct deep-red GAME OVER, restarts the campaign.
function GameOverPanel({ distance, clears, onRestart, onExit }) {
  return (
    <Overlay bg="rgba(28,4,4,0.86)" border="#ff2e2255">
      <div className="font-display font-black text-4xl" style={{ color: '#ff2e22', textShadow: '0 2px 16px #000, 0 0 28px #ff2e2266' }}>
        GAME OVER
      </div>
      <div className="mt-1 text-[12px] tracking-[0.22em] uppercase" style={{ color: '#ff8a7a' }}>
        The temple keeps you
      </div>
      <div className="mt-3 text-[15px]" style={{ color: '#ffd9c8' }}>{distance} m · {clears} {clears === 1 ? 'clear' : 'clears'}</div>
      <div className="flex gap-2 justify-center flex-wrap mt-5">
        <PrimaryBtn onClick={onRestart}>Restart</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
  );
}

// WIN on a non-last level — gold/green LEVEL COMPLETE, advances keeping lives.
function LevelCompletePanel({ levelName, lives, onNext, onExit }) {
  return (
    <Overlay bg="rgba(10,12,7,0.82)" border="#9be7a055">
      <div className="font-display font-black text-3xl" style={{ color: '#ffb454', textShadow: '0 2px 16px #000, 0 0 26px #9be7a066' }}>
        LEVEL COMPLETE
      </div>
      <div className="mt-1 text-[13px]" style={{ color: '#9be7a0' }}>{levelName} escaped</div>
      <div className="mt-2 text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#ffd99a' }}>
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
function VictoryPanel({ distance, clears, lives, onRestart, onExit }) {
  return (
    <Overlay bg="rgba(10,12,7,0.84)" border="#ffd86655">
      <div className="font-display font-black text-3xl" style={{ color: '#ffd866', textShadow: '0 2px 18px #000, 0 0 30px #ffd86677' }}>
        YOU ESCAPED THE TEMPLE
      </div>
      <div className="mt-1 text-[12px] tracking-[0.22em] uppercase" style={{ color: '#9be7a0' }}>
        Campaign complete
      </div>
      <div className="mt-3 text-[15px]" style={{ color: '#ffe9c8' }}>
        {distance} m · {clears} {clears === 1 ? 'clear' : 'clears'} · {lives} {lives === 1 ? 'life' : 'lives'} left
      </div>
      <LivesRow lives={lives} />
      <div className="flex gap-2 justify-center flex-wrap mt-5">
        <PrimaryBtn onClick={onRestart}>Play again</PrimaryBtn>
        <BackBtn onExit={onExit} />
      </div>
    </Overlay>
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
