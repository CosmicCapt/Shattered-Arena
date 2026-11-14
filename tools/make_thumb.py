# Composes the Shattered Arena thumbnail from the top-down render. Usage: python make_thumb.py <top.png> <out.png>
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

top, out = sys.argv[1], sys.argv[2]
W, H = 1920, 1080
BOLD = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf'
MED = '/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf'
rng = np.random.default_rng(3)

# Storm sky: dark navy to purple, soft cloud noise, darker edges.
yy, xx = np.mgrid[0:H, 0:W]
def noise(scale, octaves=5):
    acc = np.zeros((H, W)); amp = 1.0; tot = 0
    for o in range(octaves):
        g = rng.random((int(H / scale * 2 ** o) + 3, int(W / scale * 2 ** o) + 3))
        acc += amp * ndimage.zoom(g, (H / (g.shape[0] - 3), W / (g.shape[1] - 3)), order=3)[:H, :W]
        tot += amp; amp *= 0.55
    return acc / tot
n = noise(420)
t = yy / H
sky = (np.array([18, 16, 34])[None, None] * (1 - t)[..., None] + np.array([46, 22, 70])[None, None] * t[..., None])
sky = sky * (0.7 + 0.6 * n)[..., None]
d = np.hypot((xx - W / 2) / W, (yy - H / 2) / H)
sky *= (1.15 - 0.9 * d)[..., None]
bg = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8)).convert('RGBA')

# The map, with a purple glow and a shadow behind it.
m = Image.open(top)
mh = 880; mw = round(m.width * mh / m.height)
m = m.resize((mw, mh), Image.LANCZOS)
mx, my = (W - mw) // 2, H - mh - 40
a = m.split()[3]
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
glow.paste(Image.new('RGBA', m.size, (170, 70, 255, 255)), (mx, my), a)
glow = glow.filter(ImageFilter.GaussianBlur(38))
bg.alpha_composite(glow)
bg.alpha_composite(glow)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sh.paste(Image.new('RGBA', m.size, (0, 0, 0, 200)), (mx + 14, my + 22), a)
bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
bg.alpha_composite(m, (mx, my))

def text_layer(txt, font, fill, xy, anchor, spacing=0, glow_col=None, glow_r=0):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dl = ImageDraw.Draw(layer)
    # letter-spaced text: draw letter by letter around the anchor
    widths = [dl.textlength(c, font=font) for c in txt]
    total = sum(widths) + spacing * (len(txt) - 1)
    x0 = xy[0] - (total / 2 if anchor[0] == 'm' else 0 if anchor[0] == 'l' else total)
    x = x0
    for c, w in zip(txt, widths):
        dl.text((x, xy[1]), c, font=font, fill=fill, anchor='l' + anchor[1])
        x += w + spacing
    if glow_col is not None:
        g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        g.paste(Image.new('RGBA', (W, H), glow_col), (0, 0), layer.split()[3])
        g = g.filter(ImageFilter.GaussianBlur(glow_r))
        bg.alpha_composite(g); bg.alpha_composite(g)
    return layer

# Title, with a dark band behind it so it reads over the map.
band = Image.new('RGBA', (W, H), (0, 0, 0, 0)); db = ImageDraw.Draw(band)
db.ellipse([W / 2 - 760, -40, W / 2 + 760, 230], fill=(8, 6, 18, 210))
bg.alpha_composite(band.filter(ImageFilter.GaussianBlur(40)))
title = text_layer('SHATTERED ARENA', ImageFont.truetype(BOLD, 132), (255, 255, 255, 255), (W / 2, 104), 'mm', spacing=10,
                   glow_col=(190, 70, 255, 255), glow_r=22)
# Purple-to-pink fill through the letters.
grad = np.zeros((H, W, 4), np.uint8)
tt = np.clip((yy - 40) / 130, 0, 1)
grad[..., 0] = (225 + 30 * tt).astype(np.uint8); grad[..., 1] = (160 - 90 * tt).astype(np.uint8)
grad[..., 2] = 255; grad[..., 3] = 255
fill = Image.fromarray(grad)
fill.putalpha(title.split()[3])
bg.alpha_composite(fill)

# A crack across the title.
crack = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dc = ImageDraw.Draw(crack)
pts, x, y = [], W / 2 - 600, 112
while x < W / 2 + 600:
    pts.append((x, y)); x += rng.uniform(35, 80); y = 104 + rng.uniform(-26, 26)
dc.line(pts, fill=(20, 8, 40, 255), width=5, joint='curve')
c_mask = Image.new('L', (W, H), 0); c_mask.paste(crack.split()[3], (0, 0))
c_mask = Image.fromarray(np.minimum(np.array(c_mask), np.array(title.split()[3])))
crack.putalpha(c_mask)
bg.alpha_composite(crack)

# Team names beside their bases: The Archmother (blue) on the left, The Hidden King (orange) on the right.
small, big = ImageFont.truetype(MED, 34), ImageFont.truetype(BOLD, 50)
cy = my + mh / 2
for txt1, txt2, col, glowc, cx in (('THE', 'ARCHMOTHER', (130, 170, 255, 255), (60, 100, 255, 255), mx / 2 - 4),
                                   ('THE', 'HIDDEN KING', (255, 165, 80, 255), (255, 110, 30, 255), W - mx / 2 + 4)):
    l1 = text_layer(txt1, small, col, (cx, cy - 46), 'mm', spacing=8)
    l2 = text_layer(txt2, big, col, (cx, cy + 14), 'mm', spacing=3, glow_col=glowc, glow_r=16)
    bg.alpha_composite(l1); bg.alpha_composite(l2)
vs = text_layer('VS', ImageFont.truetype(BOLD, 40), (235, 220, 255, 255), (W / 2, H - 22), 'mb', spacing=4)

bg.convert('RGB').save(out, quality=95)
print('saved', out)
