#!/usr/bin/env python3
"""
Extract a PLAYER-ONLY penalty-kick sprite from a single-subject Grok clip.

The source clip is a footballer on a FLAT CHROMA-GREEN background doing a short
run-up and striking a penalty TOWARD the camera. In the strike frames the BALL
balloons toward the lens and fills most of the frame — those frames are useless as
a player sprite, so this script lets you pick an EXPLICIT set of source-frame
indices (run-up -> plant -> strike pose -> follow-through -> settle) and SKIP the
giant-ball range entirely. The game renders its own ball, so the sprite must be
the kicker only.

Pipeline (no ML model download — pure OpenCV):
  ffmpeg-decoded frames -> HSV CHROMA-KEY of the green bg -> transparent, with
  green-spill cleanup -> drop the round ball blob near the boot -> keep the tall
  player component -> bbox trim -> normalise to a fixed height, foot-anchored
  bottom-centre (registration) -> numbered PNGs (kick_00..kick_NN) + a
  `shooter_kick.json` manifest {frames, fps, w, h, contactFrame} (+ optional sprite
  sheet) + a magenta review contact sheet.

The Keeper renderer (src/games/keeper/render/scene.js) auto-discovers the output
via the module's Vite glob and plays the frames across the engine shooter states
(run-up TRANSLATES the figure onto the ball-spawn point during 'wind', strike timed
to kickK, then follow-through/settle in place), placing the contact frame's boot at
the ball spawn point. If the frames are absent the renderer falls back to the
procedural silhouette.

--------------------------------------------------------------------------------
RUN COMMAND (from this folder, src/games/keeper/assets/shooter/):

  python3 extract_shooter.py SHOOTER_KICK.mp4 . \
      --frames 88,91,94,97,100,103,106,108,110,131,134,137,140,143 \
      --fps 18 --contact 8 --drop-ball

  # Common flags:
  #   --frames a,b,c  EXPLICIT source frame indices (1-based, as seen in the review
  #                   montage) to keep, IN ORDER. This is how you skip the giant-ball
  #                   range. If omitted, falls back to --n evenly-spaced samples.
  #   --n 14          (fallback) how many evenly-spaced frames to pull across --start/--end
  #   --fps 18        playback fps written into shooter_kick.json
  #   --contact 8     OUTPUT frame index (0-based, into the kept set) where the boot
  #                   meets the ball (the strike). The renderer pins this boot to the
  #                   ball spawn and ends the run-up translation here.
  #   --drop-ball     remove the round white/black football blob from each frame so it
  #                   never appears in the sprite (the engine draws its own ball)
  #   --start/--end   (fallback path only) trim window in seconds
  #   --height 512    output frame height (px); width is derived from the figure
  #   --sheet         also emit a horizontal sprite sheet shooter_kick.png
  #   --green-hue 40,95   inclusive HSV hue band treated as background green
--------------------------------------------------------------------------------
"""
import argparse, json, os
import numpy as np, cv2


