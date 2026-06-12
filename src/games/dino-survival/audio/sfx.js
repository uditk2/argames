// ===========================================================================
// Dino Survival — AUDIO (fully procedural, Web Audio API).
// ---------------------------------------------------------------------------
// Every sound is synthesised at runtime — NO audio files, so there are no
// placeholders and no licensing to track. One master gain = mute (persisted).
// Same shape the host wires to:
//   one-shots: play(name, vol, rate)   names: roar snarl chomp engine footfall footstep door beep
//   loops:     startLoop / setLoop / stopLoop / stopAll   names: amb music run
//   master:    setMuted / toggle / isMuted / resume / dispose
// The context must be resumed on a user gesture (the host does this on Start).
// ===========================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MUTE_KEY = 'slayfit_dino_muted';

export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {                                   // no Web Audio -> inert no-op API
    const noop = () => {};
    return { play: noop, startLoop: noop, setLoop: noop, stopLoop: noop, stopAll: noop,
      setMuted: noop, toggle: () => false, isMuted: () => true, resume: noop, dispose: noop };
  }
  const ctx = new Ctx();
  let muted = false; try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}
  const master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
  const now = () => ctx.currentTime;

  // --- shared building blocks -------------------------------------------------
  let _noise;                                   // 2s of white noise, reused everywhere
  function noiseBuf() { if (!_noise) { const n = ctx.sampleRate * 2; _noise = ctx.createBuffer(1, n, ctx.sampleRate); const d = _noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } return _noise; }
  function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noiseBuf(); s.loop = true; return s; }
  function shaper(k) { const ws = ctx.createWaveShaper(); const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } ws.curve = c; return ws; }
  // exponential one-shot envelope (attack then decay to ~0), auto-stops the source(s)
  function envGain(t, a, d, peak) { const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }

  // --- one-shot voices --------------------------------------------------------
  function roar(vol = 1, rate = 1) {
    const t = now(), dur = 1.15;
    const out = ctx.createGain(); out.gain.value = clamp(vol, 0, 1); out.connect(master);
    const dist = shaper(8); dist.connect(out);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7;            // "mouth" opens then closes
    lp.frequency.setValueAtTime(320, t); lp.frequency.linearRampToValueAtTime(1900, t + 0.32); lp.frequency.linearRampToValueAtTime(480, t + dur); lp.connect(dist);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.12); env.gain.setValueAtTime(1, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); env.connect(lp);
    const base = 95 * rate;
    [0, -0.05, 0.07].forEach((dt, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = base * (1 + dt);
      o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.2); o.frequency.linearRampToValueAtTime(f * 0.7, t + dur);
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 22 + i * 6; const lg = ctx.createGain(); lg.gain.value = f * 0.12; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
      o.connect(env); o.start(t); o.stop(t + dur);
    });
    const ns = noiseSrc(); const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 0.7; const ng = ctx.createGain(); ng.gain.value = 0.25; ns.connect(nbp); nbp.connect(ng); ng.connect(env); ns.start(t); ns.stop(t + dur);
  }
  function snarl(vol = 1, rate = 1) {
    const t = now(), dur = 0.5;
    const out = ctx.createGain(); out.gain.value = clamp(vol, 0, 1); out.connect(master);
    const dist = shaper(12); dist.connect(out);
    const env = envGain(t, 0.04, dur - 0.04, 1); env.connect(dist);
    const base = 150 * rate;
    [0, 0.06].forEach((dt) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = base * (1 + dt); o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.8, t + dur);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 30; const lg = ctx.createGain(); lg.gain.value = f * 0.2; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur); o.connect(env); o.start(t); o.stop(t + dur); });
    const ns = noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; ns.connect(bp); const ng = ctx.createGain(); ng.gain.value = 0.35; bp.connect(ng); ng.connect(env); ns.start(t); ns.stop(t + dur);
  }
  function chomp(vol = 1) {
    const t = now(); const out = ctx.createGain(); out.gain.value = clamp(vol, 0, 1); out.connect(master);
    // jaw snap (high click) -> wet crunch (mid noise, distorted) -> low gulp thud
    const snap = noiseSrc(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; const sg = envGain(t, 0.002, 0.05, 0.6); snap.connect(hp); hp.connect(sg); sg.connect(out); snap.start(t); snap.stop(t + 0.08);
    const cr = noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8; const ds = shaper(6); const cg = envGain(t + 0.05, 0.01, 0.14, 0.8); cr.connect(bp); bp.connect(ds); ds.connect(cg); cg.connect(out); cr.start(t + 0.05); cr.stop(t + 0.22);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(80, t + 0.08); o.frequency.exponentialRampToValueAtTime(42, t + 0.26); const og = envGain(t + 0.08, 0.01, 0.2, 0.7); o.connect(og); og.connect(out); o.start(t + 0.08); o.stop(t + 0.3);
  }
  function engine(vol = 1, rate = 1) {
    const t = now(), dur = 1.5;
    const out = ctx.createGain(); out.gain.value = clamp(vol, 0, 1); out.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.7); lp.connect(out);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.25); env.gain.setValueAtTime(1, t + dur * 0.7); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); env.connect(lp);
    const base = 58 * rate;
    [1, 1.5, 2].forEach((mult, i) => { const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'square'; o.frequency.setValueAtTime(base * mult * 0.7, t); o.frequency.linearRampToValueAtTime(base * mult * 1.6, t + dur); const og = ctx.createGain(); og.gain.value = i === 0 ? 0.5 : 0.18; o.connect(og); og.connect(env); o.start(t); o.stop(t + dur); });
    const rumble = ctx.createOscillator(); rumble.type = 'sine'; rumble.frequency.value = 26; const rg = ctx.createGain(); rg.gain.value = 0.5; rumble.connect(rg); rg.connect(env.gain); rumble.start(t); rumble.stop(t + dur);   // amplitude vibration
    const ns = noiseSrc(); const ng = ctx.createGain(); ng.gain.value = 0.06; ns.connect(ng); ng.connect(lp); ns.start(t); ns.stop(t + dur);
  }
  function footfall(vol = 0.7, rate = 1) {   // heavy dino stomp
    const t = now(); const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150 * rate, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18); const og = envGain(t, 0.005, 0.2, clamp(vol, 0, 1)); o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.24);
    const ns = noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; const ng = envGain(t, 0.003, 0.1, clamp(vol, 0, 1) * 0.5); ns.connect(lp); lp.connect(ng); ng.connect(master); ns.start(t); ns.stop(t + 0.14);
  }
  function footstep(vol = 0.5, rate = 1) {    // light player step on dirt
    const t = now(); const ns = noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380 * rate; const g = envGain(t, 0.004, 0.1, clamp(vol, 0, 1)); ns.connect(lp); lp.connect(g); g.connect(master); ns.start(t); ns.stop(t + 0.12);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120 * rate, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.1); const og = envGain(t, 0.004, 0.1, clamp(vol, 0, 1) * 0.55); o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.12);
  }
  function door(vol = 0.85) {                  // car-door thunk
    const t = now(); const ns = noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; const g = envGain(t, 0.003, 0.12, clamp(vol, 0, 1)); ns.connect(lp); lp.connect(g); g.connect(master); ns.start(t); ns.stop(t + 0.16);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.1); const og = envGain(t, 0.003, 0.1, clamp(vol, 0, 1) * 0.7); o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.13);
  }
  function beep(vol = 0.5, rate = 1) {         // UI / countdown blip
    const t = now(); const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 660 * rate; const g = envGain(t, 0.005, 0.12, clamp(vol, 0, 1)); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
  }
  const VOICES = { roar, snarl, chomp, engine, footfall, footstep, door, beep, click: beep };

  // --- loops ------------------------------------------------------------------
  const loops = {};   // name -> { stop(), gain?, state? }
  function startAmb(vol) {
    const g = ctx.createGain(); g.gain.value = vol; g.connect(master);
    const wind = noiseSrc(); const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 480; const wg = ctx.createGain(); wg.gain.value = 0.12; wind.connect(wlp); wlp.connect(wg); wg.connect(g); wind.start();
    const ins = noiseSrc(); const ibp = ctx.createBiquadFilter(); ibp.type = 'bandpass'; ibp.frequency.value = 6500; ibp.Q.value = 0.4; const ig = ctx.createGain(); ig.gain.value = 0.03; ins.connect(ibp); ibp.connect(ig); ig.connect(g); ins.start();
    let timer;
    const chirp = () => { const t = now(); const o = ctx.createOscillator(); o.type = 'sine'; const f = 1600 + Math.random() * 1800; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (1 + (Math.random() * 0.4 - 0.1)), t + 0.12); const cg = envGain(t, 0.02, 0.16, 0.06); o.connect(cg); cg.connect(g); o.start(t); o.stop(t + 0.2); timer = setTimeout(chirp, 1200 + Math.random() * 3200); };
    timer = setTimeout(chirp, 700);
    loops.amb = { gain: g, stop() { try { wind.stop(); ins.stop(); } catch {} clearTimeout(timer); try { g.disconnect(); } catch {} } };
  }
  function startMusic(vol) {
    const g = ctx.createGain(); g.gain.value = vol; g.connect(master);
    const bpm = 150, step = (60 / bpm) / 2;                 // 8th notes
    const bassSeq = [0, 0, 7, 0, 3, 0, 5, 2].map(s => 55 * Math.pow(2, s / 12));   // low minor-ish drive
    let next = now() + 0.06, beat = 0, timer;
    const kick = (t) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); const k = envGain(t, 0.005, 0.16, 0.9); o.connect(k); k.connect(g); o.start(t); o.stop(t + 0.2); };
    const hat = (t) => { const s = noiseSrc(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const hg = envGain(t, 0.004, 0.04, 0.1); s.connect(hp); hp.connect(hg); hg.connect(g); s.start(t); s.stop(t + 0.06); };
    const bass = (t, f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const bg = envGain(t, 0.02, step * 0.9, 0.32); o.connect(lp); lp.connect(bg); bg.connect(g); o.start(t); o.stop(t + step); };
    const sched = () => { while (next < now() + 0.2) { const s = beat % 8; if (s % 2 === 0) kick(next); hat(next); bass(next, bassSeq[s]); next += step; beat++; } timer = setTimeout(sched, 40); };
    sched();
    loops.music = { gain: g, stop() { clearTimeout(timer); try { g.disconnect(); } catch {} } };
  }
  function startRun(vol) {
    const state = { vol, rate: 1 }; let timer;
    const tick = () => { if (state.vol > 0.01) footstep(state.vol * 0.6, state.rate); const interval = clamp(520 / (0.5 + state.rate), 150, 820); timer = setTimeout(tick, interval); };
    tick();
    loops.run = { state, stop() { clearTimeout(timer); } };
  }
  function startLoop(name, vol) {
    resume(); const v = vol == null ? 0.4 : vol;
    if (loops[name]) { setLoop(name, vol); return; }
    if (name === 'amb') startAmb(v); else if (name === 'music') startMusic(v); else if (name === 'run') startRun(v);
  }
  function setLoop(name, vol, rate) {
    const L = loops[name]; if (!L) return;
    if (L.state) { if (vol != null) L.state.vol = vol; if (rate != null) L.state.rate = rate; }
    else if (L.gain && vol != null) L.gain.gain.setTargetAtTime(clamp(vol, 0, 1), now(), 0.08);
  }
  function stopLoop(name) { const L = loops[name]; if (!L) return; try { L.stop(); } catch {} delete loops[name]; }
  function stopAll() { Object.keys(loops).forEach(stopLoop); }

  // --- master / lifecycle -----------------------------------------------------
  function resume() { if (ctx.state !== 'running') ctx.resume(); }
  function play(name, vol = 1, rate = 1) { resume(); const f = VOICES[name]; if (f) f(vol, rate); }
  function setMuted(m) { muted = !!m; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {} master.gain.setTargetAtTime(muted ? 0 : 1, now(), 0.02); }
  function toggle() { setMuted(!muted); return muted; }
  function dispose() { stopAll(); try { ctx.close(); } catch {} }

  return { play, startLoop, setLoop, stopLoop, stopAll, setMuted, toggle, isMuted: () => muted, resume, dispose, _ctx: ctx, _master: master };
}
