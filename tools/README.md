# Arena Pit tools

## The map

- `arena_shapes.py`: every shape of the map (outline, bases, portals, pillars, walls, pits, camps,
  towers, minion routes the mod walks), measured from the SMITE Arena picture. Change the layout here.
- `build_arena_v1.py`: builds `hl_arena_pit.vmap` and `layout.ts` (positions the mod uses) from it:
  `python build_arena_v1.py <sample.vmap> <out.vmap> <preview.png> <layout.ts> [solids]`. The sample is any
  Hammer-saved map with a mesh. **Don't run it over the master once the map has been edited in Hammer**:
  it rebuilds everything. The map's looks are at the top of it (`LOOKS`): which of Deadlock's materials
  each kind of piece gets, its tint, the texture size, the glow at the bottom of the pits and the sky.
  Hammer can't draw these materials: check in game.
- `meshkit.py`, `dmx.py`: the mesh builder and the `.vmap` reader/writer.
- `render_view.py`: a flat-shaded view of the generated solids from any point, to approve shapes before a
  compile. `render_top.py`, `make_thumb.py`, `make_layout.py`: the top view, the Hyperline thumbnail and
  the labelled layout picture (the last two point at fonts on Linux; change `BOLD` and `MED` to run them here).
- `compile_arena.cmd`: compiles `hl_arena_pit` with Modlock Tools and copies it to `maps\hl_arena_pit.vpk`
  in the project (what `modlock publish` uploads) and into Deadlock (for `modlock dev`). Nothing needs
  packing into the map afterwards.

## The Rift effects

The portals play copies of the game's Unstable Rift pieces at 3x size (`rift.ts`). They ship in
`content\particles\` as the mod's own addon, which every player's game mounts, and the mod plays them as
`particles/{addon}/rift_*.vpcf`.

- `rift\src\rift_*.vpcf`: the effect sources (KV3 text). Edit these to change the look.
- `compile_rift.cmd`: compiles the sources with Modlock Tools (through the `arena_pit` addon) and copies the
  compiled `.vpcf_c` files into `content\particles\`. Run it after changing a source, then fully restart
  `modlock dev`.
- `rift\make_rift_vpcf.py`: writes the sources from the game's own `koth_aura_*.vpcf_c` pieces with every
  size multiplied by `SCALE` and child effects dropped (each piece is played on its own). Get the game's
  pieces with `modlock vpk unpack <Deadlock>\game\citadel\pak01_dir.vpk <dir> particles/generic`.
  `kv3dump.py`, `kv3q.py`, `kv3strings.py` and `lz4dec.py` are its reader for compiled KV3 files
  (`modlock kv3 FILE` prints one as JSON for reading by eye).
