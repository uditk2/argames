// ===========================================================================
// GameScreen — the orchestrator. It wires the one-directional pipeline:
//   vision (pose) -> moves (detectors -> moveBus) -> engine (gameLoop)
//   -> render (pixiScene) + HUD (React).
//
// React only mirrors engine state into HUD components each frame; all game
// logic stays in the pure engine. Demo mode swaps real pose input for a
// simulated move emitter so the build is verifiable without a camera.
// ===========================================================================

import React, { useEffect, useRef, useState } from 'react';
import { makeRunConfig, PLAYER_RENDER_MODE } from '../../config/game.config.js';
import { createGame } from '../../engine/gameLoop.js';
import { createMoveBus } from '../../moves/moveBus.js';
import { createPunchDetector } from '../../moves/punch.js';
import { createShieldDetector } from '../../moves/shield.js';
import { createPoseTracker, startCamera } from '../../vision/poseTracker.js';
import { createPixiScene } from '../../render/pixiScene.js';
import { createReplayBuffer } from '../../recording/replayBuffer.js';
import { timerProgress } from '../../engine/timer.js';

import Timer from '../hud/Timer.jsx';
import ScorePanel from '../hud/ScorePanel.jsx';
import ComboMeter from '../hud/ComboMeter.jsx';

// Landmarks that must all be in-frame for the player to count as "fully visible
// to the knees": nose, both shoulders, both hips, both knees. (MediaPipe Pose.)
const FRAME_REQUIRED = [0, 11, 12, 23, 24, 25, 26];
const FRAME_MARGIN = 0.03;     // must sit this far inside each edge
const FRAME_MIN_VIS = 0.5;     // landmark visibility threshold

/** True when every required landmark is visible and inside the frame margins. */
function isFramedToKnees(lm) {
  if (!lm) return false;
  for (const i of FRAME_REQUIRED) {
    const p = lm[i];
    if (!p) return false;
    if (p.visibility != null && p.visibility < FRAME_MIN_VIS) return false;
    if (p.x < FRAME_MARGIN || p.x > 1 - FRAME_MARGIN) return false;
    if (p.y < FRAME_MARGIN || p.y > 1 - FRAME_MARGIN) return false;
  }
  return true;
}

