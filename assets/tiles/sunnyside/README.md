# Sunnyside World tileset

Sunnyside World Asset Pack V2.1 by Daniel Diggle (danieldiggle.itch.io/sunnyside).
License: usable in free and commercial projects, may be modified, credit appreciated.
Not for repackaging or resale.

- `spr_tileset_sunnysideworld_16px.png`: main 16x16 tileset, 64 columns (1024x1024).
- `spr_tileset_sunnysideworld_forest_32px.png`: 32x32 forest canopy autotile, 10 columns (320 px wide).
- `sunnyside.json`: extracted from the pack's GameMaker project.
  - `tilesets.*.autotiles`: GameMaker 16-tile autotile sets by name (Land, Path 01-03,
    River, Clouds, Cloud Shadow, Building, Inner Walls, forest_01). Each lists 16 tile
    indices in GameMaker's 16-tile autotile order; a 0 entry means empty.
  - `tilesets.*.animations`: water and other animated tiles as frame index lists.
  - `demo_room`: the pack's example map, 86x48 tiles, all tile layers bottom to top
    with per-tile flip flags (bit0 mirror, bit1 flip, bit2 rotate) and the two sprite
    (decor) layers. `demo_room_render.png` is that map rebuilt from this JSON.
- `plants/`, `other/`, `animals/`, `vfx/`: decor and effect strips (`_stripN` = N frames
  side by side). `ui/`: bars, icons and a 9-slice box.

Tile index = row * 64 + column in the 16px sheet (10 columns for the forest sheet).
