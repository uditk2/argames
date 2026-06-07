// ===========================================================================
// REPLAY BUFFER — rolling ~10s instant-replay CAPTURE (capture concern only).
// ---------------------------------------------------------------------------
// The visible game is two stacked layers:
//   (1) the mirrored webcam <video>            (behind, z-0)
//   (2) the transparent PixiJS canvas (FX/HUD) (on top,  z-1)
// A useful clip must show BOTH composited ("you in the demon realm"). So this
// module runs an OFFSCREEN compositor canvas: every animation frame it draws
// the current webcam frame (respecting the same horizontal mirror used on
// screen) and then the Pixi canvas on top. That offscreen canvas is recorded
// with `offscreen.captureStream(fps)` -> MediaRecorder.
//
// Rolling window: MediaRecorder is started with a timeslice so it emits a chunk
// roughly every second; we keep only the most recent ~10 chunks, so at any
// moment getLastClip() can stitch "the last 10 seconds" into one WebM Blob.
//
// SEPARATION OF CONCERNS: this file only CAPTURES. Turning a clip into a shared
// file is owned by the separate src/sharing/ module.
//
// FORMAT NOTE (honest): the clip is WebM (VP8/VP9 — broadly supported by
// MediaRecorder on Chrome/Firefox/Edge/Android). Instagram & TikTok prefer MP4;
// an MP4 transcode is a known follow-up (e.g. via ffmpeg.wasm or a server hop).
//
// Null/again-safe: if MediaRecorder or captureStream is unsupported (e.g. older
// Safari), we feature-detect and degrade to a no-op so the game never crashes.
// ===========================================================================

import { REPLAY } from '../config/game.config.js';

/**
 * Detect MediaRecorder + the best available mime up front (no side effects).
 *
 * We PREFER MP4 (H.264/AAC) so the clip is social-ready (Instagram/TikTok want
 * MP4) with zero transcoding when the platform can record it natively:
 *   - iOS Safari 14.5+  → records video/mp4 natively
 *   - Chrome 126+ (desktop/Android) → video/mp4 when an OS H.264 encoder exists
 * Everything else falls back to WebM (VP9/VP8), which a separate transcode
 * module can later convert to MP4 on demand.
 */
function detectSupport() {
  if (typeof MediaRecorder === 'undefined') return { ok: false, mime: '', isMp4: false };
  if (typeof document === 'undefined') return { ok: false, mime: '', isMp4: false };
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') return { ok: false, mime: '', isMp4: false };
  const supports = (m) =>
    typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m);
  // MP4 first (native, social-ready), then WebM fallback.
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // H.264 baseline + AAC
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mime = candidates.find(supports) || '';
  const isMp4 = mime.startsWith('video/mp4');
  // Some engines expose MediaRecorder but no mime match; still try empty mime.
  return { ok: true, mime, isMp4 };
}

