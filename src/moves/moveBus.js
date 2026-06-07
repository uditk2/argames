// ===========================================================================
// MOVE BUS — tiny pub/sub. Detectors emit moves; the engine subscribes.
// Decouples vision/move-detection from the engine (one-directional flow).
// ===========================================================================

export function createMoveBus() {
  const subs = new Set();

  return {
    /** Subscribe; returns an unsubscribe fn. */
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** Emit a detected move, e.g. { type:'punch', payload:{x,y,uid} }. */
    emit(move) {
      for (const fn of subs) fn(move);
    },
  };
}
