// ===========================================================================
// POSE TRACKER — MediaPipe Tasks Vision (Pose Landmarker) wrapper.
// ---------------------------------------------------------------------------
// Loads the ESM bundle + wasm + model from the known-good CDN URLs at runtime
// (intentionally NOT bundled, see vite.config.js). Emits normalized landmark
// arrays via a callback. Fully null-safe: if pose is lost it emits `null` and
// never throws.
//
// USAGE:
//   const tracker = createPoseTracker();
//   await tracker.init();                 // loads model (async, ~1-2s first time)
//   tracker.start(videoEl, (landmarks) => { ... });  // landmarks: [{x,y,z,visibility}] | null
//   tracker.stop();
// ===========================================================================

const MODULE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export function createPoseTracker() {
  let landmarker = null;
  let running = false;
  let rafId = null;

  async function init() {
    // Dynamic import keeps MediaPipe out of the production bundle.
    const vision = await import(/* @vite-ignore */ MODULE_URL);
    const { FilesetResolver, PoseLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return true;
  }

  /**
   * Begin detecting on a <video> element.
   * @param {HTMLVideoElement} video
   * @param {(landmarks: Array|null) => void} onLandmarks
   */
  function start(video, onLandmarks) {
    if (!landmarker) throw new Error('poseTracker.init() must finish before start()');
    running = true;

    const loop = () => {
      if (!running) return;
      try {
        if (video.readyState >= 2) {
          const res = landmarker.detectForVideo(video, performance.now());
          const lm = res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
          onLandmarks(lm);
        } else {
          onLandmarks(null);
        }
      } catch (err) {
        // Never let a detection hiccup crash the game.
        console.warn('[poseTracker] detect error (ignored):', err);
        onLandmarks(null);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function dispose() {
    stop();
    if (landmarker && landmarker.close) landmarker.close();
    landmarker = null;
  }

  return { init, start, stop, dispose };
}

/**
 * Request the webcam and attach it to a <video> element.
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}
