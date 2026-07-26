// ===========================================================================
// Temple / Relic Hunter — CLIP RECORDER (canvas MediaRecorder, own module).
// ---------------------------------------------------------------------------
// Records the game's WebGL <canvas> straight to a webm via captureStream +
// MediaRecorder. Captures the canvas pixels ONLY — so there's no mouse cursor
// and no OS screen-record chrome, and the resolution is exactly the canvas size
// (play in a 16:9 window for clean 1080p-ish footage). Audio is intentionally
// NOT captured (CrazyGames previews are silent). Pair with clipStore.js to keep
// the resulting blobs, and public/recordings.html to review them.
//
//   const rec = createClipRecorder({ canvas, fps });
//   rec.start();                       // begin
//   const clip = await rec.stop();     // -> { blob, mime, durationMs, w, h } | null
//   rec.recording  // bool     rec.elapsedMs  // ms since start
//
// Returns null from stop() if nothing was recording or no frames were captured.
// ===========================================================================

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return '';
}

export function isSupported() {
  return typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export function createClipRecorder({ canvas, fps = 30, bitrate = 12_000_000 } = {}) {
  let rec = null, chunks = [], startTs = 0, mime = '', stream = null;

  function start() {
    if (rec || !canvas || !isSupported()) return false;
    try {
      stream = canvas.captureStream(fps);
      mime = pickMime();
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(250);                 // gather in 250ms slices
      startTs = performance.now();
      return true;
    } catch (err) {
      console.warn('[clipRecorder] start failed', err);
      rec = null; stream = null;
      return false;
    }
  }

  function stop() {
    return new Promise((resolve) => {
      if (!rec) { resolve(null); return; }
      const r = rec, w = canvas.width, h = canvas.height, dur = performance.now() - startTs;
      rec = null;
      r.onstop = () => {
        try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        stream = null;
        if (!chunks.length) { resolve(null); return; }
        const type = mime || 'video/webm';
        resolve({ blob: new Blob(chunks, { type }), mime: type, durationMs: dur, w, h });
        chunks = [];
      };
      try { r.stop(); } catch { resolve(null); }
    });
  }

  return {
    start,
    stop,
    get recording() { return !!rec; },
    get elapsedMs() { return rec ? performance.now() - startTs : 0; },
  };
}

export default createClipRecorder;
