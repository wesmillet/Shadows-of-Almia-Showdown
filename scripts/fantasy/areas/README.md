# Areas: hand-made places, drawn in Tiled

The castle lives here as a Tiled map (`castle.tmx`). The island build stamps it in, so you can
open it in Tiled with the whole Fan-tasy tileset and change anything: walls, paving, trees,
props, where the healer stands. No code involved.

## Editing the castle

1. Install Tiled (free, https://www.mapeditor.org).
2. Put the map next to the pack's own samples so Tiled finds the tilesets:

       FANTASY_DIR=/path/to/fantasy python3 scripts/fantasy/areas.py install castle

   That copies `castle.tmx`, its pictures and the small `almia_meta` tileset into the pack's
   `Tiled/Tilemaps` and `Tiled/Tilesets` folders. (`FANTASY_DIR` is the folder with `Art/` and
   `Tiled/` in it.)
3. Open `Tiled/Tilemaps/Almia castle.tmx` in Tiled, edit, save.
4. Copy it back and rebuild:

       FANTASY_DIR=/path/to/fantasy python3 scripts/fantasy/areas.py fetch castle
       FANTASY_DIR=/path/to/fantasy python3 scripts/fantasy/build3.py

   then the usual polish/render steps (the island's rebuild script does them all).

To throw the edited castle away and start again from the generator:
`python3 scripts/fantasy/build3.py --export-castle` rewrites `castle.tmx`.

## What the layers mean

| Layer | What the build does with it |
| --- | --- |
| `… (preview)` | The island's own ground and paving, rewritten after every build so you can see them. Locked; edits are ignored. |
| `Castle Floor`, `Castle Walls`, `Fountains`, any other tile layer | Stamped over the island exactly as drawn, in this order. Add tile layers freely. |
| `Solid` | Paint the red tile wherever nobody may walk: walls, towers, the fountain's basin. Leave the gates open. |
| `Paving` (objects) | Rectangles and ellipses, class `Slab` or `Mid Slab`. The build paints them with the castle floor set and smooths the edges at pixel level, so corners come out rounded and an ellipse is a true oval (that is the battlefield's light oval). Draw paving here, not as tiles, to get the rounded look. |
| `Objects` (objects) | Trees, props, furniture: tile objects from any `Objects_…` tileset. Wide trees cast the island's round shadow automatically. |
| `Buildings` (group) | Each image layer is a baked picture (the keep, the gate towers) that stands on the map as a depth-sorted object. Its `foot` property (rows, default 3) is the part nobody walks through. A group of tile layers inside `Buildings` is baked the same way. |
| `Markers` (objects) | Points by name: `healer`, `challenger` (where those NPCs stand), `statue` with property `dex` (a stone Pokémon). A rectangle named `arena` is the battlefield's box. |

The map's top-left corner is island tile (`x0`, `y0`), stored as map properties. The battlefield
oval should keep its centre on the south gate's axis so the roads still meet it.
