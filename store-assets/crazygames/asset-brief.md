# Temple Collapse — CrazyGames Cover & Preview Asset Brief

Everything needed to produce the 3 cover images + preview video required to submit **Temple Collapse** to CrazyGames. Specs pulled from https://docs.crazygames.com/requirements/game-covers/ (fetched 2026-07-01). Art direction reuses the game's established Master Style String from `temple-dash-full-design.md`.

> Do NOT reuse a raw screenshot for covers — CrazyGames explicitly discourages it. Covers are marketing art. Screenshots are for the separate gallery.

---

## 1. Required assets — exact spec table

| Asset | Aspect ratio | Dimensions (px) | File format | Max file size | Notes |
|---|---|---|---|---|---|
| **Landscape cover** | 16:9 | **1920 × 1080** | PNG or JPG* | Not stated in docs → keep **under ~2 MB** (safe) | Mandatory |
| **Portrait cover** | 2:3 | **800 × 1200** | PNG or JPG* | Not stated → **under ~2 MB** (safe) | Mandatory |
| **Square cover** | 1:1 | **800 × 800** | PNG or JPG* | Not stated → **under ~1.5 MB** (safe) | Mandatory |
| **Preview video — landscape** | 16:9 | **1920 × 1080 (1080p)** | MP4 (H.264) recommended | **50 MB max** | Mandatory. 15–20 s max (longer is cut to 20 s) |
| **Preview video — portrait** | 2:3 | **1080p @ 2:3** (e.g. 1080 × 1620) | MP4 (H.264) recommended | **50 MB max** | Mandatory. Same length rules |

\* The docs don't name an explicit cover file format or a per-image byte cap — they only specify pixel dimensions. **PNG** is the safe choice for these painterly covers (or high-quality JPG if you need to stay small). Keep files crisp, never blurry/pixelated.

**Video hard rules (from docs):**
- Length: **15–20 s max** (anything longer is auto-cut to 20 s).
- Size: **50 MB max**.
- **No sound.**
- **No fast-forwarding** — CrazyGames slightly speeds it up automatically during processing, so record at natural pace.
- Avoid: opening transitions, black-screen/logo transitions, black bars top & bottom, the default mouse cursor, "Play Now"/promo text, app or social icons.
- Both landscape **and** portrait video versions are mandatory.
- Recommended tools: iMovie (Mac) / ClipChamp (Windows) for editing; HandBrake for conversion/compression.

---

## 2. Art direction (consistent across all 3 covers)

All three covers show the **same treasure-hunter hero** (khaki explorer outfit, backpack, mid-sprint) fleeing down a **torch-lit sandstone corridor** with the **giant rolling stone boulder** looming behind — recomposed for each aspect ratio, never a different scene. Hold the game's palette on every asset: **warm amber-gold + turquoise accents, torch-lit cinematic light with deep teal shadows, golden dust haze, and volumetric god-rays**, so the square, portrait, and landscape read instantly as the same game (CrazyGames explicitly wants consistent visuals/aesthetics across the three).

**CrazyGames text/logo rule (important — note the nuance):**
- **Covers:** CrazyGames *recommends putting the game's title on the cover* in a nice stylized font, but **forbids all other text and any logos/icons.** So: the words **"Temple Collapse"** in a stylized adventure-serif title are allowed and encouraged — but **no** "New / Updated / Play / Play Now," **no** store or app logos, **no** UI/HUD elements, **no** borders. **Generate the artwork clean with empty space for the title, then add the title text yourself in an editor** (image generators render text unreliably). Every generation prompt below therefore says *no text* — you composite the title on afterward.
- **Preview video:** **no text at all** (not even the title), no cursor, no UI overlays.

---

## 3. Ready-to-use generation prompts

Generate the artwork **text-free** (add the "Temple Collapse" title in an editor afterward). Each image prompt ends with the game's **Master Style String** so the look matches the shipped game.

**MASTER STYLE STRING (append verbatim to each image prompt):**
> *stylized painterly AAA mobile-game splash art, ancient sandstone temple, warm torchlit cinematic lighting with deep teal shadows, rich amber-gold and turquoise palette, golden dust haze, volumetric god-rays, high contrast, clean readable silhouettes, hand-painted texture, dramatic depth. No text, no logos, no watermark, no UI, no people unless requested.*

### 3a. Landscape cover — 1920 × 1080 (16:9)
> Epic horizontal splash: a treasure-hunter hero in a khaki explorer outfit with a backpack sprinting toward the viewer's right down a torch-lit sandstone temple corridor, glancing back in fear. Behind and to the left, an enormous ancient carved stone boulder with faint glowing runes rolls after him, kicking up a wall of golden dust. Rows of massive weathered columns and flaming braziers recede into warm gloom, volumetric god-rays cutting through the dust haze, fire-jet and swinging-blade hazards hinted in the mid-ground. Wide cinematic poster composition, hero framed left-of-center, generous clean space in the upper area for a title. No text. — *[append Master Style String]*

