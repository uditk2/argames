// ===========================================================================
// Dino Survival — POSE SOURCE.
// ---------------------------------------------------------------------------
// Webcam + MediaPipe Pose (control only). The player avatar is now a baked run
// sprite, so we no longer run ImageSegmenter — pose-only is far lighter on mobile.
// Loads the vision bundle from the CDN at runtime. Emits mirrored landmarks.
// ===========================================================================
import { MP } from '../config.js';

export function createPoseSource(videoEl) {
  let pose = null, stream = null, running = false, raf = null, errCount = 0, lastErr = '';
  const video = videoEl;
  let _ts = 0; const nextTs = () => { let t = performance.now(); if (t <= _ts) t = _ts + 1; _ts = t; return t; };

  async function init() {
    const vision = await import(/* @vite-ignore */ MP.TV + '/vision_bundle.mjs');
    const { FilesetResolver, PoseLandmarker } = vision;
    const fs = await FilesetResolver.forVisionTasks(MP.TV + '/wasm');
    pose = await PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MP.POSE, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
  }
  async function startCamera() {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play().catch(() => {});
  }
  function start(onFrame) {
    running = true;
    const loop = () => {
      if (!running) return; let lm = null;
      if (video.readyState >= 2) {
        try { const r = pose.detectForVideo(video, nextTs()); lm = r?.landmarks?.[0] ? r.landmarks[0].map(p => ({ ...p, x: 1 - p.x })) : null; } catch (e) { errCount++; lastErr = (e && e.message) || String(e); }
      }
      onFrame(lm, video, null); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function dispose() {
    running = false; if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    try { pose?.close?.(); } catch (e) {}
  }
  return { init, startCamera, start, dispose, hasSeg: () => false, errors: () => errCount, lastError: () => lastErr };
}
