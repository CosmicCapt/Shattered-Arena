"""Pictures of the map from a camera inside it, from the solids build_arena_v1.py saves (its fifth argument).
Usage: render_view.py solids_file out.png  eye_x,eye_y,eye_z  look_x,look_y,look_z  [fov_degrees] [title]
A plain painter's render: faces sorted far to near, flat colours shaded by the sun's direction."""
import sys, math, pickle
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

solids = pickle.load(open(sys.argv[1], 'rb'))
eye = tuple(float(v) for v in sys.argv[3].split(',')); look = tuple(float(v) for v in sys.argv[4].split(','))
fov = float(sys.argv[5]) if len(sys.argv) > 5 else 80.0
title = sys.argv[6] if len(sys.argv) > 6 else ''

def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def unit(v):
    l = math.sqrt(dot(v, v)); return tuple(c / l for c in v)
fwd = unit(sub(look, eye)); right = unit(cross(fwd, (0, 0, 1))); up = cross(right, fwd)
sun = unit((0.4, -0.5, 0.75))
BASE = {'cobblestone': (0.72, 0.70, 0.68), 'marble': (0.93, 0.92, 0.95), 'brick': (0.80, 0.62, 0.52), 'purple_illum': (0.62, 0.25, 0.95), 'fog_plane': None,
        'toolsplayerclip': None, 'toolstrigger': None}
def colour(mat, tint):
    key = next((k for k in BASE if mat and k in mat), None)
    if key is not None and BASE[key] is None: return None
    base = BASE.get(key, (0.85, 0.85, 0.85))
    glow = mat is not None and ('illum' in mat or 'emissive' in mat or 'ring' in mat.lower())
    return tuple(b * t / 255 for b, t in zip(base, tint[:3])), glow or key == 'purple_illum'

NEAR = 20.0
def clip_near(poly):
    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        if p[2] >= NEAR: out.append(p)
        if (p[2] >= NEAR) != (q[2] >= NEAR):
            t = (NEAR - p[2]) / (q[2] - p[2]); out.append(tuple(p[k] + (q[k] - p[k]) * t for k in range(3)))
    return out

faces = []
for points, loops, tint, label, mat in solids:
    if 'sky barrier' in label or 'clip' in label or 'pit sheet' in label: continue
    c = colour(mat, tint)
    if c is None: continue
    rgb, glow = c
    for loop in loops:
        w = [points[i] for i in loop]
        n = cross(sub(w[1], w[0]), sub(w[2], w[0]))
        if dot(n, n) == 0: continue
        n = unit(n)
        if dot(n, sub(eye, w[0])) <= 0: continue                      # facing away
        cam = [(dot(sub(p, eye), right), dot(sub(p, eye), up), dot(sub(p, eye), fwd)) for p in w]
        cam = clip_near(cam)
        if len(cam) < 3: continue
        shade = 1.0 if glow else 0.45 + 0.55 * max(0.0, dot(n, sun))
        far = max(p[2] for p in cam)
        f = 1 / math.tan(math.radians(fov) / 2)
        faces.append((far, [(p[0] / p[2] * f, p[1] / p[2] * f) for p in cam], tuple(min(1.0, v * shade) for v in rgb)))
faces.sort(key=lambda t: -t[0])
fig = plt.figure(figsize=(12.8, 7.2), dpi=110); ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor('#231c33')
for _, poly, rgb in faces:
    ax.add_patch(plt.Polygon(poly, fc=rgb, ec=tuple(v * 0.8 for v in rgb), lw=0.3))
ax.set_xlim(-1, 1); ax.set_ylim(-0.5625, 0.5625); ax.set_xticks([]); ax.set_yticks([])
if title: ax.text(-0.98, 0.52, title, color='white', fontsize=11)
plt.savefig(sys.argv[2])
