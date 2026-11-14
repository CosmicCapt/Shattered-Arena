# Arena Pit tools

- `arena_shapes.py`: every shape of the map (outline, bases, portals, pillars, walls, pits, camps,
  towers, minion routes the mod walks), measured from the SMITE Arena picture. Change the layout here.
- `build_arena_v1.py`: builds `hl_arena_pit.vmap` and `layout.ts` (positions the mod uses) from it:
  `python build_arena_v1.py <sample.vmap> <out.vmap> <preview.png> <layout.ts>`. The sample is any
  Hammer-saved map with a mesh (Siege's `siege_map_v1.vmap` was used). **Don't run it over the master
  once the map has been edited in Hammer**: it rebuilds everything.
  The map's looks are at the top of it (`LOOKS`): which of Deadlock's materials each kind of piece gets, its
  tint, the texture size, the glow at the bottom of the pits and the sky. Hammer can't draw these materials: check in game.
- `meshkit.py`, `dmx.py`: the mesh builder and the `.vmap` reader/writer, from Siege.
- `compile_arena.cmd`: compiles `hl_arena_pit` with Modlock Tools and copies it to `maps\hl_arena_pit.vpk`
  in the project (what `modlock publish` uploads) and into Deadlock (for `modlock dev`).
- `arena_pit_v1_preview.png`: top view of the generated map.
- `compile_rift.cmd`: compiles the 3x Unstable Rift effects (`maps\hl_arena_pit\particles\rift_*.vpcf` in
  Modlock Tools' `arena_pit` addon) that the portals play. They sit in the map's own folder because
  `modlock publish` lets a map's `.vpk` hold only the map's own files.
- `rift\`: `make_rift_vpcf.py` writes those effect sources from the game's own Rift pieces (sizes x3);
  `vpkpack.py` packs the compiled effects into `maps\hl_arena_pit.vpk` so they ship with the map
  (`python vpkpack.py <in.vpk> <out.vpk> <addon game folder> maps/hl_arena_pit/particles/rift_*.vpcf_c`). The rest are
  readers for the game's files. **After any map recompile, pack the effects in again**, or no rifts show.
