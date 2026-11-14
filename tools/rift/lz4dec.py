def lz4_block(src, start=0, end=None, out=None, limit=1 << 26):
    """Decode LZ4 block data from src[start:end] into out (bytearray). Stops at end or on an error."""
    out = bytearray() if out is None else out
    i = start; end = len(src) if end is None else end
    try:
        while i < end and len(out) < limit:
            tok = src[i]; i += 1
            ln = tok >> 4
            if ln == 15:
                while True:
                    b = src[i]; i += 1; ln += b
                    if b != 255: break
            out += src[i:i + ln]; i += ln
            if i >= end: break
            off = src[i] | (src[i + 1] << 8); i += 2
            if off == 0 or off > len(out): return out, i, 'bad offset'
            ml = tok & 15
            if ml == 15:
                while True:
                    b = src[i]; i += 1; ml += b
                    if b != 255: break
            ml += 4
            p = len(out) - off
            for k in range(ml): out.append(out[p + k])
    except IndexError:
        return out, i, 'eof'
    return out, i, 'ok'
