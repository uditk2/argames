// ===========================================================================
// SHARE LANDING — /api/share  (pretty path: /s, see vercel.json rewrite)
// ---------------------------------------------------------------------------
// Returns a tiny HTML page carrying Open Graph / Twitter Card meta tags so that
// X / Facebook / LinkedIn crawlers (which DON'T run JS, so the SPA's runtime
// tags are invisible to them) render the dynamic /api/og image as the preview.
//
// Humans who click the shared link get a real landing: the card image + a
// "Play SlayFit" button into the game. Crawlers just read the <head>.
//
// All params are coerced to safe integers and HTML-escaped before output.
// ===========================================================================

const BRAND = { name: 'SlayFit', descriptor: 'webcam workout brawler' };

function int(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function handler(req, res) {
  const q = req.query || {};
  const score = int(q.score);
  const slain = int(q.slain);
  const kcal = int(q.kcal);
  const durationSec = int(q.t);
  const combo = q.combo != null ? int(q.combo, null) : null;

  // Absolute origin (crawlers require absolute og:image / og:url URLs).
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const origin = `${proto}://${host}`;

  let ogParams, title, desc;
  if (q.g === 'dino') {
    // Dino Survival: esc (1|0), dt (escape/survive time in deci-seconds), pct (distance %).
    const escaped = q.esc === '1';
    const dt = int(q.dt);
    const pct = int(q.pct);
    const timeS = (dt / 10).toFixed(1);
    ogParams = new URLSearchParams({ g: 'dino', esc: escaped ? '1' : '0', dt: String(dt), pct: String(pct) });
    title = escaped ? `Escaped the dino in ${timeS}s` : `Caught at ${pct}% by the dino`;
    desc = escaped
      ? `I outran the beast and reached the jeep in ${timeS}s on ${BRAND.name} Dino Survival. Can you beat my time?`
      : `The beast caught me at ${pct}% on ${BRAND.name} Dino Survival. Can you escape?`;
  } else {
    ogParams = new URLSearchParams({ score: String(score), slain: String(slain), kcal: String(kcal), t: String(durationSec) });
    if (combo != null) ogParams.set('combo', String(combo));
    title = `${score.toLocaleString()} pts in ${BRAND.name}`;
    desc = `I cleared the realm — ${slain} demons slain, ${kcal} kcal burned in ${fmtDur(durationSec)}. Think you can beat it?`;
  }

  const imageUrl = `${origin}/api/og?${ogParams.toString()}`;
  const pageUrl = `${origin}/s?${ogParams.toString()}`;
  const playUrl = `${origin}/`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — ${esc(BRAND.name)}</title>
  <meta name="description" content="${esc(desc)}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(BRAND.name)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(pageUrl)}" />
  <meta property="og:image" content="${esc(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${esc(imageUrl)}" />

  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; }
    body {
      min-height: 100vh; display: flex; flex-direction: column; gap: 24px;
      align-items: center; justify-content: center; padding: 24px;
      background: radial-gradient(120% 80% at 50% 115%, rgba(255,122,60,.35), transparent 55%),
                  radial-gradient(110% 70% at 50% -15%, rgba(255,182,39,.30), transparent 55%),
                  linear-gradient(160deg, #160A1A, #0A0612 70%);
      color: #FAF4E9; font-family: system-ui, sans-serif; text-align: center;
    }
    img { width: min(92vw, 640px); height: auto; border-radius: 18px;
          box-shadow: 0 18px 60px rgba(0,0,0,.55); border: 1px solid rgba(255,182,39,.25); }
    a.play {
      display: inline-block; padding: 14px 40px; border-radius: 14px; font-weight: 700;
      font-size: 18px; color: #fff; text-decoration: none;
      background: linear-gradient(90deg, #FF7A3C, #FFB627);
      box-shadow: 0 8px 30px rgba(255,122,60,.4);
    }
    p { color: rgba(255,182,39,.85); letter-spacing: .18em; text-transform: uppercase; font-size: 13px; }
  </style>
</head>
<body>
  <img src="${esc(imageUrl)}" alt="${esc(title)}" />
  <p>${esc(BRAND.descriptor)}</p>
  <a class="play" href="${esc(playUrl)}">Play ${esc(BRAND.name)}</a>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Crawlers re-fetch; cache the rendered HTML at the edge for a day.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.status(200).send(html);
}
