"""vpkpack.py: rewrite a single-file VPK v2 (a compiled map) with extra files added or replaced.
Usage: python3 vpkpack.py <in.vpk> <out.vpk> <root> [files relative to root ...]"""
import hashlib, struct, sys, zlib, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vpk

def read_all(path):
    idx, d = vpk.read_index(path)
    sig, ver, tree, data, amd5, omd5, ssz = struct.unpack_from('<7I', d, 0)
    base = 28 + tree
    files = {}
    for name, (arc, off, ln, pre, _h) in idx.items():
        assert arc == 0x7fff, name
        files[name] = pre + d[base + off: base + off + ln]
    tail_sig = d[base + data + amd5 + omd5:]
    return files, tail_sig

def write(path, files, tail_sig):
    by_ext = {}
    for name in sorted(files):
        dirn, base = os.path.split(name)
        stem, ext = base.rsplit('.', 1)
        by_ext.setdefault(ext, {}).setdefault(dirn or ' ', []).append((stem, name))
    tree = bytearray(); data = bytearray()
    for ext in sorted(by_ext):
        tree += ext.encode() + b'\0'
        for dirn in sorted(by_ext[ext]):
            tree += dirn.encode() + b'\0'
            for stem, name in by_ext[ext][dirn]:
                b = files[name]
                tree += stem.encode() + b'\0'
                tree += struct.pack('<IHHIIH', zlib.crc32(b) & 0xffffffff, 0, 0x7fff, len(data), len(b), 0xffff)
                data += b
            tree += b'\0'
        tree += b'\0'
    tree += b'\0'
    amd5 = bytearray()
    for start in range(0, len(data), 0x100000):
        chunk = data[start:start + 0x100000]
        amd5 += struct.pack('<III', 0x7fff, start, len(chunk)) + hashlib.md5(chunk).digest()
    head = struct.pack('<7I', 0x55aa1234, 2, len(tree), len(data), len(amd5), 48, len(tail_sig))
    body = head + bytes(tree) + bytes(data) + bytes(amd5)
    omd5 = hashlib.md5(bytes(tree)).digest() + hashlib.md5(bytes(amd5)).digest()
    omd5 += hashlib.md5(body + omd5).digest()
    open(path, 'wb').write(body + omd5 + tail_sig)

if __name__ == '__main__':
    src, dst, root = sys.argv[1:4]
    files, tail = read_all(src)
    for rel in sys.argv[4:]:
        files[rel.replace('\\', '/')] = open(os.path.join(root, rel), 'rb').read()
    write(dst, files, tail)
    print(len(files), 'files ->', dst)
