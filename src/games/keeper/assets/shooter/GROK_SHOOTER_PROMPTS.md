# Keeper — Shooter Source-Frame Prompts (Grok)

> Goal: replace the procedural stick-figure `drawShooter()` silhouette at the FAR
> end of the pitch with a **real frame-by-frame sprite of a footballer striking the
> ball TOWARD the camera** (the ball then flies down-pitch to the keeper/you).
>
> Pipeline (sibling of Dino Survival's runner, see
> `prototypes/dino-survival/GROK_SOURCE_PROMPTS.md`):
> **single-subject still → Grok image-to-video penalty run-up + strike →
> `extract_shooter.py` (CHROMA-KEY the flat green bg → drop the ball → trim →
> registered PLAYER-ONLY numbered PNGs + `shooter_kick.json`) → game plays the
> frames, translating the run-up onto the ball at the strike.**
>
> The figure is small and far away in-frame (perspective) and faces the camera. At
> the strike the **ball balloons toward the lens and fills the frame** — those frames
> are player-only-unusable, so the extractor **skips them**; the game draws its own
> ball leaving the boot. Keep the footballer **full body to the FEET on a plain flat
> chroma-green background** so the key is clean.

---

## Shared STYLE block (prepend to every prompt)

> STYLE: clean semi-realistic game-sprite render of a single footballer, **SlayFit
> gold-and-dark kit** — molten-gold jersey and shorts with dark trim, dark socks,
> gold-accented boots (or a neutral kit if you prefer), warm gold rim-light from
> upper-right, soft even fill so there are **no harsh cast shadows on the
> background**. Crisp readable silhouette, no motion blur, no depth-of-field blur
> on the body, no text, no logos, no UI, no crowd, no pitch markings. **Single
> subject only.**

## Shared FRAMING / BACKGROUND (for clean extraction)

