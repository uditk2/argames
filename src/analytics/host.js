// ===========================================================================
// ANALYTICS HOST GUARD.
// ---------------------------------------------------------------------------
// Analytics must NOT ingest traffic from local development. isLocalHost() is
// true on localhost / loopback / private-LAN dev hosts, on file://, and in the
// Vite dev server (import.meta.env.DEV). Both the provider init and every event
// are gated on it, so no pageview, pageleave, or game event is ever sent while
// developing — keeping the funnel clean of our own testing.
// ===========================================================================
export function isLocalHost() {
  try {
    if (import.meta && import.meta.env && import.meta.env.DEV) return true;
  } catch { /* not Vite */ }
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const h = (window.location.hostname || '').toLowerCase();
    if (window.location.protocol === 'file:') return true;
    return (
      h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' ||
      h.endsWith('.local') ||
      h.startsWith('192.168.') || h.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch { return false; }
}

export default { isLocalHost };
