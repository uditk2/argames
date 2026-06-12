// ===========================================================================
// Dino Survival — POSE SOURCE.
// ---------------------------------------------------------------------------
// Webcam + MediaPipe Pose (control) + ImageSegmenter (player cutout). Loads the
// vision bundle from the CDN at runtime (kept out of the bundle, same pattern
// as src/vision/poseTracker.js). Emits mirrored landmarks + the latest mask.
// ===========================================================================
import { MP } from '../config.js';

export function createPoseSource(videoEl) {
  let pose = null, seg = null, stream = null, running = false, raf = null, latestMask = null;
  const video = videoEl;
  let _ts = 0; const nextTs = () => { let t = performance.now(); if (t <= _ts) t = _ts + 1; _ts = t; return t; };

  async function init() {
    const vision = await import(/* @vite-ignore */ MP.TV + '/vision_bundle.mjs');
    const { FilesetResolver, PoseLandmarker, ImageSegmenter } = vision;
    const fs = await FilesetResolver.forVisionTasks(MP.TV + '/wasm');
    pose = await PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MP.POSE, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
    try {
      seg = await ImageSegmenter.createFromOptions(fs, {
        baseOptions: { modelAssetPath: MP.SEG, delegate: 'GPU' },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    } catch (e) { seg = null; }
  }
  async function startCamera() {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play().catch(() => {});
  }
  function start(onFrame) {
    running = true; let fc = 0;
    const loop = () => {
      if (!running) return; let lm = null;
      if (video.readyState >= 2) {
        // pose every frame (responsive cadence); segmentation every OTHER frame
        // (the cutout doesn't need 60fps) — frees a lot of CPU for smoothness.
        try { const r = pose.detectForVideo(video, nextTs()); lm = r?.landmarks?.[0] ? r.landmarks[0].map(p => ({ ...p, x: 1 - p.x })) : null; } catch (e) {}
        if (seg && (fc % 2 === 0)) { try { seg.segmentForVideo(video, nextTs(), (res) => { latestMask = res?.confidenceMasks?.[0] || null; }); } catch (e) {} }
      }
      fc++;
      onFrame(lm, video, latestMask); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function dispose() {
    running = false; if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    try { pose?.close?.(); seg?.close?.(); } catch (e) {}
  }
  return { init, startCamera, start, dispose, hasSeg: () => !!seg };
}
