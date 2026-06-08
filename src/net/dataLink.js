// ===========================================================================
// DATA LINK — the minimal transport interface every higher layer talks to, so
// the netcode is transport-agnostic and testable. See docs/versus-netcode.md §2.
//
//   DataLink = { send(bytes), onMessage(cb), onOpen(cb), onClose(cb),
//                readyState, close() }
//
// peerLink.js produces a real DataLink backed by a PeerJS DataConnection.
// createLoopbackPair() below produces two linked in-process DataLinks with
// simulated latency/jitter/loss — used by the two-instance fight test to mock
// the wire without any real network.
// ===========================================================================

/**
 * Two linked in-process DataLinks. Anything a.send() goes to b's onMessage
 * (and vice-versa) after a simulated delay, with optional packet loss.
 * @param {{ latencyMs?: number, jitterMs?: number, loss?: number,
 *           setTimeoutFn?: Function }} opts
 * @returns {[DataLink, DataLink]}
 */
export function createLoopbackPair(opts = {}) {
  const { latencyMs = 0, jitterMs = 0, loss = 0, setTimeoutFn = setTimeout } = opts;

  function makeEnd(name) {
    return {
      name,
      readyState: 'connecting',
      _other: null,
      _msg: [],
      _open: [],
      _close: [],
      send(bytes) {
        if (this.readyState !== 'open') return;
        if (loss > 0 && Math.random() < loss) return; // dropped
        const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
        const d = Math.max(0, latencyMs + (Math.random() * 2 - 1) * jitterMs);
        const other = this._other;
        setTimeoutFn(() => {
          if (other.readyState === 'closed') return;
          for (const cb of other._msg) cb(copy);
        }, d);
      },
      onMessage(cb) { this._msg.push(cb); },
      onOpen(cb) { this._open.push(cb); if (this.readyState === 'open') cb(); },
      onClose(cb) { this._close.push(cb); },
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        for (const cb of this._close) cb();
      },
    };
  }

  const a = makeEnd('A');
  const b = makeEnd('B');
  a._other = b;
  b._other = a;
  // Open both ends on the next tick (mimics async channel open).
  setTimeoutFn(() => {
    a.readyState = 'open'; b.readyState = 'open';
    for (const cb of a._open) cb();
    for (const cb of b._open) cb();
  }, 0);

  return [a, b];
}
