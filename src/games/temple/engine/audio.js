// ===========================================================================
// Temple Collapse — AUDIO (real CC0 samples via Web Audio, procedural fallback).
// ---------------------------------------------------------------------------
// Loads CC0 sound effects (Kenney, public/assets/temple/audio/*.ogg) + a
// royalty-free music loop (music.mp3) with fetch + decodeAudioData — NOT <audio>,
// so it works on any static host with no Range support. Every event tries its
// real sample first and falls back to a synth beep if the buffer isn't ready.
// A single master gain gives a global mute; ambient() runs the music bed + a low
// rumble that swells as the collapse nears.
//
//   const audio = createAudio();
//   audio.resume();  // first user gesture — unlocks the context + kicks off loading
//   audio.jump()/duck()/turn()/back()/stumble()/clear()/pickup()/win()/lose()
//   audio.die('blade'|'fire'|'collapse'|...)  audio.doorGrind(intensity)
//   audio.ambient(on)  audio.danger(0..1)  audio.tickFeet(dt, moving)
//   audio.setMuted(bool) / audio.toggleMuted()
// ===========================================================================
import { assetUrl } from '../assetUrl.js';

const SAMPLES = {
  footstep: 'footstep.ogg', jump: 'jump.ogg', duck: 'duck.ogg', turn: 'turn.ogg', back: 'back.ogg',
  stumble: 'stumble.ogg', clear: 'clear.ogg', blade: 'blade.ogg', die: 'die.ogg', collapse: 'collapse.ogg',
  door: 'door.ogg', pickup: 'pickup.ogg', win: 'win.ogg', lose: 'lose.ogg',
};
// Backdrop music (user-supplied) — a single looping track. Swap the filename to change it.
const MUSIC = 'music_chase.mp3';