export function createReplayBuffer(opts = {}) {
  const windowMs = opts.windowMs ?? REPLAY.windowMs;
  const timesliceMs = opts.timesliceMs ?? REPLAY.timesliceMs;
  const fps = opts.fps ?? REPLAY.fps;
  const mirror = opts.mirror ?? REPLAY.mirror;

  const support = detectSupport();

  let recorder = null;
  let chunks = []; // [{ blob, t }]
  // The VERY FIRST chunk MediaRecorder emits carries the stream initialization
  // segment — the EBML header (WebM) or the ftyp+moov boxes (fragmented MP4).
  // The rolling window prunes old chunks, but if we ever drop this one the
  // concatenated clip has no header and is undecodable (Chrome throws
  // DEMUXER_ERROR_COULD_NOT_OPEN). So we keep it forever and re-prepend it when
  // assembling the clip.
  let headBlob = null;
  let rafId = null;
  let offscreen = null;
  let ctx = null;
  let videoEl = null;
  let pixiCanvas = null;
  let mime = support.mime;
  let running = false;

  /** Whether instant-replay capture is available in this browser. */
  const isSupported = support.ok;

  /**
   * Start the rolling capture.
   * @param {Object} sources
   * @param {HTMLVideoElement|null} sources.video      live webcam (null in demo)
   * @param {HTMLCanvasElement}     sources.pixiCanvas the transparent FX canvas
   * @param {HTMLElement|null}      [sources.demoBg]   optional element drawn as a
   *        backdrop when there's no webcam (kept simple: a flat realm fill).
   * @returns {boolean} true if capture started
   */
  function start({ video = null, pixiCanvas: canvas, demoBg = null } = {}) {
    if (!isSupported || !canvas) return false;
    if (running) return true;
    try {
      videoEl = video || null;
      pixiCanvas = canvas;

      // Size the compositor to the Pixi canvas (the on-screen drawing size).
      const w = canvas.width || 720;
      const h = canvas.height || 1280;
      offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      ctx = offscreen.getContext('2d');

      // First paint so the stream has a frame before recording starts.
      drawFrame(demoBg);

      const stream = offscreen.captureStream(fps);
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      // Capture the actually-negotiated mime for the resulting Blob.
      mime = recorder.mimeType || mime || 'video/webm';

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) {
          if (!headBlob) headBlob = e.data; // first chunk = header/init segment
          chunks.push({ blob: e.data, t: performance.now() });
          // Drop chunks older than the rolling window (+ one slice of slack so a
          // freshly-finalized chunk isn't pruned before it can be used).
          const cutoff = performance.now() - (windowMs + timesliceMs);
          chunks = chunks.filter((c) => c.t >= cutoff);
        }
      };

      recorder.start(timesliceMs);
      running = true;

      // Composite loop: keep the offscreen canvas updated every frame.
      const tick = () => {
        if (!running) return;
        drawFrame(demoBg);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return true;
    } catch (e) {
      console.warn('[replayBuffer] start failed; disabling capture:', e);
      cleanup();
      return false;
    }
  }

  /** Draw one composite frame: webcam (mirrored) under, Pixi canvas over. */
  function drawFrame(demoBg) {
    if (!ctx || !offscreen) return;
    const w = offscreen.width;
    const h = offscreen.height;

    // Base fill (also the demo backdrop when there's no camera).
    ctx.save();
    ctx.fillStyle = '#0a0510';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // (1) Webcam frame, object-cover + horizontal mirror to match the screen.
    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      drawCover(ctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, w, h, mirror);
    } else if (demoBg) {
      // Demo / no-camera: a soft purple realm glow so the clip isn't empty.
      const g = ctx.createRadialGradient(w / 2, h * 1.05, h * 0.1, w / 2, h * 1.05, h * 0.9);
      g.addColorStop(0, 'rgba(154,76,255,0.28)');
      g.addColorStop(1, 'rgba(10,5,16,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // (2) Pixi canvas (transparent — demons, traps, energy FX) on top.
    if (pixiCanvas && pixiCanvas.width > 0) {
      try {
        ctx.drawImage(pixiCanvas, 0, 0, w, h);
      } catch {
        /* canvas may be transiently untainted/empty; skip this frame */
      }
    }
  }

  /** object-cover blit with optional horizontal mirror. */
  function drawCover(c, src, sw, sh, dw, dh, doMirror) {
    const scale = Math.max(dw / sw, dh / sh);
    const rw = sw * scale;
    const rh = sh * scale;
    const dx = (dw - rw) / 2;
    const dy = (dh - rh) / 2;
    c.save();
    if (doMirror) {
      c.translate(dw, 0);
      c.scale(-1, 1);
      // After mirroring, the destination x flips: mirror dx accordingly.
      c.drawImage(src, dw - dx - rw, dy, rw, rh);
    } else {
      c.drawImage(src, dx, dy, rw, rh);
    }
    c.restore();
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (recorder && recorder.state !== 'inactive') {
      try {
        // Flush a final chunk so the very last second is included.
        recorder.requestData();
      } catch {}
      try {
        recorder.stop();
      } catch {}
    }
  }

  function cleanup() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    recorder = null;
    headBlob = null;
    offscreen = null;
    ctx = null;
    videoEl = null;
    pixiCanvas = null;
  }

  /**
   * Assemble the most recent ~windowMs of footage into a single clip.
   * @returns {{ blob: Blob, url: string, mime: string, durationSec: number }|null}
   */
  function getLastClip() {
    if (!chunks.length) return null;
    const cutoff = performance.now() - (windowMs + timesliceMs);
    const recent = chunks.filter((c) => c.t >= cutoff);
    const use = recent.length ? recent : chunks;
    const type = mime || 'video/webm';
    // Prepend the header/init segment so the muxed stream is openable even after
    // the original first chunk was pruned out of the rolling window. Skip it if
    // the header is already the first chunk in `use` (early game, nothing pruned).
    const parts = [];
    if (headBlob && (!use.length || use[0].blob !== headBlob)) parts.push(headBlob);
    for (const c of use) parts.push(c.blob);
    const blob = new Blob(parts, { type });
    if (!blob.size) return null;
    const url = URL.createObjectURL(blob);
    const durationSec = Math.min(windowMs, use.length * timesliceMs) / 1000;
    return { blob, url, mime: type, durationSec };
  }

  return { start, stop, getLastClip, isSupported };
}
