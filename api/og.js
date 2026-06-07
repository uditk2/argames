// ===========================================================================
// DYNAMIC OG IMAGE — /api/og
// ---------------------------------------------------------------------------
// Renders the shareable score card on demand (Vercel Edge + @vercel/og /
// Satori) from query params, so X / Facebook / LinkedIn can pull it as the
// link-preview image with ZERO storage cost. Output is heavily edge-cached.
//
// Landscape 1200x630 — the size social link previews render best at (the
// in-app PNG in src/sharing/scoreCard.js stays portrait for direct sharing;
// this is the link-preview counterpart).
//
// Params (all optional, coerced to safe values):
//   score, slain, kcal, t (durationSec), combo (bestCombo)
//
// NOTE: this is plain .js using React.createElement (aliased `h`) ON PURPOSE —
// Vercel's zero-config function detection in a non-Next project only picks up
// api/**/*.{js,ts,mjs}, NOT .jsx, so JSX here would deploy as a dead static
// file (404). Palette + brand are mirrored (not imported) to keep the edge
// bundle self-contained. Source of truth: src/index.css and src/config/brand.js.
// ===========================================================================

import React from 'react';
import { ImageResponse } from '@vercel/og';

const h = React.createElement;

export const config = { runtime: 'edge' };

const W = 1200;
const H = 630;

const C = {
  realm: '#0A0612',
  realm2: '#160A1A',
  magic: '#FFB627',
  fire: '#FF7A3C',
  fireBright: '#FFC25E',
  gold: '#FFD54A',
  ink: '#FAF4E9',
};

const BRAND = { wordmark: 'SLAYFIT', descriptor: 'webcam workout brawler' };

// Every glyph the card can render — lets Google return a small subsetted TTF
// (Satori needs ttf/otf/woff, NOT woff2) and keeps the fetch tiny.
const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.:×·!?'—-";

/** Fetch a Google font as an ArrayBuffer (truetype, subsetted to `text`). */
async function loadGoogleFont(family, weight, text) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const m = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
  if (!m) throw new Error(`font css parse failed: ${family}`);
  const res = await fetch(m[1]);
  if (!res.ok) throw new Error(`font fetch failed: ${family}`);
  return res.arrayBuffer();
}

function intParam(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function chip(label, value, color) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: 380,
        padding: '18px 26px',
        borderRadius: 18,
        background: 'rgba(20,10,30,0.55)',
        border: '1px solid rgba(255,182,39,0.30)',
      },
    },
    h(
      'span',
      { style: { fontFamily: 'Fredoka', fontSize: 26, color: 'rgba(250,244,233,0.72)', letterSpacing: 1 } },
      label
    ),
    h('span', { style: { fontFamily: 'Cinzel', fontSize: 46, color } }, value)
  );
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const score = intParam(searchParams.get('score'));
    const slain = intParam(searchParams.get('slain'));
    const kcal = intParam(searchParams.get('kcal'));
    const durationSec = intParam(searchParams.get('t'));
    const comboRaw = searchParams.get('combo');
    const combo = comboRaw != null ? intParam(comboRaw, null) : null;

    const [cinzel, fredoka] = await Promise.all([
      loadGoogleFont('Cinzel Decorative', 900, `${CHARSET}${score}${slain}${kcal}`),
      loadGoogleFont('Fredoka', 600, CHARSET),
    ]);

    const tree = h(
      'div',
      {
        style: {
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          backgroundColor: C.realm,
          backgroundImage:
            'radial-gradient(120% 80% at 50% 115%, rgba(255,122,60,0.40) 0%, rgba(255,122,60,0) 55%),' +
            'radial-gradient(110% 70% at 50% -15%, rgba(255,182,39,0.34) 0%, rgba(255,182,39,0) 55%),' +
            `linear-gradient(160deg, ${C.realm2} 0%, ${C.realm} 70%)`,
          color: C.ink,
        },
      },
      // Header: wordmark + "realm cleared" pill
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { style: { fontFamily: 'Cinzel', fontSize: 56, color: C.gold, letterSpacing: 2 } }, BRAND.wordmark),
          h(
            'span',
            { style: { fontFamily: 'Fredoka', fontSize: 24, color: 'rgba(255,182,39,0.85)', letterSpacing: 6 } },
            BRAND.descriptor.toUpperCase()
          )
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              fontFamily: 'Fredoka',
              fontSize: 24,
              letterSpacing: 6,
              color: C.ink,
              padding: '12px 24px',
              borderRadius: 999,
              background: 'rgba(255,122,60,0.18)',
              border: '1px solid rgba(255,122,60,0.55)',
            },
          },
          'REALM CLEARED'
        )
      ),
      // Body: hero score (left) + stat chips (right)
      h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column' } },
          h(
            'span',
            { style: { fontFamily: 'Fredoka', fontSize: 30, letterSpacing: 8, color: 'rgba(250,244,233,0.65)' } },
            'SCORE'
          ),
          h('span', { style: { fontFamily: 'Cinzel', fontSize: 200, lineHeight: 1, color: '#ffffff' } }, score.toLocaleString()),
          combo != null
            ? h('span', { style: { fontFamily: 'Fredoka', fontSize: 30, color: C.fireBright, marginTop: 8 } }, `Best combo ×${combo}`)
            : null
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          chip('DEMONS SLAIN', String(slain), C.gold),
          chip('CALORIES', String(kcal), C.fireBright),
          chip('TIME', fmtDur(durationSec), C.magic)
        )
      )
    );

    return new ImageResponse(tree, {
      width: W,
      height: H,
      fonts: [
        { name: 'Cinzel', data: cinzel, weight: 900, style: 'normal' },
        { name: 'Fredoka', data: fredoka, weight: 600, style: 'normal' },
      ],
      headers: {
        // Long-lived edge cache: same params → same image, regenerated rarely.
        'cache-control': 'public, immutable, no-transform, max-age=31536000',
      },
    });
  } catch (e) {
    return new Response(`og render failed: ${e.message}`, { status: 500 });
  }
}
