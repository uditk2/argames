# Keeper — Shooter sprite (footballer kicking toward the camera)

Replaces the procedural stick-figure `drawShooter()` at the far end of the pitch
with a **real frame-by-frame sprite** of a footballer striking the ball toward you.
Mirrors the Dino Survival runner pipeline. **Optional** — if these files are absent
the renderer falls back to the procedural silhouette, so the game always runs.

## 3-step flow

1. **Generate the image** — a single footballer in a neutral pre-kick stance,
   front-facing, full body to the feet, ball at his boot, on a **flat chroma-green
   (or magenta) background**. Use the IMAGE prompt in `GROK_SHOOTER_PROMPTS.md`.
2. **Grok image-to-video** — animate a **penalty run-up + strike** (2–3 step
   approach → plant → strike toward camera → follow-through → settle), **~5–6 s,
   locked camera, plain flat green bg**. Use the video prompt in
   `GROK_SHOOTER_PROMPTS.md`. **Drop the resulting mp4 in THIS folder**
   (`src/games/keeper/assets/shooter/`), e.g. `shooter_kick.mp4`. The ball will
   balloon toward the camera at the strike — that's fine, those frames get skipped.
3. **Run the extractor** (from this folder) — pure OpenCV **chroma-key**, no model
   download. Pass an EXPLICIT `--frames` list (1-based source indices) that hops
   over the giant-ball span, picked from a frame montage:
   ```sh
   pip install opencv-python numpy            # (no rembg / no ML model)
   python3 extract_shooter.py shooter_kick.mp4 . \
       --frames 88,91,94,97,100,103,106,108,110,131,134,137,140,143 \
       --fps 18 --contact 7 --drop-ball
   ```
   `--drop-ball` erases the football; `--contact` (0-based into the kept set) is the
   strike. Open `_contact.png` to confirm the cutout + the chosen contact frame.

## What lands here

```
src/games/keeper/assets/shooter/
  GROK_SHOOTER_PROMPTS.md   ← image + Grok video prompts
  extract_shooter.py        ← clip -> cutout frames + manifest
  README.md                 ← this file
  shooter_kick.mp4          ← (you drop this) the Grok clip
  kick_00.png … kick_NN.png ← (generated) transparent, foot-anchored kick frames
  shooter_kick.json         ← (generated) { frames, fps, w, h, contactFrame }
  shooter_kick.png          ← (generated, --sheet) horizontal sprite sheet (review)
  _contact.png              ← (generated) review contact sheet on magenta
```

## How the game uses it

`render/scene.js` auto-discovers `shooter_kick.json` + `kick_*.png` through the
Keeper module's Vite glob (`./assets/**`, same mechanism as `getAsset`/the stadium
PNGs), then in `drawShooter()`:

- **`st:'wind'`** (engine wind-up) — plays the early frames (approach → load),
  scrubbed by `windK`. The figure also **TRANSLATES**: it starts a couple of steps
  **behind** the ball (further up-pitch, ~0.78× size in perspective) and slides onto
  the ball-spawn point, reaching full size at the contact frame — so the run-up reads
  as a real approach onto the ball.
- **strike** — at the `wind→fly` transition the engine sets `kicked`, and `kickK`
  rises 0→1; the renderer scrubs the **contact → follow-through** frames over `kickK`
  so the boot meets the ball exactly as it leaves the foot.
- **settle** — holds the last/neutral frame through the follow-through, in place.

The figure is drawn small (far up-pitch, in perspective) and anchored so the
**contact frame's boot sits at the ball spawn point** (`sh.x, sh.y`), matching the
old silhouette; horizontal mirroring handles left/right-aimed shots. No
`shooter_kick.json` → the procedural silhouette is drawn instead.
