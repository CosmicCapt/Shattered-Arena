# A labelled layout picture of Shattered Arena, from the top-down render (render_top.py) and arena_shapes.
# Usage: python make_layout.py <top.png> <out.png>
import math, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import arena_shapes as A

top, out = sys.argv[1], sys.argv[2]
E = A.everything()
m = Image.open(top).convert('RGBA')
PAD = 120
S = m.width / (2 * (A.RY + PAD))
ML, MR, MT, MB = 430, 430, 150, 190
W, H = m.width + ML + MR, m.height + MT + MB
def P(x, y):                                     # world -> canvas
    return (ML + (y + A.RY + PAD) * S, MT + (A.RX + PAD - x) * S)

BOLD = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf'
MED = '/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf'
F = lambda f, n: ImageFont.truetype(f, n)
BLUE, ORANGE, TEXT, DIM = (120, 165, 255), (255, 160, 75), (240, 236, 250), (170, 160, 195)
BUFF = {'blue': ('CASTING', (110, 160, 255)), 'red': ('GUN', (255, 105, 95)), 'purple': ('MOVEMENT', (190, 110, 255))}
TEAM = {3: BLUE, 2: ORANGE}

img = Image.new('RGBA', (W, H), (16, 13, 28, 255))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
glow.paste(Image.new('RGBA', m.size, (150, 60, 230, 255)), (ML, MT), m.split()[3])
img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(30)))
img.alpha_composite(m, (ML, MT))
d = ImageDraw.Draw(img)

def tag(xy, text, col, size=26, font=BOLD, anchor='mm', box=True):
    f = F(font, size)
    if box:
        l, t, r, b = d.textbbox(xy, text, font=f, anchor=anchor)
        d.rounded_rectangle([l - 10, t - 6, r + 10, b + 6], 8, fill=(14, 10, 26, 215), outline=col + (255,), width=2)
    d.text(xy, text, font=f, fill=col + (255,) if len(col) == 3 else col, anchor=anchor)

def dashed(pts, col, w=5, dash=22, gap=14):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); t = 0.0
        while t < L:
            t1 = min(L, t + dash)
            d.line([(x0 + (x1 - x0) * t / L, y0 + (y1 - y0) * t / L), (x0 + (x1 - x0) * t1 / L, y0 + (y1 - y0) * t1 / L)], fill=col + (200,), width=w)
            t = t1 + gap

# Minion routes: each team's two lanes, from its base to the enemy portal.
for team, side, pts in E['routes']:
    dashed([P(*q) for q in pts], TEAM[team])
# Walkers, shops, hero spawns, portals.
for team, (x, y) in E['towers']:
    cx, cy = P(x, y); r = 20
    d.polygon([(cx, cy - r), (cx + r, cy + r * 0.8), (cx - r, cy + r * 0.8)], fill=TEAM[team] + (255,), outline=(20, 15, 30, 255))
    tag((cx, cy + 46 if x < 0 else cy - 46), 'Walker', TEAM[team], 22, MED)
for team, (x, y) in E['shops']:
    cx, cy = P(x, y)
    d.rounded_rectangle([cx - 20, cy - 20, cx + 20, cy + 20], 6, fill=(250, 200, 60, 255), outline=(30, 20, 10, 255), width=2)
    d.text((cx, cy), '$', font=F(BOLD, 28), fill=(40, 25, 10, 255), anchor='mm')
for team, (x, y) in E['spawns']:
    cx, cy = P(x, y)
    tag((cx + (60 if y > 0 else -60), cy), 'Spawn', TEAM[team], 20, MED)
for team, (x, y) in E['portals']:
    cx, cy = P(x, y)
    tag((cx, cy - 120), 'Portal', TEAM[team], 24)
# Camps: the buff each drops.
for kind, (x, y) in E['camps']:
    name, col = BUFF[kind]
    cx, cy = P(x, y)
    tag((cx, cy), f'{name} BUFF', col, 22)
# Pits.
for cx, cy in E['pits']:
    if abs(cx) > 2500: cx = math.copysign(3080, cx)        # the long side pits: the middle of the band
    px, py = P(cx, cy)
    if abs(cy) > 1000: py += 52                              # the round pits: below the pillar in the middle
    d.text((px, py), 'PIT', font=F(BOLD, 30 if abs(cy) < 1000 else 24), fill=(245, 225, 255, 235), anchor='mm')

# Bases, title and key.
for team, (x, y) in E['portals']:
    cx = ML / 2 if y < 0 else W - MR / 2
    col = TEAM[team]; name = 'THE ARCHMOTHER' if y < 0 else 'THE HIDDEN KING'
    d.text((cx, MT + m.height / 2 - 30), name, font=F(BOLD, 40), fill=col + (255,), anchor='mm')
    d.text((cx, MT + m.height / 2 + 20), 'base', font=F(MED, 28), fill=col + (255,), anchor='mm')
d.text((W / 2, 70), 'SHATTERED ARENA  -  MAP LAYOUT', font=F(BOLD, 64), fill=(225, 140, 255, 255), anchor='mm')
ky = H - MB / 2
items = [('dash', BLUE, 'Archmother minion lanes'), ('dash', ORANGE, 'Hidden King minion lanes'), ('tri', TEXT, 'Walker'),
         ('shop', None, 'Shop'), ('pit', None, 'Pit (fall = death)'), ('pillar', None, 'Pillar / wall')]
x = 180
for kind, col, label in items:
    if kind == 'dash': d.line([(x - 40, ky), (x - 6, ky)], fill=col + (255,), width=6); d.line([(x - 70, ky), (x - 52, ky)], fill=col + (255,), width=6)
    elif kind == 'tri': d.polygon([(x - 38, ky - 16), (x - 20, ky + 14), (x - 56, ky + 14)], fill=(200, 200, 220, 255))
    elif kind == 'shop': d.rounded_rectangle([x - 56, ky - 18, x - 20, ky + 18], 6, fill=(250, 200, 60, 255)); d.text((x - 38, ky), '$', font=F(BOLD, 24), fill=(40, 25, 10, 255), anchor='mm')
    elif kind == 'pit': d.ellipse([x - 60, ky - 20, x - 20, ky + 20], fill=(120, 60, 200, 255), outline=(200, 80, 240, 255), width=4)
    elif kind == 'pillar': d.ellipse([x - 56, ky - 18, x - 20, ky + 18], fill=(232, 228, 242, 255))
    d.text((x, ky), label, font=F(MED, 28), fill=TEXT + (255,), anchor='lm')
    x += d.textlength(label, font=F(MED, 28)) + 130
img.convert('RGB').save(out, quality=92, optimize=True)
print('saved', out, img.size)