> COMPOSITION: ONE footballer, **front-facing toward the camera** (he kicks toward
> the viewer), **full body head-to-FEET always inside the frame with clear ground
> contact**, centered, standing roughly upright. Plain **flat solid background —
> chroma green (#00B140) [or flat magenta #FF00FF if the kit is green]** filling
> the entire frame edge-to-edge, evenly lit, no gradient, no vignette, no floor
> texture, no shadow on the backdrop. The football sits **on the ground just in
> front of his kicking foot**. Locked, eye-level-to-slightly-low camera.

---

## STEP 1 — the IMAGE (neutral pre-kick stance)

Generate (or image-edit) a single still: the footballer in a **neutral, balanced
pre-kick stance**, weight centered, ball at his feet, ready to strike toward the
viewer. This is the source frame Grok will animate, and it doubles as the idle /
settle pose.

> [STYLE BLOCK] [FRAMING] A footballer in a **neutral athletic pre-kick stance**,
> standing tall and centered, **facing the camera**, weight balanced on both feet,
> arms relaxed slightly out for balance, looking down at the ball. The **football
> rests on the ground just ahead of his right boot**, ready to be struck toward the
> viewer. Full body from head to both feet, both feet flat on the ground. Plain flat
> chroma-green background filling the whole frame, even lighting, **no shadow cast on
> the background**, no motion blur, no text, no logos. One clean, sharp, centered
> figure.

> Tip: keep the pose **symmetric and upright** (not already mid-wind-up) so the clip
> has room to load back and swing through. A neutral stance also reads well as the
> game's idle/settle frame.

---

## STEP 2 — the Grok IMAGE-TO-VIDEO (penalty run-up + strike)

Animate the still into **one clean penalty run-up and strike toward the camera**: a
short 2–3 step approach, a plant, the strike, a follow-through, then settle —
single subject, locked camera, plain flat green background.

> Animate this footballer taking a **penalty kick struck straight TOWARD the
> camera**, in this order: (1) he starts a step or two **behind the ball** and takes
> a short **2–3 step run-up** in toward it; (2) he **plants** his standing foot
> beside the ball; (3) the kicking leg **swings through and strikes the ball toward
> the viewer** — the ball leaves the boot toward the camera; (4) a natural
> **follow-through** with the kicking leg raised and arms counter-balancing; (5) the
> body **settles back to a balanced standing stance**. He stays **facing the camera,
> full body to the feet** throughout, finishing roughly centered. **Locked, static
> camera. Plain flat chroma-green background, no shadow on the backdrop, no camera
> shake, no zoom, no extra people, no text, no UI.** Keep the player's identity, kit
> and proportions **perfectly consistent — no morphing, no extra limbs, no style
> drift.** Smooth and clean.

**Settings:** length **~5–6 s** (room for the run-up → plant → strike →
follow-through → settle); **highest resolution**; **lowest motion-randomness /
highest consistency** the tool offers; **static/locked camera**. Generate 2–3 takes
and keep the steadiest with the cleanest single run-up-and-strike (no double kick).

> ⚠️ **The ball balloons toward the camera at the strike** and fills most of the
> frame for ~0.5–0.7 s afterward — that is EXPECTED and FINE. Those giant-ball frames
> are **player-only-UNUSABLE**, and the extractor **skips them** (you pass an explicit
> `--frames` list that hops over that range). The game draws its OWN ball leaving the
> boot, so the sprite must be the **kicker only**. Just make sure the player is clean
> and on flat green in the run-up, plant, the strike pose, and the settle — the
> giant-ball span in between is discarded. Grok's corner watermark is fine — it sits
> in a corner the cutout crops, not over the player.

---

## STEP 3 — run the extractor (CHROMA-KEY, player-only)

`extract_shooter.py` cuts the player out with an **HSV chroma-key** of the flat
green backdrop (no rembg / no ML model download), removes the football blob, keeps
the tall player component, trims, height-normalises and foot-anchors each frame.
You pass an **explicit `--frames` list** (1-based source-frame indices, as seen in a
review montage) so you hop OVER the giant-ball span:

```
# from src/games/keeper/assets/shooter/  — indices below are for THIS source clip
python3 extract_shooter.py SHOOTER_KICK.mp4 . \
    --frames 88,91,94,97,100,103,106,108,110,131,134,137,140,143 \
    --fps 18 --contact 7 --drop-ball
```

- Eyeball a frame montage first, then pick: run-up start → plant → the strike pose
  (`--contact`, 0-based into the kept set) → **skip the giant-ball range** → settle.
- `--drop-ball` erases the round white/black football so it never enters the sprite.
- `--green-hue 40,95` is the background hue band; widen/narrow if the key leaks.
- Falls back to `--n` evenly-spaced sampling if you omit `--frames`.

### Output (consumed by the game)

| File | What |
|---|---|
| `kick_00.png … kick_NN.png` | transparent, chroma-keyed, **player-only**, **foot-anchored** frames (registered bottom-centre so the boot stays put; the giant ball is excluded) |
| `shooter_kick.json` | `{ "frames": N, "fps": F, "w": W, "h": H, "contactFrame": C }` — frame count, playback fps, frame size, and the index where the boot meets the ball |
| `shooter_kick.png` | (optional, `--sheet`) a horizontal sprite sheet for review/atlas use |
| `_contact.png` | review contact-sheet on magenta (eyeball the cutout + the cycle). Underscore-prefixed review files are excluded from the build glob, so it's safe to leave beside the frames |

The Keeper renderer (`render/scene.js`) auto-discovers these via the module's Vite
glob (`./assets/**`), plays the cutout frames across the engine's shooter states, and
**TRANSLATES the run-up**: at the start of the wind-up the figure stands a couple of
steps **behind** the ball (further up-pitch, a touch smaller in perspective) and
**slides onto the ball-spawn point**, growing to full size by the **contact frame**,
so the kicking boot meets the ball exactly at the strike (synced to `shooterState()`
`windK` → `kicked`/`kickK`). The follow-through and settle play in place; horizontal
mirroring handles left/right-aimed shots. **If the frames are absent it falls back to
the procedural silhouette**, so the game always runs.
