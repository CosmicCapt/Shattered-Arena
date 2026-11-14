# Draws the compiled-to-be map (a .vmap) from straight above, coloured by each piece's material, for a
# thumbnail. Usage: python render_top.py <map.vmap> <out.png> <width>
# Long side (Y) runs left to right: The Archmother (-Y) on the left, The Hidden King (+Y) on the right.
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
import dmx
import arena_shapes as A

src, out, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
E = A.everything()
PAD = 120
SPAN_X, SPAN_Y = 2 * (A.RY + PAD), 2 * (A.RX + PAD)        # world Y across, world X down
H = round(W * SPAN_Y / SPAN_X)
S = W / SPAN_X
def to_px(x, y):                                             # world -> image
    return ((y + A.RY + PAD) * S, (A.RX + PAD - x) * S)

h, p, s, e = dmx.load(src)
pieces = []
for k in e[0].get('world').get('children'):
    if k.type != 'CMapMesh': continue
    md = k.get('meshData'); mat = md.get('materials')[0].split('/')[-1].replace('.vmat', '')
    if mat in ('toolsplayerclip', 'toolstrigger'): continue
    o = k.get('origin'); pos = md.get('vertexData').get('streams')[0].get('data')
    pts = [(o[0] + v[0], o[1] + v[1]) for v in pos]; top = max(o[2] + v[2] for v in pos)
    cx = sum(q[0] for q in pts) / len(pts); cy = sum(q[1] for q in pts) / len(pts)
    pts = sorted(set((round(a, 2), round(b, 2)) for a, b in pts), key=lambda q: math.atan2(q[1] - cy, q[0] - cx))
    pieces.append((top, mat, tuple(k.get('tintColor'))[:3], pts))
pieces.sort(key=lambda t: t[0])

# Painter's order into an index image; pieces taller than the floor also cast a shadow.
idx = Image.new('I', (W, H), 0); di = ImageDraw.Draw(idx)
for n, (top, mat, tint, pts) in enumerate(pieces, 1):
    di.polygon([to_px(*q) for q in pts], fill=n)
idx = np.array(idx)
shadow = Image.new('L', (W, H), 0); ds = ImageDraw.Draw(shadow)
for top, mat, tint, pts in pieces:
    if top > 60:
        off = min(top, 1100) * 0.16 * S                       # light from the upper left
        ds.polygon([(px + off, py + off * 0.8) for px, py in (to_px(*q) for q in pts)], fill=150)
shadow = np.array(shadow.filter(ImageFilter.GaussianBlur(5 * S * 10))) / 255.0

rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W]
def noise(scale, octaves=4):
    acc = np.zeros((H, W)); amp = 1.0; tot = 0
    for o in range(octaves):
        g = rng.random((max(2, int(H / scale * 2 ** o)) + 2, max(2, int(W / scale * 2 ** o)) + 2))
        acc += amp * ndimage.zoom(g, (H / (g.shape[0] - 2), W / (g.shape[1] - 2)), order=3)[:H, :W]
        tot += amp; amp *= 0.5
    return acc / tot

def cobbles(cell):                                           # rounded stones in loose rows
    pts = []
    for r in range(int(H / cell) + 2):
        for c in range(int(W / cell) + 2):
            pts.append(((c + 0.5 * (r % 2) + rng.uniform(-0.25, 0.25)) * cell, (r + rng.uniform(-0.2, 0.2)) * cell))
    pts = np.array(pts)
    from scipy.spatial import cKDTree
    d, i = cKDTree(pts).query(np.stack([xx.ravel(), yy.ravel()], 1), k=2)
    edge = (d[:, 1] - d[:, 0]).reshape(H, W)
    shade = rng.uniform(0.86, 1.08, len(pts))[i[:, 0]].reshape(H, W)
    return (0.55 + 0.45 * np.clip(edge / (cell * 0.16), 0, 1) ** 0.5) * shade

