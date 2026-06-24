// ===========================================================================
// KEEPER AR — WEB AUDIO SOUND BANK (synth, no samples)
// ---------------------------------------------------------------------------
// Everything is synthesized at runtime with the Web Audio API. We deliberately
// avoid <audio> tags / sample files because the dev static server (python
// http.server) has no HTTP Range support, which breaks media seeking — the
// same constraint the dino game works around. There are NO copyrighted
// samples and no network requests.
//
// API (matches THEME_CONTRACT):
//   const audio = createKeeperAudio();
//   audio.unlock();              // call once from a user gesture (click)
//   audio.startAmbience();       // crowd ambience loop (filtered-noise swells)
//   audio.stopAmbience();
//   audio.play('save');          // one-shots: see SFX list below
//   audio.setMuted(true|false);
//   audio.isMuted();
//   audio.setVolume(0..1);
//   audio.dispose();
//
// One-shot names:
//   'save'      whoosh + leather catch (gloves grab the ball)
//   'goal'      low thud + descending crowd groan (conceded)
//   'whistle'   referee pea-whistle chirp
//   'levelup'   bright ascending sting (gold)
//   'click'     soft UI tick
//   'countdown' short beep (3..2..1)
//   'go'        higher confirm beep (SHOTS INCOMING)
//   'cheer'     quick crowd cheer burst (great save / level clear)
// ===========================================================================

