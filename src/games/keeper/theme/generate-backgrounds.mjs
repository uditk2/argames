#!/usr/bin/env node
// ===========================================================================
// KEEPER AR — STADIUM BACKGROUND GENERATOR (OpenAI Images / gpt-image-1)
// ---------------------------------------------------------------------------
// Generates production-quality stadium backdrops and saves PNGs into assets/bg/.
// The Keeper runtime PREFERS these PNGs if present and falls back to the
// procedural canvas art in background.js otherwise (see THEME_CONTRACT.md).
//
// REQUIREMENTS
//   • Node 18+ (uses global fetch).
//   • Environment: OPENAI_API_KEY must be set.
//       export OPENAI_API_KEY="sk-..."
//   • No npm dependencies — talks to the REST API directly.
//
// RUN
//   node generate-backgrounds.mjs                # all variants, 1536x1024
//   node generate-backgrounds.mjs night          # only the 'night' variant
//   node generate-backgrounds.mjs --size 1024x1024
//
// OUTPUT  (filenames match KEEPER_THEME.assets in theme.js)
//   assets/bg/stadium-day.png
//   assets/bg/stadium-night.png
//   assets/bg/stadium-finals.png
//
// COST/SAFETY: image generation is billed per image. This script asks for one
// image per variant. Re-running overwrites existing PNGs.
// ===========================================================================

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'assets', 'bg');

// ---------------------------------------------------------------------------
// PROMPTS — tuned to the SlayFit palette (molten gold / fire / deep realm).
// Shared style suffix keeps all three variants consistent: same camera framing
// (looking from the pitch toward an empty goal area), 16:9-ish, no people in
// the foreground (the live keeper/ball are composited on top at runtime).
// ---------------------------------------------------------------------------
const STYLE = [
  'Wide cinematic view from the penalty spot looking toward the goal end of a',
  'soccer stadium. The goal mouth area is left empty and unobstructed in the',
  'lower-center (a live goalkeeper and ball are composited there later), so keep',
  'the center-bottom clean with clear flat pitch. Dramatic depth: mown grass',
  'stripes in perspective, a curved tiered crowd bowl in the background, tall',
  'floodlight masts. Rich but slightly dark, moody arena mood. Color grade toward',
  'a molten-gold and warm-amber palette (RGB ~255,182,39 gold; ~255,122,60 fire',
  'orange) over deep near-black backgrounds (~10,6,18). High detail, volumetric',
  'light, subtle atmospheric haze, no text, no logos, no watermark, no UI,',
  'photorealistic-illustrative hybrid, game key-art quality.',
].join(' ');

const PROMPTS = {
  day: [
    'Late-afternoon golden-hour match.',
    'Warm low sun rakes across the pitch casting long shadows; sky graded amber',
    'to deep indigo at the top. Crowd visible but soft. Floodlights off or faint.',
    STYLE,
  ].join(' '),

  night: [
    'Floodlit night match — the hero/default look.',
    'Pitch-black sky, four blazing floodlight banks throwing gold volumetric',
    'beams down onto vivid green grass. Crowd is a dark silhouetted bowl speckled',
    'with thousands of tiny warm phone-lights and camera flashes. Gold rim-light',
    'on the grass, intense arena atmosphere.',
    STYLE,
  ].join(' '),

  finals: [
    'Championship final, peak intensity.',
    'Night stadium drenched in molten-gold and fiery-orange light, pyrotechnic',
    'glow and confetti haze in the air, floodlights flaring, the crowd a roaring',
    'sea of gold sparks. Slightly more saturated and dramatic than the night',
    'variant, epic finals key-art energy.',
    STYLE,
  ].join(' '),
};

const FILES = {
  day: 'stadium-day.png',
  night: 'stadium-night.png',
  finals: 'stadium-finals.png',
};

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { variants: [], size: '1536x1024' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') {
      args.size = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (PROMPTS[a]) {
      args.variants.push(a);
    } else {
      console.warn(`Ignoring unknown arg: ${a}`);
    }
  }
  if (!args.variants.length) args.variants = Object.keys(PROMPTS);
  return args;
}

async function generateOne(variant, size, apiKey) {
  const prompt = PROMPTS[variant];
  process.stdout.write(`• Generating "${variant}" (${size}) … `);

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size, // 1536x1024 (landscape), 1024x1024, or 1024x1536
      n: 1,
      // gpt-image-1 returns base64 by default in `data[].b64_json`.
      quality: 'high',
      background: 'opaque',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image data returned for "${variant}"`);

  const outPath = resolve(OUT_DIR, FILES[variant]);
  await writeFile(outPath, Buffer.from(b64, 'base64'));
  console.log(`saved → ${outPath}`);
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node generate-backgrounds.mjs [day|night|finals ...] [--size WxH]
Generates stadium backgrounds into assets/bg/. Requires OPENAI_API_KEY.`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY is not set. Export it and re-run:');
    console.error('  export OPENAI_API_KEY="sk-..."');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Variants:   ${args.variants.join(', ')}\n`);

  const results = [];
  for (const v of args.variants) {
    try {
      results.push(await generateOne(v, args.size, apiKey));
    } catch (err) {
      console.error(`  ✗ ${v} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. ${results.length}/${args.variants.length} image(s) written.`);
  if (results.length) {
    console.log('The Keeper runtime will now prefer these PNGs over the procedural art.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
