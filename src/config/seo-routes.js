// ===========================================================================
// SEO ROUTES — single source of truth for every crawlable URL.
//
// Used in two places:
//   • runtime  (src/ui/App.jsx)        — maps URL <-> game, sets <head> on nav
//   • buildtime(scripts/prerender-...) — writes a static HTML file per route
//
// `game` is App's internal game id: null = home | 'demon' (Monster Punch) |
// 'dino' (Dino Survival) | 'keeper' (Keeper, AR goalkeeping).
// `view` marks non-game pages that still own a URL (e.g. the standalone
// leaderboards page). Home is the only game:null route WITHOUT a view.
// Keep paths in sync with the App router and vercel.json.
// ===========================================================================

import { BRAND } from './brand.js';

export const SITE_URL = (BRAND.siteUrl || 'https://slayfit.fun').replace(/\/$/, '');
const OG_IMAGE = '/og-cover.png';

export const ROUTES = [
  {
    path: '/',
    game: null,
    title: 'SlayFit — Free No-Download Webcam AR Games',
    description:
      'SlayFit is a collection of free no-download games you play with your webcam — popular no-download games like an AR football game, webcam boxing and a run-in-place runner. No install, just your camera and your body.',
    body: `<main>
        <h1>SlayFit — Free No-Download Webcam AR Games</h1>
        <p>SlayFit is a collection of free no-download games that turn your webcam into a full-body controller. Stand in front of your camera and your movement drives the game — no console, no equipment, no install. These are popular no-download games you open and play instantly in the browser.</p>
        <h2>Free no-download games you can play today</h2>
        <ul>
          <li><a href="/keeper"><strong>Keeper</strong></a> — a free, no-download <strong>AR football game</strong>: be the webcam goalkeeper, dive and save shots that get faster and wider every level. Play the AR football game today.</li>
          <li><a href="/brawler"><strong>Monster Punch</strong></a> — a webcam boxing brawler: punch incoming monsters, raise both arms to block, and dodge ground traps. A timed upper-body cardio workout you control with your body.</li>
          <li><a href="/dino-survival"><strong>Dino Survival</strong></a> — a run-in-place endless runner: jog on the spot to outrun the beast, and jump or duck obstacles using real movement.</li>
        </ul>
        <h2>Why no-download games are so popular</h2>
        <p>No-download games load straight in your browser — no app store, no install, no waiting. SlayFit takes that one step further: every game is free, runs on your webcam, and turns real movement into the controller. It is instant, popular, and works on the device you already have.</p>
        <h2>How to play</h2>
        <p>Allow camera access, stand back so your upper body is in frame, and move. Pose tracking reads your punches, blocks, jumps and squats in real time. No camera? A demo mode drives the game with simulated input.</p>
        <h2>Read more</h2>
        <ul>
          <li><a href="/blog/free-no-download-games">Free No-Download Games: Popular Browser Games You Can Play Today</a></li>
          <li><a href="/blog/ar-football-game">AR Football Game You Can Play Today — Be the Webcam Goalkeeper</a></li>
        </ul>
      </main>`,
  },
  {
    path: '/brawler',
    game: 'demon',
    title: 'Monster Punch — Free Online Punch Game | SlayFit',
    description:
      'Monster Punch is a free online punch game — a webcam boxing brawler in the spirit of classic punch-out games. Throw real punches at monsters, block and dodge. No download; play this punch-out-style game online in your browser.',
    body: `<main>
        <h1>Monster Punch — Online Punch-Out-Style Boxing</h1>
        <p>Monster Punch is a free online <strong>punch game</strong> — a webcam boxing brawler. Throw real punches to hit incoming monsters, raise both arms to block, and dodge to survive a timed cardio round, driven entirely by your webcam.</p>
        <p>If you love punch games or classic Super Punch-Out-style arcade boxing, Monster Punch is a no-download take you play online in your browser — except you control the fighter with your own body (think stickman punch, but it's really you moving).</p>
        <h2>How to play</h2>
        <p>Allow camera access and stand back so your upper body is in frame. Pose tracking reads your punches and blocks in real time. No camera? Use demo mode.</p>
        <p>Part of <a href="/">SlayFit fitness AR games</a> · also try <a href="/dino-survival">Dino Survival</a>.</p>
      </main>`,
  },
  {
    path: '/dino-survival',
    game: 'dino',
    title: 'Dino Survival — T-Rex Run Endless Runner Game | SlayFit',
    description:
      'Dino Survival is a free T-Rex run endless runner you play with your webcam. Jog in place to outrun the beast and reach the jeep, jumping and ducking obstacles with real movement — a no-download trex run cardio game.',
    body: `<main>
        <h1>Dino Survival — T-Rex Run Endless Runner</h1>
        <p>Dino Survival is a free, full-body take on the classic <strong>T-Rex run</strong> (a.k.a. trex run) endless runner. Jog on the spot to outrun the beast and reach the jeep, and jump or duck obstacles using real movement — a cardio game controlled entirely by your webcam, no download required.</p>
        <h2>How to play</h2>
        <p>Allow camera access, stand back so your body is in frame, and run in place. Pose tracking turns your stride, jumps and ducks into controls. No camera? Use demo mode.</p>
        <p>Part of <a href="/">SlayFit fitness AR games</a> · also try <a href="/brawler">Monster Punch</a>.</p>
      </main>`,
  },
  {
    path: '/keeper',
    game: 'keeper',
    title: 'AR Football Game — Free No-Download Goalkeeper | SlayFit',
    description:
      'Keeper is a free, no-download AR football game you can play today. Be the webcam goalkeeper — dive and save shots that get faster, swervier and wider every level. No app, no install, just your camera.',
    body: `<main>
        <h1>AR Football Game — Be the Webcam Goalkeeper</h1>
        <p>Keeper is a free, no-download <strong>AR football game</strong> you can play today right in your browser. You are the goalkeeper: your body is scaled to fill the goal mouth, so you reach and lean to dive and stop the shots. Each level the ball flies faster, swerves harder, and the goal grows wider — an endless, lives-based AR football game and reaction workout driven entirely by your webcam.</p>
        <h2>Play the AR football game today — no download</h2>
        <p>There is nothing to install. Open the page, allow camera access, and you are in goal. It is one of SlayFit's free no-download games: instant, popular and powered by real movement instead of a controller.</p>
        <h2>How to play</h2>
        <p>Allow camera access and stand back so your head, shoulders and arms are in frame. Pose tracking maps your reach and lean into a diving keeper. No camera? Use demo mode.</p>
        <h2>Read more</h2>
        <ul>
          <li><a href="/blog/ar-football-game">AR Football Game You Can Play Today — Be the Webcam Goalkeeper</a></li>
          <li><a href="/blog/free-no-download-games">Free No-Download Games: Popular Browser Games You Can Play Today</a></li>
        </ul>
        <p>Part of <a href="/">SlayFit free no-download games</a> · also try <a href="/brawler">Monster Punch</a> and <a href="/dino-survival">Dino Survival</a>.</p>
      </main>`,
  },
  {
    path: '/leaderboard',
    game: null,
    view: 'leaderboard',
    title: 'Leaderboard — Top SlayFit Players | SlayFit',
    description:
      'See who tops the SlayFit leaderboards. The fastest Dino Survival escape times and the highest Monster Punch scores from players around the world. Beat them with your webcam — no equipment, no download.',
    body: `<main>
        <h1>SlayFit Leaderboards</h1>
        <p>See who tops the SlayFit boards across every game — then jump in and beat them. Every score is set with nothing but a webcam and real movement.</p>
        <h2>The boards</h2>
        <ul>
          <li><a href="/dino-survival"><strong>Dino Survival</strong></a> — fastest escape time wins. Run in place to outrun the beast and reach the jeep before anyone else.</li>
          <li><a href="/brawler"><strong>Monster Punch</strong></a> — highest score wins. Punch and block your way to the top of the arena.</li>
        </ul>
        <p>Part of <a href="/">SlayFit fitness AR games</a>.</p>
      </main>`,
  },
  {
    path: '/blog',
    game: null,
    view: 'blog',
    title: 'SlayFit Blog — Guides to Free No-Download Webcam Games',
    description:
      'Guides and explainers for SlayFit, a collection of free no-download games. Learn about popular browser games you can play today and how the webcam AR football goalkeeper game works.',
    body: `<article>
        <h1>SlayFit Blog</h1>
        <p>Short, useful guides to SlayFit — a collection of free no-download games you play with your webcam. Browse our posts on popular browser games and the AR football game you can play today.</p>
        <h2>Latest posts</h2>
        <ul>
          <li><a href="/blog/free-no-download-games"><strong>Free No-Download Games: Popular Browser Games You Can Play Today</strong></a> — what no-download games are, why they are popular, and the best free webcam games to play right now.</li>
          <li><a href="/blog/ar-football-game"><strong>AR Football Game You Can Play Today — Be the Webcam Goalkeeper</strong></a> — how an AR football game works and why webcam goalkeeping is a fun, instant, no-download way to play.</li>
        </ul>
        <p>Back to the <a href="/">SlayFit free no-download games</a>.</p>
      </article>`,
  },
  {
    path: '/blog/free-no-download-games',
    game: null,
    view: 'blog',
    title: 'Free No-Download Games: Popular Browser Games You Can Play Today',
    description:
      'A guide to free no-download games — what they are, why they are so popular, and a curated list of free webcam games you can play today, including an AR football game, boxing and a runner.',
    body: `<article>
        <h1>Free No-Download Games: Popular Browser Games You Can Play Today</h1>
        <p>Free no-download games are games you open and play instantly in your browser — no app store, no install, no waiting. They have quietly become some of the most popular games on the web precisely because there is nothing standing between you and the fun. In this guide we explain what no-download games are, why they have become so popular, and round up a short list of free webcam games you can play today.</p>

        <h2>What are no-download games?</h2>
        <p>A no-download game runs entirely in the web browser. You click a link, the page loads, and you are playing. There is no executable to install, no console to own, and no account required to start. Modern browsers are powerful enough to run real-time graphics, audio and even computer-vision pose tracking, which means a no-download game today can be every bit as rich as something you would have installed a few years ago.</p>

        <h2>Why no-download games are so popular</h2>
        <p>The appeal is simple: zero friction. No-download, popular games win because anyone can join in seconds, on the device they already have, without filling up storage or trusting an installer. They are easy to share — you just send a link — and they work the same on a laptop, a desktop or a phone. For free games in particular, removing the install step removes the single biggest reason people bounce before they ever start.</p>

        <h2>Free webcam games you can play today</h2>
        <p>SlayFit is a collection of free no-download games that go one step further than the usual browser game: instead of a keyboard or a gamepad, your webcam reads your body, so your real movement is the controller. Here are the games, each free and instant:</p>
        <ul>
          <li><a href="/keeper"><strong>Keeper</strong></a> — a free <strong>AR football game</strong> where you are the goalkeeper. Your body is scaled to fill the goal, and you dive and lean to save shots that get faster and wider every level. Play the AR football game today, no download required.</li>
          <li><a href="/brawler"><strong>Monster Punch</strong></a> — a webcam boxing brawler. Throw real punches at incoming monsters, raise both arms to block, and dodge ground traps for a timed upper-body cardio round.</li>
          <li><a href="/dino-survival"><strong>Dino Survival</strong></a> — a run-in-place endless runner. Jog on the spot to outrun the beast and reach the jeep, jumping and ducking obstacles with real movement.</li>
        </ul>

        <h2>How to start in seconds</h2>
        <p>Pick a game above, allow camera access when prompted, and stand back so your upper body is in frame. Pose tracking reads your punches, dives, jumps and squats in real time. No webcam handy? Every game has a demo mode that drives the action with simulated input, so you can try the experience before turning your camera on.</p>

        <h2>Are no-download games safe and free?</h2>
        <p>Because they run in the browser sandbox, no-download games never install software on your machine, which makes them inherently lower-risk than downloaded executables. SlayFit's games are free to play, and the webcam feed stays on your device for pose tracking — you are simply moving in front of your own camera.</p>

        <h2>Start playing</h2>
        <p>The best way to understand why free no-download games are so popular is to play one. Jump into the <a href="/keeper">AR football goalkeeper game</a>, throw down in <a href="/brawler">Monster Punch</a>, or sprint through <a href="/dino-survival">Dino Survival</a> — all free, all instant, all in your browser. And if you want to go deeper on the goalkeeper experience, read our companion post on the <a href="/blog/ar-football-game">AR football game you can play today</a>.</p>
        <p>Back to all <a href="/">SlayFit free no-download games</a> · <a href="/blog">more guides</a>.</p>
      </article>`,
  },
  {
    path: '/blog/ar-football-game',
    game: null,
    view: 'blog',
    title: 'AR Football Game You Can Play Today — Be the Webcam Goalkeeper',
    description:
      'An AR football game you can play today: be the webcam goalkeeper, dive and save shots with your body. Learn how pose tracking, levels and save % work — free, instant and no download.',
    body: `<article>
        <h1>AR Football Game You Can Play Today — Be the Webcam Goalkeeper</h1>
        <p>If you have ever wanted to step between the posts, here is an <strong>AR football game</strong> you can play today — no kit, no pitch, and no download. SlayFit's Keeper turns your webcam into a goal mouth and your body into the goalkeeper: you dive, reach and lean to keep the ball out. This post explains how the AR football game works, why webcam goalkeeping is such a satisfying way to play, and how to get started in seconds.</p>

        <h2>What makes it an AR football game?</h2>
        <p>Augmented reality (AR) blends the digital game with the real you. In Keeper, a live pose model tracks your head, shoulders and arms through the webcam, then scales your body up so it fills the goal. The ball is rendered on screen, but the save is real — you physically reach and lean, and the game maps that movement onto a diving keeper. It is football reimagined as an AR exergame: the most fun part of the sport, the saves, distilled into a browser game you control with your body.</p>

        <h2>How Keeper works</h2>
        <p>Pose tracking reads your movement frame by frame and translates your reach and lean into the keeper's dive. As you clear each level the difficulty ramps: shots fly faster, swerve harder, and the goal grows wider, so you have to cover more ground. It is a lives-based, endless format — you keep going until the shots beat you, chasing a higher level and a better save percentage each run. That blend of reaction, agility and a rising save % is what keeps you diving for one more shot.</p>

        <h2>Why it is a great no-download AR football game</h2>
        <p>The best thing about it is the lack of friction. This is a free, no-download AR football game — there is nothing to install, no console to buy, and no waiting. You open the page, allow your camera, and you are in goal. That makes it easy to play on a whim and easy to share with a friend: just send the link. It sits alongside SlayFit's other <a href="/blog/free-no-download-games">free no-download games</a>, all of which run instantly in the browser.</p>

        <h2>How to play in your browser</h2>
        <p>Head to <a href="/keeper">Keeper</a>, allow camera access when prompted, and stand back so your head, shoulders and arms are in frame. Then react — dive left, stretch right, lean for the top corners. No webcam? A demo mode drives the keeper with simulated input so you can see the AR football game in action first.</p>

        <h2>Tips for more saves</h2>
        <p>Give yourself room to move, keep your whole upper body in frame, and stay light on your feet so you can reach the corners. Watch the ball's swerve early — later levels curve hard — and commit to your dive rather than hesitating. The wider the goal gets, the more your footwork and reach matter, so treat each level as a fresh agility test.</p>

        <h2>Play the AR football game today</h2>
        <p>There is no better time than now: jump into the <a href="/keeper">webcam goalkeeper AR football game</a> and see how many shots you can save. Want more? Explore the rest of SlayFit's <a href="/">free no-download games</a> or read our guide to <a href="/blog/free-no-download-games">popular browser games you can play today</a>.</p>
        <p><a href="/blog">More SlayFit guides</a>.</p>
      </article>`,
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
  // Blog routes get BlogPosting/Article markup; everything else is a game/app.
  if (route.view === 'blog') {
    return {
      '@context': 'https://schema.org',
      '@type': route.path === '/blog' ? 'Blog' : 'BlogPosting',
      headline: route.title,
      description: route.description,
      url: urlFor(route),
      image: SITE_URL + OG_IMAGE,
      inLanguage: 'en',
      author: { '@type': 'Organization', name: BRAND.name, url: SITE_URL + '/' },
      publisher: { '@type': 'Organization', name: BRAND.name, url: SITE_URL + '/' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': urlFor(route) },
    };
  }
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
