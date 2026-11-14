"""Mesh and entity builders for Hammer .vmap files, taken from Siege's build_siege_v2.py.
init(sample) loads a Hammer-saved .vmap whose first world child is a mesh; its mesh streams are
the template for every mesh made here."""
import copy, math, random
import dmx

ARR = dmx.ARR
MAT = 'materials/dev/dev_measuregeneric01b.vmat'
rng = random.Random(7)
tmpl_mesh = None
tmpl_stream = None
solids = []          # (points, faces, tint, label, material) of every mesh made, for pictures of the map

def init(sample_path):
    global tmpl_mesh, tmpl_stream, SAMPLE
    SAMPLE = dmx.load(sample_path)
    root = SAMPLE[3][0]
    tmpl_mesh = next(c for c in root.get('world').get('children') if c.type == 'CMapMesh')
    pm = tmpl_mesh.get('meshData')
    tmpl_stream = {s.name: s for arr in (pm.get('faceData'), pm.get('edgeData'), pm.get('faceVertexData'), pm.get('vertexData')) for s in arr.get('streams')}
    return SAMPLE

# ---------------------------------------------------------------- geometry
def norm(v):
    l = math.sqrt(sum(c * c for c in v)); return tuple(c / l for c in v)

def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a, b): return sum(x * y for x, y in zip(a, b))

def prism(poly, z0, z1):
    """poly: convex 2D polygon, counter-clockwise seen from above. Returns positions, faces."""
    n = len(poly)
    pos = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces = [list(range(n, 2 * n)),                 # top, CCW from above
             list(reversed(range(n)))]              # bottom, CCW from below
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])          # side, CCW from outside
    return pos, faces

def tex_axes(nrm):
    ax = max(range(3), key=lambda k: abs(nrm[k]))
    if ax == 2: return (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)
    if ax == 0: return (0.0, 1.0, 0.0), (0.0, 0.0, -1.0)
    return (1.0, 0.0, 0.0), (0.0, 0.0, -1.0)

# ---------------------------------------------------------------- elements
def clone_shallow(e, name=None):
    c = dmx.Elem(e.type, e.name if name is None else name)
    c.attrs = [[n, t, copy.deepcopy(v) if not isinstance(v, (dmx.Elem, list)) or t not in (1, 1 + ARR) else v] for n, t, v in e.attrs]
    return c


def stream(name, data):
    s = clone_shallow(tmpl_stream[name])
    s.set('subdivisionBinding', 1, None)
    s.set('data', s.attrs[[a[0] for a in s.attrs].index('data')][1], data)
    return s

def data_array(size, streams):
    a = dmx.Elem('CDmePolygonMeshDataArray', '')
    a.attrs = [['size', 2, size], ['streams', 1 + ARR, streams]]
    return a

node_counter = [10]
used_refs = set()

def new_ref():
    while True:
        r = rng.getrandbits(63)
        if r not in used_refs:
            used_refs.add(r); return r

def make_mesh(poly, z0, z1, tint=(255, 255, 255, 255), label='', mat=None, uv=128.0):
    """A convex 2D polygon stood up from z0 to z1. uv is how many units one repeat of the material covers."""
    pos, faces = prism(poly, z0, z1)
    return make_solid(pos, faces, tint, label, mat, uv)

