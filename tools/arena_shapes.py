"""Arena Pit v1 layout: every shape of the map, measured from the SMITE Arena reference picture.

Picture coordinates (500 x 500 image, arena centre at (250, 250), y down) are turned into map units
with S units per pixel. Map axes: +Y is the top of the picture (Amber, orange), -Y the bottom
(Sapphire, green). The map is symmetric by a 180-degree turn, so only the bottom (Sapphire) half is
described and the top half is its rotated copy.
"""
import math

S = 21.5                     # units per picture pixel: the arena floor is about 6,950 x 8,170 units
CX, CY = 250.0, 250.0

def P(px, py):
    """Picture pixel -> map units."""
    return ((px - CX) * S, -(py - CY) * S)

def rot(p):
    return (-p[0], -p[1])

AMBER, SAPPHIRE = 2, 3       # Amber at +Y (top, orange in the picture), Sapphire at -Y (bottom, green)

# ---------------------------------------------------------------- outline
RX, RY = 161.5 * S, 190.0 * S          # the outer wall's inside edge (the picture's wall band is ~9 px thick): an ellipse
OUTLINE_SEGS = 64

# ---------------------------------------------------------------- the base (Sapphire's; Amber's is rotated)
# The base wall is an arc across the bottom, centred below the map, with the portal in its middle.
ARC_C = P(250, 493.25)                 # arc centre
ARC_R = 106.25 * S                     # through (205, 397), (250, 387), (295, 397)
ARC_HALF_DEG = 22                      # the arc spans +-22 degrees either side of straight up (ends near (210, 395))
BASE_WALL_T = 120
# Short walls jutting in from the outer wall beside each base exit: inner end, outer end.
STUBS = [(P(187, 411), P(176, 423)), (P(313, 411), P(324, 423))]   # shortened so each exit is ~600 units wide
STUB_T = 100
# The portal: a gate in the middle of the arc wall, in the base's team colour.
PORTAL = (0.0, ARC_C[1] + ARC_R)        # in the middle of the arc wall (its top point)
PORTAL_HALF_W = 20 * S                 # 800 units wide
SPAWN = P(250, 428)                    # the team spawn, at the back of the base
SHOP = (0.0, -3146.0)                  # the shop, its back against the portal wall (base side at 3,046), facing the spawn

# ---------------------------------------------------------------- the arena floor
PILLAR_R = 6 * S                       # 120 units
PILLARS = [P(220.7, 278.3), P(279.3, 278.3), P(188.5, 329.0), P(311.5, 329.0)]   # bottom half
# Side walls (capsules): end points; bottom half has the lower angled wall each side.
SIDE_WALL_T = 6 * S
SIDE_WALLS = [(P(126, 276.7), P(143.3, 320)), (P(374, 276.7), P(356.7, 320))]
MID_WALLS = [(P(172.3, 226), P(172.3, 274)), (P(327.7, 226), P(327.7, 274))]  # on the midline, not rotated
WALL_H = 1100                          # every wall and pillar: higher than the sky clip, so not climbable
SKY_Z = 1000

# ---------------------------------------------------------------- pits
# Round 2 (8 Nov 2026, from the user's marked-up preview). Each pit is an ellipse or a capsule, in map
# units; the map is symmetric both ways, so each is listed once with the mirrors it gets.
def _side_pit(width=520, beyond=150, y_max=2180, n=40):
    """The long pit along the outer wall on the +x side (round 3: the three side pits joined), from
    y = -y_max to y_max, width units in from the wall's inside edge and beyond units into the wall.
    Round 4 (16 Nov 2026): y_max 2,780 -> 2,180, so each rounded end stops about 1,020 units from the
    nearest Walker, just outside its 24 m (about 945 units) reach."""
    t_max = math.asin(y_max / RY)
    def at(t, off):
        x, y = RX * math.cos(t), RY * math.sin(t)
        nx, ny = math.cos(t) / RX, math.sin(t) / RY
        k = math.hypot(nx, ny)
        return (x + off * nx / k, y + off * ny / k)
    ts = [-t_max + 2 * t_max * i / n for i in range(n + 1)]
    inner = [at(t, -width) for t in ts]
    outer = [at(t, beyond) for t in reversed(ts)]
    def cap(start, end, toward):
        """A half circle from start to end that bulges toward the point toward."""
        c, r = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2), math.dist(start, end) / 2
        a0 = math.atan2(start[1] - c[1], start[0] - c[0])
        best = None
        for sign in (1, -1):
            pts = [(c[0] + r * math.cos(a0 + sign * math.pi * i / 8), c[1] + r * math.sin(a0 + sign * math.pi * i / 8)) for i in range(1, 8)]
            d = math.dist(pts[3], toward)
            if best is None or d < best[0]: best = (d, pts)
        return best[1]
    top = cap(inner[-1], at(t_max, beyond), at(t_max + 0.3, -width / 2))
    bottom = cap(outer[-1], inner[0], at(-t_max - 0.3, -width / 2))
    return inner + top + outer + bottom


