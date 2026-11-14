import struct, sys
def read_index(path):
    d = open(path, 'rb').read()
    sig, ver, tree = struct.unpack_from('<III', d, 0)
    assert sig == 0x55aa1234, hex(sig)
    hdr = 12 if ver == 1 else 28
    p = hdr; end = hdr + tree; out = {}
    def cstr():
        nonlocal p
        e = d.index(b'\0', p); s = d[p:e].decode('utf-8', 'replace'); p = e + 1; return s
    while p < end:
        ext = cstr()
        if not ext: break
        while True:
            path_ = cstr()
            if not path_: break
            while True:
                name = cstr()
                if not name: break
                crc, pre, arc, off, ln, term = struct.unpack_from('<IHHIIH', d, p); p += 18
                preload = d[p:p + pre]; p += pre
                full = (path_.strip() + '/' if path_.strip() not in ('', ' ') else '') + name + '.' + ext
                out[full] = (arc, off, ln, preload, hdr + tree)
    return out, d