def make_solid(points, faces, tint=(255, 255, 255, 255), label='', mat=None, uv=128.0):
    """Any closed convex solid: points in world units, faces as loops of point indices, counter-clockwise
    seen from outside."""
    cx, cy, cz = (sum(p[k] for p in points) / len(points) for k in range(3))
    pos = [(x - cx, y - cy, z - cz) for x, y, z in points]
    solids.append((list(points), faces, tint, label, mat))
    # half-edges, opposite pairs adjacent
    he_src, he_dst, he_face, he_next = [], [], [], []
    key = {}
    def he(a, b):
        if (a, b) not in key:
            k = len(he_src)
            for s, d in ((a, b), (b, a)):
                key[(s, d)] = len(he_src); he_src.append(s); he_dst.append(d); he_face.append(-1); he_next.append(-1)
        return key[(a, b)]
    face_he = []
    for f, loop in enumerate(faces):
        ids = [he(loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop))]
        for i, h in enumerate(ids):
            he_face[h] = f; he_next[h] = ids[(i + 1) % len(ids)]
        face_he.append(ids[0])
    nh = len(he_src)
    assert all(f >= 0 for f in he_face), 'mesh not closed: ' + label
    opp = [i ^ 1 for i in range(nh)]
    vert_edge = [he_src.index(v) for v in range(len(pos))]
    # face data
    fnorm, fu, fv = [], [], []
    for loop in faces:
        a, b, c = pos[loop[0]], pos[loop[1]], pos[loop[2]]
        n = norm(cross(sub(b, a), sub(c, a)))
        u, v = tex_axes(n)
        fnorm.append(n); fu.append(u); fv.append(v)
    nf = len(faces)
    # face-vertex data, one per half-edge (corner at the half-edge's destination)
    texc, nrm, tan = [], [], []
    for h in range(nh):
        f = he_face[h]; p = pos[he_dst[h]]; n = fnorm[f]; u, v = fu[f], fv[f]
        wp = (p[0] + cx, p[1] + cy, p[2] + cz)
        texc.append((dot(wp, u) / uv, dot(wp, v) / uv))
        nrm.append(n)
        w = -1.0 if dot(cross(n, u), v) < 0 else 1.0
        tan.append((u[0], u[1], u[2], w))
    md = dmx.Elem('CDmePolygonMesh', 'meshData')
    sd = dmx.Elem('CDmePolygonMeshSubdivisionData', '')
    sd.attrs = [['subdivisionLevels', 2 + ARR, [0] * nh], ['streams', 1 + ARR, []]]
    md.attrs = [
        ['vertexEdgeIndices', 2 + ARR, vert_edge],
        ['vertexDataIndices', 2 + ARR, list(range(len(pos)))],
        ['edgeVertexIndices', 2 + ARR, he_dst],
        ['edgeOppositeIndices', 2 + ARR, opp],
        ['edgeNextIndices', 2 + ARR, he_next],
        ['edgeFaceIndices', 2 + ARR, he_face],
        ['edgeDataIndices', 2 + ARR, [h // 2 for h in range(nh)]],
        ['edgeVertexDataIndices', 2 + ARR, list(range(nh))],
        ['faceEdgeIndices', 2 + ARR, face_he],
        ['faceDataIndices', 2 + ARR, list(range(nf))],
        ['materials', 5 + ARR, [mat or MAT]],
        ['vertexData', 1, data_array(len(pos), [stream('position:0', pos)])],
        ['faceVertexData', 1, data_array(nh, [stream('texcoord:0', texc), stream('normal:0', nrm), stream('tangent:0', tan)])],
        ['edgeData', 1, data_array(nh // 2, [stream('flags:0', [0] * (nh // 2))])],
        ['faceData', 1, data_array(nf, [
            stream('textureScale:0', [(0.25, 0.25)] * nf),
            stream('textureAxisU:0', [u + (0.0,) for u in fu]),
            stream('textureAxisV:0', [v + (0.0,) for v in fv]),
            stream('materialindex:0', [0] * nf),
            stream('flags:0', [0] * nf),
            stream('lightmapScaleBias:0', [0] * nf)])],
        ['subdivisionData', 1, sd],
    ]
    m = clone_shallow(tmpl_mesh)
    pin = clone_shallow(tmpl_mesh.get('transformPin'))
    node_counter[0] += 1
    m.set('nodeID', 2, node_counter[0])
    m.set('referenceID', 15, new_ref())
    m.set('children', 1 + ARR, [])
    m.set('meshData', 1, md)
    m.set('origin', 10, (cx, cy, cz))
    m.set('transformPin', 1, pin)
    m.set('randomSeed', 2, rng.getrandbits(31))
    m.set('tintColor', 8, tint)
    return m