export default function GameScreen({ settings, onFinish, onQuit }) {
  const mountRef = useRef(null);
  const videoRef = useRef(null);
  const demo = settings.mode === 'demo';

  // HUD mirror of engine state (updated each frame).
  const [hud, setHud] = useState({ timeLeftMs: settings.durationSec * 1000, progress: 0, score: 0, slain: 0, kcal: 0, combo: 0 });
  const [status, setStatus] = useState(demo ? 'ready' : 'starting'); // starting|ready|camera-error|loading-pose
  const [replaySupported, setReplaySupported] = useState(true);
  // Pre-game framing gate (camera only). null once scoring has begun.
  //   { phase: 'framing'|'countdown', ok: bool, count: number|null }
  const [calib, setCalib] = useState(demo ? null : { phase: 'framing', ok: false, count: null });

  // Mutable refs that survive re-renders.
  const gameRef = useRef(null);
  const sceneRef = useRef(null);
  const replayRef = useRef(null);
  const latestPoseRef = useRef(null); // most recent mirrored landmarks (for framing check)
  const cameraFailedRef = useRef(false); // true if camera/pose unavailable (skip framing gate)
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    let disposed = false;
    let rafId = null;
    let stream = null;
    let tracker = null;
    let demoInterval = null;
    const cleanups = [];

    async function boot() {
      // 1) Engine + move bus
      const runConfig = makeRunConfig({
        durationSec: settings.durationSec,
        bodyweightKg: settings.bodyweightKg,
      });
      const game = createGame(runConfig);
      gameRef.current = game;
      const bus = createMoveBus();
      cleanups.push(bus.subscribe((move) => game.enqueueMove(move)));

      // 2) Render scene
      const scene = await createPixiScene(mountRef.current, {
        avatarId: settings.avatarId,
        playerRenderMode: PLAYER_RENDER_MODE,
        demo,
      });
      if (disposed) {
        scene.destroy();
        return;
      }
      sceneRef.current = scene;

      // Unlock WebAudio on the first user gesture (browsers gate sound).
      const unlock = () => { try { scene.unlockAudio && scene.unlockAudio(); } catch {} };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      cleanups.push(() => {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      });

      // Route every detected move into the scene so it can spawn the matching
      // pose-tracked energy FX (punch bursts, shield arc).
      cleanups.push(bus.subscribe((move) => scene.notifyMove(move)));

      // 3) Replay buffer (rolling 10s) — composites the webcam (mirrored, same
      //    as on screen) + the transparent Pixi canvas into one offscreen
      //    canvas. In demo mode there's no <video>, so we pass a demoBg flag and
      //    the compositor paints a realm glow under the FX instead.
      const replay = createReplayBuffer();
      replayRef.current = replay;
      const ok = replay.start({
        video: demo ? null : videoRef.current,
        pixiCanvas: scene.app.canvas,
        demoBg: demo ? true : null,
      });
      setReplaySupported(ok && replay.isSupported);
      cleanups.push(() => replay.stop());

      // 4) Input source
      if (demo) {
        setStatus('ready');
        startDemoInput(bus, game);
      } else {
        await startPoseInput(bus, game);
      }

      // 5) Main loop. In camera mode the timer/scoring stay paused until the
      //    player is framed head-to-knees (a hard "step back" gate); demo mode
      //    starts immediately. game.step() is a no-op until game.start() runs,
      //    so the webcam + live skeleton still render during framing.
      if (demo) game.start();
      let last = performance.now();
      let framedSince = 0;       // when framing first became good (ms) | 0
      let countdownUntil = 0;    // performance.now() target end of 3-2-1 | 0
      let started = demo;        // scoring active?
      const HOLD_MS = 1000;      // must stay framed this long before countdown
      const COUNT_MS = 3000;     // 3-2-1 go

      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const dt = Math.min(50, now - last); // clamp big gaps (tab switch)
        last = now;

        // Demo mode has no camera: synthesize a moving "pose" whose wrists
        // actively chase incoming demons so the fists really OVERLAP them and
        // trigger genuine collision connects (bursts, shake, pips, combo).
        if (demo) {
          const dp = makeDemoPose(now, game.state);
          scene.setPose(dp);
          feedFists(game, dp);
        }

        // --- Pre-game framing gate (camera only) ---------------------------
        if (!started) {
          if (cameraFailedRef.current) {
            // No camera/pose: don't soft-lock — just begin.
            game.start(); started = true; setCalib(null);
          } else if (countdownUntil === 0) {
            const ok = isFramedToKnees(latestPoseRef.current);
            if (ok) {
              if (!framedSince) framedSince = now;
              if (now - framedSince >= HOLD_MS) countdownUntil = now + COUNT_MS;
            } else {
              framedSince = 0;
            }
            setCalib({ phase: 'framing', ok, count: null });
          } else {
            const remain = countdownUntil - now;
            if (remain <= 0) {
              game.start(); started = true; setCalib(null);
            } else {
              setCalib({ phase: 'countdown', ok: true, count: Math.ceil(remain / 1000) });
            }
          }
        }

        const finished = game.step(dt);
        scene.render(game.state, dt, (uid) => {
          // Demo-mode click-to-punch lands directly on the clicked demon.
          bus.emit({ type: 'punch', payload: { uid } });
        });

        const s = game.state;
        setHud({
          timeLeftMs: s.timeLeftMs,
          progress: timerProgress(s),
          score: s.score,
          slain: s.slain,
          kcal: s.kcal,
          combo: s.combo,
        });

        if (finished) {
          // Round over (timer hit 0): grab the last ~10s clip BEFORE we stop the
          // recorder, then hand it to results along with the final state.
          let clip = null;
          try {
            if (replayRef.current) {
              clip = replayRef.current.getLastClip();
              replayRef.current.stop();
            }
          } catch (e) {
            console.warn('[GameScreen] replay collect failed:', e);
          }
          onFinishRef.current(game.state, clip);
          return;
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    // --- Real camera + pose pipeline ---
    async function startPoseInput(bus, game) {
      try {
        setStatus('starting');
        stream = await startCamera(videoRef.current);
      } catch (e) {
        console.warn('[GameScreen] camera denied/unavailable:', e);
        cameraFailedRef.current = true; // skip the framing gate so we don't soft-lock
        setStatus('camera-error');
        return; // game still runs; pose simply never fires moves
      }
      try {
        setStatus('loading-pose');
        tracker = createPoseTracker();
        await tracker.init();
        const punch = createPunchDetector();
        const shield = createShieldDetector();
        let lastPose = performance.now();
        tracker.start(videoRef.current, (landmarks) => {
          const now = performance.now();
          const dt = now - lastPose;
          lastPose = now;
          // Mirror x because the on-screen video is mirrored (selfie). The
          // render layer draws the energy FX from these SAME mirrored
          // landmarks, so the glowing fists stay aligned with the live video.
          const mirrored = landmarks
            ? landmarks.map((p) => ({ ...p, x: 1 - p.x }))
            : null;
          latestPoseRef.current = mirrored;
          if (sceneRef.current) sceneRef.current.setPose(mirrored);
          // Feed the live fist (wrist) positions into the engine so collision
          // can test them against demons. Detectors still gate "is this a punch".
          feedFists(game, mirrored);
          for (const m of punch.detect(mirrored, dt, now)) bus.emit(m);
          for (const m of shield.detect(mirrored, dt, now)) bus.emit(m);
        });
        cleanups.push(() => tracker && tracker.dispose());
        setStatus('ready');
      } catch (e) {
        console.warn('[GameScreen] pose model failed to load:', e);
        cameraFailedRef.current = true; // skip the framing gate so we don't soft-lock
        setStatus('camera-error');
      }
    }

    // Pull the two wrist (15/16) positions from landmarks and push them into
    // the engine as normalized fist positions for collision. Null-safe.
    function feedFists(game, landmarks) {
      if (!game || !game.setFists) return;
      const w = (i) => {
        const p = landmarks && landmarks[i];
        if (!p || (p.visibility != null && p.visibility < 0.4)) return null;
        return { x: p.x, y: p.y };
      };
      game.setFists(w(15), w(16));
    }

    // Demo fist simulation state: each fist eases toward a chosen demon target,
    // then we fire a side-punch when it's overlapping so the ENGINE COLLISION
    // path produces a real connect (same code path the camera uses).
    const demoFist = {
      left: { x: 0.34, y: 0.52, uid: null },
      right: { x: 0.66, y: 0.52, uid: null },
    };

    // Pick the nearest live demon on the given half of the screen for a fist.
    function pickDemoTarget(state, side) {
      let best = null, bestD = Infinity;
      for (const d of state.demons) {
        if (d.dead) continue;
        const onSide = side === 'left' ? d.x <= 0.55 : d.x >= 0.45;
        if (!onSide) continue;
        const dx = d.x - (side === 'left' ? 0.4 : 0.6);
        const dist = dx * dx + (d.y - 0.4) * (d.y - 0.4);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      return best;
    }

    // --- Demo: synthetic move emitter (no camera) ---
    // Periodically fires side-punches (arming a fist) + occasional shields.
    // The fist positions themselves are driven in makeDemoPose() toward demons,
    // so the punch lands via real overlap collision (not a direct uid hit).
    function startDemoInput(bus, game) {
      demoInterval = setInterval(() => {
        const s = game.state;
        if (s.phase !== 'running') return;
        const r = Math.random();
        if (r < 0.82 && s.demons.length) {
          // Arm whichever fist is currently nearest a demon so it connects.
          const side = Math.random() < 0.5 ? 'left' : 'right';
          bus.emit({ type: 'punch', payload: { side } });
          // also jab with the other fist sometimes for combo build-up
          if (Math.random() < 0.5) {
            const other = side === 'left' ? 'right' : 'left';
            bus.emit({ type: 'punch', payload: { side: other } });
          }
        } else if (r < 0.95) {
          bus.emit({ type: 'shield' });
          setTimeout(() => bus.emit({ type: 'shield-end' }), 500);
        }
      }, 260);
      cleanups.push(() => clearInterval(demoInterval));
    }

    // Simulated pose for demo mode. Stable torso; each WRIST eases toward the
    // nearest demon on its half so the glowing fists really overlap incoming
    // demons (driving genuine collision connects). Mirrored/display space.
    function makeDemoPose(t, state) {
      const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 0 }));
      const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 1 }; };
      const phase = t / 1000;
      set(0, 0.5, 0.26);                                   // nose
      set(11, 0.40, 0.40); set(12, 0.60, 0.40);            // shoulders
      set(23, 0.43, 0.66); set(24, 0.57, 0.66);            // hips
      set(25, 0.43, 0.82); set(26, 0.57, 0.82);            // knees
      set(27, 0.43, 0.96); set(28, 0.57, 0.96);            // ankles

      for (const side of ['left', 'right']) {
        const f = demoFist[side];
        const target = state ? pickDemoTarget(state, side) : null;
        // home position (idle bob) when no target on this side
        const homeX = side === 'left' ? 0.34 : 0.66;
        const homeY = 0.52 + 0.05 * Math.sin(phase * (side === 'left' ? 2.1 : 2.3));
        const tx = target ? target.x : homeX;
        const ty = target ? target.y : homeY;
        // ease toward the target (snappy enough to actually reach it)
        f.x += (tx - f.x) * 0.18;
        f.y += (ty - f.y) * 0.18;
      }
      set(15, demoFist.left.x, demoFist.left.y);            // left wrist
      set(16, demoFist.right.x, demoFist.right.y);          // right wrist
      // elbows (rough midpoints toward each wrist, for skeleton mode)
      set(13, (0.40 + demoFist.left.x) / 2, (0.40 + demoFist.left.y) / 2);
      set(14, (0.60 + demoFist.right.x) / 2, (0.40 + demoFist.right.y) / 2);
      return lm;
    }

    boot();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (demoInterval) clearInterval(demoInterval);
      cleanups.forEach((fn) => { try { fn(); } catch {} });
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (sceneRef.current) sceneRef.current.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0a0510]">
      {/* LIVE PLAYER LAYER (behind the transparent Pixi canvas).
          The mirrored webcam IS the fighter; the Pixi canvas overlays the
          glowing pose-tracked energy effects on top of it. */}
      {!demo ? (
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1] z-0"
        />
      ) : (
        // Demo: no camera — tasteful dim silhouette so the "live" feel still
        // reads while the simulated energy fists move on top.
        <div className="absolute inset-0 z-0 flex items-end justify-center bg-[radial-gradient(70%_80%_at_50%_115%,rgba(154,76,255,.18),transparent_70%)]">
          <svg className="h-[78%] opacity-30" viewBox="0 0 70 92" preserveAspectRatio="xMidYMax meet">
            <g fill="rgba(180,160,255,.9)">
              <circle cx="35" cy="22" r="15" />
              <path d="M12 92 q0 -40 23 -40 q23 0 23 40 z" />
            </g>
          </svg>
        </div>
      )}

      {/* Pixi canvas mount (transparent — draws demons, traps, energy FX, HUD glints) */}
      <div ref={mountRef} className="absolute inset-0 z-[1]" />

      {/* HUD overlay */}
      <div className="absolute inset-0 z-10">
        {/* Brand */}
        <div className="absolute top-2 left-3 sm:top-4 sm:left-5">
          <div className="font-display font-black text-sm sm:text-lg bg-gradient-to-b from-[#ffe7a8] to-[#ff8c3c] bg-clip-text text-transparent">
            DEMON REALM
          </div>
          <div className="hidden sm:block text-[10px] tracking-[0.24em] text-magic/70">
            {Math.round(settings.durationSec / 60)}-MINUTE ONSLAUGHT
          </div>
        </div>

        {/* Gameplay stats appear only once scoring has begun (after framing). */}
        {!calib && (
          <>
            <Timer timeLeftMs={hud.timeLeftMs} progress={hud.progress} />
            <ScorePanel score={hud.score} slain={hud.slain} kcal={hud.kcal} />
            <ComboMeter combo={hud.combo} />
          </>
        )}

        {/* Pre-game framing gate: guide outline + "step back" prompt + 3-2-1. */}
        {calib && status === 'ready' && (
          <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <svg
                className="h-[82%] transition-colors duration-300"
                viewBox="0 0 100 150"
                fill="none"
                preserveAspectRatio="xMidYMid meet"
              >
                <g
                  stroke={calib.ok ? '#7dffa0' : '#b079ff'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeDasharray="4 3"
                  opacity="0.9"
                >
                  <ellipse cx="50" cy="20" rx="12" ry="14" />
                  <line x1="50" y1="34" x2="50" y2="92" />
                  <line x1="50" y1="48" x2="24" y2="76" />
                  <line x1="50" y1="48" x2="76" y2="76" />
                  <line x1="50" y1="92" x2="36" y2="142" />
                  <line x1="50" y1="92" x2="64" y2="142" />
                </g>
              </svg>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 bottom-[14%] flex flex-col items-center pointer-events-none">
              {calib.phase === 'countdown' ? (
                <div
                  className="font-display font-black text-white"
                  style={{ fontSize: 96, lineHeight: 1, textShadow: '0 2px 22px rgba(255,122,60,.85)' }}
                >
                  {calib.count}
                </div>
              ) : (
                <div className="panel px-6 py-3 text-center max-w-[420px]">
                  <div className="text-base font-semibold text-ink">
                    {calib.ok ? 'Hold it…' : 'Step back so your whole body is in frame'}
                  </div>
                  <div className={`text-[12px] mt-1 ${calib.ok ? 'text-shield' : 'text-magic/70'}`}>
                    {calib.ok ? "You're fully visible — get ready" : 'Move back until your head, arms and knees all show'}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Quit */}
        <button
          onClick={onQuit}
          className="absolute top-4 left-1/2 -translate-x-1/2 mt-[88px] text-[11px] text-magic/60 hover:text-magic pointer-events-auto"
        >
          quit
        </button>

        {/* Footer hint */}
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[11px] text-magic/50">
          punch what flies in · arms up to block
        </div>

        {/* Status toasts */}
        {status !== 'ready' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 panel px-5 py-3 text-sm">
            {status === 'starting' && 'Requesting camera…'}
            {status === 'loading-pose' && 'Summoning the pose oracle…'}
            {status === 'camera-error' && (
              <span className="text-fire-bright">
                Camera/pose unavailable — game runs, but moves won’t register.
                Try Demo mode.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
