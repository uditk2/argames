// ===========================================================================
// POSE BUFFER — timestamped remote-pose history + interpolation.
// ---------------------------------------------------------------------------
// Incoming POSE packets land here. The scene renders the opponent at
// (clock.now() - RENDER_DELAY) and asks sampleAt() for an interpolated pose
// between the two bracketing samples → smooth motion, hides jitter. See
// docs/versus-netcode.md §7.
// ===========================================================================

export function createPoseBuffer({ keepMs = 1500 } = {}) {
  /** @type {{t:number, lm:Array}[]} sorted ascending by t */
  const samples = [];

  function push(t, landmarks) {
    // Keep sorted; packets can arrive slightly out of order on an unreliable
    // channel, so insert at the right spot rather than assuming append.
    if (samples.length === 0 || t >= samples[samples.length - 1].t) {
      samples.push({ t, lm: landmarks });
    } else {
      let i = samples.length - 1;
      while (i >= 0 && samples[i].t > t) i--;
      samples.splice(i + 1, 0, { t, lm: landmarks });
    }
    const newest = samples[samples.length - 1].t;
    while (samples.length > 2 && newest - samples[0].t > keepMs) samples.shift();
  }

  function lerpPose(a, b, f) {
    const out = new Array(33).fill(null);
    for (let i = 0; i < 33; i++) {
      const pa = a[i], pb = b[i];
      const va = pa && (pa.visibility == null || pa.visibility >= 0.4);
      const vb = pb && (pb.visibility == null || pb.visibility >= 0.4);
      if (va && vb) {
        out[i] = { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, visibility: 1 };
      } else if (vb) {
        out[i] = { x: pb.x, y: pb.y, visibility: 1 };
      } else if (va) {
        out[i] = { x: pa.x, y: pa.y, visibility: 1 };
      } else {
        out[i] = { x: 0, y: 0, visibility: 0 };
      }
    }
    return out;
  }

  /** Interpolated landmarks at render time `rt`, or null if empty. */
  function sampleAt(rt) {
    if (samples.length === 0) return null;
    if (rt <= samples[0].t) return samples[0].lm;
    const last = samples[samples.length - 1];
    if (rt >= last.t) return last.lm;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (rt >= a.t && rt <= b.t) {
        const span = b.t - a.t || 1;
        return lerpPose(a.lm, b.lm, (rt - a.t) / span);
      }
    }
    return last.lm;
  }

  return {
    push,
    sampleAt,
    get size() { return samples.length; },
    newestT: () => (samples.length ? samples[samples.length - 1].t : null),
    clear: () => { samples.length = 0; },
  };
}