export function createAudio() {
  let ctx = null, master = null, muted = false, footT = 0;
  const buffers = {};
  let loadStarted = false;
  // beds
  let bed = null, bedGain = null, bedFilter = null;   // low noise rumble
  let drone = null, droneG = null;                     // synth tonal bed (only if music missing)
  let musicSrc = null, musicGain = null, wantMusic = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    loadSamples();
    return ctx;
  }
  function resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }

  async function loadSamples() {
    if (loadStarted || !ctx) return; loadStarted = true;
    await Promise.all(Object.entries(SAMPLES).map(async ([name, file]) => {
      try {
        const res = await fetch(assetUrl('assets/temple/audio/' + file));
        buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) { /* keep procedural fallback */ }
    }));
    // Backdrop music: load the single track; start it if ambient is already on.
    try {
      const res = await fetch(assetUrl('assets/temple/audio/' + MUSIC));
      buffers.music = await ctx.decodeAudioData(await res.arrayBuffer());
      if (wantMusic && !musicSrc) startMusic();
    } catch (e) { /* no backdrop — rumble bed only */ }
  }

  // play a loaded sample; returns false if not ready (caller uses a synth fallback).
  function playBuf(name, gain = 0.85, rate = 1) {
    const b = buffers[name]; if (!b || !ctx) return false;
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(master); src.start();
    return true;
  }

  // --- synth primitives (fallback only) --------------------------------------
  function env(node, t0, a, d, peak) {
    const g = node.gain; g.cancelScheduledValues(t0); g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0002, t0 + a + d);
  }
  function tone({ freq = 300, type = 'sine', a = 0.005, d = 0.15, peak = 0.4, slideTo = null, slideT = 0.12 }) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + slideT);
    o.connect(g); g.connect(master); env(g, c.currentTime, a, d, peak);
    o.start(); o.stop(c.currentTime + a + d + 0.05);
  }
  function noise({ d = 0.2, peak = 0.4, type = 'lowpass', freq = 1200, q = 0.7 }) {
    const c = ensure(); if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * d));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = c.createGain(); src.connect(filt); filt.connect(g); g.connect(master);
    env(g, c.currentTime, 0.004, d, peak); src.start(); src.stop(c.currentTime + d + 0.03);
  }

  // --- SFX (sample first, synth fallback) ------------------------------------
  const jump = () => { if (!playBuf('jump', 0.5)) { tone({ freq: 220, type: 'triangle', slideTo: 520, slideT: 0.17, d: 0.18, peak: 0.24 }); noise({ d: 0.24, peak: 0.16, type: 'highpass', freq: 650 }); } };
  const duck = () => { if (!playBuf('duck', 0.5)) { tone({ freq: 380, type: 'sine', slideTo: 140, slideT: 0.17, d: 0.2, peak: 0.2 }); noise({ d: 0.22, peak: 0.16, freq: 700 }); } };
  const turn = () => {};   // turn sound removed per feedback (read as "weird")
  const back = () => { if (!playBuf('back', 0.5)) { tone({ freq: 300, type: 'sine', slideTo: 200, slideT: 0.1, d: 0.14, peak: 0.2 }); } };
  const stumble = () => { if (!playBuf('stumble', 0.7)) { noise({ d: 0.22, peak: 0.4, freq: 500, q: 1 }); tone({ freq: 120, type: 'square', d: 0.16, peak: 0.2 }); } };
  const clear = () => { if (!playBuf('clear', 0.5)) { tone({ freq: 880, type: 'sine', d: 0.11, peak: 0.2 }); tone({ freq: 1320, type: 'sine', d: 0.14, peak: 0.12 }); } };
  const footstep = () => { playBuf('footstep', 0.3); };
  const pickup = () => { if (!playBuf('pickup', 0.7)) { tone({ freq: 660, type: 'sine', d: 0.5, peak: 0.4, slideTo: 990, slideT: 0.28 }); tone({ freq: 990, type: 'sine', d: 0.7, peak: 0.28 }); } };
  const win = () => { if (!playBuf('win', 0.7)) { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', d: 0.4, peak: 0.34 }), i * 110)); } };
  const lose = () => { if (!playBuf('lose', 0.7)) { tone({ freq: 200, type: 'sawtooth', slideTo: 60, slideT: 0.6, d: 0.7, peak: 0.4 }); } };
  function die(cause) {
    if (cause === 'blade') { if (!playBuf('blade', 0.75)) noise({ d: 0.2, peak: 0.3, type: 'highpass', freq: 3000 }); }
    else if (cause === 'collapse') { if (!playBuf('collapse', 0.9)) { noise({ d: 1.1, peak: 0.6, freq: 260 }); } }
    else { if (!playBuf('die', 0.8)) lose(); }
  }
  const doorGrind = () => {};   // stone-door grind removed (read as "cranking") — a better track is coming

  // --- beds ------------------------------------------------------------------
  function startRumble() {
    const c = ensure(); if (!c || bed) return;
    const len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    bed = c.createBufferSource(); bed.buffer = buf; bed.loop = true;
    bedFilter = c.createBiquadFilter(); bedFilter.type = 'lowpass'; bedFilter.frequency.value = 120; bedFilter.Q.value = 0.6;
    bedGain = c.createGain(); bedGain.gain.value = 0.04;
    bed.connect(bedFilter); bedFilter.connect(bedGain); bedGain.connect(master); bed.start();
  }
  function stopRumble() { if (bed) { try { bed.stop(); } catch {} bed = null; bedGain = null; bedFilter = null; } }
  function startDrone() {
    const c = ensure(); if (!c || drone || buffers.music) return;   // only if no real music
    droneG = c.createGain(); droneG.gain.value = 0.0001; droneG.connect(master);
    drone = [55, 82.4, 110].map((f, i) => { const o = c.createOscillator(); o.type = i === 2 ? 'sine' : 'sawtooth'; o.frequency.value = f * (i === 1 ? 1.003 : 1); const g = c.createGain(); g.gain.value = i === 2 ? 0.5 : 0.2; o.connect(g); g.connect(droneG); o.start(); return o; });
    droneG.gain.setTargetAtTime(0.028, c.currentTime, 2.0);
  }
  function stopDrone() { if (drone) { drone.forEach((o) => { try { o.stop(); } catch {} }); drone = null; } if (droneG) { try { droneG.disconnect(); } catch {} droneG = null; } }
  function startMusic() {
    if (!ctx || !buffers.music || musicSrc) return;
    stopDrone();   // real music replaces the synth bed
    musicSrc = ctx.createBufferSource(); musicSrc.buffer = buffers.music; musicSrc.loop = true;
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0001;
    musicSrc.connect(musicGain); musicGain.connect(master); musicSrc.start();
    musicGain.gain.setTargetAtTime(0.32, ctx.currentTime, 2.0);
  }
  function stopMusic() { if (musicSrc) { try { musicSrc.stop(); } catch {} musicSrc = null; musicGain = null; } }

  function ambient(on) {
    const c = ensure(); if (!c) return;
    if (on) { wantMusic = true; if (buffers.music) startMusic(); startRumble(); }
    else { wantMusic = false; stopMusic(); stopRumble(); }
  }
  function danger(x) {
    if (!ctx) return; const t = ctx.currentTime;
    if (bedGain) { bedGain.gain.setTargetAtTime(0.04 + 0.13 * x, t, 0.4); bedFilter.frequency.setTargetAtTime(120 + 260 * x, t, 0.4); }
    if (musicGain) musicGain.gain.setTargetAtTime(0.24 + 0.14 * x, t, 0.6);   // backdrop swells as collapse nears
  }

  function tickFeet(dt, moving, pace = 1) {
    if (!moving) { footT = 0; return; }
    footT += dt * pace; if (footT >= 0.33) { footT = 0; footstep(); }
  }
  function setMuted(v) { muted = !!v; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02); return muted; }
  function toggleMuted() { return setMuted(!muted); }

  return {
    resume, jump, duck, turn, back, stumble, clear, pickup, win, lose, die, doorGrind,
    ambient, danger, tickFeet, setMuted, toggleMuted, get muted() { return muted; },
  };
}

export default createAudio;
