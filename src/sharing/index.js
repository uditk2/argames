// ===========================================================================
// SHARING MODULE — public API. Owns all share concerns; orchestrates turning a
// captured clip / run stats into a shared (or downloaded) file.
// ---------------------------------------------------------------------------
// Clean separation: the replay CAPTURE (offscreen compositor + MediaRecorder
// rolling buffer) lives in src/recording/replayBuffer.js. This module only
// consumes a finished clip ({ blob, ... }) and stats; it never touches the
// game canvas or camera directly.
//
//   shareReplay(clip, stats)         -> share/download the instant-replay clip
//   shareScoreCard(stats, opts)      -> build + share/download the PNG card
//   buildScoreCard(stats, opts)      -> just build the PNG ({ blob, url, ... })
//
// TWO SHARE PATHS, by medium:
//   • Media files (replay clip, PNG card) -> Web Share sheet / download here, so
//     users can post the actual file into mobile apps (Instagram/TikTok/X). The
//     clip is already MP4 where the platform can record it (see replayBuffer.js).
//   • X / Facebook / LinkedIn -> can't take a local file; they read OG tags off
//     a public URL. socialShare.js points them at our /s page whose og:image is
//     the dynamic /api/og card. No upload, no storage.
// ===========================================================================

import { buildScoreCard } from './scoreCard.js';
import { shareFile } from './share.js';
import { BRAND, BRAND_SLUG } from '../config/brand.js';
import { shared as gaShared } from '../analytics/ga.js';

export { buildScoreCard };
// Per-network sharing (X / Facebook / LinkedIn / copy link) via the /s OG page.
export { buildShareUrl, shareText, openSocialShare, copyShareLink } from './socialShare.js';

function slug() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function extForMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

/**
 * Share the instant-replay clip produced by the replay buffer.
 * @param {{ blob: Blob, mime?: string }} clip
 * @param {Object} [stats]  run stats (used for share text)
 * @returns {Promise<{ method: 'share'|'download'|'unsupported' }>}
 */
export async function shareReplay(clip, stats = {}) {
  if (!clip || !clip.blob) return { method: 'unsupported' };
  const ext = extForMime(clip.mime || clip.blob.type);
  const filename = `${BRAND_SLUG}-replay-${slug()}.${ext}`;
  const text = `I scored ${(stats.score ?? 0).toLocaleString()} in ${BRAND.name} — last 10 seconds of the fight.`;
  const res = await shareFile({
    blob: clip.blob,
    filename,
    title: `${BRAND.name} — Instant Replay`,
    text,
  });
  gaShared({ kind: 'replay', method: res.method });
  return res;
}

/**
 * Build the score card and share (or download) it.
 * @param {Object} stats  { score, slain, kcal, durationSec, bestCombo? }
 * @param {Object} [opts] { bgSrc?, title?, card? } — pass a prebuilt `card`
 *        ({ blob }) to avoid re-rendering (e.g. when a preview already exists).
 * @returns {Promise<{ method: 'share'|'download'|'unsupported', card }>}
 */
export async function shareScoreCard(stats = {}, opts = {}) {
  const card = opts.card || (await buildScoreCard(stats, opts));
  const filename = `${BRAND_SLUG}-score-${slug()}.png`;
  const text = `I cleared ${BRAND.name} with ${(stats.score ?? 0).toLocaleString()} points & ${stats.slain ?? 0} demons slain!`;
  const res = await shareFile({
    blob: card.blob,
    filename,
    title: `${BRAND.name} — Score`,
    text,
  });
  gaShared({ kind: 'scorecard', method: res.method });
  return { ...res, card };
}
