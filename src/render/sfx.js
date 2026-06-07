// ===========================================================================
// SFX — tiny, modular WebAudio sound helper for combat feedback.
// ---------------------------------------------------------------------------
// Decodes a small bank of impact sounds once and plays them on demand with a
// little pitch/gain variation so repeated hits don't feel robotic. Fully
// null-safe and lazy: if WebAudio is unavailable or a clip fails to load, every
// call is a quiet no-op. The render layer owns this (it's pure "juice"); the
// engine never touches audio.
// ===========================================================================

const CLIPS = {
  hit: '/assets/audio/impactPunch_medium_000.ogg',   // a normal connect
  hitSoft: '/assets/audio/impactSoft_medium_000.ogg', // brute chip (multi-hit)
  kill: '/assets/audio/impactPunch_heavy_000.ogg',    // the meatier kill thud
};

export function createSfx() {
  let ctx = null;
  const buffers = {};   // key -> AudioBuffer
  let unlocked = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      console.warn('[sfx] no AudioContext', e);
      ctx = null;
    }
    return ctx;
  }

  async function loadOne(key, url) {
    const c = ensureCtx();
    if (!c) return;
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      buffers[key] = await c.decodeAudioData(arr);
    } catch (e) {
      console.warn('[sfx] failed to load', url, e);
    }
  }

  /** Preload the bank (call once; safe to await or fire-and-forget). */
  async function init() {
    if (!ensureCtx()) return;
    await Promise.all(Object.entries(CLIPS).map(([k, u]) => loadOne(k, u)));
  }

  /** Browsers gate audio until a user gesture; call this from a click/keydown. */
  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
  }

  /**
   * Play a clip with slight randomized pitch + gain.
   * @param {keyof typeof CLIPS} key
   * @param {{volume?:number, rate?:number}} [opts]
   */
  function play(key, opts = {}) {
    const c = ctx;
    const buf = buffers[key];
    if (!c || !buf) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = (opts.rate ?? 1) * (0.92 + Math.random() * 0.16);
      const gain = c.createGain();
      gain.gain.value = opts.volume ?? 0.9;
      src.connect(gain).connect(c.destination);
      src.start();
    } catch (e) {
      // never let audio break the render loop
    }
  }

  return { init, unlock, play, get unlocked() { return unlocked; } };
}
