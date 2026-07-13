// ===========================================================================
// UNIFIED ANALYTICS FACADE.
// ---------------------------------------------------------------------------
// One call site → both providers. `event(name, props)` fans out to Google
// Analytics (analytics/ga.js) and PostHog (analytics/posthog.js). Either
// provider is an independent guarded no-op when unconfigured, so callers never
// need to know which are enabled.
//
//   import { event } from '../../analytics';
//   event('temple_death', { cause, distance, level });
//
// Keep event names snake_case and stable — they become funnel steps in PostHog.
// ===========================================================================
import { track as gaTrack } from './ga.js';
import { phCapture } from './posthog.js';
import { isLocalHost } from './host.js';

export function event(name, props = {}) {
  if (isLocalHost()) return;   // never ingest our own local-dev traffic
  try { gaTrack(name, props); } catch {}
  try { phCapture(name, props); } catch {}
}

export { initGA } from './ga.js';
export { initPostHog, isPostHogEnabled } from './posthog.js';
export default { event };
