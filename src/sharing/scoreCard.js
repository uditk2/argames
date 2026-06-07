// ===========================================================================
// SCORE CARD (Requirement B) — render a portrait social card to a PNG Blob.
// ---------------------------------------------------------------------------
// Self-contained: drawn with the Canvas 2D API. Optionally loads one backdrop
// image from /assets/backgrounds/ (feature-detected + awaited; if it fails we
// fall back to a pure procedural magical background, so this never rejects on a
// missing asset). Palette matches the app: purple magic + fire-orange on dark.
// ===========================================================================

import { rgba } from '../config/theme.js';
import { BRAND } from '../config/brand.js';

const CARD_W = 1080;
const CARD_H = 1350;

// Palette reads from the shared theme (src/config/theme.js -> CSS variables),
// so the share card retints with the rest of the app from one source.
const COLORS = {
  realm: '#0a0510',
  realm2: '#160a26',
  magic: rgba.magic(),
  magicLight: rgba.magic(),
  fire: rgba.fire(),
  fireBright: '#ff8c3c',
  gold: rgba.gold(),
  ink: rgba.ink(),
};

const DEFAULT_BG = '/assets/backgrounds/Cloudy_Sky-Night_01-1024x512.png';

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Load an image, resolving to null (never rejecting) on any failure. */
function loadImage(src) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || !src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(ctx, img, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const rw = img.width * scale;
  const rh = img.height * scale;
  ctx.drawImage(img, (dw - rw) / 2, (dh - rh) / 2, rw, rh);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Build the score card.
 * @param {Object} stats  { score, slain, kcal, durationSec, bestCombo? }
 * @param {Object} [opts] { bgSrc?, title? }
 * @returns {Promise<{ blob: Blob, url: string, width:number, height:number }>}
 */
export async function buildScoreCard(stats = {}, opts = {}) {
  const title = opts.title || BRAND.wordmark;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  // --- Background: dark base + optional sky image + magical wash ---
  ctx.fillStyle = COLORS.realm;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const bg = await loadImage(opts.bgSrc || DEFAULT_BG);
  if (bg) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawCover(ctx, bg, CARD_W, CARD_H);
    ctx.restore();
  }

  // Vertical mood gradient (warm top -> deep dark bottom).
  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, 'rgba(92,54,18,0.55)');
  grad.addColorStop(0.5, 'rgba(16,8,30,0.78)');
  grad.addColorStop(1, 'rgba(8,4,16,0.96)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Fire glow rising from the bottom.
  const fireGlow = ctx.createRadialGradient(CARD_W / 2, CARD_H * 1.08, 60, CARD_W / 2, CARD_H * 1.08, CARD_H * 0.7);
  fireGlow.addColorStop(0, 'rgba(255,106,44,0.35)');
  fireGlow.addColorStop(1, 'rgba(255,106,44,0)');
  ctx.fillStyle = fireGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Magic glow from the top.
  const magicGlow = ctx.createRadialGradient(CARD_W / 2, -CARD_H * 0.05, 60, CARD_W / 2, -CARD_H * 0.05, CARD_H * 0.7);
  magicGlow.addColorStop(0, rgba.magic(0.4));
  magicGlow.addColorStop(1, rgba.magic(0));
  ctx.fillStyle = magicGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Scattered spark particles for a touch of magic.
  ctx.save();
  for (let i = 0; i < 60; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 12543.123) % 1;
    const px = Math.abs(x) * CARD_W;
    const py = Math.abs(y) * CARD_H;
    const r = 1 + (Math.abs(x) * 3);
    ctx.globalAlpha = 0.15 + Math.abs(y) * 0.4;
    ctx.fillStyle = i % 3 === 0 ? COLORS.fireBright : COLORS.magicLight;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const cx = CARD_W / 2;

  // --- Title ---
  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = 'rgba(255,140,60,0.6)';
  ctx.shadowBlur = 32;
  const titleGrad = ctx.createLinearGradient(0, 120, 0, 230);
  titleGrad.addColorStop(0, COLORS.gold);
  titleGrad.addColorStop(1, COLORS.fireBright);
  ctx.fillStyle = titleGrad;
  ctx.font = '900 110px Georgia, "Times New Roman", serif';
  ctx.fillText(title, cx, 220);
  ctx.restore();

  ctx.fillStyle = rgba.magic(0.85);
  ctx.font = '600 34px Arial, sans-serif';
  ctx.fillText('R E A L M   C L E A R E D', cx, 285);

  // --- Hero score ---
  ctx.save();
  ctx.shadowColor = rgba.magic(0.7);
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 280px Georgia, serif';
  const scoreText = (stats.score ?? 0).toLocaleString();
  ctx.fillText(scoreText, cx, 600);
  ctx.restore();

  ctx.fillStyle = rgba.ink(0.7);
  ctx.font = '600 40px Arial, sans-serif';
  ctx.fillText('SCORE', cx, 670);

  // --- Stat tiles (3 across) ---
  const tiles = [
    { label: 'DEMONS SLAIN', value: String(stats.slain ?? 0), color: COLORS.gold },
    { label: 'CALORIES', value: String(stats.kcal ?? 0), color: COLORS.fireBright },
    { label: 'TIME', value: fmtDur(stats.durationSec), color: COLORS.magicLight },
  ];
  const gap = 40;
  const margin = 80;
  const tileW = (CARD_W - margin * 2 - gap * 2) / 3;
  const tileH = 260;
  const tileY = 800;
  tiles.forEach((t, i) => {
    const x = margin + i * (tileW + gap);
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,36,0.55)';
    roundRect(ctx, x, tileY, tileW, tileH, 28);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba.magic(0.35);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = t.color;
    ctx.font = '900 86px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.value, x + tileW / 2, tileY + 130);

    ctx.fillStyle = rgba.ink(0.65);
    ctx.font = '600 26px Arial, sans-serif';
    ctx.fillText(t.label, x + tileW / 2, tileY + 190);
  });

  // --- Best combo banner (if present) ---
  if (stats.bestCombo != null) {
    ctx.fillStyle = COLORS.fireBright;
    ctx.font = '700 48px Georgia, serif';
    ctx.fillText(`Best combo  ×${stats.bestCombo}`, cx, tileY + tileH + 130);
  }

  // --- Footer ---
  ctx.fillStyle = rgba.magic(0.7);
  ctx.font = '600 32px Arial, sans-serif';
  ctx.fillText('webcam workout brawler', cx, CARD_H - 70);

  // --- Export to PNG blob ---
  const blob = await new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } else {
      // Fallback for engines without toBlob: dataURL -> Blob.
      try {
        const data = canvas.toDataURL('image/png');
        const bin = atob(data.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/png' }));
      } catch {
        resolve(null);
      }
    }
  });

  if (!blob) throw new Error('score card render produced no blob');
  const url = URL.createObjectURL(blob);
  return { blob, url, width: CARD_W, height: CARD_H };
}
