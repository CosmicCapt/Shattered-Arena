"""Generate Arena Pit's map hl_arena_pit from arena_shapes.py (the SMITE Arena layout with two death pits).

Usage: python build_arena_v1.py <sample.vmap> <out.vmap> <preview.png> <layout.ts> [walls.png]
The optional fifth argument also draws the outer walls unrolled and saves <walls.png>.solids for render_view.py.
The sample is any Hammer-saved .vmap whose world has a mesh (Siege's siege_map_v1.vmap was used).

Builds, in grey blockout (dev_measuregeneric01b) with tints:
  - the floor: the arena's ellipse minus the two pits, cut into convex pieces
  - the outer wall (1,500 high with a broken top of leaning shards and glowing cracks), each base's
    curved wall with the portal (team colour) in its middle and the short walls beside each base exit
    (750 high with ramparts and towers), eight broken pillars and six side walls, under a player-clip
    ceiling at 1,000
  - the pits: purple rims straight down to -1,600 and no floor (the mod kills heroes below -100)
Entities: sun, team spawns, nav seeds, four lane paths (one per minion spawn) with trooper spawns,
shop zones and markers, portal markers, six tier 3 camps (one unit each), four Walkers (T2 towers; the mod makes them
indestructible). No Deadlock models (they crash Hammer); the mod places the shop models.
Don't run it over the map once it has been edited in Hammer: it rebuilds everything."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dmx
import meshkit as mk
import arena_shapes as A

ARR = dmx.ARR
SAMPLE, OUT, PNG, LAYOUT = sys.argv[1:5]
MAP = os.path.splitext(os.path.basename(OUT))[0]
header, prefix, strs, elems = mk.init(SAMPLE)
root = elems[0]
world = root.get('world')
TRIGGER = 'materials/tools/toolstrigger.vmat'
CLIP = 'materials/tools/toolsplayerclip.vmat'

FLOOR_Z0, FLOOR_Z1 = -64, 0
PIT_DEPTH = -1600
PIT_KILL_Z = -100
PORTAL_H = 700
PORTAL_DEPTH = 200
PORTAL_REACH = 40         # a minion this close to the face of the enemy portal has gone in (the mod's check)
PORTAL_WALK_IN = 30       # the mod walks minions this far past the face (less than PORTAL_REACH, so one that stops there still counts)
GREY, FLOOR, CORRUPT = (150, 150, 150, 255), (205, 205, 195, 255), (150, 40, 200, 255)
TEAMCOL = {A.AMBER: (255, 150, 30, 255), A.SAPPHIRE: (60, 214, 168, 255)}

E = A.everything()

# ---------------------------------------------------------------- looks
# Deadlock's own materials (players already have them, so they add nothing to the upload). Hammer can't
# draw them: check in game. A piece not listed in LOOKS keeps the grey measuring material and its tint.
MAT_FLOOR = 'materials/cobble/cobblestone_01/cobblestone_01.vmat'
MAT_WALL = 'materials/marble/marble_trim_01.vmat'
MAT_BASE = 'materials/brick/brick_wall01.vmat'
MAT_PIT = 'materials/dev/purple_illum.vmat'            # glows
WHITE = (255, 255, 255, 255)                            # no tint: the material's own colours
BASE_TINT = {A.AMBER: (255, 205, 160, 255), A.SAPPHIRE: (160, 205, 255, 255)}   # a team's brick is tinted its colour
TEXTURE_UNITS = 256                                     # one repeat of a material covers this many units
# Every pit ends in a dim purple glow at the bottom of its walls. (The game's Cosmic Veil material was tried
# across the pits: everything seen through it turns grey.)
PIT_GLOW_TINT = (120, 60, 200, 255)
MAT_SKY = 'materials/skybox/sky_dl_hideout_storm_01.vmat'   # the Hideout's storm sky
# A sheet of glowing purple cloud across every pit, 85% of the way up from the bottom. (Tried in game:
# materials/effects/fog_plane.vmat draws nothing here, and the Cosmic Veil turns everything under it grey.)
MAT_PIT_SHEET = 'materials/effects/fog_plane_test_01.vmat'
PIT_SHEET_Z = round(PIT_DEPTH * 0.15)
SIDE_WALL_H = A.WALL_H // 2                             # the walls beside the camps are half as tall as the rest
# A glowing ring on the floor around each camp, in the colour of the buff it drops.
MAT_RING = 'materials/dev/primary_white_emissive_glowing.vmat'
RING_TINT = {'blue': (70, 140, 255, 255), 'red': (255, 70, 60, 255), 'purple': (180, 90, 255, 255)}   # casting, gun, movement
# The wall beside each camp is tinted its buff's colour too (softer than the ring: it is a big surface).
CAMP_WALL_TINT = {'blue': (110, 160, 255, 255), 'red': (255, 115, 105, 255), 'purple': (175, 100, 255, 255)}
RING_R, RING_W, RING_H, RING_SEGS = 220, 24, 2, 32     # outer radius, width, height above the floor, pieces
# The buff's name on the camp side of each camp's wall, in glowing block letters (two lines: the buff, then BUFF).
# Floating text made by the mod does not show on this map, so the words are part of the map.
SIGN_WORD = {'blue': 'CASTING', 'red': 'GUN', 'purple': 'MOVEMENT'}
SIGN_PIXEL = 16                                         # one letter block; letters are 5 blocks wide and 7 tall
SIGN_Z = 330                                            # the middle of the two lines, above the floor
SIGN_OUT = 6                                            # how far the letters stand out from the wall
FONT = {   # 5 x 7, top row first
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
}
# The outer walls (the arena's and the bonus arena's): a soft grey-violet instead of the marble's white,
# OUTER_H high with a broken top edge of slanted shards above that, and glowing cracks down their inside.
OUTER_TINT = (196, 188, 212, 255)
OUTER_H = 1500                                          # a camera at the sky barrier (1,000) cannot see over
SHARD_W = (70, 190)                                     # a shard's width along the wall
SHARD_PEAK = (300, 900)                                 # its high corner above OUTER_H
SHARD_LOW = (0, 280)                                    # its low corner
SHARD_SET_IN = 50                                       # how far its face may sit back from the wall's
SHARD_LEAN = 0.75                                       # units a shard leans in over the arena for each unit it rises: together they close in like a broken dome
CRACK_CHANCE = 0.75                                     # of a wall piece having a crack
CRACK_W = (34, 10)                                      # a crack's width at its start and its end
CRACK_OUT = 4                                           # how far it stands out of the wall
# The bases: their own walls (the curved one with the portal, and the ones beside the exits) are half the
# outer wall's height with a rampart on top: a marble ledge and battlements, a gable over the portal
# and a roofed tower either side of it and at the end of each exit wall. Heroes can get on top of them and
# shoot over them (the user's choice: a base heals its own team).
BASE_H = OUTER_H // 2
LEDGE_H, LEDGE_OUT = 40, 28                             # the marble ledge: its height, and how far it overhangs each face
MERLON = (110, 90, 95)                                  # a battlement block: length, gap to the next, height
GABLE_H = 240                                           # the gable over the portal, above the ledge
TOWER = (130, 330, 220)                                 # a gate tower: radius, height above the wall, roof height
POST = (95, 170, 150)                                   # the same for the tower ending an exit wall
BAND_GLOW = {A.AMBER: (255, 150, 40, 255), A.SAPPHIRE: (70, 150, 255, 255)}   # the glowing band round each tower
PILLAR_SCALE = 0.85                                     # pillars are this much of the heights below
# Shattered pillars: each is broken off at its own height, with three jagged pieces of its top still standing. Heights are for arena_shapes.PILLARS in order, then their copies.
PILLAR_BREAKS = [960, 700, 840, 620, 760, 900, 660, 800]
PILLAR_SHARDS = [(0, 6, 230), (6, 4, 130), (10, 3, 60)]    # (first side, sides it spans of 16, height above the break)
LOOKS = {            # label: (material, tint or None for the team's BASE_TINT)
    'floor': (MAT_FLOOR, WHITE),
    'outer wall': (MAT_WALL, OUTER_TINT), 'pillar': (MAT_WALL, OUTER_TINT),
    'side wall blue': (MAT_WALL, CAMP_WALL_TINT['blue']), 'side wall red': (MAT_WALL, CAMP_WALL_TINT['red']), 'side wall purple': (MAT_WALL, CAMP_WALL_TINT['purple']),
    'base wall': (MAT_BASE, None), 'base exit wall': (MAT_BASE, None),
    'portal': (MAT_BASE, None), 'portal top': (MAT_BASE, None),
    'portal threshold': (MAT_WALL, OUTER_TINT),          # a marble doorstep; its glowing edge is added with the ramparts
    'pit wall': (MAT_PIT, WHITE),
}

def circle(c, r, n, phase=None):
    phase = math.pi / n if phase is None else phase
    return [(c[0] + r * math.cos(phase + 2 * math.pi * i / n), c[1] + r * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]

def cross3(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

def ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else list(reversed(poly))

def clean(poly):
    out = []
    for q in poly:
        if not out or math.dist(out[-1], q) > 0.5: out.append(q)
    if len(out) > 1 and math.dist(out[0], out[-1]) <= 0.5: out.pop()
    i = 0
    while len(out) > 3 and i < len(out):
        if abs(cross3(out[i - 1], out[i], out[(i + 1) % len(out)])) < 1e-3 * (math.dist(out[i - 1], out[(i + 1) % len(out)]) + 1):
            out.pop(i); i = 0
        else:
            i += 1
    return out

def convex(poly):
    n = len(poly)
    return all(cross3(poly[i - 1], poly[i], poly[(i + 1) % n]) > -1e-6 for i in range(n))

def inside(poly, x, y):
    c = False; n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def strip(a, b, t, ext=0.0):
    """A wall piece t thick centred on the line a-b, lengthened by ext at both ends."""
    dx, dy = b[0] - a[0], b[1] - a[1]; ln = math.hypot(dx, dy); tx, ty = dx / ln, dy / ln
    nx, ny = -ty * t / 2, tx * t / 2
    a2 = (a[0] - tx * ext, a[1] - ty * ext); b2 = (b[0] + tx * ext, b[1] + ty * ext)
    return ccw([(a2[0] + nx, a2[1] + ny), (b2[0] + nx, b2[1] + ny), (b2[0] - nx, b2[1] - ny), (a2[0] - nx, a2[1] - ny)])

def side_strip(a, b, t, ext, outward):
    """A wall piece along a->b on one side of the line (outward = right of the direction), lengthened by
    ext at both ends, or by (ext at a, ext at b)."""
    dx, dy = b[0] - a[0], b[1] - a[1]; ln = math.hypot(dx, dy); tx, ty = dx / ln, dy / ln
    nx, ny = (ty, -tx) if outward else (-ty, tx)
    ea, eb = ext if isinstance(ext, tuple) else (ext, ext)
    a2 = (a[0] - tx * ea, a[1] - ty * ea); b2 = (b[0] + tx * eb, b[1] + ty * eb)
    return ccw([a2, b2, (b2[0] + nx * t, b2[1] + ny * t), (a2[0] + nx * t, a2[1] + ny * t)])

def capsule(a, b, t, n=8):
    """A convex capsule (rounded ends) around a-b, t thick."""
    ang = math.atan2(b[1] - a[1], b[0] - a[0]); r = t / 2
    pts = [(b[0] + r * math.cos(ang - math.pi / 2 + math.pi * i / n), b[1] + r * math.sin(ang - math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]
    pts += [(a[0] + r * math.cos(ang + math.pi / 2 + math.pi * i / n), a[1] + r * math.sin(ang + math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]
    return ccw(pts)

# ---------------------------------------------------------------- floor: ellipse minus pits, as convex trapezoids
outline = ccw(E['outline'])
pits = [ccw(p) for p in E['pit_polys']]
solids = [outline]

def crossings(poly, y):
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a[1] - y) * (b[1] - y) < 0:
            t = (y - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * t, (a, b)))
    out.sort(key=lambda c: c[0])
    return out

def intervals(poly, y):
    c = crossings(poly, y)
    return [(c[i], c[i + 1]) for i in range(0, len(c) - 1, 2)]

def union(ivs):
    ivs = sorted(ivs, key=lambda iv: iv[0][0]); out = []
    for iv in ivs:
        if out and iv[0][0] <= out[-1][1][0]:
            if iv[1][0] > out[-1][1][0]: out[-1] = (out[-1][0], iv[1])
        else:
            out.append(iv)
    return out

def subtract(ivs, holes):
    for h0, h1 in holes:
        nxt = []
        for a, b in ivs:
            if h1[0] <= a[0] or h0[0] >= b[0]:
                nxt.append((a, b)); continue
            if h0[0] > a[0]: nxt.append((a, h0))
            if h1[0] < b[0]: nxt.append((h1, b))
        ivs = nxt
    return ivs

def x_at(edge, y):
    (ax, ay), (bx, by) = edge
    return ax + (bx - ax) * (y - ay) / (by - ay)

def seg_cross_y(a, b, c, d):
    r = (b[0] - a[0], b[1] - a[1]); s_ = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s_[1] - r[1] * s_[0]
    if abs(den) < 1e-9: return None
    t = ((c[0] - a[0]) * s_[1] - (c[1] - a[1]) * s_[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    return a[1] + t * r[1] if 0 < t < 1 and 0 < u < 1 else None

# Band edges: every corner, and every place two outlines cross (pits cut into the outer wall), so each band
# holds straight edges only.
ys = {round(p[1], 4) for poly in solids + pits for p in poly}
shapes_ = solids + pits
for i in range(len(shapes_)):
    for j in range(i + 1, len(shapes_)):
        for a, b in zip(shapes_[i], shapes_[i][1:] + shapes_[i][:1]):
            for c, d in zip(shapes_[j], shapes_[j][1:] + shapes_[j][:1]):
                y = seg_cross_y(a, b, c, d)
                if y is not None: ys.add(round(y, 4))
ys = sorted(ys)
# Band edges closer than a unit are merged into one (a band that thin would otherwise leave a sliver of
# missing floor).
_m = []
for y in ys:
    if not _m or y - _m[-1] >= 1.0: _m.append(y)
ys = _m
floor, open_ = [], []
for y0, y1 in zip(ys, ys[1:]):
    if y1 - y0 < 1: continue
    ym = (y0 + y1) / 2
    ivs = subtract(union([iv for s in solids for iv in intervals(s, ym)]), union([iv for p in pits for iv in intervals(p, ym)]))
    band = []
    for (xa, ea), (xb, eb) in ivs:
        bl, br, tl, tr = x_at(ea, y0), x_at(eb, y0), x_at(ea, y1), x_at(eb, y1)
        if br - bl < -0.5 or tr - tl < -0.5:
            continue          # two outlines cross inside this band: a sliver that is under the outer wall anyway
        piece = None
        for f in open_:
            if f['y1'] == y0 and abs(f['top'][0] - bl) < 0.5 and abs(f['top'][1] - br) < 0.5:
                poly = clean([f['left'][0]] + f['right'] + [(tr, y1), (tl, y1)] + list(reversed(f['left'][1:])))
                if convex(poly):
                    f['right'].append((tr, y1)); f['left'].append((tl, y1)); f['top'] = (tl, tr); f['y1'] = y1
                    piece = f
                break
        if piece is None:
            piece = {'left': [(bl, y0), (tl, y1)], 'right': [(br, y0), (tr, y1)], 'top': (tl, tr), 'y1': y1}
            floor.append(piece)
        band.append(piece)
    open_ = band
floor_polys = [p for p in (clean([f['left'][0]] + f['right'] + list(reversed(f['left'][1:]))) for f in floor) if len(p) >= 3]

# ---------------------------------------------------------------- walls
def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
walls = []        # (poly, z0, z1, tint, label)
outer_runs = []   # (a, b): each piece of the outer wall, for its broken top and its cracks
def outer(a, b, ext=60):
    walls.append((side_strip(a, b, 200, ext, outward=True), PIT_DEPTH, OUTER_H, GREY, 'outer wall'))
    outer_runs.append((a, b))
for i in range(len(outline)):
    outer(outline[i], outline[(i + 1) % len(outline)])
ramparts = []     # (team, a, b, thickness): each lowered base wall piece, for what stands on it
for team, pts in E['base_arcs']:
    for a, b in zip(pts, pts[1:]):
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if abs(m[0]) < A.PORTAL_HALF_W - 40: continue                 # the portal sits here
        walls.append((strip(a, b, A.BASE_WALL_T, 20), 0, BASE_H, GREY, 'base wall'))
        ramparts.append((team, a, b, A.BASE_WALL_T))
for a, b in E['stubs']:
    walls.append((strip(a, b, A.STUB_T, 0), 0, BASE_H, GREY, 'base exit wall'))
    ramparts.append((A.AMBER if a[1] > 0 else A.SAPPHIRE, a, b, A.STUB_T))
assert len(E['pillars']) == len(PILLAR_BREAKS)
for n, p in enumerate(E['pillars']):
    ring, top = circle(p, A.PILLAR_R, 16), round(PILLAR_BREAKS[n] * PILLAR_SCALE)
    walls.append((ring, PIT_DEPTH, top, GREY, 'pillar'))   # down to the pit floor: some stand in a pit's edge
    turn = 5 * n                                            # each pillar's break faces a different way
    for first, span, rise in PILLAR_SHARDS:
        shard = [p] + [ring[(turn + first + k) % 16] for k in range(span + 1)]
        walls.append((shard, top, top + round(rise * PILLAR_SCALE), GREY, 'pillar'))
for a, b in E['side_walls']:
    kind = min(E['camps'], key=lambda c: seg_dist(c[1], a, b))[0]        # the camp this wall stands beside
    walls.append((capsule(a, b, A.SIDE_WALL_T), PIT_DEPTH, SIDE_WALL_H, GREY, 'side wall ' + kind))
# Portals: a gate block in team colour, filling the middle of the base wall, with a doorstep in front.
thresholds = []   # (team, x, the portal's arena-side y, which way is out of the arena): for the doorstep's glowing edge
for team, p in E['portals']:
    hw, hd = A.PORTAL_HALF_W + 40, PORTAL_DEPTH / 2
    walls.append(([(p[0] - hw, p[1] - hd), (p[0] + hw, p[1] - hd), (p[0] + hw, p[1] + hd), (p[0] - hw, p[1] + hd)], 0, PORTAL_H, TEAMCOL[team], 'portal'))
    walls.append(([(p[0] - hw, p[1] - hd), (p[0] + hw, p[1] - hd), (p[0] + hw, p[1] + hd), (p[0] - hw, p[1] + hd)], PORTAL_H, BASE_H, GREY, 'portal top'))
    s = 1 if p[1] > 0 else -1                                          # the arena side is toward y = 0
    fy = p[1] - s * hd
    walls.append(([(p[0] - A.PORTAL_HALF_W, fy - s * 0), (p[0] + A.PORTAL_HALF_W, fy), (p[0] + A.PORTAL_HALF_W, fy - s * 160), (p[0] - A.PORTAL_HALF_W, fy - s * 160)], 0, 4, TEAMCOL[team], 'portal threshold'))
    thresholds.append((team, p[0], fy, s))
# Pit rims: purple, inside each pit, straight down; only where the pit's edge is in the arena (not in a wall).
for pit in pits:
    pc = ccw(pit)
    for i in range(len(pc)):
        a, b = pc[i], pc[(i + 1) % len(pc)]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if not inside(outline, mx, my): continue
        walls.append((side_strip(a, b, 48, 6, outward=False), PIT_DEPTH, FLOOR_Z1, CORRUPT, 'pit wall'))

# ---------------------------------------------------------------- entities
def make_entity(classname, origin, angles=(0.0, 0.0, 0.0), kids=(), **props):
    plug = dmx.Elem('DmePlugList', '')
    plug.attrs = [['names', 5 + ARR, []], ['dataTypes', 2 + ARR, []], ['plugTypes', 2 + ARR, []], ['descriptions', 5 + ARR, []]]
    kv = dmx.Elem('EditGameClassProps', '')
    kv.attrs = [['classname', 5, classname]] + [[k, 5, str(v)] for k, v in props.items()]
    e = dmx.Elem('CMapEntity', '')
    mk.node_counter[0] += 1
    e.attrs = [['origin', 10, tuple(float(c) for c in origin)], ['angles', 12, tuple(float(c) for c in angles)],
               ['scales', 10, (1.0, 1.0, 1.0)], ['nodeID', 2, mk.node_counter[0]], ['children', 1 + ARR, list(kids)],
               ['editorOnly', 4, 0], ['force_hidden', 4, 0], ['variableTargetKeys', 5 + ARR, []], ['variableNames', 5 + ARR, []],
               ['relayPlugData', 1, plug], ['connectionsData', 1 + ARR, []], ['entity_properties', 1, kv],
               ['hitNormal', 10, (0.0, 0.0, 1.0)], ['isProceduralEntity', 4, 0]]
    return e

def yaw_to(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 360

TN = {A.AMBER: 'amber', A.SAPPHIRE: 'sapphire'}
entities = []
entities.append(make_entity('light_environment', (0, 0, 2048), (50, 35, 0),
    targetname='sun', enabled=1, color='255 236 222', brightness='2.0', directlight=2, castshadows=1,
    angulardiameter='1.5', bouncescale='1.0', skycolor='190 160 255', skyintensity='1.2', skybouncescale='1.0',
    skyambientbounce='90 80 100', range='0'))
# The sky (env_sky's key names are the ones the Hideout's own sky entity uses).
entities.append(make_entity('env_sky', (0, 0, 2300), targetname='sky', skyname=MAT_SKY, tint_color='255 255 255', brightnessscale='1.0', fog_type=1))
# Team spawns: two rows of three around the base's spawn point, lanes 1, 4, 6 (lane 0 spawns at 0 0 0).
for team, p in E['spawns']:
    s = 1 if p[1] > 0 else -1
    for k, lane in enumerate((1, 1, 4, 4, 6, 6)):
        x = p[0] + (k % 3 - 1) * 140
        y = p[1] + s * (k // 3) * 120 * -1
        entities.append(make_entity('info_team_spawn', (x, y, 48), (0, yaw_to((x, y), (0, 0)), 0), teamnumber=team, initialspawn=0, lanenum=lane))
# Nav seeds.
seeds = [(0, 0), (0, 1500), (0, -1500), (-2400, 0), (2400, 0), (-1700, 1800), (1700, -1800)]
seeds += [p for _, p in E['spawns']]
for x, y in seeds:
    entities.append(make_entity('point_nav_walkable', (x, y, 16)))

# Lane path. What tests showed: troopers only fight troopers of their own lane, a lane has one path, Amber
# troopers walk it from its start and Sapphire from its end, and a trooper moved to another lane walks off
# on its own (back towards its spawn, through pillars and over pits). So every minion is on one lane
# (MINION_LANE) from the moment it spawns, and the mod walks it along its route itself (minions.ts):
# spawn -> bend -> meeting point -> straight up the middle -> enemy portal, letting the game's AI take over
# only while it is fighting. The lane's path is one straight line down the middle from the Amber portal to
# the Sapphire portal, so whatever the AI does in a fight, it stays in the middle.
MINION_LANE = 2
lane_layout = []
def portal_front(team):
    p = next(q for t, q in E['portals'] if t == team)
    s_ = 1 if p[1] > 0 else -1
    return (p[0], p[1] - s_ * (PORTAL_DEPTH / 2 + 60))

def rows_from(points, subdivide):
    """Path rows for a polyline: points [(x, y)], subdivide[i] says whether segment i gets nodes every ~400."""
    pts = [points[0]]
    for i, (a, b) in enumerate(zip(points, points[1:])):
        n = max(1, round(math.dist(a, b) / 400)) if subdivide[i] else 1
        for k in range(1, n + 1):
            pts.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    rows = []
    for j, p in enumerate(pts):
        nxt = pts[min(j + 1, len(pts) - 1)]; prv = pts[max(j - 1, 0)]
        dx, dy = nxt[0] - prv[0], nxt[1] - prv[1]; ln = math.hypot(dx, dy) or 1
        h = min(math.dist(p, nxt) if j + 1 < len(pts) else math.dist(p, prv), math.dist(p, prv) if j > 0 else math.dist(p, nxt), 400) / 3
        rows.append((p, (dx / ln * h, dy / ln * h)))
    return rows

def add_path(name, lane, rows):
    o = rows[0][0]
    txt = '[\n' + '\n'.join('\t[\n\t\t%.4f, %.4f, 0.0, %.4f,\n\t\t%.4f, 0.0, %.4f, %.4f,\n\t\t0.0,\n\t],' %
                            (p[0] - o[0], p[1] - o[1], -t[0], -t[1], t[0], t[1]) for p, t in rows) + '\n]'
    n = len(rows)
    entities.append(make_entity('lane_marker_path', (o[0], o[1], 0), targetname=name, LaneNum=lane, LaneSlot=0,
                                pathNodes=txt, pathNodeRadiusScales='[\n\t' + ', '.join(['0.0'] * n) + ',\n]',
                                pathNodePinsEnabled='[\n\t' + ', '.join(['false'] * n) + ',\n]'))
    return n

fs, fa = portal_front(A.SAPPHIRE), portal_front(A.AMBER)
for team, side, pts in E['routes']:                     # pts: spawn, bend, meet, enemy portal
    # No info_trooper_spawn: with spawn points the game sends its own waves; the mod places its minions itself.
    meet = pts[2]
    front = fs if team == A.AMBER else fa
    route = [pts[0], pts[1], meet] + ([] if abs(meet[0]) < 1 else [(0, meet[1])]) + [front]
    lane_layout.append((team, side, MINION_LANE, pts[0], pts[1], route))
n = add_path('arena_lane_middle', MINION_LANE, rows_from([fa, fs], [True]))   # Amber walks it from its start
print(f'lane {MINION_LANE}: {n} nodes, Amber portal to Sapphire portal')

# Shops: a buy volume and a marker where the mod puts the shop model (shops.ts).
for team, p in E['shops']:
    tn = TN[team]
    yaw = yaw_to(p, (E['spawns'][0][1] if team == A.SAPPHIRE else E['spawns'][1][1]))
    yaw = 270 if p[1] < 0 else 90                     # round 3: behind the portal, facing the spawn
    fy = -1 if p[1] < 0 else 1                        # the buy volume reaches toward the spawn
    trig_mesh = mk.make_mesh([(-256, -256), (256, -256), (256, 256), (-256, 256)], 0, 256, (255, 255, 255, 255), 'shop trigger', mat=TRIGGER)
    trig_mesh.set('origin', 10, (0.0, 0.0, 0.0))
    entities.append(make_entity('trigger_item_shop', (p[0], p[1] + fy * 150, 128), kids=[trig_mesh], targetname=f'arena_shop_{tn}_trigger',
                                teamnumber=team, lanenum=0, spawnflags=1, startdisabled=0))
    entities.append(make_entity('info_target_server_only', (p[0], p[1], 0), (0, yaw, 0), targetname=f'arena_shop_{tn}_model'))
for team, p in E['portals']:
    entities.append(make_entity('info_target_server_only', (p[0], p[1], 0), targetname=f'arena_portal_{TN[team]}'))

# Camps: tier 3, one strong unit each, in the middle of the camp (16 Nov 2026; two tier 3 units was too much,
# and before that they were tier 1, Midtown's small camps' units). The kind (blue, red, purple) is in the camp's
# name, arena_camp_<kind>_<n>, which the mod reads to pick the bridge buff it drops.
# Each buff has its own kind of unit, the same on both sides: Specimens (casting), Lanterns (gun), Gutter Ghouls (movement).
CAMP_UNIT = {'blue': 'neutral_specimen_strong', 'red': 'neutral_lantern_strong', 'purple': 'neutral_drain_creature_strong'}
for i, (kind, p) in enumerate(E['camps'], 1):
    name = f'arena_camp_{kind}_{i}'
    entities.append(make_entity('info_neutral_trooper_camp', (p[0], p[1], 0), targetname=name, campname=name,
                                tetherradiusoverride=400, initialspawndelayinseconds=1, spawnintervalinseconds=120))
    entities.append(make_entity('info_neutral_trooper_spawn', (p[0], p[1], 0), (0, yaw_to(p, (0, 0)), 0), campname=name,
                                eneutraltroopertype=-1, neutralsubclass=CAMP_UNIT[kind], teamnumber=4))
# Sinner's Sacrifices (16 Nov 2026, from the user's markup): one on a small island in each middle pit, against
# the pit side of the gun buff wall (reached only by jumping across from the floor at the wall's ends, or off
# the wall), and one on the floor by each long side pit, across from the gun buff. The mod (arena/sinners.ts)
# spawns them (pit ones at 5:00, edge ones at 10:00, then 2 minutes after each is cleared) and pays tickets
# for heavy melee hits. Camp names arena_sinner_<pit|edge>_<n>, which the mod reads.
SINNER_ISLAND_R = 150                                   # fits the Sinner and two heroes
SINNER_ISLAND_X = 1670.55 - A.SIDE_WALL_T / 2 - 6 - SINNER_ISLAND_R   # against the gun buff wall's pit side (the wall is SIDE_WALL_T thick)
SINNER_ON_ISLAND_X = SINNER_ISLAND_X + 55               # the Sinner stands toward the wall, heroes in front
SINNER_EDGE_X = 2780                                    # on the floor, clear of the side pit's edge (~2950)
SINNER_RING_TINT = (255, 190, 60, 255)
sinner_spots = [('pit', (SINNER_ON_ISLAND_X, 0.0)), ('pit', (-SINNER_ON_ISLAND_X, 0.0)), ('edge', (SINNER_EDGE_X, 0.0)), ('edge', (-SINNER_EDGE_X, 0.0))]
for i, (kind, p) in enumerate(sinner_spots, 1):
    name = f'arena_sinner_{kind}_{i}'
    entities.append(make_entity('info_neutral_trooper_camp', (p[0], p[1], 0), targetname=name, campname=name,
                                tetherradiusoverride=200, initialspawndelayinseconds=1, spawnintervalinseconds=120))
    entities.append(make_entity('info_neutral_trooper_spawn', (p[0], p[1], 0), (0, yaw_to(p, (0, 0)), 0), campname=name,
                                eneutraltroopertype=-1, neutralsubclass='neutral_sinners_sacrifice', teamnumber=4))
sinner_islands = [(SINNER_ISLAND_X, 0.0), (-SINNER_ISLAND_X, 0.0)]
sinner_rings = [(c, SINNER_ISLAND_R - 4) for c in sinner_islands] + [((x, 0.0), 150) for x in (SINNER_EDGE_X, -SINNER_EDGE_X)]
# T2 towers: Walkers, each team's own unit entry (the wrong one gives the other team's model).
for team, p in E['towers']:
    entities.append(make_entity('npc_boss_tier2', (p[0], p[1], 0), (0, yaw_to(p, (0, 0)), 0), teamnumber=team,
                                subclass_name='npc_boss_tier2' if team == A.AMBER else 'alt_npc_boss_tier2', lanenum=1 if p[0] < 0 else 6))

# ---------------------------------------------------------------- build
meshes, preview = [], []
def add(poly, z0, z1, tint, label):
    p = ccw(clean(poly))
    if len(p) < 3: return
    if label in LOOKS:
        mat, look_tint = LOOKS[label]
        if look_tint is None:                                # a base's piece: Amber's base is at +Y
            look_tint = BASE_TINT[A.AMBER if sum(q[1] for q in p) > 0 else A.SAPPHIRE]
        meshes.append(mk.make_mesh(p, z0, z1, look_tint, label, mat=mat, uv=TEXTURE_UNITS))
    else:
        meshes.append(mk.make_mesh(p, z0, z1, tint, label))
    preview.append((p, tint, z1, label))                     # the preview keeps the plain colours
for p in floor_polys:
    add(p, FLOOR_Z0, FLOOR_Z1, FLOOR, 'floor')
for poly, z0, z1, tint, label in walls:
    add(poly, z0, z1, tint, label)
# Wall signs: every run of lit blocks in a row of a letter is one thin box standing out of the wall's camp side.
sign_boxes = 0
for a, b in E['side_walls']:
    kind, camp = min(E['camps'], key=lambda c: seg_dist(c[1], a, b))
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    nx, ny = -(b[1] - a[1]) / length, (b[0] - a[0]) / length
    if (camp[0] - mid[0]) * nx + (camp[1] - mid[1]) * ny < 0: nx, ny = -nx, -ny      # the normal points at the camp
    rx, ry = -ny, nx                                       # to the right, for someone at the camp reading the wall
    lines = [SIGN_WORD[kind], 'BUFF']
    px = min(SIGN_PIXEL, length * 0.9 / max(len(w) * 6 - 1 for w in lines))
    face = A.SIDE_WALL_T / 2
    for li, word in enumerate(lines):
        top = SIGN_Z + (7.75 - li * 8.5) * px             # the two lines, 1.5 blocks apart, centred on SIGN_Z
        left = -(len(word) * 6 - 1) * px / 2
        for ci, ch in enumerate(word):
            for row, bits in enumerate(FONT[ch]):
                col = 0
                while col < 5:
                    if bits[col] == '0': col += 1; continue
                    end = col
                    while end < 5 and bits[end] == '1': end += 1
                    u0, u1 = left + (ci * 6 + col) * px, left + (ci * 6 + end) * px
                    quad = [(mid[0] + rx * u + nx * d, mid[1] + ry * u + ny * d) for u, d in ((u0, face - 2), (u1, face - 2), (u1, face + SIGN_OUT), (u0, face + SIGN_OUT))]
                    meshes.append(mk.make_mesh(ccw(quad), top - (row + 1) * px, top - row * px, RING_TINT[kind], 'wall sign', mat=MAT_RING))
                    sign_boxes += 1
                    col = end
print('wall sign boxes:', sign_boxes)
# Camp rings: each ring is cut into pieces, and a piece that would hang over a pit or sit in a wall is left out.
ring_count = {}
for n, (kind, c) in enumerate(E['camps']):
    for i in range(RING_SEGS):
        a0, a1 = 2 * math.pi * i / RING_SEGS, 2 * math.pi * (i + 1) / RING_SEGS
        quad = [(c[0] + r * math.cos(a), c[1] + r * math.sin(a)) for r, a in ((RING_R - RING_W, a0), (RING_R, a0), (RING_R, a1), (RING_R - RING_W, a1))]
        on_floor = all(inside(outline, x, y) and not any(inside(pp, x, y) for pp in pits)
                       and not any(inside(w[0], x, y) for w in walls if w[4] != 'pit wall') for x, y in quad)
        if not on_floor: continue
        meshes.append(mk.make_mesh(ccw(quad), FLOOR_Z1, FLOOR_Z1 + RING_H, RING_TINT[kind], 'camp ring', mat=MAT_RING))
        ring_count[n] = ring_count.get(n, 0) + 1
print('camp ring pieces:', [ring_count.get(n, 0) for n in range(len(E['camps']))], 'of', RING_SEGS)
# The pits' cloud and the glow at the bottom: one sheet each under the whole floor, seen only down the pits.
under = [(-A.RX, -A.RY), (A.RX, -A.RY), (A.RX, A.RY), (-A.RX, A.RY)]
cloud = mk.make_mesh(under, PIT_SHEET_Z - 4, PIT_SHEET_Z, WHITE, 'pit sheet', mat=MAT_PIT_SHEET, uv=512)
cloud.set('physicsType', 5, 'none')                       # not solid: bodies fall through it
meshes.append(cloud)
meshes.append(mk.make_mesh([(-A.RX, -A.RY), (A.RX, -A.RY), (A.RX, A.RY), (-A.RX, A.RY)], PIT_DEPTH, PIT_DEPTH + 8, PIT_GLOW_TINT, 'pit glow', mat=MAT_PIT, uv=512))
meshes.append(mk.make_mesh([(-A.RX - 800, -A.RY - 800), (A.RX + 800, -A.RY - 800), (A.RX + 800, A.RY + 800), (-A.RX - 800, A.RY + 800)],
                           A.SKY_Z, A.SKY_Z + 64, (255, 255, 255, 255), 'sky barrier', mat=CLIP))
# A wall's broken top and cracks. Both are flat shapes drawn on the wall's inside face (s along the wall,
# z up) and given thickness into or out of the wall.
import random
rough = random.Random(20)
face_shapes = []   # (label, a, b, shape): what was drawn on which wall, for a preview of the walls
def face_solid(a, b, shape, t0, t1, tint, label, mat, uv=TEXTURE_UNITS, lean=0.0, lean_from=0.0):
    """shape: convex polygon of (s, z) on the face of the wall a->b; t0..t1: its depth, positive into the
    wall (to the right of a->b). lean tips it out of the wall (to the left) by that much for each unit
    above lean_from."""
    dx, dy = b[0] - a[0], b[1] - a[1]; ln = math.hypot(dx, dy); tx, ty = dx / ln, dy / ln
    nx, ny = ty, -tx
    n = len(shape)
    pts = [(a[0] + tx * s + nx * (t - lean * (z - lean_from)), a[1] + ty * s + ny * (t - lean * (z - lean_from)), z) for t in (t0, t1) for s, z in shape]
    faces = [list(range(n)), list(reversed(range(n, 2 * n)))] + [[i, n + i, n + (i + 1) % n, (i + 1) % n] for i in range(n)]
    # Faces must wind counter-clockwise seen from outside: test the first against the solid's middle.
    mid = tuple(sum(q[k] for q in pts) / len(pts) for k in range(3))
    f = faces[0]; nrm = mk.cross(mk.sub(pts[f[1]], pts[f[0]]), mk.sub(pts[f[2]], pts[f[0]]))
    if mk.dot(nrm, mk.sub(pts[f[0]], mid)) < 0: faces = [list(reversed(loop)) for loop in faces]
    face_shapes.append((label, a, b, shape))
    return mk.make_solid(pts, faces, tint, label, mat, uv)

def broken_top(a, b, tint, mat, label, out):
    """Slanted shards side by side along the top of the wall a->b, each with one high corner, all leaning
    in over the arena."""
    ln = math.hypot(b[0] - a[0], b[1] - a[1]); s = 0.0
    while s < ln - 1:
        w = min(rough.uniform(*SHARD_W), ln - s)
        if ln - s - w < SHARD_W[0] / 2: w = ln - s            # no sliver at the end
        hi, lo = rough.uniform(*SHARD_PEAK), rough.uniform(*SHARD_LOW)
        left, right = (hi, lo) if rough.random() < 0.5 else (lo, hi)
        shape = [(s, OUTER_H), (s + w, OUTER_H)] + ([(s + w, OUTER_H + right)] if right > 1 else []) + ([(s, OUTER_H + left)] if left > 1 else [])
        out.append(face_solid(a, b, shape, rough.uniform(0, SHARD_SET_IN), 200, tint, label, mat, lean=SHARD_LEAN, lean_from=OUTER_H))
        s += w

def crack(a, b, out):
    """A glowing crack down the inside of the wall a->b from its top (or up from the floor): a zigzag of
    thin slanted strips, narrowing, sometimes forking."""
    ln = math.hypot(b[0] - a[0], b[1] - a[1])
    down = rough.random() < 0.7
    def run(s, z, steps, w0):
        for k in range(steps):
            ds = rough.uniform(35, 150) * rough.choice((-1, 1)); dz = rough.uniform(130, 320) * (-1 if down else 1)
            s2, z2 = min(ln - 14, max(14, s + ds)), z + dz
            if not 40 < z2 < OUTER_H: break
            w1 = w0 + (CRACK_W[1] - CRACK_W[0]) / 6
            strip_ = [(s - w0 / 2, z), (s + w0 / 2, z), (s2 + w1 / 2, z2), (s2 - w1 / 2, z2)]
            m = face_solid(a, b, strip_, -CRACK_OUT, 2, WHITE, 'crack', MAT_PIT, 512)
            m.set('physicsType', 5, 'none')
            out.append(m)
            if k > 0 and steps > 2 and rough.random() < 0.35: run(s2, z2, 2, w1)
            s, z, w0 = s2, z2, max(CRACK_W[1], w1)
    run(rough.uniform(30, ln - 30), OUTER_H if down else 0.0, rough.randint(3, 6), CRACK_W[0])

# The ramparts on the bases' walls.
def cone(ring, z, tip, tint, label, mat):
    """A pointed roof: ring (counter-clockwise from above) at z, up to a point tip above its middle."""
    n = len(ring); cx, cy = sum(q[0] for q in ring) / n, sum(q[1] for q in ring) / n
    pts = [(x, y, z) for x, y in ring] + [(cx, cy, z + tip)]
    return mk.make_solid(pts, [list(reversed(range(n)))] + [[i, (i + 1) % n, n] for i in range(n)], tint, label, mat, TEXTURE_UNITS)

def tower(c, team, size, out):
    r, rise, roof = size; top = BASE_H + LEDGE_H + rise
    brick = BASE_TINT[team]
    out.append(mk.make_mesh(circle(c, r, 8), 0, top, brick, 'base tower', mat=MAT_BASE, uv=TEXTURE_UNITS))
    out.append(mk.make_mesh(circle(c, r + 6, 8), top - 110, top - 80, BAND_GLOW[team], 'base tower band', mat=MAT_RING))
    out.append(mk.make_mesh(circle(c, r + LEDGE_OUT, 8), top, top + LEDGE_H, OUTER_TINT, 'base tower ledge', mat=MAT_WALL, uv=TEXTURE_UNITS))
    out.append(cone(circle(c, r + LEDGE_OUT - 8, 8), top + LEDGE_H, roof, brick, 'base tower roof', MAT_BASE))

base_extras = []
for team, a, b, t in ramparts:
    ln = math.hypot(b[0] - a[0], b[1] - a[1]); ext = 20 if t == A.BASE_WALL_T else 0
    base_extras.append(mk.make_mesh(strip(a, b, t + 2 * LEDGE_OUT, ext), BASE_H, BASE_H + LEDGE_H, OUTER_TINT, 'base ledge', mat=MAT_WALL, uv=TEXTURE_UNITS))
    # Battlements: as many blocks as fit, spread evenly, each across the wall's thickness.
    count = max(1, int((ln + MERLON[1]) // (MERLON[0] + MERLON[1])))
    step = ln / count
    for k in range(count):
        s0 = k * step + (step - MERLON[0]) / 2
        q0 = (a[0] + (b[0] - a[0]) * s0 / ln, a[1] + (b[1] - a[1]) * s0 / ln)
        q1 = (a[0] + (b[0] - a[0]) * (s0 + MERLON[0]) / ln, a[1] + (b[1] - a[1]) * (s0 + MERLON[0]) / ln)
        base_extras.append(mk.make_mesh(strip(q0, q1, t, 0), BASE_H + LEDGE_H, BASE_H + LEDGE_H + MERLON[2], OUTER_TINT, 'base battlement', mat=MAT_WALL, uv=TEXTURE_UNITS))
for team, p in E['portals']:
    hw, hd = A.PORTAL_HALF_W + 40, PORTAL_DEPTH / 2
    box = [(p[0] - hw - LEDGE_OUT, p[1] - hd - LEDGE_OUT), (p[0] + hw + LEDGE_OUT, p[1] - hd - LEDGE_OUT), (p[0] + hw + LEDGE_OUT, p[1] + hd + LEDGE_OUT), (p[0] - hw - LEDGE_OUT, p[1] + hd + LEDGE_OUT)]
    base_extras.append(mk.make_mesh(box, BASE_H, BASE_H + LEDGE_H, OUTER_TINT, 'portal ledge', mat=MAT_WALL, uv=TEXTURE_UNITS))
    # The gable: a triangle over the portal, as deep as the portal block, with a glowing strip under it.
    left, right = (p[0] - hw, p[1] + hd), (p[0] + hw, p[1] + hd)
    base_extras.append(face_solid(left, right, [(0, BASE_H + LEDGE_H), (2 * hw, BASE_H + LEDGE_H), (hw, BASE_H + LEDGE_H + GABLE_H)], 0, 2 * hd, BASE_TINT[team], 'portal gable', MAT_BASE))
    s = 1 if p[1] > 0 else -1
    fy = p[1] - s * (hd + LEDGE_OUT + 4)
    base_extras.append(mk.make_mesh(ccw([(p[0] - hw, fy), (p[0] + hw, fy), (p[0] + hw, fy + s * 8), (p[0] - hw, fy + s * 8)]), BASE_H + 6, BASE_H + LEDGE_H - 6, BAND_GLOW[team], 'portal glow strip', mat=MAT_RING))
    for side in (-1, 1):
        tower((p[0] + side * (hw + TOWER[0] - 30), p[1] + s * 40), team, TOWER, base_extras)
for team, x, fy, s in thresholds:
    # The doorstep's edge: a glowing line in the team's colour along its arena side and its two ends.
    w, d, g = A.PORTAL_HALF_W, 160, 10
    for box in ([(x - w, fy - s * d), (x + w, fy - s * d), (x + w, fy - s * (d - g)), (x - w, fy - s * (d - g))],
                [(x - w, fy), (x - w + g, fy), (x - w + g, fy - s * (d - g)), (x - w, fy - s * (d - g))],
                [(x + w - g, fy), (x + w, fy), (x + w, fy - s * (d - g)), (x + w - g, fy - s * (d - g))]):
        base_extras.append(mk.make_mesh(ccw(box), 4, 6, BAND_GLOW[team], 'portal threshold edge', mat=MAT_RING))
for a, b in E['stubs']:
    tower(min((a, b), key=lambda q: abs(q[1])), A.AMBER if a[1] > 0 else A.SAPPHIRE, POST, base_extras)   # the exit wall's arena end
meshes += base_extras

wall_extras = []
for a, b in outer_runs:
    broken_top(a, b, OUTER_TINT, MAT_WALL, 'outer wall top', wall_extras)
    if rough.random() < CRACK_CHANCE: crack(a, b, wall_extras)
meshes += wall_extras

# The bonus arena: the platform as a column up from the pit floor, a line across its middle, a rim in the
# teams' colours, the wall around its pit, and its own cloud, glow and sky barrier.
BONUS_SEGS = 48
BONUS_TEAM_TINT = {A.AMBER: (255, 140, 40, 255), A.SAPPHIRE: (70, 140, 255, 255)}
bc, br, bw = A.BONUS_C, A.BONUS_R, A.BONUS_WALL_R
# The Sinner islands: a stone column with a cobbled top and a gold ring on the Sinner's spot. Each is a mover
# (func_movelinear, arena_sinner_island_<n>, 16 Nov 2026): built sunk, its top just under the pit floor, it
# rises SINNER_ISLAND_DROP units in SINNER_ISLAND_RISE seconds to floor height when the mod Opens it (before
# its Sinner comes) and sinks back on Close (arena/sinners.ts). The edge Sinners' rings stay on the floor.
SINNER_ISLAND_DROP = FLOOR_Z1 + RING_H - PIT_DEPTH + 8   # sunk this far, the ring's top is under the pit floor
SINNER_ISLAND_RISE = 4.0                                 # seconds; the mod's SINNER_RISE_TIME must match
def sinner_ring(c, r, z):
    outer_ring, inner_ring = circle(c, r, 24), circle(c, r - RING_W, 24)
    return [mk.make_mesh(ccw([inner_ring[i], outer_ring[i], outer_ring[(i + 1) % 24], inner_ring[(i + 1) % 24]]), z, z + RING_H,
                         SINNER_RING_TINT, 'sinner ring', mat=MAT_RING) for i in range(24)]
for i, c in enumerate(sinner_islands, 1):
    dz = -SINNER_ISLAND_DROP
    disc = circle(c, SINNER_ISLAND_R, 20)
    parts = [mk.make_mesh(disc, PIT_DEPTH + dz, FLOOR_Z0 + dz, OUTER_TINT, 'sinner island', mat=MAT_WALL, uv=TEXTURE_UNITS),
             mk.make_mesh(disc, FLOOR_Z0 + dz, FLOOR_Z1 + dz, WHITE, 'sinner island floor', mat=MAT_FLOOR, uv=TEXTURE_UNITS)]
    parts += sinner_ring(c, SINNER_ISLAND_R - 4, FLOOR_Z1 + dz)
    origin = (c[0], c[1], FLOOR_Z1 + dz)
    # A mover's meshes keep their world origins: made relative to the entity, they sat around the map's centre
    # (tested 16 Nov 2026, both islands rose there as one tall pillar).
    entities.append(make_entity('func_movelinear', origin, kids=parts, targetname=f'arena_sinner_island_{i}',
                                movedir='-90 0 0', movedirislocal=0, movedistance=SINNER_ISLAND_DROP,
                                speed=round(SINNER_ISLAND_DROP / SINNER_ISLAND_RISE, 3), startposition=0, blockdamage=0, spawnflags=0))
for c, r in sinner_rings:
    if c in sinner_islands: continue                       # the islands carry their own ring
    meshes += sinner_ring(c, r, FLOOR_Z1)

def bonus_ring(r, n=BONUS_SEGS):
    return [(bc[0] + r * math.cos(2 * math.pi * i / n), bc[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
disc = bonus_ring(br)
meshes.append(mk.make_mesh(disc, PIT_DEPTH, FLOOR_Z0, WHITE, 'bonus column', mat=MAT_PIT, uv=TEXTURE_UNITS))
meshes.append(mk.make_mesh(disc, FLOOR_Z0, FLOOR_Z1, WHITE, 'bonus floor', mat=MAT_FLOOR, uv=TEXTURE_UNITS))
meshes.append(mk.make_mesh([(bc[0] - br + 30, bc[1] - 6), (bc[0] + br - 30, bc[1] - 6), (bc[0] + br - 30, bc[1] + 6), (bc[0] - br + 30, bc[1] + 6)],
                           FLOOR_Z1, FLOOR_Z1 + RING_H, WHITE, 'bonus line', mat=MAT_RING))
inner = bonus_ring(br - RING_W)
for i in range(BONUS_SEGS):
    j = (i + 1) % BONUS_SEGS
    quad = [inner[i], disc[i], disc[j], inner[j]]
    team = A.AMBER if sum(q[1] for q in quad) / 4 > bc[1] else A.SAPPHIRE
    meshes.append(mk.make_mesh(ccw(quad), FLOOR_Z1, FLOOR_Z1 + RING_H, BONUS_TEAM_TINT[team], 'bonus rim', mat=MAT_RING))
wall_in, wall_out = bonus_ring(bw, 32), bonus_ring(bw + 200, 32)
for i in range(32):
    j = (i + 1) % 32
    meshes.append(mk.make_mesh(ccw([wall_in[i], wall_out[i], wall_out[j], wall_in[j]]), PIT_DEPTH, OUTER_H, OUTER_TINT, 'bonus wall', mat=MAT_WALL, uv=TEXTURE_UNITS))
    # Its inside face runs i -> j (counter-clockwise) with the wall on the right, as the broken top and the cracks expect.
    bonus_extras = []
    broken_top(wall_in[i], wall_in[j], OUTER_TINT, MAT_WALL, 'bonus wall top', bonus_extras)
    if rough.random() < CRACK_CHANCE: crack(wall_in[i], wall_in[j], bonus_extras)
    meshes += bonus_extras
bsq = [(bc[0] - bw - 200, bc[1] - bw - 200), (bc[0] + bw + 200, bc[1] - bw - 200), (bc[0] + bw + 200, bc[1] + bw + 200), (bc[0] - bw - 200, bc[1] + bw + 200)]
bonus_cloud = mk.make_mesh(bsq, PIT_SHEET_Z - 4, PIT_SHEET_Z, WHITE, 'bonus pit sheet', mat=MAT_PIT_SHEET, uv=512)
bonus_cloud.set('physicsType', 5, 'none')
meshes.append(bonus_cloud)
meshes.append(mk.make_mesh(bsq, PIT_DEPTH, PIT_DEPTH + 8, PIT_GLOW_TINT, 'bonus pit glow', mat=MAT_PIT, uv=512))
meshes.append(mk.make_mesh(bsq, A.SKY_Z, A.SKY_Z + 64, (255, 255, 255, 255), 'bonus sky barrier', mat=CLIP))
world.set('children', 1 + ARR, meshes + entities)
vis = root.get('visbility')
vis.set('nodes', 1 + ARR, []); vis.set('hiddenFlags', 2 + ARR, []); vis.set('children', 1 + ARR, [])
root.get('rootSelectionSet').set('children', 1 + ARR, [])
root.set('m_ReferencedMeshSnapshots', 1 + ARR, []); root.set('nodeInstanceData', 1 + ARR, [])
cam = root.get('defaultcamera')
cam.set('position', 10, (0.0, -9500.0, 7000.0)); cam.set('lookat', 10, (0.0, -8500.0, 6200.0))
for a in prefix[0]:
    if a[0] == 'map_asset_references': a[2] = [mk.MAT, TRIGGER, CLIP, MAT_FLOOR, MAT_WALL, MAT_BASE, MAT_PIT, MAT_SKY, MAT_RING, MAT_PIT_SHEET]
dmx.save(OUT, header, prefix, [root, elems[1]] + [e for e in dmx.collect(root)[1:] if e is not elems[1]], strs)

# ---------------------------------------------------------------- verify
h2, p2, s2, e2 = dmx.load(OUT)
ms = [e for e in e2 if e.type == 'CDmePolygonMesh']
for m in ms:
    nxt, opp, face, dst = m.get('edgeNextIndices'), m.get('edgeOppositeIndices'), m.get('edgeFaceIndices'), m.get('edgeVertexIndices')
    for hh in range(len(nxt)):
        assert opp[opp[hh]] == hh and face[nxt[hh]] == face[hh] and dst[opp[nxt[hh]]] == dst[hh]
bad = sum(1 for p, *_ in preview if len(p) < 3 or any(cross3(p[i - 1], p[i], p[(i + 1) % len(p)]) <= 0 for i in range(len(p))))
import random
def near_outline(x, y, d=30):
    for i in range(len(outline)):
        (ax, ay), (bx, by) = outline[i], outline[(i + 1) % len(outline)]
        dx, dy = bx - ax, by - ay; t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        if math.hypot(x - ax - t * dx, y - ay - t * dy) < d: return True
    return False
rr = random.Random(1); wrong = 0
for _ in range(20000):
    x, y = rr.uniform(-A.RX - 50, A.RX + 50), rr.uniform(-A.RY - 50, A.RY + 50)
    if near_outline(x, y): continue   # a pit meeting the outer wall can leave a sliver a few units wide there
    want = inside(outline, x, y) and not any(inside(pp, x, y) for pp in pits)
    wrong += want != any(inside(fp, x, y) for fp in floor_polys)
print(f'meshes {len(ms)}, entities {len([e for e in e2 if e.type == "CMapEntity"])}, bytes {os.path.getsize(OUT)}, not convex {bad}, floor mismatches {wrong}/20000')
assert bad == 0 and wrong == 0

# ---------------------------------------------------------------- layout.ts for the mod
def v(p, z=0):
    return '{ x: %d, y: %d, z: %d }' % (round(p[0]), round(p[1]), z)
portal_face, walk_in = {}, {}
for team, p in E['portals']:
    s = 1 if p[1] > 0 else -1
    portal_face[team] = (p[0], p[1] - s * (PORTAL_DEPTH / 2))                   # the arena-side face of the block
    walk_in[team] = (p[0], p[1] - s * (PORTAL_DEPTH / 2 - PORTAL_WALK_IN))      # the mod's routes end inside it
L = [f'// Generated by tools/build_arena_v1.py with the map {MAP}. Edit the generator (or arena_shapes.py), not this file.',
     "import type { Vector } from 'modlock'", '',
     f"export const MAP = '{MAP}'",
     '/** Heroes below this height have fallen into a pit (the floor is at 0). */',
     f'export const PIT_KILL_Z = {PIT_KILL_Z}',
     '/** The arena-side face of each team\'s portal; an enemy minion within PORTAL_REACH of it has gone in. */',
     f'export const PORTALS: Record<number, Vector> = {{ 2: {v(portal_face[A.AMBER])}, 3: {v(portal_face[A.SAPPHIRE])} }}',
     f'export const PORTAL_REACH = {PORTAL_REACH}',
     "export type Side = 'left' | 'right'",
     '/** Each team\'s minion spawns (its own left and right), their lane, and the route the mod walks them: bend, meeting point, the middle, the enemy portal. */',
     'export const MINION_SPAWNS: Record<number, Record<Side, { lane: number; at: Vector; facing: number; route: Vector[] }>> = {']
for team in (A.AMBER, A.SAPPHIRE):
    parts = []
    for side in ('left', 'right'):
        t, sd, lane, sp, nx, route = next(x for x in lane_layout if x[0] == team and x[1] == side)
        enemy = A.SAPPHIRE if team == A.AMBER else A.AMBER
        route = route[:-1] + [walk_in[enemy]]   # the map's lane path stops in front; the mod walks them into the face
        parts.append(f'{side}: {{ lane: {lane}, at: {v(sp)}, facing: {round(yaw_to(sp, nx))}, route: [{", ".join(v(q) for q in route[1:])}] }}')
    L.append(f'  {team}: {{ {", ".join(parts)} }},')
L += ['}',
      '/** Each team\'s base: the part of the arena within radius of centre (behind its curved wall). */',
      f'export const BASES: Record<number, {{ centre: Vector; radius: number }}> = {{ 2: {{ centre: {v(A.rot(A.ARC_C))}, radius: {round(A.ARC_R)} }}, 3: {{ centre: {v(A.ARC_C)}, radius: {round(A.ARC_R)} }} }}',
      f'export const SPAWNS: Record<number, Vector> = {{ 2: {v(A.rot(A.SPAWN), 48)}, 3: {v(A.SPAWN, 48)} }}',
      'export const CENTRE: Vector = { x: 0, y: 0, z: 0 }',
      '/** The bonus round\'s platform, and each team\'s row of places on it (facing the other team\'s). */',
      f'export const BONUS: {{ centre: Vector; radius: number; spawns: Record<number, Vector[]> }} = {{ centre: {v(A.BONUS_C)}, radius: {A.BONUS_R}, spawns: {{',
      f'  2: [{", ".join(v(q, 48) for q in A.bonus_spawns(A.AMBER))}],',
      f'  3: [{", ".join(v(q, 48) for q in A.bonus_spawns(A.SAPPHIRE))}],',
      '} }']
open(LAYOUT, 'w').write('\n'.join(L) + '\n')

# ---------------------------------------------------------------- preview of what was built
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
fig, ax = plt.subplots(figsize=(8, 9.4), dpi=110)
ax.set_facecolor('#1a0f24')
# The floor and the pit rims are drawn as one surface each: the seams between their convex pieces
# exist only in the map file (the game shows one flat floor), so drawing them only confuses.
ax.add_patch(Polygon(outline, closed=True, fc=tuple(c / 255 for c in FLOOR[:3]), ec='none'))
for pit in pits:
    ax.add_patch(Polygon(pit, closed=True, fc='#1a0f24', ec='none'))
ORDER = {'portal top': 1, 'portal': 2, 'portal threshold': 3}
for p, t, z1, label in sorted(preview, key=lambda r: (r[2], ORDER.get(r[3], 0))):
    if label in ('floor', 'portal top'): continue      # the portal shows in its team colour from above
    fc = tuple(c / 255 for c in t[:3])
    seamless = label in ('pit wall', 'outer wall', 'base wall')
    ax.add_patch(Polygon(p, closed=True, fc=fc, ec=fc if seamless else 'black', lw=0.8 if seamless else 0.4))
for team, side, lane, sp, nx, route in lane_layout:
    c = '#ff961e' if team == A.AMBER else '#3fd6a8'
    ax.plot([q[0] for q in route], [q[1] for q in route], color=c, lw=1.5, ls='--')
    ax.text(sp[0], sp[1], f'{TN[team]} {side}', color=c, fontsize=7, ha='center', va='bottom')
for team, p in E['towers']:
    ax.scatter([p[0]], [p[1]], marker='^', s=120, c='#ff961e' if team == A.AMBER else '#3fd6a8', edgecolors='black', zorder=5)
for team, p in E['shops']:
    ax.scatter([p[0]], [p[1]], marker='s', s=110, c='#f5c542', edgecolors='black', zorder=5)
for k, p in E['camps']:
    ax.scatter([p[0]], [p[1]], marker='o', s=80, c={'blue': '#3aa0ff', 'red': '#ff4040', 'purple': '#b050ff'}[k], edgecolors='black', zorder=5)
ax.set_xlim(-A.RX - 500, A.RX + 500); ax.set_ylim(-A.RY - 500, A.RY + 500); ax.set_aspect('equal')
ax.set_title(f'{MAP} as built (top view, units)')
plt.tight_layout(); plt.savefig(PNG)
print('layout ->', LAYOUT, '| preview ->', PNG)

# With a fifth argument: a picture of the outer walls as seen from inside, unrolled (a stretch of the
# arena's, then the bonus arena's), with their broken tops and cracks.
if len(sys.argv) > 5:
    fig, axs = plt.subplots(2, 1, figsize=(15, 7.2), dpi=110)
    def unroll(ax, runs, title, upto):
        ax.set_facecolor('#2a2238'); s0 = 0.0
        for a, b in runs:
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            if s0 > upto: break
            body = '#c4bcd4'
            ax.add_patch(plt.Polygon([(s0, 0), (s0 + ln, 0), (s0 + ln, OUTER_H), (s0, OUTER_H)], fc=body, ec='none'))
            for label, fa, fb, shape in face_shapes:
                if fa != a or fb != b: continue
                ax.add_patch(plt.Polygon([(s0 + s, z) for s, z in shape], fc='#b04cff' if label == 'crack' else body, ec='#7a5fb0' if label == 'crack' else '#8d86a0', lw=0.4))
            s0 += ln
        ax.axhline(A.SKY_Z, color='white', ls=':', lw=0.8); ax.text(20, A.SKY_Z + 25, 'sky barrier (highest a hero gets)', color='white', fontsize=7)
        ax.axhline(1100, color='#ffcf66', ls=':', lw=0.8); ax.text(20, 1125, 'old wall top', color='#ffcf66', fontsize=7)
        ax.set_xlim(0, min(s0, upto)); ax.set_ylim(0, OUTER_H + SHARD_PEAK[1] + 80); ax.set_aspect('equal'); ax.set_title(title, fontsize=10)
        ax.set_xlabel('units along the wall'); ax.set_ylabel('height')
    unroll(axs[0], outer_runs, "The arena's outer wall from inside (a stretch of it)", 7500)
    ring32 = [(wall_in[i], wall_in[(i + 1) % 32]) for i in range(32)]
    unroll(axs[1], ring32, "The bonus arena's wall from inside (a stretch of it)", 7500)
    plt.tight_layout(); plt.savefig(sys.argv[5])
    # And every solid, for render_view.py's pictures from inside the map.
    import pickle
    with open(sys.argv[5] + '.solids', 'wb') as f: pickle.dump(mk.solids, f)
