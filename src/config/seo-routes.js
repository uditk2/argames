// ===========================================================================
// SEO ROUTES — single source of truth for every crawlable URL.
//
// Used in two places:
//   • runtime  (src/ui/App.jsx)        — maps URL <-> game, sets <head> on nav
//   • buildtime(scripts/prerender-...) — writes a static HTML file per route
//
// `game` is App's internal game id: null = home | 'demon' (Monster Punch) | 'dino'.
// Keep paths in sync with the App router and vercel.json.
// ===========================================================================

import { BRAND } from './brand.js';

export const SITE_URL = (BRAND.siteUrl || 'https://slayfit.fun').replace(/\/$/, '');
const OG_IMAGE = '/og-cover.png';

export const ROUTES = [
  {
    path: '/',
    game: null,
    title: 'SlayFit — Fitness AR Games You Play With Your Webcam',
    description:
      'SlayFit is a collection of free fitness AR games you play with your webcam — punch, block, dodge and run a real cardio workout. No equipment, no download, just your camera and your body.',
    body: `<main>
        <h1>SlayFit — Fitness AR Games You Play With Your Webcam</h1>
        <p>SlayFit is a collection of free fitness AR games that turn your webcam into a full-body controller. Stand in front of your camera and your movement drives the game — no console, no equipment, no download. Just open the page and start moving.</p>
        <h2>The games</h2>
        <ul>
          <li><a href="/brawler"><strong>Monster Punch</strong></a> — a webcam boxing brawler: punch incoming monsters, raise both arms to block, and dodge ground traps. A timed upper-body cardio workout you control with your body.</li>
          <li><a href="/dino-survival"><strong>Dino Survival</strong></a> — a run-in-place endless runner: jog on the spot to outrun the beast, and jump or duck obstacles using real movement.</li>
        </ul>
        <h2>How to play</h2>
        <p>Allow camera access, stand back so your upper body is in frame, and move. Pose tracking reads your punches, blocks, jumps and squats in real time. No camera? A demo mode drives the game with simulated input.</p>
      </main>`,
  },
  {
    path: '/brawler',
    game: 'demon',
    title: 'Monster Punch — Webcam Boxing Workout Game | SlayFit',
    description:
      'Monster Punch is a free webcam boxing game. Throw real punches at incoming monsters, raise both arms to block, and dodge — a timed upper-body cardio workout controlled by your webcam. No equipment, no download.',
    body: `<main>
        <h1>Monster Punch — Webcam Boxing Workout</h1>
        <p>Monster Punch is a free webcam boxing brawler. Throw real punches to hit incoming monsters, raise both arms to block, and dodge to survive a timed cardio round — an arms, shoulders and reflex workout driven entirely by your webcam.</p>
        <h2>How to play</h2>
        <p>Allow camera access and stand back so your upper body is in frame. Pose tracking reads your punches and blocks in real time. No camera? Use demo mode.</p>
        <p>Part of <a href="/">SlayFit fitness AR games</a> · also try <a href="/dino-survival">Dino Survival</a>.</p>
      </main>`,
  },
  {
    path: '/dino-survival',
    game: 'dino',
    title: 'Dino Survival — Run-in-Place Endless Runner Game | SlayFit',
    description:
      'Dino Survival is a free run-in-place cardio game. Jog on the spot to outrun the beast and reach the jeep; jump and duck obstacles with real movement. Webcam-controlled, no equipment, no download.',
    body: `<main>
        <h1>Dino Survival — Run-in-Place Endless Runner</h1>
        <p>Dino Survival is a free run-in-place endless runner. Jog on the spot to outrun the beast and reach the jeep, and jump or duck obstacles using real movement — a full-body cardio game controlled by your webcam.</p>
        <h2>How to play</h2>
        <p>Allow camera access, stand back so your body is in frame, and run in place. Pose tracking turns your stride, jumps and ducks into controls. No camera? Use demo mode.</p>
        <p>Part of <a href="/">SlayFit fitness AR games</a> · also try <a href="/brawler">Monster Punch</a>.</p>
      </main>`,
  },
];

const HOME = ROUTES[0];

/** Normalize a pathname and return its route (falls back to home). */
export function routeForPath(pathname) {
  const clean = String(pathname || '/').replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) || HOME;
}

/** Return the route for an App game id (null/'demon'/'dino'). */
export function routeForGame(game) {
  return ROUTES.find((r) => r.game === (game ?? null)) || HOME;
}

/** Absolute URL for a route. */
export function urlFor(route) {
  return SITE_URL + (route.path === '/' ? '/' : route.path);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function jsonLd(route) {
  return {
    '@context': 'https://schema.org',
    '@type': ['VideoGame', 'WebApplication'],
    name: route.title.split(' — ')[0],
    description: route.description,
    genre: ['Fitness', 'Exergame', 'Action'],
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web browser',
    gamePlatform: 'Web',
    url: urlFor(route),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

/** Full <head> SEO block for a route — used by the build-time prerender script. */
export function headHtml(route) {
  const url = urlFor(route);
  const img = SITE_URL + OG_IMAGE;
  return `<title>${esc(route.title)}</title>
    <meta name="description" content="${esc(route.description)}" />
    <meta name="theme-color" content="#0a0a0f" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(route.title)}" />
    <meta property="og:description" content="${esc(route.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(route.title)}" />
    <meta name="twitter:description" content="${esc(route.description)}" />
    <meta name="twitter:image" content="${img}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(route))}</script>`;
}

// --- Runtime-only helpers (no-ops outside the browser) ---------------------

function setMeta(attr, key, val) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', val);
}
function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
  el.setAttribute('href', href);
}

/** Sync the live <head> with a route (title + description + canonical + OG). */
export function applyRouteHead(route) {
  if (typeof document === 'undefined') return;
  const url = urlFor(route);
  document.title = route.title;
  setMeta('name', 'description', route.description);
  setLink('canonical', url);
  setMeta('property', 'og:title', route.title);
  setMeta('property', 'og:description', route.description);
  setMeta('property', 'og:url', url);
  setMeta('name', 'twitter:title', route.title);
  setMeta('name', 'twitter:description', route.description);
}
