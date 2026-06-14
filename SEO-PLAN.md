# SlayFit / Dino Survival — SEO Plan

A grounded plan to get Google (and AI crawlers) to discover, index, and rank the games so you pull organic traffic. Recommendations are based on current (2026) guidance, cited at the bottom.

---

## The core problem (read this first)

The app ships as a **client-rendered Vite + React SPA**. The built `dist/index.html` is essentially:

```html
<title>SlayFit — Punch · Block · Burn</title>
<body><div id="root"></div></body>
```

No description, no canonical, no Open Graph tags, and **no actual content** until JavaScript runs. This matters because:

- **Googlebot _can_ render JS, but in a delayed "second wave."** It crawls the raw HTML first, then queues the page to run JS hours-to-days later. For a page whose entire content depends on JS, indexing is slow and unreliable. ([Google two-wave rendering](https://www.stackmatix.com/blog/how-googlebot-crawls-single-page-applications), [SPA SEO 2026](https://www.weweb.io/blog/seo-single-page-application-ultimate-guide))
- **AI crawlers don't render JS at all.** GPTBot, ClaudeBot, and PerplexityBot fetch raw HTML only — they execute zero JavaScript. To them your site is a blank page today, so you're invisible in AI/LLM answers. ([AI crawlers + SPAs](https://www.getpassionfruit.com/blog/javascript-rendering-and-ai-crawlers-can-llms-read-your-spa))
- **You have one route.** Both SlayFit (the brawler) and Dino Survival live at `/` behind a React state router. Google has exactly one URL with one (empty) `<head>` to rank — so you're competing for everything with a single thin page.

The fix is to make the **HTML that crawlers receive before any JS runs** contain real titles, descriptions, and copy — and to give each game its own URL.

---

## Target keywords

People don't search "SlayFit" (no one knows the brand yet). They search the _activity_. Group by intent and build pages around these.

**Category / head terms** (high volume, competitive — use in titles & H1s)

- exergame, exergaming, gamercise
- webcam fitness game, webcam workout game
- motion controlled game, motion sensing game
- play games with your body / camera game / webcam game

**Long-tail / buyer-intent** (lower volume, easier to rank, higher conversion — best ROI)

- free workout game no equipment
- full body workout game online / in browser
- fitness game no download (play in browser)
- cardio game at home, fun workout game
- AI pose / camera-controlled game

**Game-specific** (own pages should target these)

- _SlayFit_: webcam boxing game, shadow boxing game online, punch workout game, "punch · block · burn" brawler
- _Dino Survival_: dino run game, run-in-place game, endless runner workout, chrome-dino-style cardio game
- _Origin/jumpjack angle_: jumping jacks game, AI jumping jack counter, jumping jacks tracker

**Why these:** "exergame," "fitness game," and "gamercise" are the established umbrella terms for play-as-exercise; "webcam fitness game" and "motion controlled game" are how the closest competitors (Zazti, WebCam Mania, DanceWall) describe themselves. Long-tail "no equipment / no download / in browser" phrases match your single biggest differentiator — open a link and move, no console or app needed. ([fitness game terminology](https://en.wikipedia.org/wiki/Fitness_game), [webcam fitness games](https://67speedgames.com/blog/webcam-fitness-games-future/), [competitor landscape](https://itch.io/games/free/input-webcam))

---

## The fix, in priority order

### 1. Fill in the static `<head>` (1 hour, do today)

Edit `index.html` (the source Vite uses for every build) so the pre-JS HTML carries real metadata. Crawlers read this immediately.

```html
<meta name="description" content="SlayFit is a free webcam fitness game — punch, block and dodge your way through a cardio workout using just your camera. No equipment, no download. Play in your browser." />
<link rel="canonical" href="https://YOUR-DOMAIN.com/" />
<meta name="theme-color" content="#0a0a0f" />

<!-- Open Graph / Twitter (so links unfurl + non-JS crawlers get content) -->
<meta property="og:type" content="website" />
<meta property="og:title" content="SlayFit — Webcam Fitness Brawler" />
<meta property="og:description" content="Punch, block, burn. A free full-body workout game you play with your webcam." />
<meta property="og:image" content="https://YOUR-DOMAIN.com/og-cover.png" />
<meta property="og:url" content="https://YOUR-DOMAIN.com/" />
<meta name="twitter:card" content="summary_large_image" />
```

You already generate dynamic OG images for shared scores in `api/share.js` — this just gives the **homepage itself** a static equivalent.

### 2. Put crawlable text content in the page (highest impact)

Crawlers need words. Add a real hero block — `<h1>`, a paragraph describing the game, a "How to play" section, and a list of the games — that exists in the HTML **before** React mounts. Two ways:

- **Quick:** hand-write the hero HTML inside `<div id="root">…</div>` in `index.html`. React replaces it on mount, but crawlers (and AI bots) read it. Add a `<noscript>` version too.
- **Proper (recommended):** prerender at build time with a Vite SSG plugin so the built `index.html` contains the fully rendered hero. Options: `vite-react-ssg` or `@wroud/vite-plugin-ssg`. This is the standard 2026 answer for a client-rendered SPA that needs SEO without migrating frameworks. ([prerendering for SPA SEO](https://prerender.info/), [Vite SSG options](https://www.npmjs.com/package/@wroud/vite-plugin-ssg))

### 3. Give each game its own URL (more surface area to rank)

Right now everything is `/`. Add real routes — `/slayfit` (boxing/brawler) and `/dino-survival` (run game) — each prerendered with its **own** title, description, H1, and copy targeting that game's keywords. One generic page can't rank for both "webcam boxing game" and "dino run game"; two focused pages can. A landing page that links into the game also lets you rank without forcing the heavy game engine to load first.

### 4. Add `robots.txt` + `sitemap.xml` (15 min)

Both are missing. Drop into `public/`:

`public/robots.txt`
```
User-agent: *
Allow: /
Sitemap: https://YOUR-DOMAIN.com/sitemap.xml
```

`public/sitemap.xml` — list `/`, `/slayfit`, `/dino-survival`. A sitemap is the explicit list of URLs you want crawled and is standard guidance for SPAs. ([SPA sitemap guidance](https://collaborator.pro/blog/javascript-seo-optimize-spa-sites))

### 5. Structured data (JSON-LD)

Add a `VideoGame` block **co-typed** with `WebApplication`. Important caveat: Google does **not** show a rich result for `VideoGame` alone — you must co-type it with `WebApplication` / `SoftwareApplication` to be eligible. ([Google: co-type VideoGame](https://www.seroundtable.com/google-video-games-schema-32249.html), [Software App schema](https://developers.google.com/search/docs/appearance/structured-data/software-app))

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["VideoGame", "WebApplication"],
  "name": "SlayFit",
  "description": "Free webcam fitness brawler. Punch, block and dodge a cardio workout using your camera.",
  "genre": ["Fitness", "Exergame", "Action"],
  "applicationCategory": "GameApplication",
  "operatingSystem": "Web browser",
  "gamePlatform": "Web",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
</script>
```

### 6. Register with search engines

Create a **Google Search Console** property, verify the domain, submit the sitemap, and use "Request indexing" on each URL. Do the same in **Bing Webmaster Tools** (also feeds some AI answers). Nothing ranks until Google knows the site exists — this is the step people skip.

### 7. A memorable custom domain

The Vercel project is `demon-realm` (so a `*.vercel.app` URL). A branded domain like `slayfit.app` or `slayfit.game` is easier to share, link, and remember, and lets you set a clean canonical. You're already on HTTPS via Vercel, which Google requires.

### 8. Performance / Core Web Vitals

The game pulls MediaPipe WASM + PixiJS — heavy. Make sure the **landing content paints before** the engine loads (lazy-load the game module on a "Play" click). Good Largest Contentful Paint and a fast first render are ranking factors and keep crawlers from timing out. ([SPA performance + SEO](https://digispot.ai/blog/react-seo-optimization-guide))

### 9. Off-page (where game traffic actually comes from)

SEO gets you found; these get you links and players: list on **itch.io** (the webcam-input category is small and discoverable), launch on **Product Hunt**, post demos to relevant subreddits (r/webgames, r/fitness, r/IndieDev) and TikTok/Shorts. Inbound links from these raise your domain's authority and directly drive players.

---

## Suggested sequence

1. **Today:** `<head>` meta + OG tags, `robots.txt`, `sitemap.xml`, JSON-LD, Google Search Console. (Half a day, unlocks indexing.)
2. **This week:** prerender the homepage hero with real copy targeting your head + long-tail keywords.
3. **Next:** split SlayFit and Dino Survival into their own prerendered landing pages.
4. **Ongoing:** custom domain, performance pass, itch.io / Product Hunt / social.

The single highest-leverage move is #2 — get real words into the HTML before JS runs — because it fixes the one thing that currently makes both Google's render queue and every AI crawler see a blank page.

---

## Sources

- [JavaScript SEO: How Googlebot Crawls Single-Page Applications — Stackmatix](https://www.stackmatix.com/blog/how-googlebot-crawls-single-page-applications)
- [SEO Single Page Application: The 2026 Ultimate Guide — WeWeb](https://www.weweb.io/blog/seo-single-page-application-ultimate-guide)
- [JavaScript Rendering and AI Crawlers: Can LLMs Read Your SPA? — Passionfruit](https://www.getpassionfruit.com/blog/javascript-rendering-and-ai-crawlers-can-llms-read-your-spa)
- [JavaScript SEO Guide 2026 — Fuel Online](https://fuelonline.com/seo/javascript-seo-guide-2026/)
- [JavaScript SEO — Optimize SPA Sites — Collaborator](https://collaborator.pro/blog/javascript-seo-optimize-spa-sites)
- [Pre-rendering for JavaScript SEO — prerender.info](https://prerender.info/)
- [@wroud/vite-plugin-ssg — npm](https://www.npmjs.com/package/@wroud/vite-plugin-ssg)
- [React SEO Optimization Guide 2026 — Digispot](https://digispot.ai/blog/react-seo-optimization-guide)
- [Software App (SoftwareApplication) Schema — Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Google: Video Games Not Valid Software Type alone — Search Engine Roundtable](https://www.seroundtable.com/google-video-games-schema-32249.html)
- [VideoGame — Schema.org](https://schema.org/VideoGame)
- [Fitness game (terminology) — Wikipedia](https://en.wikipedia.org/wiki/Fitness_game)
- [Webcam Fitness Games: The Future of Working Out at Home — 67 Speed Games](https://67speedgames.com/blog/webcam-fitness-games-future/)
- [Top free games with Webcam support — itch.io](https://itch.io/games/free/input-webcam)