def _mid_pit(cx=1025, rx=600, ry=760, x_wall=1670, corner=200, n=14):
    """The middle pit on the +x side (round 3): the lane side keeps the old ellipse's curve (a little taller),
    and the outer side runs square out to the upright wall by the red camp, with rounded corners."""
    pts = [(cx + rx * math.cos(math.radians(a)), ry * math.sin(math.radians(a))) for a in [90 + 180 * i / n for i in range(n + 1)]]
    for c0, a0 in (((x_wall - corner, -ry + corner), -90), ((x_wall - corner, ry - corner), 0)):
        pts += [(c0[0] + corner * math.cos(math.radians(a0 + 90 * i / 6)), c0[1] + corner * math.sin(math.radians(a0 + 90 * i / 6))) for i in range(7)]
    return pts


# Round 3 (9 Nov 2026, from the user's marked-up preview). Each pit is an ellipse, a capsule or a polygon, in
# map units; the map is symmetric both ways, so each is listed once with the mirrors it gets.
PIT_SHAPES = [
    # The middle pits: from the centre pillars out to the upright wall by each red camp; the lane between them
    # is as wide as before.
    ('poly', _mid_pit(), 'x'),
    # One long pit along each side of the outer wall (the old side and corner pits joined), ending just
    # outside each Walker's reach.
    ('poly', _side_pit(), 'x'),
    # A ring of pit around each pillar nearest a base.
    ('ellipse', P(311.5, 329.0), 430, 430, 'xy'),
]

# ---------------------------------------------------------------- camps and towers (bottom half)
# Camps (round 3, from the user's markup): moved back toward the walls. Map units; the bottom-left blue and
# bottom-right purple camps, and their 180-degree copies (top-right blue, top-left purple).
CAMPS = [('blue', (-2310.0, -1000.0)), ('purple', (2310.0, -1000.0))]
MID_CAMPS = [('red', (-1900.0, 45.0)), ('red', (1900.0, -45.0))]               # the red camps beside the side walls
TOWERS = [P(170, 387), P(330, 387)]    # T2 towers outside each base exit

# ---------------------------------------------------------------- minions
MINION_SPAWNS = {'left': P(163, 398), 'right': P(337, 398)}   # Sapphire's own left and right, behind the towers
MEET = P(250, 283)                     # where both routes meet, just below the centre
# A bend on the way to MEET, so minions keep clear of the small pits by the pillars nearest the base.
BENDS = {'left': (-900.0, -2600.0), 'right': (900.0, -2600.0)}   # round 3: further from the pillar pits
TARGET_PORTAL = rot(PORTAL)            # they walk to the enemy portal


# The bonus round's arena: a round platform alone in a pit of its own, far to the side of the main arena
# (as far as the map's size allows) and walled in so neither can be seen from the other. Amber stands on its +Y half, as in the main arena.
BONUS_C = (12500.0, 0.0)
BONUS_R = 700                          # the platform
BONUS_WALL_R = 2400                    # the wall around its pit
BONUS_GAP = 400                        # between the two teams' rows (about a Walker)
BONUS_SPAWN_STEP = 150                 # between heroes in a row
BONUS_TEAM_SIZE = 6

