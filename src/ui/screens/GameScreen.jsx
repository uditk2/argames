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
import ReplayCard from '../hud/ReplayCard.jsx';

export default function GameScreen({ settings, onFinish, onQuit }) {
  const mountRef = useRef(null);
  const videoRef = useRef(null);
  const demo = settings.mode === 'demo';

  // HUD mirror of engine state (updated each frame).
  const [hud, setHud] = useState({ timeLeftMs: settings.durationSec * 1000, progress: 0, score: 0, slain: 0, kcal: 0, combo: 0 });
  const [status, setStatus] = useState(demo ? 'ready' : 'starting'); // starting|ready|camera-error|loading-pose
  const [replaySupported, setReplaySupported] = useState(true);

  // Mutable refs that survive re-renders.
  const gameRef = useRef(null);
  const sceneRef = useRef(null);
  const replayRef = useRef(null);
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
        await startPoseInput(bus);
      }

      // 5) Start the game + main loop
      game.start();
      let last = performance.now();
      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const dt = Math.min(50, now - last); // clamp big gaps (tab switch)
        last = now;

        // Demo mode has no camera: synthesize a gently-moving "pose" so the
        // glowing energy fists visibly track simulated wrists.
        if (demo) scene.setPose(makeDemoPose(now));

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
    async function startPoseInput(bus) {
      try {
        setStatus('starting');
        stream = await startCamera(videoRef.current);
      } catch (e) {
        console.warn('[GameScreen] camera denied/unavailable:', e);
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
          if (sceneRef.current) sceneRef.current.setPose(mirrored);
          for (const m of punch.detect(mirrored, dt, now)) bus.emit(m);
          for (const m of shield.detect(mirrored, dt, now)) bus.emit(m);
        });
        cleanups.push(() => tracker && tracker.dispose());
        setStatus('ready');
      } catch (e) {
        console.warn('[GameScreen] pose model failed to load:', e);
        setStatus('camera-error');
      }
    }

    // --- Demo: synthetic move emitter (no camera) ---
    function startDemoInput(bus, game) {
      demoInterval = setInterval(() => {
        const s = game.state;
        if (s.phase !== 'running') return;
        const r = Math.random();
        if (r < 0.72 && s.demons.length) {
          // punch a random live demon; tag a side so the burst lands at a fist
          const target = s.demons[Math.floor(Math.random() * s.demons.length)];
          const side = Math.random() < 0.5 ? 'left' : 'right';
          bus.emit({ type: 'punch', payload: { uid: target.uid, x: target.x, y: target.y, side } });
        } else if (r < 0.9) {
          bus.emit({ type: 'shield' });
          setTimeout(() => bus.emit({ type: 'shield-end' }), 500);
        }
      }, 320);
      cleanups.push(() => clearInterval(demoInterval));
    }

    // Simulated pose for demo mode: a stable torso with both wrists drifting in
    // small loops so the energy fists feel alive. Already in mirrored/display
    // space (same convention the real pose feed uses). Indices match MediaPipe.
    function makeDemoPose(t) {
      const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 0 }));
      const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 1 }; };
      const phase = t / 1000;
      set(0, 0.5, 0.26);                                   // nose
      set(11, 0.40, 0.40); set(12, 0.60, 0.40);            // shoulders
      set(23, 0.43, 0.66); set(24, 0.57, 0.66);            // hips
      set(25, 0.43, 0.82); set(26, 0.57, 0.82);            // knees
      set(27, 0.43, 0.96); set(28, 0.57, 0.96);            // ankles
      // wrists loop around chest height
      set(15, 0.34 + 0.06 * Math.cos(phase * 1.7), 0.52 + 0.07 * Math.sin(phase * 2.1));  // left
      set(16, 0.66 + 0.06 * Math.cos(phase * 1.9 + 1), 0.52 + 0.07 * Math.sin(phase * 2.3 + 2)); // right
      // elbows (rough midpoints, for skeleton mode)
      set(13, 0.37, 0.47); set(14, 0.63, 0.47);
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
        <div className="absolute top-4 left-5">
          <div className="font-display font-black text-lg bg-gradient-to-b from-[#ffe7a8] to-[#ff8c3c] bg-clip-text text-transparent">
            DEMON REALM
          </div>
          <div className="text-[10px] tracking-[0.24em] text-magic/70">
            {Math.round(settings.durationSec / 60)}-MINUTE ONSLAUGHT
          </div>
        </div>

        <Timer timeLeftMs={hud.timeLeftMs} progress={hud.progress} />
        <ScorePanel score={hud.score} slain={hud.slain} kcal={hud.kcal} />
        <ComboMeter combo={hud.combo} />
        <ReplayCard supported={replaySupported} />

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