export function createKeeperAudio(opts = {}) {
  const state = {
    ctx: null,
    master: null,
    muteGain: null,
    muted: false,
    volume: opts.volume ?? 0.8,
    ambience: null, // { stop() }
    noiseBuffer: null,
  };

  // --- lifecycle ------------------------------------------------------------
  function ensure() {
    if (state.ctx) return state.ctx;
    if (typeof window === 'undefined') return null; // non-browser (SSR/test): no-op
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.ctx = new AC();
    state.master = state.ctx.createGain();
    state.master.gain.value = state.volume;
    state.muteGain = state.ctx.createGain();
    state.muteGain.gain.value = state.muted ? 0 : 1;
    state.master.connect(state.muteGain).connect(state.ctx.destination);
    state.noiseBuffer = makeNoiseBuffer(state.ctx, 2.0);
    return state.ctx;
  }

  /** Resume the context from a user gesture (autoplay policy). */
  function unlock() {
    const ctx = ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function dispose() {
    stopAmbience();
    if (state.ctx) state.ctx.close();
    state.ctx = null;
  }

  // --- helpers --------------------------------------------------------------
  function makeNoiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function now() {
    return state.ctx.currentTime;
  }

  // ADSR-ish gain envelope node.
  function env(t0, { a = 0.005, d = 0.08, s = 0, r = 0.05, peak = 1, sus = 0 } = {}) {
    const g = state.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t0 + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, sus || 0.0001), t0 + a + d + s);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + s + r);
    return g;
  }

  function osc(type, freq, t0) {
    const o = state.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    return o;
  }

  function noiseSource() {
    const s = state.ctx.createBufferSource();
    s.buffer = state.noiseBuffer;
    s.loop = true;
    return s;
  }

  // --- ambience: a calm, warm AMBIENT MUSIC PAD (not crowd noise) -----------
  // Soft detuned triangle voices play a slow chord progression through a
  // low-pass, with a gentle tremolo for movement. Unobtrusive background music.
  function startAmbience() {
    const ctx = ensure();
    if (!ctx) return;
    if (state.ambience) return;

    // chord progression (root/third/fifth frequencies) — Am · F · C · G
    const CHORDS = [
      [220.0, 261.6, 329.6], // Am
      [174.6, 220.0, 261.6], // F
      [261.6, 329.6, 392.0], // C
      [196.0, 246.9, 293.7], // G
    ];
    const VOICES = 3;        // notes per chord
    const GLIDE = 1.6;       // seconds to glide between chords
    const HOLD = 5.0;        // seconds each chord is held

    // signal chain: voices -> lowpass -> tremolo -> out -> master
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(state.master);
    out.gain.exponentialRampToValueAtTime(0.1, now() + 3); // slow fade-in

    const trem = ctx.createGain();
    trem.gain.value = 1;
    trem.connect(out);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1150;
    lp.Q.value = 0.3;
    lp.connect(trem);

    // gentle tremolo LFO on the tremolo gain
    const lfo = osc('sine', 0.07, now());
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(trem.gain);
    lfo.start();

    // build persistent voices: 2 slightly-detuned oscillators per note for warmth
    const voices = [];
    for (let i = 0; i < VOICES; i++) {
      for (const cents of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = CHORDS[0][i];
        o.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = 0.085; // soft per-voice level
        o.connect(g).connect(lp);
        o.start();
        voices.push({ o, note: i });
      }
    }

    function setChord(idx) {
      const c = CHORDS[idx], t = now();
      voices.forEach((v) => {
        const f = c[v.note];
        v.o.frequency.cancelScheduledValues(t);
        v.o.frequency.setValueAtTime(v.o.frequency.value, t);
        v.o.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + GLIDE);
      });
    }
    let ci = 0;
    setChord(0);
    const timer = setInterval(() => { ci = (ci + 1) % CHORDS.length; setChord(ci); }, HOLD * 1000);

    state.ambience = {
      stop() {
        const t = now();
        clearInterval(timer);
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        setTimeout(() => {
          voices.forEach((v) => { try { v.o.stop(); } catch {} });
          try { lfo.stop(); } catch {}
        }, 1100);
      },
    };
  }

  function stopAmbience() {
    if (state.ambience) {
      state.ambience.stop();
      state.ambience = null;
    }
  }

  // --- one-shot SFX ---------------------------------------------------------
  const SFX = {
    // Whoosh of the dive + a short leather "catch" thud.
    save() {
      const t = now();
      // Whoosh: rising band-passed noise.
      const src = noiseSource();
      const bp = state.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
      bp.Q.value = 1.2;
      const g = env(t, { a: 0.02, d: 0.12, r: 0.08, peak: 0.5 });
      src.connect(bp).connect(g).connect(state.master);
      src.start(t);
      src.stop(t + 0.35);
      // Catch: short filtered noise burst + low body.
      const t2 = t + 0.14;
      const cs = noiseSource();
      const cf = state.ctx.createBiquadFilter();
      cf.type = 'lowpass';
      cf.frequency.value = 1400;
      const cg = env(t2, { a: 0.001, d: 0.06, r: 0.03, peak: 0.6 });
      cs.connect(cf).connect(cg).connect(state.master);
      cs.start(t2);
      cs.stop(t2 + 0.12);
      const body = osc('sine', 150, t2);
      const bg = env(t2, { a: 0.001, d: 0.09, r: 0.04, peak: 0.4 });
      body.connect(bg).connect(state.master);
      body.start(t2);
      body.stop(t2 + 0.16);
    },

    // Conceded: low thud (ball hits net) + descending crowd groan.
    goal() {
      const t = now();
      // Thud.
      const o = osc('sine', 120, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
      const g = env(t, { a: 0.002, d: 0.3, r: 0.1, peak: 0.7 });
      o.connect(g).connect(state.master);
      o.start(t);
      o.stop(t + 0.5);
      // Groan: descending band-passed noise swell.
      const t2 = t + 0.05;
      const src = noiseSource();
      const bp = state.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(600, t2);
      bp.frequency.exponentialRampToValueAtTime(180, t2 + 0.9);
      bp.Q.value = 0.8;
      const ng = env(t2, { a: 0.15, d: 0.9, s: 0.1, r: 0.4, peak: 0.28 });
      src.connect(bp).connect(ng).connect(state.master);
      src.start(t2);
      src.stop(t2 + 1.6);
    },

    // Referee pea-whistle: two detuned high tones with a fast trill.
    whistle() {
      const t = now();
      const g = env(t, { a: 0.01, d: 0.05, s: 0.22, r: 0.06, peak: 0.32, sus: 0.28 });
      g.connect(state.master);
      [2100, 2160].forEach((f, i) => {
        const o = osc('square', f, t);
        // Trill / pea wobble.
        const lfo = osc('sine', 28, t);
        const lg = state.ctx.createGain();
        lg.gain.value = 90;
        lfo.connect(lg).connect(o.frequency);
        const og = state.ctx.createGain();
        og.gain.value = i ? 0.5 : 0.7;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + 0.4);
        lfo.start(t);
        lfo.stop(t + 0.4);
      });
    },

    // Bright ascending sting for level-up.
    levelup() {
      const t = now();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        const t0 = t + i * 0.08;
        const o = osc('triangle', f, t0);
        const g = env(t0, { a: 0.005, d: 0.18, r: 0.12, peak: 0.32 });
        o.connect(g).connect(state.master);
        o.start(t0);
        o.stop(t0 + 0.4);
      });
    },

    click() {
      const t = now();
      const o = osc('square', 880, t);
      const g = env(t, { a: 0.001, d: 0.03, r: 0.02, peak: 0.18 });
      o.connect(g).connect(state.master);
      o.start(t);
      o.stop(t + 0.06);
    },

    countdown() {
      const t = now();
      const o = osc('sine', 440, t);
      const g = env(t, { a: 0.003, d: 0.12, r: 0.06, peak: 0.3 });
      o.connect(g).connect(state.master);
      o.start(t);
      o.stop(t + 0.22);
    },

    go() {
      const t = now();
      const o = osc('sine', 660, t);
      o.frequency.exponentialRampToValueAtTime(990, t + 0.12);
      const g = env(t, { a: 0.003, d: 0.18, r: 0.08, peak: 0.34 });
      o.connect(g).connect(state.master);
      o.start(t);
      o.stop(t + 0.3);
    },

    // Quick crowd cheer: noise swell up then settle, brighter than ambience.
    cheer() {
      const t = now();
      const src = noiseSource();
      const bp = state.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
      bp.Q.value = 0.6;
      const g = env(t, { a: 0.08, d: 0.5, s: 0.25, r: 0.6, peak: 0.34, sus: 0.18 });
      src.connect(bp).connect(g).connect(state.master);
      src.start(t);
      src.stop(t + 1.5);
    },
  };

  /** Play a one-shot by name. Safe no-op if audio unavailable. */
  function play(name) {
    const ctx = ensure();
    if (!ctx || state.muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    const fn = SFX[name];
    if (fn) {
      try {
        fn();
      } catch {
        /* ignore audio glitches */
      }
    }
  }

  // --- controls -------------------------------------------------------------
  function setMuted(m) {
    state.muted = !!m;
    if (state.muteGain) {
      const t = now();
      state.muteGain.gain.cancelScheduledValues(t);
      state.muteGain.gain.setTargetAtTime(state.muted ? 0 : 1, t, 0.05);
    }
    return state.muted;
  }
  function isMuted() {
    return state.muted;
  }
  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    if (state.master) state.master.gain.setTargetAtTime(state.volume, now(), 0.05);
  }

  return {
    unlock,
    play,
    startAmbience,
    stopAmbience,
    setMuted,
    isMuted,
    setVolume,
    dispose,
    get names() {
      return Object.keys(SFX);
    },
  };
}

export default createKeeperAudio;
