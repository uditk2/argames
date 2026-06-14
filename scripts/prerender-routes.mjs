// ===========================================================================
// PRERENDER ROUTES — post-build step (runs after `vite build`).
//
// Vite emits one client-rendered dist/index.html. This script clones it into a
// static HTML file per crawlable route (see src/config/seo-routes.js), injecting
// that route's <head> (title/description/canonical/OG/JSON-LD) and a crawlable
// hero into the SEO_HEAD / SEO_BODY markers. It also writes sitemap.xml.
//
// Result: crawlers (and JS-less AI bots) get real per-URL HTML; the SPA still
// hydrates and takes over for humans.
//
// Usage: node scripts/prerender-routes.mjs [distDir]   (default: dist)
// ===========================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, SITE_URL, headHtml, urlFor } from '../src/config/seo-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', process.argv[2] || 'dist');
const templatePath = join(dist, 'index.html');

const template = readFileSync(templatePath, 'utf8');
if (!template.includes('<!--SEO_HEAD-->') || !template.includes('<!--SEO_BODY-->')) {
  console.error('[prerender] markers <!--SEO_HEAD--> / <!--SEO_BODY--> not found in', templatePath);
  process.exit(1);
}

for (const route of ROUTES) {
  const html = template
    .replace('<!--SEO_HEAD-->', headHtml(route))
    .replace('<!--SEO_BODY-->', route.body);
  const outPath =
    route.path === '/' ? join(dist, 'index.html') : join(dist, route.path.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  console.log('[prerender]', route.path, '->', outPath.replace(dist, '.'));
}

// sitemap.xml — every route, home highest priority.
const body = ROUTES.map(
  (r) =>
    `  <url>\n    <loc>${urlFor(r)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${
      r.path === '/' ? '1.0' : '0.8'
    }</priority>\n  </url>`
).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
writeFileSync(join(dist, 'sitemap.xml'), sitemap);
console.log('[prerender] sitemap.xml ->', ROUTES.length, 'urls @', SITE_URL);