def green_mask(bgr, hlo, hhi, slo=55, vlo=45):
    """Foreground (non-green) mask via HSV chroma-key of a flat green backdrop."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.int32)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    is_green = (h > hlo) & (h < hhi) & (s > slo) & (v > vlo)
    fg = (~is_green).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return fg


def keep_player(fg):
    """Keep the tall player component; drop stray blobs (incl. a detached ball)."""
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n <= 1:
        return fg
    best, best_score = -1, -1e9
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 0.005 * fg.size:
            continue
        top = stats[i, cv2.CC_STAT_TOP]
        ht = stats[i, cv2.CC_STAT_HEIGHT]
        # the player is the tall component that reaches near the top of the frame
        score = ht - (top if top < 60 else top * 2)
        if score > best_score:
            best_score, best = score, i
    return (lbl == best).astype(np.uint8) * 255 if best > 0 else fg


def remove_ball(bgr, mask):
    """Erase the round white/black football blob so it never enters the sprite.

    The ball is the low-saturation white+black sphere that sits at the boot during
    the juggle/strike. We find low-sat (white) blobs in the lower 2/3 of the figure,
    take the most circular sizeable one, dilate to grab its black panels, and knock
    it out of the alpha mask.
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    s, v = hsv[..., 1], hsv[..., 2]
    H = bgr.shape[0]
    white = ((s < 60) & (v > 170)).astype(np.uint8) * 255
    white[: H // 3, :] = 0                      # ignore upper third (face/highlights)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lbl, stats, cent = cv2.connectedComponentsWithStats(white, 8)
    ball = None
    best = 0
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        if area < 220 or w == 0 or h == 0:
            continue
        fill = area / float(w * h)              # circle ~0.78 of its bbox
        aspect = min(w, h) / float(max(w, h))   # round -> near 1
        if fill > 0.45 and aspect > 0.55 and area > best:
            best, ball = area, (i, stats[i], cent[i])
    if ball is None:
        return mask
    i, st, (cx, cy) = ball
    r = max(st[cv2.CC_STAT_WIDTH], st[cv2.CC_STAT_HEIGHT]) / 2.0
    kill = np.zeros(mask.shape, np.uint8)
    cv2.circle(kill, (int(cx), int(cy)), int(r * 1.18), 255, -1)  # cover black panels too
    out = mask.copy()
    out[kill > 0] = 0
    return out


def despill(rgba):
    """Reduce green fringing: where green channel overshoots, clamp it to max(r,b)."""
    rgb = rgba[..., :3].astype(np.int32)        # R,G,B order (we build RGBA)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    over = g > ((r + b) // 2 + 12)
    g2 = np.where(over, ((r + b) // 2 + 12), g)
    rgb[..., 1] = g2
    rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return rgba


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("outdir")
    ap.add_argument("--frames", type=str, default="",
                    help="explicit 1-based source frame indices to keep, in order (comma sep)")
    ap.add_argument("--n", type=int, default=14, help="fallback: evenly-spaced sample count")
    ap.add_argument("--fps", type=int, default=18, help="playback fps in the manifest")
    ap.add_argument("--contact", type=int, default=-1,
                    help="OUTPUT (0-based) index of the strike; default = middle")
    ap.add_argument("--height", type=int, default=512)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--pad", type=int, default=8)
    ap.add_argument("--green-hue", dest="green_hue", type=str, default="40,95")
    ap.add_argument("--drop-ball", dest="drop_ball", action="store_true",
                    help="erase the football blob so it never appears in the sprite")
    ap.add_argument("--sheet", action="store_true", help="also emit shooter_kick.png sprite sheet")
    a = ap.parse_args()

    hlo, hhi = (int(x) for x in a.green_hue.split(","))
    os.makedirs(a.outdir, exist_ok=True)
    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    if a.frames.strip():
        idxs = [int(x) - 1 for x in a.frames.split(",") if x.strip() != ""]  # ->0-based
    else:
        dur = total / fps
        end = a.end if a.end else dur
        times = np.linspace(a.start, min(end, dur - 1e-3), a.n)
        idxs = [int(round(t * fps)) for t in times]

    cw = int(a.height * 1.05); ch = a.height       # kicking figure throws a leg out
    frames = []; sheet_cells = []; kept = 0
    for fi in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ok, bgr = cap.read()
        if not ok:
            print(f"  ! could not read source frame {fi+1}"); continue
        mask = green_mask(bgr, hlo, hhi)
        if a.drop_ball:
            mask = remove_ball(bgr, mask)
        # keep the tall player AFTER ball removal so any fragment the ball-cut
        # detaches (a stray sock/boot blob) is dropped too.
        mask = keep_player(mask)
        # soften the mask edge a touch to kill the hard chroma fringe
        mask = cv2.erode(mask, np.ones((3, 3), np.uint8), 1)
        soft = cv2.GaussianBlur(mask, (3, 3), 0)
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            print(f"  ! empty mask at source frame {fi+1}"); continue
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgba = np.dstack([rgb, soft]).astype(np.uint8)
        rgba = despill(rgba)
        y0c, y1c = max(0, y0 - a.pad), min(bgr.shape[0], y1 + a.pad)
        x0c, x1c = max(0, x0 - a.pad), min(bgr.shape[1], x1 + a.pad)
        crop = rgba[y0c:y1c, x0c:x1c]
        sc = a.height / crop.shape[0]; w = max(1, int(crop.shape[1] * sc))
        crop = cv2.resize(crop, (w, a.height), interpolation=cv2.INTER_AREA)
        canvas = np.zeros((ch, cw, 4), np.uint8)
        x = (cw - w) // 2
        if x < 0:
            crop = crop[:, -x:-x + cw]; w = cw; x = 0
        canvas[:, x:x + min(w, cw - x)] = crop[:, :min(w, cw - x)]
        cv2.imwrite(os.path.join(a.outdir, f"kick_{kept:02d}.png"),
                    cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA))
        frames.append(canvas)
        cell = canvas.astype(np.float32); al = cell[..., 3:4] / 255.0
        comp = cell[..., :3] * al + np.array([255, 0, 255]) * (1 - al)
        sheet_cells.append(cv2.cvtColor(comp.astype(np.uint8), cv2.COLOR_RGB2BGR))
        kept += 1

    cap.release()
    if kept == 0:
        print("no frames extracted — check the input clip / --frames / --green-hue")
        return

    contact = a.contact if a.contact >= 0 else kept // 2
    contact = max(0, min(kept - 1, contact))

    manifest = {"frames": kept, "fps": a.fps, "w": cw, "h": ch, "contactFrame": contact}
    with open(os.path.join(a.outdir, "shooter_kick.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    if a.sheet:
        sheet = np.zeros((ch, cw * kept, 4), np.uint8)
        for k, fr in enumerate(frames):
            sheet[:, k * cw:(k + 1) * cw] = fr
        cv2.imwrite(os.path.join(a.outdir, "shooter_kick.png"),
                    cv2.cvtColor(sheet, cv2.COLOR_RGBA2BGRA))

    cols = min(7, len(sheet_cells)); rows = (len(sheet_cells) + cols - 1) // cols
    h, w = sheet_cells[0].shape[:2]
    review = np.full((rows * h, cols * w, 3), 30, np.uint8)
    for k, c in enumerate(sheet_cells):
        r, cc = divmod(k, cols); review[r*h:r*h+h, cc*w:cc*w+w] = c
    cv2.imwrite(os.path.join(a.outdir, "_contact.png"), review)

    print(f"wrote {kept} player-only kick frames + shooter_kick.json to {a.outdir}  "
          f"(canvas {cw}x{ch}, feet bottom-centre, contactFrame={contact}, fps={a.fps})")


if __name__ == "__main__":
    main()
