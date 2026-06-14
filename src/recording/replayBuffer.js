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
// moment getLastClip() can stitch "the last 10 seconds" into one Blob.
//
// SEPARATION OF CONCERNS: this file only CAPTURES. Turning a clip into a shared
// file is owned by the separate src/sharing/ module.
//
// FORMAT NOTE: we record MP4 (H.264/AAC) wherever the platform can — iOS Safari
// and modern Chrome/Android — so the clip is social-ready with no transcode.
// WebM (VP9/VP8) is only a fallback for engines that can't record MP4 (e.g.
// Firefox); see detectSupport() below.
//
// Null/again-safe: if MediaRecorder or captureStream is unsupported (e.g. older
// Safari), we feature-detect and degrade to a no-op so the game never crashes.
// ===========================================================================

import { REPLAY } from '../config/game.config.js';
import { rgba } from '../config/theme.js';

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

/**
 * Rebase fragmented-MP4 decode times to start at 0, IN PLACE.
 * ---------------------------------------------------------------------------
 * MediaRecorder writes each fragment's `tfdt` baseMediaDecodeTime as an ABSOLUTE
 * time from recording start. When we keep only the last ~10s of fragments, those
 * times are still ~Ns in, so a player shows a long empty lead-in and an inflated
 * duration. We walk the box tree, find every `tfdt`, and subtract the FIRST one's
 * value from all of them — so the clip timeline starts at 0. No re-encode.
 * @param {ArrayBuffer} buffer  concatenated [ftyp+moov][moof+mdat…] — mutated.
 */
function rebaseFmp4(buffer) {
  const u = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let offset = null; // first baseMediaDecodeTime seen = the amount to subtract
  function walk(start, end) {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      let header = 8;
      if (size === 1) { size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); header = 16; }
      else if (size === 0) { size = end - p; }
      if (size < header || p + size > end) break;
      const boxEnd = p + size;
      if (type === 'moof' || type === 'traf') {
        walk(p + header, boxEnd);                         // recurse to reach tfdt
      } else if (type === 'tfdt') {
        const c = p + header;                             // box content: version(1) flags(3) time
        const ver = u[c];
        if (ver === 1) {
          const t = c + 4;
          let val = dv.getUint32(t) * 4294967296 + dv.getUint32(t + 4);
          if (offset === null) offset = val;
          val = Math.max(0, val - offset);
          dv.setUint32(t, Math.floor(val / 4294967296));
          dv.setUint32(t + 4, val >>> 0);
        } else {
          const t = c + 4;
          const val = dv.getUint32(t);
          if (offset === null) offset = val;
          dv.setUint32(t, Math.max(0, val - offset) >>> 0);
        }
      }
      p = boxEnd;
    }
  }
  walk(0, u.length);
}

/** Read an EBML variable-length integer at `p`. Returns { value, len } or null. */
function ebmlVint(u, p) {
  const b0 = u[p];
  if (b0 === undefined || b0 === 0) return null;
  let mask = 0x80, len = 1;
  while (!(b0 & mask) && len <= 8) { mask >>= 1; len++; }
  if (len > 8 || p + len > u.length) return null;
  let value = b0 & (mask - 1);
  for (let i = 1; i < len; i++) value = value * 256 + u[p + i];
  return { value, len };
}

/**
 * Rebase WebM (Matroska) cluster timecodes to start at 0, IN PLACE.
 * ---------------------------------------------------------------------------
 * The WebM analogue of the MP4 tfdt problem: each Cluster carries an absolute
 * `Timecode` (0xE7) from recording start, so kept clusters sit ~Ns in. We scan
 * for Cluster IDs (1F 43 B6 75), read each cluster's first child Timecode, and
 * subtract the first one — writing back into the SAME byte width (rebased value
 * is always ≤ original, so it fits). Block-relative timecodes are untouched
 * (they're relative to the cluster). Used for the Firefox WebM fallback.
 * @param {ArrayBuffer} buffer  mutated in place.
 */
