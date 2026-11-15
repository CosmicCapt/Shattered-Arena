"""make_rift_vpcf.py: write scaled copies of the game's Unstable Rift look pieces as particle sources.
Reads the compiled koth_aura_*.vpcf_c pieces, multiplies their sizes by SCALE and writes .vpcf (KV3 text)
into tools/rift/src/, which tools/compile_rift.cmd compiles into content/particles/ (the mod's own addon,
played as particles/{addon}/rift_*.vpcf). Child effects are dropped: rift.ts plays every piece on its own,
and a compiled child path can't point into the addon, whose name holds a digest of its own content.

    python make_rift_vpcf.py <dir with koth_aura_*.vpcf_c> src

Get the game's pieces with: modlock vpk unpack <Deadlock>/game/citadel/pak01_dir.vpk <dir> particles/generic
(they are koth_aura_*.vpcf_c under particles/generic/)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kv3dump
from kv3q import Flagged

SCALE = 3.0
PIECES = {  # game piece -> our copy
    'koth_aura_portal_model': 'rift_portal_model',
    'koth_aura_rift_outline': 'rift_outline',
    'koth_aura_rift_outline_edge': 'rift_outline_edge',
    'koth_aura_rift_sparks': 'rift_sparks',
    'koth_aura_rift_dimension': 'rift_dimension',
    'koth_aura_rift_decal_edge': 'rift_decal_edge',
    'koth_aura_light': 'rift_light',
}
FLAGS = {1: 'resource', 2: 'resource_name', 8: 'panorama', 16: 'soundevent', 32: 'subclass'}
HEADER = '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:vpcf36:version{dd571be4-586e-4f41-8b2d-5bbc969e1c53} -->\n'

changes = []

def lit(obj, key, f=SCALE):
    """Scale a float input's literal (and random range) in place."""
    v = obj.get(key)
    if not isinstance(v, dict): return
    keys = ('m_flLiteralValue',) if v.get('m_nType') == 'PF_TYPE_LITERAL' else \
        ('m_flRandomMin', 'm_flRandomMax') if str(v.get('m_nType', '')).startswith('PF_TYPE_RANDOM') else ()
    for k in keys:
        if isinstance(v.get(k), float) and v[k] != 0.0:
            changes.append(f'{key}.{k} {v[k]} -> {v[k] * f}')
            v[k] *= f

def scale(r):
    if isinstance(r.get('m_flConstantRadius'), float):
        changes.append(f"m_flConstantRadius {r['m_flConstantRadius']} -> {r['m_flConstantRadius'] * SCALE}")
        r['m_flConstantRadius'] *= SCALE
    for op in r.get('m_Initializers', []):
        c = op.get('_class')
        if c == 'C_INIT_InitFloat' and op.get('m_nOutputField', 3) == 3:   # radius (model scale for models)
            lit(op, 'm_InputValue')
        elif c == 'C_INIT_RingWave':
            for k in ('m_flInitialRadius', 'm_flThickness', 'm_flInitialSpeedMin', 'm_flInitialSpeedMax'):
                lit(op, k)
        elif c == 'C_INIT_CreateWithinSphereTransform':
            for k in ('m_fRadiusMin', 'm_fRadiusMax', 'm_fSpeedMin', 'm_fSpeedMax'):
                lit(op, k)
    for op in r.get('m_Renderers', []):
        if op.get('_class') == 'C_OP_RenderProjected' and isinstance(op.get('m_flMaxProjectionDepth'), float):
            op['m_flMaxProjectionDepth'] *= SCALE
    if 'm_Children' in r:   # every piece is played on its own (rift.ts)
        changes.append(f"dropped {len(r['m_Children'])} child effect(s)")
        del r['m_Children']

def text(v, ind=0):
    pad = '\t' * ind
    if isinstance(v, bool): return 'true' if v else 'false'
    if v is None: return 'null'
    if isinstance(v, Flagged): return f'{FLAGS.get(v.flag, "resource")}:{json.dumps(str(v))}'
    if isinstance(v, str): return json.dumps(v)
    if isinstance(v, int): return str(v)
    if isinstance(v, float):
        s = repr(v)
        return s if ('.' in s or 'e' in s or 'inf' in s or 'nan' in s) else s + '.0'
    if isinstance(v, list):
        if not v: return '[  ]'
        if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
            return '[ ' + ', '.join(text(x) for x in v) + ' ]'
        return '\n' + pad + '[\n' + ''.join(pad + '\t' + text(x, ind + 1).lstrip('\n') + ',\n' for x in v) + pad + ']'
    if isinstance(v, dict):
        out = '\n' + pad + '{\n'
        for k, x in v.items():
            out += pad + '\t' + k + ' = ' + text(x, ind + 1) + '\n'
        return out + pad + '}'
    raise TypeError(type(v))

if __name__ == '__main__':
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    for game, ours in PIECES.items():
        r, st, _ = kv3dump.load(os.path.join(src_dir, game + '.vpcf_c'))
        changes.clear(); scale(r)
        open(os.path.join(out_dir, ours + '.vpcf'), 'w', newline='\r\n').write(HEADER + text(r).lstrip('\n') + '\n')
        print(ours, '|', '; '.join(changes) or 'no size changes')