def bonus_spawns(team):
    """A team's row on its half of the platform, facing the other."""
    s = 1 if team == AMBER else -1
    y = BONUS_C[1] + s * (BONUS_GAP / 2 + 130)
    return [(BONUS_C[0] + (i - (BONUS_TEAM_SIZE - 1) / 2) * BONUS_SPAWN_STEP, y) for i in range(BONUS_TEAM_SIZE)]

def everything():
    """Every shape, with both halves, for drawing and building."""
    out = {}
    out['outline'] = [(RX * math.cos(2 * math.pi * i / OUTLINE_SEGS), RY * math.sin(2 * math.pi * i / OUTLINE_SEGS)) for i in range(OUTLINE_SEGS)]
    arcs = []
    for team, f in ((SAPPHIRE, lambda p: p), (AMBER, rot)):
        pts = []
        for i in range(25):
            a = math.radians(90 - ARC_HALF_DEG + 2 * ARC_HALF_DEG * i / 24)
            pts.append(f((ARC_C[0] + ARC_R * math.cos(a), ARC_C[1] + ARC_R * math.sin(a))))
        arcs.append((team, pts))
    out['base_arcs'] = arcs
    out['stubs'] = [s for s in STUBS] + [(rot(a), rot(b)) for a, b in STUBS]
    out['portals'] = [(SAPPHIRE, PORTAL), (AMBER, rot(PORTAL))]
    out['spawns'] = [(SAPPHIRE, SPAWN), (AMBER, rot(SPAWN))]
    out['shops'] = [(SAPPHIRE, SHOP), (AMBER, rot(SHOP))]
    out['pillars'] = PILLARS + [rot(p) for p in PILLARS]
    out['side_walls'] = SIDE_WALLS + [(rot(a), rot(b)) for a, b in SIDE_WALLS] + MID_WALLS
    out['pit_polys'], out['pits'] = pit_polygons()
    out['camps'] = CAMPS + [(k, rot(p)) for k, p in CAMPS] + MID_CAMPS
    out['towers'] = [(SAPPHIRE, p) for p in TOWERS] + [(AMBER, rot(p)) for p in TOWERS]
    routes = []
    for side, sp in MINION_SPAWNS.items():
        routes.append((SAPPHIRE, side, [sp, BENDS[side], MEET, TARGET_PORTAL]))
        # Amber's own left is the picture's right (they face down), so Amber's left is the rotated copy
        routes.append((AMBER, side, [rot(sp), rot(BENDS[side]), rot(MEET), PORTAL]))
    out['routes'] = routes
    return out


def _ellipse(c, rx, ry, n=28):
    return [(c[0] + rx * math.cos(math.pi / n + 2 * math.pi * i / n), c[1] + ry * math.sin(math.pi / n + 2 * math.pi * i / n)) for i in range(n)]


def _capsule(a, b, r, n=10):
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    pts = [(b[0] + r * math.cos(ang - math.pi / 2 + math.pi * i / n), b[1] + r * math.sin(ang - math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]
    pts += [(a[0] + r * math.cos(ang + math.pi / 2 + math.pi * i / n), a[1] + r * math.sin(ang + math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]
    return pts


def pit_polygons():
    """Every pit as a polygon (all mirrors), and a centre for each."""
    polys, centres = [], []
    for shape in PIT_SHAPES:
        kind, mirrors = shape[0], shape[-1]
        flips = [(1, 1), (-1, 1)] if mirrors == 'x' else [(1, 1), (-1, 1), (1, -1), (-1, -1)]
        for fx, fy in flips:
            f = lambda p: (p[0] * fx, p[1] * fy)
            if kind == 'poly':
                pts = [f(p) for p in shape[1]]
                polys.append(pts if fx * fy > 0 else list(reversed(pts)))
                centres.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
            elif kind == 'ellipse':
                _, c, rx, ry, _m = shape
                polys.append(_ellipse(f(c), rx, ry)); centres.append(f(c))
            else:
                _, a, b, r, _m = shape
                polys.append(_capsule(f(a), f(b), r)); centres.append(f(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)))
    return polys, centres
