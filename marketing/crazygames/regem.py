"""Swap the stock blue 💎 emoji on the Relic Hunter covers for the game's own
Syamantaka sun-jewel.

Three passes per cover:
  1. DE-BLUE  — the emoji sits in a wide blue glow that tints a big patch of warm
                temple wall. Any pixel whose blue exceeds its red is pushed back
                to amber by moving the excess into R/G, so the glow becomes warm
                light instead of a cold hole in the art.
  2. ERASE    — the emoji body itself (including its near-white top facets and the
                thin sparkle cross, which the de-blue pass leaves alone because
                they are neutral, not blue) is painted over by radially sampling
                the background just outside the affected disc and blurring it in.
  3. COMPOSE  — gem_hero.webp is screen-blended on top. It is authored on pure
                black exactly for this, and screen drops the black cleanly. A soft
                radial warm glow goes underneath so the jewel sits in the scene
                instead of floating on it.
"""
from PIL import Image, ImageFilter, ImageDraw
import sys, math

GEM = Image.open('public/assets/temple/gem_hero.webp').convert('RGB')

# center + radii tuned per cover (see the blue-blob detection that found them)
COVERS = {
    'marketing/crazygames/landscape_1920x1080.png': dict(cx=1595, cy=472, erase=105, dbr=510, gx=1595, gy=500, gsize=300, gglow=260),
    # the jewel must clear the TEMPLE COLLAPSE sub-line, so it sits lower than the
    # emoji it replaces (and further right on portrait, to stay off the hunter).
    'marketing/crazygames/portrait_800x1200.png':   dict(cx=559,  cy=478, erase=95,  dbr=465, gx=628, gy=548, gsize=235, gglow=200),
    'marketing/crazygames/square_800x800.png':      dict(cx=600,  cy=332, erase=100, dbr=485, gx=600, gy=395, gsize=255, gglow=215),
    'marketing/crazygames/og-cover_1200x630.png':   dict(cx=994,  cy=291, erase=62,  dbr=295, gx=996, gy=330, gsize=165, gglow=140),
}


def deblue(im, cx, cy, radius):
    """Turn the cold glow warm. Untouched outside the disc, feathered at the rim.

    Re-tints by LUMINANCE toward the art's amber, rather than moving the blue
    excess into R and G. Shifting channels turns a cyan pixel (high G and B)
    green, because G gets lifted on top of an already-high G — which is exactly
    the olive halo the first attempt produced. Mapping luminance onto a fixed
    warm ramp can only ever yield r > g > b.
    """
    px = im.load()
    w, h = im.size
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = math.hypot(x - cx, y - cy)
            if d > radius:
                continue
            f = 1.0 if d < radius * 0.75 else (radius - d) / (radius * 0.25)
            r, g, b = px[x, y]
            if b <= r:
                continue
            cast = min(1.0, (b - r) / 55.0) * f          # how cold this pixel is
            L = 0.299 * r + 0.587 * g + 0.114 * b
            warm = (min(255, L * 1.16), L * 0.79, L * 0.46)
            px[x, y] = tuple(
                max(0, min(255, int(o * (1 - cast) + wv * cast)))
                for o, wv in zip((r, g, b), warm)
            )


def erase(im, cx, cy, radius):
    """Paint the emoji out using the ring of background just outside it."""
    w, h = im.size
    # a blurred copy supplies plausible wall texture; sampling the ring keeps the
    # local brightness right so the patch does not read as a smudge
    blur = im.filter(ImageFilter.GaussianBlur(radius * 0.55))
    src, dst = blur.load(), im.load()
    ring = []
    for a in range(0, 360, 6):
        rx = int(cx + math.cos(math.radians(a)) * radius * 1.30)
        ry = int(cy + math.sin(math.radians(a)) * radius * 1.30)
        if 0 <= rx < w and 0 <= ry < h:
            ring.append(im.getpixel((rx, ry)))
    avg = tuple(sum(c[i] for c in ring) // len(ring) for i in range(3)) if ring else (40, 26, 14)
    for y in range(max(0, cy - radius), min(h, cy + radius)):
        for x in range(max(0, cx - radius), min(w, cx + radius)):
            d = math.hypot(x - cx, y - cy)
            if d > radius:
                continue
            f = 1.0 if d < radius * 0.7 else (radius - d) / (radius * 0.3)
            b_, a_ = src[x, y], avg
            mix = tuple(int(b_[i] * 0.45 + a_[i] * 0.55) for i in range(3))
            o = dst[x, y]
            dst[x, y] = tuple(int(o[i] * (1 - f) + mix[i] * f) for i in range(3))


def compose(im, cx, cy, gem_px, glow_px):
    # warm radial glow underneath
    glow = Image.new('RGB', im.size, (0, 0, 0))
    d = ImageDraw.Draw(glow)
    steps = 26
    for i in range(steps, 0, -1):
        rr = int(glow_px * i / steps)
        a = int(70 * (1 - i / steps) ** 1.8)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(a, int(a * 0.66), int(a * 0.22)))
    glow = glow.filter(ImageFilter.GaussianBlur(glow_px * 0.22))
    im = Image.blend(im, Image.blend(im, glow, 0), 0)  # no-op keeps types tidy
    base = im.load(); gl = glow.load()
    for y in range(max(0, cy - glow_px), min(im.size[1], cy + glow_px)):
        for x in range(max(0, cx - glow_px), min(im.size[0], cx + glow_px)):
            b_, g_ = base[x, y], gl[x, y]
            base[x, y] = tuple(255 - (255 - b_[i]) * (255 - g_[i]) // 255 for i in range(3))  # screen

    # The jewel is authored on pure black. Screen-blending it drops the black for
    # free, but screen can only ADD light — over a lit wall it washes the deep
    # amber facets out to near-white, so the cover gem stopped matching the one
    # in the game. Instead derive an alpha from the gem's own luminance (black =
    # transparent) and composite normally, which preserves its real colour.
    g = GEM.resize((gem_px, gem_px), Image.LANCZOS)
    gx, gy = cx - gem_px // 2, cy - gem_px // 2
    gp = g.load()
    for y in range(gem_px):
        Y = gy + y
        if not (0 <= Y < im.size[1]):
            continue
        for x in range(gem_px):
            X = gx + x
            if not (0 <= X < im.size[0]):
                continue
            s = gp[x, y]
            L = (0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2]) / 255.0
            a = min(1.0, (L * 1.5) ** 0.75)      # lift the faint outer sparkle, keep black out
            dpx = base[X, Y]
            base[X, Y] = tuple(int(dpx[i] * (1 - a) + s[i] * a) for i in range(3))
    return im


for path, c in COVERS.items():
    im = Image.open(path).convert('RGB')
    deblue(im, c['cx'], c['cy'], c['dbr'])
    erase(im, c['cx'], c['cy'], c['erase'])
    im = compose(im, c['gx'], c['gy'], c['gsize'], c['gglow'])
    out = path.replace('.png', '_NEW.png')
    im.save(out)
    print('wrote', out)
