// ===========================================================================
// SOCIAL SHARE — per-network share to X / Facebook / LinkedIn (+ copy link).
// ---------------------------------------------------------------------------
// These networks can't accept a locally-generated image; their intent URLs only
// take a PUBLIC page URL and pull the preview from that page's Open Graph tags.
// So we point them at our own /s share page (api/share.js), which carries OG
// tags whose og:image is the dynamic /api/og card (api/og.jsx). No upload, no
// storage — the image is regenerated from the URL params on demand.
//
// (The actual PNG / MP4 files are still shared directly via the Web Share sheet
// / download in share.js — that path is for posting media into mobile apps.)
// ===========================================================================

import { BRAND } from '../config/brand.js';

/**
 * Build the public share-page URL for a run.
 * @param {Object} stats  { score, slain, kcal, durationSec, bestCombo? }
 * @param {string} [origin] defaults to the current page origin
 * @returns {string} absolute URL to /s?... (empty string if no origin)
 */
export function buildShareUrl(stats = {}, origin) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return '';
  const p = new URLSearchParams({
    score: String(Math.max(0, Math.round(stats.score ?? 0))),
    slain: String(Math.max(0, Math.round(stats.slain ?? 0))),
    kcal: String(Math.max(0, Math.round(stats.kcal ?? 0))),
    t: String(Math.max(0, Math.round(stats.durationSec ?? 0))),
  });
  if (stats.bestCombo != null) p.set('combo', String(Math.max(0, Math.round(stats.bestCombo))));
  return `${base}/s?${p.toString()}`;
}

/** Default share caption used by networks that accept text. */
export function shareText(stats = {}) {
  const score = (stats.score ?? 0).toLocaleString();
  return `I cleared the ${BRAND.name} realm — ${score} pts & ${stats.slain ?? 0} demons slain! 🔥 Can you beat it?`;
}

/**
 * Intent URL for a given network.
 * @param {'x'|'twitter'|'facebook'|'linkedin'|'whatsapp'} network
 * @param {string} shareUrl  the public /s page URL
 * @param {string} [text]    caption (used where supported)
 * @returns {string|null}
 */
export function networkUrl(network, shareUrl, text = '') {
  const u = encodeURIComponent(shareUrl);
  const t = encodeURIComponent(text);
  switch (network) {
    case 'x':
    case 'twitter':
      return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    case 'facebook':
      // FB ignores custom text and reads OG tags from the shared URL.
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${shareUrl}`)}`;
    default:
      return null;
  }
}

/** Open a network's share dialog in a centered popup (falls back to new tab). */
export function openSocialShare(network, stats = {}, origin) {
  const shareUrl = buildShareUrl(stats, origin);
  if (!shareUrl) return false;
  const url = networkUrl(network, shareUrl, shareText(stats));
  if (!url) return false;
  if (typeof window === 'undefined') return false;
  const w = 600;
  const h = 640;
  const y = Math.max(0, (window.outerHeight - h) / 2 + (window.screenY || 0));
  const x = Math.max(0, (window.outerWidth - w) / 2 + (window.screenX || 0));
  const win = window.open(
    url,
    'share',
    `noopener,noreferrer,width=${w},height=${h},top=${Math.round(y)},left=${Math.round(x)}`
  );
  if (!win) window.open(url, '_blank', 'noopener,noreferrer'); // popup blocked → tab
  return true;
}

/** Copy the public share link to the clipboard. Resolves true on success. */
export async function copyShareLink(stats = {}, origin) {
  const shareUrl = buildShareUrl(stats, origin);
  if (!shareUrl) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback for browsers without the async clipboard API.
  try {
    const ta = document.createElement('textarea');
    ta.value = shareUrl;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
