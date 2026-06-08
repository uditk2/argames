// ===========================================================================
// SHARED MATCH CLOCK — NTP-style offset/RTT estimation over the data link.
// ---------------------------------------------------------------------------
// Two browsers don't share performance.now(). We exchange PING/PONG, estimate
// the clock offset and round-trip time, and expose clock.now() = a match time
// both peers agree on. Transport-agnostic: this module computes; the session
// drives the actual send/receive of PING/PONG. See docs/versus-netcode.md §3.
// ===========================================================================

const DEFAULT_NOW = () =>
  (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();

/**
 * @param {{ localNow?: () => number, keep?: number }} opts
 *   localNow: this machine's monotonic clock (ms). keep: # recent samples kept.
 */
export function createClock({ localNow = DEFAULT_NOW, keep = 8 } = {}) {
  let offset = 0;          // add to localNow() to get match time
  let rtt = 0;             // best (lowest) observed round-trip, ms
  const samples = [];      // recent { rtt, offset }

  function recordSample(t0, t1, t2) {
    const r = t2 - t0;
    const o = t1 - (t0 + r / 2);
    samples.push({ rtt: r, offset: o });
    while (samples.length > keep) samples.shift();
    // Use the lowest-RTT sample's offset (least queuing noise) — classic NTP.
    let best = samples[0];
    for (const s of samples) if (s.rtt < best.rtt) best = s;
    offset = best.offset;
    rtt = best.rtt;
  }

  return {
    /** This machine's raw monotonic time (ms). */
    localNow,
    /** Shared match time (ms) — agreed across both peers. */
    now: () => localNow() + offset,
    /** Best observed round-trip time (ms). */
    getRtt: () => rtt,
    /** Estimated one-way latency (ms). */
    oneWay: () => rtt / 2,
    getOffset: () => offset,
    /** Allow the session to seed/override offset (e.g. host is the reference). */
    setOffset: (o) => { offset = o; },
    /** Feed a PONG we received: we sent at t0, peer stamped t1, now is t2. */
    onPong: (t0, t1) => recordSample(t0, t1, localNow()),
    /** Build a reply timestamp for an incoming PING. */
    stampForPong: () => localNow(),
    samples,
  };
}
