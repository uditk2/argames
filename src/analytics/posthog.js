// ===========================================================================
// POSTHOG ANALYTICS — thin wrapper around posthog-js (lazy-loaded).
// ---------------------------------------------------------------------------
// Product analytics for the funnel we actually tune on: campaign/level starts,
// deaths (with cause + distance), level clears, and the rewarded-ad revive.
// CrazyGames allows third-party analytics (unlike Poki), so this ships in the
// standalone build too.
//
// PERF: posthog-js (~600KB) is loaded via a DYNAMIC import AFTER first paint
// (requestIdleCallback / setTimeout fallback), so it's split into its own chunk
// and never blocks the initial render. Events captured before it finishes
// loading are QUEUED and flushed once init completes, so nothing early (like the
// pageview or an opening game event) is lost.
//
// CONFIG (build-time env, injected by Vite from .env / .env.local):
//   VITE_POSTHOG_KEY    — your PostHog Project API key ("phc_..."). REQUIRED to
//                         enable; without it every call is a clean no-op.
//   VITE_POSTHOG_HOST   — ingestion host. Defaults to US cloud. Use
//                         https://eu.i.posthog.com for the EU region, or your
//                         self-hosted URL.
//
// Nothing here throws: if the key is absent or posthog fails to load, capture()
// just logs to the console in dev and returns, so the game is never affected.
// ===========================================================================

function env(name) {
  try { return (import.meta && import.meta.env && import.meta.env[name]) || ''; } catch { return ''; }
}

const KEY = env('VITE_POSTHOG_KEY');
const HOST = env('VITE_POSTHOG_HOST') || 'https://us.i.posthog.com';

let initStarted = false;   // initPostHog() has been called (loading may be in-flight)
let posthog = null;        // module-level ref, populated once the chunk resolves
const queue = [];          // events captured before posthog finished loading

export function isPostHogEnabled() {
  return !!KEY;
}

// Defer work until the browser is idle (falls back to a macrotask). Keeps the
// heavy posthog-js chunk off the critical path so it loads after first paint.
function whenIdle(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

function flushQueue() {
  if (!posthog) return;
  while (queue.length) {
    const [event, props] = queue.shift();
    try { posthog.capture(event, props); } catch {}
  }
}

/** Initialize PostHog once. No-op (with a dev hint) when no key is configured. */
export function initPostHog() {
  if (initStarted || typeof window === 'undefined') return;
  if (!KEY) {
    console.info('[PostHog] VITE_POSTHOG_KEY not set — analytics disabled (no-op).');
    return;
  }
  initStarted = true;
  // Defer the heavy dynamic import until after first paint.
  whenIdle(async () => {
    try {
      const mod = await import('posthog-js');
      posthog = mod.default || mod;
      posthog.init(KEY, {
        api_host: HOST,
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: false,             // we send explicit game events, not DOM autocapture
        person_profiles: 'identified_only',
      });
      console.info('[PostHog] initialized (host:', HOST, ').');
      flushQueue();                     // replay anything captured before load
    } catch (e) {
      posthog = null;
      console.info('[PostHog] load/init failed — continuing without analytics.', e && e.message);
    }
  });
}

/**
 * Capture an event. Safe to call at any time:
 *   - no key configured  → clean no-op (dev-logs a stub).
 *   - posthog not loaded  → queued, then flushed once init completes.
 *   - posthog ready       → captured immediately.
 */
export function phCapture(event, props = {}) {
  if (!KEY) {
    console.debug('[PostHog stub]', event, props);
    return;
  }
  if (!posthog) {
    queue.push([event, props]);         // buffer until the chunk resolves
    return;
  }
  try { posthog.capture(event, props); } catch {}
}

export default { isPostHogEnabled, initPostHog, phCapture };