### 3b. Portrait cover — 800 × 1200 (2:3)
> Tall vertical splash: the same khaki treasure-hunter hero in mid-sprint, filling the lower two-thirds of the frame, looking back over his shoulder in panic, the corridor and its columns compressed to lead the eye upward. Directly above/behind him the giant rune-carved stone boulder bears down, dust and rubble billowing, torch-lit sandstone walls with braziers on either side, god-rays streaming down from the top. Strong vertical depth, hero low and central, clean uncluttered space at the top for a title. No text. — *[append Master Style String]*

### 3c. Square cover — 800 × 800 (1:1)
> Balanced square splash: tight heroic close-up of the same khaki treasure-hunter hero sprinting toward the viewer, torso-up dynamic pose, terrified backward glance, the massive rune-carved stone boulder looming large and close directly behind him and nearly filling the upper background, swirling golden dust and glowing embers around them. Torch-lit sandstone corridor framing left and right, one god-ray shaft. Punchy, high-contrast, well-centered composition that reads at thumbnail size; small clean area near the top for a title. No text. — *[append Master Style String]*

### 3d. Preview video — motion prompt (15–20 s loop, 1920×1080 and 2:3, no sound, no text/cursor/UI)
> Cinematic side-tracking shot of a khaki treasure-hunter hero sprinting through a collapsing torch-lit sandstone temple corridor. He leaps a glowing lava chasm, ducks under a swinging pendulum blade, and dodges a burst of fire from a lion-mouth wall vent. Behind him a colossal rune-carved stone boulder rolls closer and closer, kicking up a churning wall of golden dust; columns topple, ceiling debris rains down, embers and god-rays fill the air. Camera stays with the hero at natural running speed; end on the boulder nearly filling the frame as daylight from the exit appears ahead. Painterly AAA cinematic look, amber-gold + turquoise palette, torch-lit with deep teal shadows, golden dust haze, volumetric god-rays, high contrast, dramatic depth. Smooth continuous motion, no on-screen text, no UI, no cursor, no black bars. — *(generate/export both a 16:9 and a 2:3 framing; keep each under 20 s and under 50 MB)*

> **Fastest path for the video:** capture 20–30 s of actual gameplay at 1080p, trim to the best 15–18 s, export MP4/H.264, run through HandBrake to land under 50 MB, and produce both a 16:9 and a 2:3 crop. The Grok-style motion prompt above is the fallback/animated alternative (allowed by CrazyGames as long as it represents real gameplay and isn't misleading).

---

## 4. Screenshots for the gallery (separate from covers)

Capture in-game at **16:9 desktop resolution (1920 × 1080)**, full-screen, **HUD visible is fine here** (unlike covers). Grab 4–6 distinct, high-energy moments:

1. **Mid-jump over a flaming lava fissure** — hero airborne, molten glow lighting him from below.
2. **Ducking under a swinging pendulum blade** — hero low, blade arc + motion blur overhead.
3. **A junction / checkpoint gate with the minimap visible** — shows the turquoise gate arch and the HUD minimap in one frame.
4. **Boulder looming close** — the Gap gauge low, boulder filling the left/back of frame, dust and screen-shake debris.
5. **Fire-jet hazard moment** — flame bursting from a lion-mouth vent as the hero threads past.
6. **The exit / daylight escape** — hero bursting toward the bright doorway, dust settling behind (great "win" shot).

Tip: turn off any debug overlays, hide the cursor, and shoot each at a peak action frame (not a lull).

---

## 5. Naming + pre-upload checklist

**Suggested filenames:**
```
temple-collapse_cover_landscape_1920x1080.png
temple-collapse_cover_portrait_800x1200.png
temple-collapse_cover_square_800x800.png
temple-collapse_preview_landscape_1080p.mp4
temple-collapse_preview_portrait_2x3_1080p.mp4
temple-collapse_screenshot_01_lava-jump.png
temple-collapse_screenshot_02_blade-duck.png
temple-collapse_screenshot_03_checkpoint-minimap.png
temple-collapse_screenshot_04_boulder-close.png
temple-collapse_screenshot_05_firejet.png
temple-collapse_screenshot_06_exit-escape.png
```

**Pre-upload checklist:**
- [ ] All 3 covers at exact dimensions: 1920×1080, 800×1200, 800×800.
- [ ] Same hero, same boulder, same palette/lighting across all 3 covers (recognizable as one game).
- [ ] Title "Temple Collapse" added in a stylized adventure font; **no** other text, **no** logos/icons, **no** borders, **no** UI on covers.
- [ ] Covers are crisp — no blur, no pixelation, no upscaling artifacts.
- [ ] Preview video exists in **both** 16:9 and 2:3, each ≤ 20 s, ≤ 50 MB, **muted**.
- [ ] Video has no opening/logo transition, no black bars, no cursor, no "Play Now"/promo text, no app/social icons.
- [ ] Video recorded at natural speed (CrazyGames auto-speeds it).
- [ ] Screenshots captured at 1920×1080, peak-action frames, 4–6 of them.
- [ ] Files named per the convention above.
```
