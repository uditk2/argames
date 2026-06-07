// ===========================================================================
// GA4 ANALYTICS — thin wrapper around gtag. Loads the GA script once.
// >>> Put your real Measurement ID in MEASUREMENT_ID below. <<<
// No-ops cleanly if the ID is still the placeholder or gtag fails to load.
// ===========================================================================

const MEASUREMENT_ID = 'G-B8H0EYCQ6Y'; // GA4 Measurement ID

let initialized = false;

function isPlaceholder() {
  return !MEASUREMENT_ID || MEASUREMENT_ID === 'G-XXXXXXXXXX';
}

/** Inject the GA script + bootstrap gtag (idempotent). */
export function initGA() {
  if (initialized || isPlaceholder() || typeof document === 'undefined') return;
  initialized = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);
}

/** Track an event. Safe to call even before initGA / with placeholder ID. */
export function track(event, params = {}) {
  if (isPlaceholder()) {
    // Helpful during development so events are still visible.
    console.debug('[GA stub]', event, params);
    return;
  }
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', event, params);
  }
}

/** Convenience: the canonical "game_started" event. */
export function trackGameStarted({ durationSec, mode, avatarId }) {
  track('game_started', { duration_sec: durationSec, mode, avatar_id: avatarId });
}

/**
 * Fired by the sharing module when a clip or score card is shared/downloaded.
 * @param {{ kind: 'replay'|'scorecard', method?: 'share'|'download'|'unsupported' }} p
 */
export function shared({ kind, method } = {}) {
  track('shared', { kind, method });
}