def bricks(bw, bh):
    row = (yy // bh).astype(int)
    col = ((xx + (row % 2) * bw / 2) // bw).astype(int)
    mortar = ((yy % bh) < bh * 0.14) | (((xx + (row % 2) * bw / 2) % bw) < bw * 0.07)
    var = (np.sin(row * 12.9898 + col * 78.233) * 43758.5453) % 1
    return np.where(mortar, 0.62, 0.9 + 0.18 * var)

def marble():
    n = noise(W / 9, 5)
    veins = np.abs(np.sin((xx * 0.004 + yy * 0.009) * 6 + n * 14))
    return 0.9 + 0.1 * np.clip(veins * 1.4, 0, 1) - 0.12 * (veins < 0.08)

cell = max(8, 120 * S)
T = {
    'cobblestone_01': (np.array([196, 188, 205]), cobbles(cell)),
    'marble_trim_01': (np.array([226, 220, 238]), marble()),
    'brick_wall01': (np.array([168, 92, 70]), bricks(max(6, 60 * S), max(3, 26 * S))),
    'purple_illum': (np.array([186, 70, 230]), 0.92 + 0.12 * noise(W / 40, 2)),
    'fog_plane_test_01': (np.array([128, 70, 205]), 0.55 + 0.75 * noise(W / 14, 5)),
    'primary_white_emissive_glowing': (np.array([255, 255, 255]), np.ones((H, W))),
    'dev_measuregeneric01b': (np.array([255, 255, 255]), np.ones((H, W))),
}
img = np.zeros((H, W, 3))
glow = np.zeros((H, W, 3))
tops = np.full((H, W), -9999.0)
for n, (top, mat, tint, pts) in enumerate(pieces, 1):
    m = idx == n
    if not m.any(): continue
    base, tex = T.get(mat, (np.array([150, 150, 150]), np.ones((H, W))))
    col = base * (np.array(tint) / 255.0) if mat in ('brick_wall01', 'primary_white_emissive_glowing', 'dev_measuregeneric01b', 'marble_trim_01') else base
    if mat == 'marble_trim_01' and tint != (255, 255, 255): col = base * (0.45 + 0.55 * np.array(tint) / 255.0)
    if mat == 'brick_wall01': col = np.array([95, 125, 210]) if tint[2] > tint[0] else np.array([215, 120, 70])
    if mat in ('primary_white_emissive_glowing',): col = np.array(tint) * 0.55 + 115
    img[m] = col * tex[m][:, None]
    tops[m] = top
    if mat in ('purple_illum', 'primary_white_emissive_glowing', 'fog_plane_test_01'):
        glow[m] = img[m] * (0.5 if mat == 'fog_plane_test_01' else 1.0)

# Height: tall pieces a little brighter, pits dark toward the bottom; then shadows on anything lower.
light = np.where(tops > 60, 1.0 + 0.10 * np.clip(tops / 1100, 0, 1), 1.0)
light = np.where(tops < -100, 0.85, light)
# Pits: darker toward their middle (distance from the floor's edge), so they read as deep.
floorish = tops > -100
dist = ndimage.distance_transform_edt(~floorish)
light = np.where(~floorish, 0.95 - 0.45 * np.clip(dist / (260 * S), 0, 1), light)
img *= light[..., None]
img *= (1 - 0.55 * shadow * (tops < 60))[..., None]
# Top edges of tall pieces catch the light.
edge = ndimage.sobel(np.where(tops > 60, tops, 0), 0) ** 2 + ndimage.sobel(np.where(tops > 60, tops, 0), 1) ** 2
img += (np.clip(edge / edge.max() * 40, 0, 1) * 35)[..., None] * (tops > 60)[..., None]
bloom = np.stack([ndimage.gaussian_filter(glow[..., c], 9 * W / 1920) for c in range(3)], -1)
img = img + bloom * 0.9
# The rifts: a dark swirl with a teal rim in front of each portal.
pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')
over = Image.new('RGBA', (W, H), (0, 0, 0, 0)); do = ImageDraw.Draw(over)
for team, (x, y) in E['portals']:
    cx, cy = to_px(x, y - math.copysign(110, y))
    r = 150 * S
    do.ellipse([cx - r * 0.55, cy - r, cx + r * 0.55, cy + r], fill=(15, 18, 30, 235), outline=(90, 240, 230, 255), width=max(2, int(18 * S)))
over = over.filter(ImageFilter.GaussianBlur(1))
pil = Image.alpha_composite(pil, over)
keep = Image.new('L', (W, H), 0); dk = ImageDraw.Draw(keep)
dk.polygon([to_px(*q) for q in E['outline']], fill=255)
keep = ndimage.binary_dilation(np.array(keep) > 0, iterations=max(1, int(205 * S)))
alpha = Image.fromarray(((idx > 0) & keep).astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.6))
pil.putalpha(alpha)
pil.save(out)
print('saved', out, pil.size)
