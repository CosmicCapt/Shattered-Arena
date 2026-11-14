import re, struct, sys
from lz4dec import lz4_block
def resource_data(b):
    size, hv, ver, boff, bcount = struct.unpack_from('<IHHII', b, 0)
    p = 8 + boff
    for _ in range(bcount):
        t = b[p:p + 4]; off, sz = struct.unpack_from('<II', b, p + 4)
        if t == b'DATA': return b[p + 4 + off:p + 4 + off + sz]
        p += 12
def all_text(path):
    data = resource_data(open(path, 'rb').read())
    # find the first start that decodes a lot, then keep decoding the following buffers
    outs = []
    s = None
    for st in range(24, 260):
        out, i, why = lz4_block(data, st)
        if len(out) > 2000: s = st; break
    while s is not None and s < len(data):
        out, i, why = lz4_block(data, s)
        if len(out) < 64: break
        outs.append(bytes(out))
        # the next buffer: try a few starts right after where this one stopped
        nxt = None
        for st in range(i - 4, i + 64):
            o2, i2, w2 = lz4_block(data, st)
            if len(o2) > 256 and st != s: nxt = st; break
        s = nxt
    return b'\n'.join(outs)
if __name__ == '__main__':
    t = all_text(sys.argv[1])
    open(sys.argv[2], 'wb').write(t)
    print(len(t))
