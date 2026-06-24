// ===========================================================================
// Keeper — SOUND ENGINE (adapter over the theme-pack Web-Audio synth bank).
// ---------------------------------------------------------------------------
// Backed by the self-contained theme pack's createKeeperAudio() in
// ../theme/keeperAudio.js (synth Web Audio: save/goal/whistle/levelup/click/
// countdown/go/cheer one-shots + a crowd ambience loop). No sample files / no
// network — the dev static server (python http.server) has no HTTP Range
// support, which breaks <audio> seeking (same rationale as the dino game).
//
// This adapter keeps the HOST-FACING SHAPE the SlayFit games already use so
// ui/Keeper.jsx is unchanged:
//   play(name, vol?, rate?)   names: save goal whistle levelup (also click/…)
//   startLoop('ambience'?, vol?) / setLoop / stopLoop / stopAll
//   startAmbience() / stopAmbience()
//   setMuted / toggle / isMuted / resume / unlock / dispose
//
// `play(name, vol)` forwards to the synth bank (per-call vol/rate are accepted
// for API compatibility but the synth bank manages its own envelopes; vol is
// applied via the master only for unknown levels). Mute state persists in
// localStorage under the same key the host reads on mount.
// ===========================================================================
import { createKeeperAudio as createSynthAudio } from '../theme/keeperAudio.js';

const MUTE_KEY = 'slayfit_keeper_muted';

export function createKeeperAudio() {
  // Initial mute from persisted preference (host reads the same key).
  let muted = false; try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}

  const synth = createSynthAudio({ volume: 0.85 });
  synth.setMuted(muted);

  let ambienceOn = false;

  function persist(m) { try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {} }

  // --- one-shots ------------------------------------------------------------
  // The synth bank ignores vol/rate (it shapes its own envelopes); we accept
  // them so existing call sites (sfx.play('save', 0.85)) keep working.
  function play(name /* , vol, rate */) {
    if (!name) return;
    synth.play(name);
  }

  // --- ambience loop --------------------------------------------------------
  function startAmbience() { synth.startAmbience(); ambienceOn = true; }
  function stopAmbience() { synth.stopAmbience(); ambienceOn = false; }

  // Back-compat loop API: only 'ambience' is a real loop in the synth bank.
  function startLoop(name = 'ambience') { if (name === 'ambience') startAmbience(); }
  function setLoop() { /* synth bank manages its own ambience gain */ }
  function stopLoop(name = 'ambience') { if (name === 'ambience') stopAmbience(); }
  function stopAll() { stopAmbience(); }

  // --- lifecycle / mute -----------------------------------------------------
  function resume() { synth.unlock(); }     // resumes the AudioContext
  function unlock() { synth.unlock(); }
  function setMuted(m) { muted = !!m; persist(muted); synth.setMuted(muted); }
  function toggle() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }
  function setVolume(v) { synth.setVolume(v); }
  function dispose() { try { stopAmbience(); } catch {} try { synth.dispose(); } catch {} }

  return {
    play,
    startAmbience, stopAmbience,
    startLoop, setLoop, stopLoop, stopAll,
    setMuted, toggle, isMuted, setVolume,
    resume, unlock, dispose,
    get isAmbiencePlaying() { return ambienceOn; },
    get names() { return synth.names; },
  };
}

export default createKeeperAudio;
