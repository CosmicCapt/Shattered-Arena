"""Minimal reader/writer for binary DMX version 9 (Source 2 .vmap), reverse-engineered
from a Hammer-saved sample. Round-trips byte for byte when verify() passes."""
import struct, uuid

ARR = 32
SCALAR = {2: '<i', 3: '<f', 7: '<i', 15: '<Q'}
VECN = {9: 2, 10: 3, 11: 4, 12: 3, 13: 4, 14: 16}


class Elem:
    def __init__(self, type, name, guid=None):
        self.type, self.name = type, name
        self.guid = guid or uuid.uuid4().bytes
        self.attrs = []  # list of [name, typeid, value]

    def get(self, n):
        for a in self.attrs:
            if a[0] == n:
                return a[2]
        raise KeyError(n)

    def set(self, n, t, v):
        for a in self.attrs:
            if a[0] == n:
                a[1], a[2] = t, v
                return
        self.attrs.append([n, t, v])

    def __repr__(self):
        return f'<{self.type} {self.name!r}>'


class Reader:
    def __init__(self, data):
        self.d, self.p = data, 0

    def i32(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]; self.p += 4; return v

    def u8(self):
        v = self.d[self.p]; self.p += 1; return v

    def cstr(self):
        e = self.d.index(b'\x00', self.p); s = self.d[self.p:e].decode('utf-8'); self.p = e + 1; return s

    def raw(self, n):
        v = self.d[self.p:self.p + n]; self.p += n; return v


def read_value(r, t, strs, inline):
    if t == 1:
        return ('ref', r.i32())
    if t in SCALAR:
        f = SCALAR[t]; v = struct.unpack_from(f, r.d, r.p)[0]; r.p += struct.calcsize(f); return v
    if t == 4 or t == 16:
        return r.u8()
    if t == 5:
        return r.cstr() if inline else strs[r.i32()]
    if t == 6:
        n = r.i32(); return r.raw(n)
    if t == 8:
        return tuple(r.raw(4))
    if t in VECN:
        n = VECN[t]; v = struct.unpack_from('<%df' % n, r.d, r.p); r.p += 4 * n; return v
    if t > ARR:
        n = r.i32()
        bt = t - ARR
        return [read_value(r, bt, strs, True if bt == 5 else inline) for _ in range(n)]
    raise ValueError('unknown type %d at %d' % (t, r.p))


def load(path):
    d = open(path, 'rb').read()
    r = Reader(d)
    header = r.cstr()  # header line incl. newline, terminated by \0
    # prefix elements (inline strings)
    prefix = []
    for _ in range(r.i32()):
        attrs = []
        for _ in range(r.i32()):
            n = r.cstr(); t = r.u8(); attrs.append([n, t, read_value(r, t, None, True)])
        prefix.append(attrs)
    strs = [r.cstr() for _ in range(r.i32())]
    elems = []
    for _ in range(r.i32()):
        t = strs[r.i32()]; n = strs[r.i32()]; g = r.raw(16)
        elems.append(Elem(t, n, g))
    for e in elems:
        for _ in range(r.i32()):
            n = strs[r.i32()]; t = r.u8(); e.attrs.append([n, t, read_value(r, t, strs, False)])
    assert r.p == len(d), (r.p, len(d))
    # resolve refs
    def res(v):
        if isinstance(v, tuple) and len(v) == 2 and v[0] == 'ref':
            return None if v[1] < 0 else elems[v[1]]
        if isinstance(v, list):
            return [res(x) for x in v]
        return v
    for e in elems:
        for a in e.attrs:
            if a[1] == 1 or a[1] == 1 + ARR:
                a[2] = res(a[2])
    return header, prefix, strs, elems


def collect(root):
    """Elements reachable from root, depth-first in attribute order (Hammer's order)."""
    out, seen = [], set()
    def walk(e):
        if e is None or id(e) in seen:
            return
        seen.add(id(e)); out.append(e)
        for a in e.attrs:
            if a[1] == 1:
                walk(a[2])
            elif a[1] == 1 + ARR:
                for x in a[2]:
                    walk(x)
    walk(root)
    return out


def write_value(o, t, v, sidx, eidx, inline):
    if t == 1:
        o += struct.pack('<i', -1 if v is None else eidx[id(v)]); return
    if t in SCALAR:
        o += struct.pack(SCALAR[t], v); return
    if t == 4 or t == 16:
        o.append(v); return
    if t == 5:
        if inline:
            o += v.encode() + b'\x00'
        else:
            o += struct.pack('<i', sidx[v])
        return
    if t == 6:
        o += struct.pack('<i', len(v)) + v; return
    if t == 8:
        o += bytes(v); return
    if t in VECN:
        o += struct.pack('<%df' % VECN[t], *v); return
    if t > ARR:
        o += struct.pack('<i', len(v)); bt = t - ARR
        for x in v:
            write_value(o, bt, x, sidx, eidx, True if bt == 5 else inline)
        return
    raise ValueError(t)


def save(path, header, prefix, elems, strs_order=None):
    # string table: element types/names, attr names, string values (non-array)
    strs, sidx = [], {}
    def add(s):
        if s not in sidx:
            sidx[s] = len(strs); strs.append(s)
    if strs_order:
        for s in strs_order:
            add(s)
    for e in elems:
        add(e.type); add(e.name)
        for n, t, v in e.attrs:
            add(n)
            if t == 5:
                add(v)
    eidx = {id(e): i for i, e in enumerate(elems)}
    o = bytearray(header.encode() + b'\x00')
    o += struct.pack('<i', len(prefix))
    for attrs in prefix:
        o += struct.pack('<i', len(attrs))
        for n, t, v in attrs:
            o += n.encode() + b'\x00'; o.append(t); write_value(o, t, v, None, None, True)
    o += struct.pack('<i', len(strs))
    for s in strs:
        o += s.encode() + b'\x00'
    o += struct.pack('<i', len(elems))
    for e in elems:
        o += struct.pack('<ii', sidx[e.type], sidx[e.name]) + e.guid
    for e in elems:
        o += struct.pack('<i', len(e.attrs))
        for n, t, v in e.attrs:
            o += struct.pack('<i', sidx[n]); o.append(t); write_value(o, t, v, sidx, eidx, False)
    open(path, 'wb').write(bytes(o))
    return bytes(o)
