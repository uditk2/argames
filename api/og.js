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

// Group a number with COMMAS, locale-independently. We can't use
// Number.prototype.toLocaleString() here: the Vercel Edge runtime ships a
// reduced-ICU build whose DEFAULT locale isn't guaranteed to be en-US, so the
// grouping separator can come out as a narrow no-break space (U+202F, fr) or a
// dot (de) — neither is in CHARSET nor in the subsetted font, which makes Satori
// render tofu or throw (→ 500, blank preview). Dino never hit this because it
// only renders toFixed()/'%' values; the score card is the one that groups.
function groupInt(n) {
  return String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

// Dino Survival card — ESCAPED (escape time) or CAUGHT (distance reached).
// Params: esc (1|0), dt (escape/survive time in DECI-seconds), pct (distance %).
async function dinoImage(searchParams) {
  const escaped = searchParams.get('esc') === '1';
  const timeS = intParam(searchParams.get('dt')) / 10;
  const pct = intParam(searchParams.get('pct'));
  const big = escaped ? `${timeS.toFixed(1)}s` : `${pct}%`;
  const accent = escaped ? C.gold : C.fire;
  const [cinzel, fredoka] = await Promise.all([
    loadGoogleFont('Cinzel Decorative', 900, `${CHARSET}${big}`),
    loadGoogleFont('Fredoka', 600, CHARSET),
  ]);
  const tree = h(
    'div',
    {
      style: {
        width: W, height: H, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64,
        backgroundColor: C.realm,
        backgroundImage:
          'radial-gradient(120% 80% at 50% 115%, rgba(255,122,60,0.40) 0%, rgba(255,122,60,0) 55%),' +
          'radial-gradient(110% 70% at 50% -15%, rgba(255,182,39,0.34) 0%, rgba(255,182,39,0) 55%),' +
          `linear-gradient(160deg, ${C.realm2} 0%, ${C.realm} 70%)`,
        color: C.ink,
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: { fontFamily: 'Cinzel', fontSize: 56, color: C.gold, letterSpacing: 2 } }, BRAND.wordmark),
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 24, color: 'rgba(255,182,39,0.85)', letterSpacing: 6 } }, 'DINO SURVIVAL')
      ),
      h(
        'div',
        { style: { display: 'flex', fontFamily: 'Fredoka', fontSize: 24, letterSpacing: 6, color: C.ink, padding: '12px 24px', borderRadius: 999, background: 'rgba(255,122,60,0.18)', border: `1px solid ${accent}` } },
        escaped ? 'ESCAPED' : 'CAUGHT'
      )
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 30, letterSpacing: 8, color: 'rgba(250,244,233,0.65)' } }, escaped ? 'ESCAPE TIME' : 'DISTANCE REACHED'),
        h('span', { style: { fontFamily: 'Cinzel', fontSize: 200, lineHeight: 1, color: '#ffffff' } }, big),
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 30, color: C.fireBright, marginTop: 8 } }, escaped ? 'Outran the beast' : 'The beast caught you')
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        chip('OUTCOME', escaped ? 'ESCAPED' : 'CAUGHT', accent),
        chip(escaped ? 'DISTANCE' : 'SURVIVED', escaped ? '100%' : `${timeS.toFixed(1)}s`, C.magic)
      )
    )
  );
  return new ImageResponse(tree, {
    width: W, height: H,
    fonts: [
      { name: 'Cinzel', data: cinzel, weight: 900, style: 'normal' },
      { name: 'Fredoka', data: fredoka, weight: 600, style: 'normal' },
    ],
    headers: { 'cache-control': 'public, immutable, no-transform, max-age=31536000' },
  });
}

// Keeper card — LEVELS CLEARED (hero) + reached level + save% + shots chips.
// Params: lvls (levels cleared), saves, shots, t (duration seconds).
async function keeperImage(searchParams) {
  const lvls = intParam(searchParams.get('lvls'));
  const saves = intParam(searchParams.get('saves'));
  const shots = intParam(searchParams.get('shots'));
  const durationSec = intParam(searchParams.get('t'));
  const pct = shots > 0 ? Math.round((saves / shots) * 100) : 0;
  const reached = lvls + 1;
  const big = groupInt(lvls);
  const accent = C.gold;
  // include every glyph the chips render (digits, '%', shots count) in the subset.
  const extra = `${big}${pct}%${shots}${saves}${reached}`;
  const [cinzel, fredoka] = await Promise.all([
    loadGoogleFont('Cinzel Decorative', 900, `${CHARSET}${extra}`),
    loadGoogleFont('Fredoka', 600, `${CHARSET}${extra}`),
  ]);
  const tree = h(
    'div',
    {
      style: {
        width: W, height: H, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64,
        backgroundColor: C.realm,
        backgroundImage:
          'radial-gradient(120% 80% at 50% 115%, rgba(57,217,138,0.34) 0%, rgba(57,217,138,0) 55%),' +
          'radial-gradient(110% 70% at 50% -15%, rgba(255,182,39,0.30) 0%, rgba(255,182,39,0) 55%),' +
          `linear-gradient(160deg, ${C.realm2} 0%, ${C.realm} 70%)`,
        color: C.ink,
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: { fontFamily: 'Cinzel', fontSize: 56, color: C.gold, letterSpacing: 2 } }, BRAND.wordmark),
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 24, color: 'rgba(255,182,39,0.85)', letterSpacing: 6 } }, 'KEEPER')
      ),
      h(
        'div',
        { style: { display: 'flex', fontFamily: 'Fredoka', fontSize: 24, letterSpacing: 6, color: C.ink, padding: '12px 24px', borderRadius: 999, background: 'rgba(57,217,138,0.16)', border: `1px solid ${accent}` } },
        `REACHED LV ${reached}`
      )
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 30, letterSpacing: 8, color: 'rgba(250,244,233,0.65)' } }, 'LEVELS CLEARED'),
        h('span', { style: { fontFamily: 'Cinzel', fontSize: 200, lineHeight: 1, color: '#ffffff' } }, big),
        h('span', { style: { fontFamily: 'Fredoka', fontSize: 30, color: C.fireBright, marginTop: 8 } }, `Reached level ${reached}`)
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        chip('SAVE RATE', `${pct}%`, C.gold),
        chip('SHOTS FACED', String(shots), C.fireBright),
        chip('TIME', fmtDur(durationSec), C.magic)
      )
    )
  );
  return new ImageResponse(tree, {
    width: W, height: H,
    fonts: [
      { name: 'Cinzel', data: cinzel, weight: 900, style: 'normal' },
      { name: 'Fredoka', data: fredoka, weight: 600, style: 'normal' },
    ],
    headers: { 'cache-control': 'public, immutable, no-transform, max-age=31536000' },
  });
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('g') === 'keeper') return await keeperImage(searchParams);
    if (searchParams.get('g') === 'dino') return await dinoImage(searchParams);
    const score = intParam(searchParams.get('score'));
    const slain = intParam(searchParams.get('slain'));
    const kcal = intParam(searchParams.get('kcal'));
    const durationSec = intParam(searchParams.get('t'));
    const comboRaw = searchParams.get('combo');
    const combo = comboRaw != null ? intParam(comboRaw, null) : null;

    const scoreText = groupInt(score);
    const [cinzel, fredoka] = await Promise.all([
      loadGoogleFont('Cinzel Decorative', 900, `${CHARSET}${scoreText}${slain}${kcal}`),
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
          h('span', { style: { fontFamily: 'Cinzel', fontSize: 200, lineHeight: 1, color: '#ffffff' } }, scoreText),
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