function rebaseWebm(buffer) {
  const u = new Uint8Array(buffer);
  let offset = null, p = 0;
  while (p + 4 < u.length) {
    if (u[p] === 0x1F && u[p + 1] === 0x43 && u[p + 2] === 0xB6 && u[p + 3] === 0x75) {
      const sz = ebmlVint(u, p + 4);                 // cluster size VINT (may be "unknown")
      if (sz) {
        const q = p + 4 + sz.len;                    // cluster content; first child should be Timecode
        if (u[q] === 0xE7) {
          const ln = ebmlVint(u, q + 1);
          if (ln && ln.value >= 1 && ln.value <= 8) {
            const n = ln.value, vpos = q + 1 + ln.len;
            let tc = 0;
            for (let i = 0; i < n; i++) tc = tc * 256 + u[vpos + i];
            if (offset === null) offset = tc;
            let nv = Math.max(0, tc - offset);
            for (let i = n - 1; i >= 0; i--) { u[vpos + i] = nv & 0xff; nv = Math.floor(nv / 256); }
            p = vpos + n;
            continue;                                // resume scanning after this timecode
          }
        }
      }
    }
    p++;
  }
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
  // When true, the compositor draws the SCENE canvas full-frame and overlays a
  // small webcam picture-in-picture near the avatar (only in the recorded clip —
  // the live game never shows it). Used by games whose canvas is opaque (Dino).
  let webcamInsetMode = false;

  // What the compositor draws each frame:
  //   'live'     — the game (canvas [+ webcam], the default during a run)
  //   'cutscene' — a fullscreen ending video (the dino chomp / jeep escape), which
  //                plays as a DOM <video> the canvas never shows, so we draw it here
  //                so the CLIP actually contains the payoff (not a frozen trail).
  //   'card'     — a branded outcome card drawn for the last ~1.5s, so a looping
  //                clip always closes on the result + brand.
  let drawMode = 'live';
  let cutsceneVideo = null;   // <video> drawn fullscreen in 'cutscene' mode
  let endCard = null;         // { escaped, primary } drawn in 'card' mode

  /** Switch what the recorder composites. See drawMode above. */
  function setMode(m, opts = {}) {
    drawMode = m || 'live';
    if (m === 'cutscene') cutsceneVideo = opts.video || null;
    if (m === 'card') endCard = opts.card || null;
  }

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
  function start({ video = null, pixiCanvas: canvas, demoBg = null, webcamInset = false } = {}) {
    if (!isSupported || !canvas) return false;
    if (running) return true;
    try {
      videoEl = video || null;
      pixiCanvas = canvas;
      webcamInsetMode = !!webcamInset;
      drawMode = 'live'; cutsceneVideo = null; endCard = null;   // fresh per run

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

      // Composite loop: redraw the offscreen canvas at the CAPTURE fps, not every
      // animation frame. captureStream only samples at `fps`, so drawing at ~60fps
      // doubled the canvas/GPU work for nothing — throttling roughly halves the
      // recorder's load (important when pose detection is also running).
      const frameMs = 1000 / Math.max(1, fps);
      let lastDraw = -1e9;
      const tick = (now) => {
        if (!running) return;
        if (now - lastDraw >= frameMs - 1) { drawFrame(demoBg); lastDraw = now; }
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

  /** Draw one composite frame. Two layouts:
   *  • default (transparent FX canvas, e.g. Demon): webcam under, canvas over.
   *  • inset (opaque scene canvas, e.g. Dino): scene full-frame, webcam PiP over. */
  function drawFrame(demoBg) {
    if (!ctx || !offscreen) return;
    const w = offscreen.width;
    const h = offscreen.height;
    const camReady = videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0;

    ctx.save();
    ctx.fillStyle = '#0a0510';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Ending overlays (Dino): the cutscene + outcome card so the clip has a real
    // finish instead of a frozen, character-less trail frame.
    if (drawMode === 'card' && endCard) { drawEndCard(ctx, w, h, endCard); return; }
    if (drawMode === 'cutscene') {
      const v = cutsceneVideo;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        drawCover(ctx, v, v.videoWidth, v.videoHeight, w, h, false);   // cutscene is already correctly oriented — no mirror
        return;
      }
      // not ready yet → fall through and keep showing the frozen scene
    }

    if (webcamInsetMode) {
      // Opaque scene first, then a small webcam picture-in-picture near the avatar
      // (clip-only — never shown live). Demo / no-camera just records the scene.
      if (pixiCanvas && pixiCanvas.width > 0) {
        try { ctx.drawImage(pixiCanvas, 0, 0, w, h); } catch { /* skip */ }
      }
      if (camReady) drawWebcamInset(ctx, videoEl, w, h);
      return;
    }

    // (1) Webcam frame, object-cover + horizontal mirror to match the screen.
    if (camReady) {
      drawCover(ctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, w, h, mirror);
    } else if (demoBg) {
      // Demo / no-camera: a soft accent realm glow so the clip isn't empty.
      const g = ctx.createRadialGradient(w / 2, h * 1.05, h * 0.1, w / 2, h * 1.05, h * 0.9);
      g.addColorStop(0, rgba.magic(0.28));
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

  /** Branded outcome card drawn as the final frames so a looping clip closes on
   *  the result + brand (works in both landscape and portrait — text scales to h). */
  function drawEndCard(c, w, h, card) {
    c.save();
    c.fillStyle = '#0c0a1f';
    c.fillRect(0, 0, w, h);
    // soft warm glow from the bottom (matches the share card / brand)
    const g = c.createRadialGradient(w / 2, h * 1.05, h * 0.1, w / 2, h * 1.05, h * 0.95);
    g.addColorStop(0, 'rgba(255,122,60,0.30)');
    g.addColorStop(1, 'rgba(12,10,31,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    const cx = w / 2;
    c.fillStyle = '#a06bff'; c.font = `900 ${Math.round(h * 0.05)}px system-ui`;
    c.fillText('DINO SURVIVAL', cx, h * 0.30);
    c.fillStyle = card.escaped ? '#7dffa0' : '#ff6b8a';
    c.font = `900 ${Math.round(h * 0.12)}px system-ui`;
    c.fillText(card.escaped ? 'ESCAPED' : 'CAUGHT', cx, h * 0.50);
    c.fillStyle = '#ffffff'; c.font = `900 ${Math.round(h * 0.17)}px system-ui`;
    c.fillText(String(card.primary || ''), cx, h * 0.70);
    c.fillStyle = '#ff7a3c'; c.font = `800 ${Math.round(h * 0.042)}px system-ui`;
    c.fillText('outrun the beast · slayfit', cx, h * 0.84);
    c.restore();
  }

  /** Rounded-rectangle path on a 2D context. */
  function roundRectPath(c, x, y, rw, rh, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + rw, y, x + rw, y + rh, r);
    c.arcTo(x + rw, y + rh, x, y + rh, r);
    c.arcTo(x, y + rh, x, y, r);
    c.arcTo(x, y, x + rw, y, r);
    c.closePath();
  }

  /** Webcam picture-in-picture, bottom-left near the avatar, rounded + bordered.
   *  Object-cover + mirror to match how the player saw themselves. */
  function drawWebcamInset(c, src, W, H) {
    const sw = src.videoWidth, sh = src.videoHeight;
    if (!sw || !sh) return;
    const iw = Math.round(W * 0.26);                  // ~quarter width
    const ih = Math.round(iw * 1.25);                 // portrait-ish PiP
    const m = Math.round(W * 0.035);                  // margin from the edges
    const x = m, y = H - ih - m;                      // bottom-left, beside the centered avatar
    const r = Math.round(iw * 0.09);

    // Image (clipped to the rounded rect, mirrored, object-cover).
    c.save();
    roundRectPath(c, x, y, iw, ih, r);
    c.clip();
    c.translate(x, y);
    if (mirror) { c.translate(iw, 0); c.scale(-1, 1); }
    const scale = Math.max(iw / sw, ih / sh);
    const rw = sw * scale, rh = sh * scale;
    c.drawImage(src, (iw - rw) / 2, (ih - rh) / 2, rw, rh);
    c.restore();

    // Border + soft shadow so it reads as a deliberate inset.
    c.save();
    roundRectPath(c, x, y, iw, ih, r);
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = Math.round(W * 0.02);
    c.lineWidth = Math.max(2, Math.round(W * 0.005));
    c.strokeStyle = rgba.magic(0.9);
    c.stroke();
    c.restore();
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
   * Async because we read the bytes to rebase MP4 fragment timestamps (below).
   * @returns {Promise<{ blob: Blob, url: string, mime: string, durationSec: number }|null>}
   */
  async function getLastClip() {
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
    let blob = new Blob(parts, { type });
    if (!blob.size) return null;
    // The kept MP4 fragments retain their ORIGINAL absolute decode times (e.g.
    // ~30s into the run), so a player reports a 40s clip with a 30s empty
    // lead-in. Rebase every fragment's tfdt so the clip starts at t=0 — a clean
    // ~windowMs clip with no re-encode. (WebM left as-is; MP4 is the shared path.)
    if (type.includes('mp4')) {
      try {
        const ab = await blob.arrayBuffer();
        rebaseFmp4(ab);
        blob = new Blob([ab], { type });
      } catch (e) {
        console.warn('[replayBuffer] tfdt rebase skipped:', e);
      }
    } else if (type.includes('webm')) {
      try {
        const ab = await blob.arrayBuffer();
        rebaseWebm(ab);
        blob = new Blob([ab], { type });
      } catch (e) {
        console.warn('[replayBuffer] webm timecode rebase skipped:', e);
      }
    }
    const url = URL.createObjectURL(blob);
    const durationSec = Math.min(windowMs, use.length * timesliceMs) / 1000;
    return { blob, url, mime: type, durationSec };
  }

  return { start, stop, getLastClip, isSupported, setMode };
}
