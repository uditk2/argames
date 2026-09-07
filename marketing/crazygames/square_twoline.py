"""Rebuild the SQUARE cover: two-line title, clear of the CrazyGames badge.

Two flaws in one pass.

  (a) The square's wordmark was a single line running 0..799 — both R's sliced
      by the frame.
  (b) It sat inside the label-badge corner, so the portal's own crop dialog
      drew its warning box straight over "RELI".

The PORTRAIT cover is the same art family (same hunter, same corridor, same
Cinzel gold) and already carries an intact two-line RELIC / HUNTER block with
real margins, so we lift that block rather than trying to cut the square's
clipped line in half.

Built from the PRE-GEM square original so the jewel can be re-placed: the
two-line block is ~130px taller than the line it replaces, which squeezes the
gem, and compositing over the already-gemmed file would leave no room to move
it. Pipeline:

  1. SHIFT   down so the title band clears the badge corner. The new top band is
             stretched from the image's own topmost rows (dark ceiling, no
             detail to lose); the same strip comes off the bottom.
  2. DE-BLUE the stock emoji's cold glow, and ERASE the emoji itself — same two
             passes as regem.py, at the post-shift coordinates.
  3. CLEAR   the old one-line title and its TEMPLE COLLAPSE. A matted block
             composited on top is transparent between its glyphs, so the old
             line reads straight through it — it genuinely has to go. The
             corridor there is a vertical gradient (columns, wall, doorway
             glow), so we interpolate DOWN each column between the rows just
             outside the band; an isotropic blur smears the doorway sideways
             into the walls.
  4. GEM     composite the Syamantaka lower and slightly right of where the
             emoji sat, so it clears the sub-line instead of sitting under it.
  5. TITLE   matte the portrait block by luminance and place it on a soft
             warm-dark scrim, which seats the type the way the portrait does
             and hides the interpolation.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter
import math

SHIFT = 181                 # pre-shift title top is y=79; 79+181 = 260 (32.5%)
EMOJI = (600, 332 + SHIFT)  # regem.py's square centre, carried down
ERASE_R = 100
DEBLUE_R = 485
GEM = (618, 632, 232, 200)  # x, y, size, glow — below the sub-line now
OLD_BAND = (243, 392)       # old main line 260..327 + sub-line 362..379
BLOCK = (40, 248, 760, 562) # portrait crop: RELIC .. TEMPLE COLLAPSE, with air
SCALE = 0.76
INK_TOP = 262               # portrait y of the RELIC cap-line
TARGET_TOP = 258            # where that cap-line lands on the square

SRC = Image.open('SQSRC').convert('RGB')
PT = Image.open('marketing/crazygames/portrait_800x1200.png').convert('RGB')
JEWEL = Image.open('public/assets/temple/gem_hero.webp').convert('RGB')
w, h = SRC.size

# --- 1. shift -------------------------------------------------------------
strip = SRC.crop((0, 0, w, 20)).resize((w, SHIFT), Image.BICUBIC)
im = Image.new('RGB', (w, h))
im.paste(strip, (0, 0))
im.paste(SRC.crop((0, 0, w, h - SHIFT)), (0, SHIFT))


def deblue(im, cx, cy, radius):
    """Warm the emoji's cold glow. Re-tints by LUMINANCE onto a fixed amber
    ramp rather than moving the blue excess into R/G — shifting channels lifts
    G on an already-green-ish cyan pixel and yields an olive halo."""
    px = im.load()
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = math.hypot(x - cx, y - cy)
            if d > radius:
                continue
            f = 1.0 if d < radius * 0.75 else (radius - d) / (radius * 0.25)
            r, g, b = px[x, y]
            if b <= r:
                continue
            cast = min(1.0, (b - r) / 55.0) * f
            L = 0.299 * r + 0.587 * g + 0.114 * b
            warm = (min(255, L * 1.16), L * 0.79, L * 0.46)
            px[x, y] = tuple(max(0, min(255, int(o * (1 - cast) + wv * cast)))
                             for o, wv in zip((r, g, b), warm))


def erase(im, cx, cy, radius):
    """Paint the emoji out using the ring of background just outside it."""
    blur = im.filter(ImageFilter.GaussianBlur(radius * 0.55))
    src, dst = blur.load(), im.load()
    ring = []
    for a in range(0, 360, 6):
        rx = int(cx + math.cos(math.radians(a)) * radius * 1.30)
        ry = int(cy + math.sin(math.radians(a)) * radius * 1.30)
        if 0 <= rx < w and 0 <= ry < h:
            ring.append(im.getpixel((rx, ry)))
    avg = tuple(sum(c[i] for c in ring) // len(ring) for i in range(3))
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = math.hypot(x - cx, y - cy)
            if d > radius:
                continue
            f = 1.0 if d < radius * 0.7 else (radius - d) / (radius * 0.3)
            b_, o = src[x, y], dst[x, y]
            mix = tuple(int(b_[i] * 0.45 + avg[i] * 0.55) for i in range(3))
            dst[x, y] = tuple(int(o[i] * (1 - f) + mix[i] * f) for i in range(3))


# --- 2. remove the emoji --------------------------------------------------
deblue(im, EMOJI[0], EMOJI[1], DEBLUE_R)
erase(im, EMOJI[0], EMOJI[1], ERASE_R)

# --- 3. clear the old title band ------------------------------------------
y0, y1 = OLD_BAND
PAD = 10
soft = im.filter(ImageFilter.GaussianBlur(3))     # keeps a little wall grain
bp, sp = im.load(), soft.load()
top = [sp[x, y0 - PAD] for x in range(w)]
bot = [sp[x, y1 + PAD] for x in range(w)]
span = (y1 + PAD) - (y0 - PAD)
for y in range(y0 - PAD, y1 + PAD):
    t = (y - (y0 - PAD)) / span
    d = min(y - (y0 - PAD), (y1 + PAD) - y)
    f = min(1.0, d / float(PAD))                 # feather both seams
    for x in range(w):
        a, b = top[x], bot[x]
        lerp = tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))
        o = bp[x, y]
        bp[x, y] = tuple(int(o[i] * (1 - f) + lerp[i] * f) for i in range(3))

# --- 4. the Syamantaka ----------------------------------------------------
gx, gy, gsize, gglow = GEM
glow = Image.new('RGB', (w, h), (0, 0, 0))
gd = ImageDraw.Draw(glow)
for i in range(26, 0, -1):
    rr = int(gglow * i / 26)
    a = int(70 * (1 - i / 26) ** 1.8)
    gd.ellipse([gx - rr, gy - rr, gx + rr, gy + rr], fill=(a, int(a * .66), int(a * .22)))
glow = glow.filter(ImageFilter.GaussianBlur(gglow * 0.22))
gl = glow.load()
for y in range(max(0, gy - gglow), min(h, gy + gglow)):
    for x in range(max(0, gx - gglow), min(w, gx + gglow)):
        b_, g_ = bp[x, y], gl[x, y]
        bp[x, y] = tuple(255 - (255 - b_[i]) * (255 - g_[i]) // 255 for i in range(3))

# The jewel is authored on pure black. Screen-blending drops the black for free
# but can only ADD light, washing the deep amber facets out over a lit wall —
# so derive an alpha from its own luminance and composite normally instead.
g = JEWEL.resize((gsize, gsize), Image.LANCZOS)
gp = g.load()
ox, oy = gx - gsize // 2, gy - gsize // 2
for y in range(gsize):
    Y = oy + y
    if not (0 <= Y < h):
        continue
    for x in range(gsize):
        X = ox + x
        if not (0 <= X < w):
            continue
        s = gp[x, y]
        L = (0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2]) / 255.0
        a = min(1.0, (L * 1.5) ** 0.75)
        o = bp[X, Y]
        bp[X, Y] = tuple(int(o[i] * (1 - a) + s[i] * a) for i in range(3))

# --- 5. the two-line title ------------------------------------------------
# Matte the block by BACKGROUND SUBTRACTION, not by a luminance threshold. The
# portrait's doorway glow behind the type reaches L=165 while the gold ink is
# only ~199-217, so any flat threshold that keeps the ink also keeps a wash of
# corridor — which composites as a faint translucent rectangle whose edge is
# plainly visible under TEMPLE COLLAPSE. Subtracting a wide blur of the block
# from itself removes that gradient: the glyphs are far narrower than the blur
# radius, so they survive while everything smooth cancels. Measured on this
# crop: background maxes at 20, ink reaches 148.
blk = PT.crop(BLOCK)
bw, bh = blk.size
lum = blk.convert('L')
diff = ImageChops.subtract(lum, lum.filter(ImageFilter.GaussianBlur(55)))
dp = diff.load()
mat = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
kp, mp = blk.load(), mat.load()
LO, HI = 14, 90
for y in range(bh):
    for x in range(bw):
        a = (dp[x, y] - LO) / float(HI - LO)
        a = max(0.0, min(1.0, a))
        if a:
            mp[x, y] = kp[x, y] + (int(a * 255),)

nw, nh = int(bw * SCALE), int(bh * SCALE)
title = mat.resize((nw, nh), Image.LANCZOS)
nx = (w - nw) // 2
ny = TARGET_TOP - int((INK_TOP - BLOCK[1]) * SCALE)

scrim = Image.new('RGBA', (w, h), (0, 0, 0, 0))
sd = ImageDraw.Draw(scrim)
cy = ny + nh // 2
for i in range(28, 0, -1):
    ry, rx = int(nh * 0.80 * i / 28), int(nw * 0.80 * i / 28)
    sd.ellipse([w // 2 - rx, cy - ry, w // 2 + rx, cy + ry],
               fill=(14, 8, 3, int(96 * (1 - i / 28) ** 1.5)))
scrim = scrim.filter(ImageFilter.GaussianBlur(34))

out = im.convert('RGBA')
out.alpha_composite(scrim)
out.alpha_composite(title, (nx, ny))
out.convert('RGB').save('SQOUT')
print(f'title block {nw}x{nh} at x {nx}..{nx + nw}, y {ny}..{ny + nh}')
print(f'gem {gsize}px at ({gx},{gy}) -> y {gy - gsize // 2}..{gy + gsize // 2}')
