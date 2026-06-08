// ===========================================================================
// VersusScreen — 2-player WebRTC duel. Lobby uses short ROOM CODES via the
// public PeerJS broker (host shares a code; guest types it). Reuses the pose
// tracker, punch/shield detectors and the avatar rig. All netcode lives in
// src/net + src/versus; this screen is the glue + UI. See docs/versus-netcode.md.
// ===========================================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPeerHost, createPeerJoin } from '../../net/peerLink.js';
import { createClock } from '../../net/clock.js';
import { createVersusEngine } from '../../versus/versusEngine.js';
import { createVersusSession } from '../../versus/versusSession.js';
import { createVersusScene } from '../../render/versusScene.js';
import { createPoseTracker, startCamera } from '../../vision/poseTracker.js';
import { createPunchDetector } from '../../moves/punch.js';
import { createShieldDetector } from '../../moves/shield.js';
import { BRAND } from '../../config/brand.js';

const RENDER_DELAY_MIN = 90;

export default function VersusScreen({ onQuit }) {
  const [phase, setPhase] = useState('role');   // role | host | join | fighting | over
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [hud, setHud] = useState({ selfHp: 100, oppHp: 100, rtt: 0, synced: false });
  const [winner, setWinner] = useState(null);

  const signalRef = useRef(null);     // peer host/join handle (for teardown)
  const sessionRef = useRef(null);
  const sceneRef = useRef(null);
  const videoRef = useRef(null);
  const mountRef = useRef(null);
  const guardRef = useRef(false);
  const localPoseRef = useRef(null);
  const prevOppHpRef = useRef(100);
  const bootedRef = useRef(false);

  // Spin up the match session once the DataLink is open (both roles).
  const startSession = useCallback((link, isHost) => {
    const clock = createClock();
    const engine = createVersusEngine();
    const session = createVersusSession({
      link, isHost, clock, engine,
      hooks: {
        onSynced: () => setStatus('connected — fight!'),
        onHitTaken: (res) => sceneRef.current && sceneRef.current.impact('self', res.blocked ? 'block' : 'hit'),
        onMatchOver: (w) => { setWinner(w); setPhase('over'); },
      },
    });
    sessionRef.current = session;
    session.start();
    setStatus('');
    setPhase('fighting');
  }, []);

  const errText = (e) => (e && (e.type || e.message)) || 'unknown error';

  const chooseHost = useCallback(() => {
    setPhase('host'); setStatus('Creating room…'); setRoomCode('');
    signalRef.current = createPeerHost({
      onCode: (code) => { setRoomCode(code); setStatus('Share this code with your opponent.'); },
      onLink: (link) => startSession(link, true),
      onError: (e) => setStatus('Error: ' + errText(e)),
    });
  }, [startSession]);

  const chooseJoin = useCallback(() => { setPhase('join'); setStatus(''); }, []);

  const doJoin = useCallback(() => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setStatus('Connecting…');
    signalRef.current = createPeerJoin({
      code,
      onLink: (link) => startSession(link, false),
      onError: (e) => setStatus('Could not connect: ' + errText(e)),
    });
  }, [joinCode, startSession]);

  const copyCode = useCallback(() => {
    try { navigator.clipboard.writeText(roomCode); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }, [roomCode]);

  // --- Arena boot (camera + tracker + scene + loop) when fighting ----------
  useEffect(() => {
    if (phase !== 'fighting' || bootedRef.current) return;
    bootedRef.current = true;
    let disposed = false, rafId = null, stream = null, tracker = null;
    const cleanups = [];

    (async () => {
      const scene = await createVersusScene(mountRef.current, {});
      if (disposed) { scene.destroy(); return; }
      sceneRef.current = scene;

      try { stream = await startCamera(videoRef.current); }
      catch { setStatus('camera unavailable — opponent still visible'); }

      const punch = createPunchDetector();
      const shield = createShieldDetector();

      if (stream) {
        try {
          tracker = createPoseTracker();
          await tracker.init();
          let lastPose = performance.now();
          tracker.start(videoRef.current, (landmarks) => {
            const now = performance.now();
            const dt = now - lastPose; lastPose = now;
            const mirrored = landmarks ? landmarks.map((p) => ({ ...p, x: 1 - p.x })) : null;
            localPoseRef.current = mirrored;
            const s = sessionRef.current;
            if (!s) return;
            s.sendPose(mirrored);
            for (const m of punch.detect(mirrored, dt, now)) {
              s.sendPunch({ side: m.payload.side, x: m.payload.x, y: m.payload.y });
              sceneRef.current && sceneRef.current.impact('self', 'hit');
            }
            for (const g of shield.detect(mirrored, dt, now)) {
              if (g.type === 'shield') { guardRef.current = true; s.setLocalGuard(true); }
              else if (g.type === 'shield-end') { guardRef.current = false; s.setLocalGuard(false); }
            }
          });
          cleanups.push(() => tracker && tracker.dispose());
        } catch { setStatus('pose model failed to load'); }
      }

      let last = performance.now();
      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const dtMs = Math.min(50, now - last); last = now;
        const s = sessionRef.current;
        if (s && sceneRef.current) {
          const oneWay = s.clock.oneWay ? s.clock.oneWay() : 0;
          const renderTime = s.clock.now() - Math.max(RENDER_DELAY_MIN, oneWay * 1.5);
          const oppLm = s.remotePoseAt(renderTime);
          sceneRef.current.render(localPoseRef.current, oppLm, {
            now, dtMs, selfGuard: guardRef.current, oppGuard: s.oppGuard(),
          });
          const st = s.state();
          if (st.oppHp < prevOppHpRef.current) {
            sceneRef.current.impact('opp', 'hit');
            prevOppHpRef.current = st.oppHp;
          }
          setHud((h) => (h.selfHp !== st.selfHp || h.oppHp !== st.oppHp || Math.abs(h.rtt - st.rtt) > 3 || h.synced !== st.synced)
            ? { selfHp: st.selfHp, oppHp: st.oppHp, rtt: Math.round(st.rtt), synced: st.synced }
            : h);
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      cleanups.forEach((fn) => { try { fn(); } catch {} });
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (sceneRef.current) { sceneRef.current.destroy(); sceneRef.current = null; }
    };
  }, [phase]);

  // Full teardown on unmount.
  useEffect(() => () => {
    try { sessionRef.current && sessionRef.current.destroy(); } catch {}
    try { signalRef.current && signalRef.current.close(); } catch {}
  }, []);

  const hpBar = (hp, side) => (
    <div className="h-3 rounded-full bg-realm/70 border border-magic/30 overflow-hidden w-full">
      <div
        className={`h-full ${side === 'self' ? 'bg-gradient-to-r from-shield to-magic' : 'bg-gradient-to-l from-fire to-gold'}`}
        style={{ width: `${Math.max(0, hp)}%`, transition: 'width 120ms linear' }}
      />
    </div>
  );

  const Spinner = () => (
    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-magic/40 border-t-magic animate-spin align-[-2px]" />
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-realm text-ink">
      {/* Local webcam, dim, behind the arena (local only — never transmitted) */}
      <video ref={videoRef} playsInline muted
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1] z-0 opacity-20" />
      <div ref={mountRef} className="absolute inset-0 z-[1]" />

      {/* HUD: health bars + ping */}
      {phase === 'fighting' && (
        <div className="absolute inset-x-0 top-0 z-10 p-3 pointer-events-none">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="text-[11px] mb-1 text-shield font-semibold">YOU</div>
              {hpBar(hud.selfHp, 'self')}
            </div>
            <div className="text-center px-2">
              <div className="font-display font-black text-lg text-magic">VS</div>
              <div className="text-[10px] text-magic/60">{hud.synced ? `${hud.rtt}ms` : 'syncing…'}</div>
            </div>
            <div className="flex-1">
              <div className="text-[11px] mb-1 text-fire-bright font-semibold text-right">OPPONENT</div>
              {hpBar(hud.oppHp, 'opp')}
            </div>
          </div>
          <div className="text-center text-[11px] text-magic/60 mt-2">{status}</div>
        </div>
      )}

      {/* Lobby */}
      {(phase === 'role' || phase === 'host' || phase === 'join') && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="panel p-6 w-[min(94vw,460px)]">
            <div className="text-center mb-5">
              <div className="font-display font-black text-2xl bg-gradient-to-b from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] bg-clip-text text-transparent">
                {BRAND.wordmark} — Versus
              </div>
              <div className="text-[11px] tracking-[0.2em] text-magic/70 uppercase mt-1">2-player · peer to peer</div>
            </div>

            {phase === 'role' && (
              <div className="space-y-3">
                <p className="text-sm text-ink/80 text-center">One of you hosts and shares a room code; the other joins with it. Direct P2P — the broker only introduces you.</p>
                <button onClick={chooseHost} className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110">Host a match</button>
                <button onClick={chooseJoin} className="w-full py-2.5 rounded-xl font-semibold bg-realm/50 border border-shield/40 hover:border-shield">Join a match</button>
              </div>
            )}

            {phase === 'host' && (
              <div className="space-y-4 text-center">
                <div className="text-[11px] uppercase tracking-wide text-magic/80">Your room code</div>
                {roomCode ? (
                  <>
                    <div className="font-display font-black text-5xl tracking-[0.3em] text-shield select-all">{roomCode}</div>
                    <button onClick={copyCode} className="text-xs px-3 py-1 rounded-lg bg-magic/20 border border-magic/40 hover:bg-magic/30">{copied ? 'Copied!' : 'Copy code'}</button>
                    <div className="text-[12px] text-magic/70 flex items-center justify-center gap-2"><Spinner /> waiting for opponent…</div>
                  </>
                ) : (
                  <div className="text-sm text-ink/80 flex items-center justify-center gap-2 py-6"><Spinner /> {status}</div>
                )}
              </div>
            )}

            {phase === 'join' && (
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-wide text-magic/80">Enter the host's room code</div>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && doJoin()}
                  placeholder="ABC123"
                  maxLength={8}
                  className="w-full text-center font-display font-black text-3xl tracking-[0.3em] bg-realm/60 border border-magic/40 rounded-xl px-3 py-3 uppercase focus:outline-none focus:border-magic"
                />
                <button onClick={doJoin} className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110">Connect</button>
                <div className="text-[12px] text-magic/60 text-center min-h-[16px]">{status}</div>
              </div>
            )}

            <button onClick={onQuit} className="mt-5 w-full text-[12px] text-magic/60 hover:text-magic">← back</button>
          </div>
        </div>
      )}

      {/* Result */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="panel p-8 text-center w-[min(92vw,420px)]">
            <div className="font-display font-black text-4xl mb-2"
              style={{ color: winner === 'self' ? '#7dffa0' : '#ff7a3c' }}>
              {winner === 'self' ? 'VICTORY' : 'DEFEATED'}
            </div>
            <div className="text-sm text-ink/80 mb-5">{winner === 'self' ? 'You knocked out your opponent!' : 'You were knocked out.'}</div>
            <button onClick={onQuit} className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-fire to-magic shadow-glow-fire hover:brightness-110">Back to menu</button>
          </div>
        </div>
      )}

      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[11px] text-magic/40 z-10">punch to attack · arms up to block</div>
    </div>
  );
}
