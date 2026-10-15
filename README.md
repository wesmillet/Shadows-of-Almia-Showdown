# Shadows of Almia Showdown

A browser demo: a Pokémon battle royale with Pokémon Mystery Dungeon
(PMDCollab SpriteCollab) Pokémon sprites and Pokémon Ranger: Shadows of
Almia overworld NPCs on a hand-planned island built from The Fan-tasy Tileset. Single HTML entry,
TypeScript, Vite, Canvas 2D for the world and a WebGL lighting pass on top.
Non-commercial fan project; see `CREDITS.md` (sources) and
`assets/CREDITS.md` (generated per-sprite SpriteCollab credits).

```
npm install
npm run dev        # http://localhost:5173/
npm test           # Vitest unit tests for the simulation and the loaders
npm run build      # typecheck + production build into dist/ (assets copied)
```

Every push to `main` runs `.github/workflows/deploy.yml`, which installs,
tests, builds and publishes `dist/` to GitHub Pages at
https://wesmillet.github.io/Shadows-of-Almia-Showdown/ (one-time setting:
Settings → Pages → Source: "GitHub Actions"). Production builds use that
repository path as the Vite base; the dev server stays at `/`.

## Playing

Title → **Roll Starter** → a vertical reel of four candidates spins and
stops. Click a card (or press 1-4), reroll up to three times (each reroll
removes the strongest tier from the pool), confirm. You start at a town on
the 320x224 island with seven rival trainers spread round the coast. Last
trainer standing wins.

The island: a castle at the centre (a walled courtyard with the palace, the
Shadow Crystal and a battlefield where the Castle Champion takes on
challengers), and four lands round it, each with its own wild Pokémon and a
town with a healer and three market stalls: Frostmere in the snowfields,
Emberwood in the autumn wood, Sunreach in the desert, Greenhollow in the
forest. Pokémon are drawn at their Pokédex size next to the trainers and
evolve at their canonical levels.

| Input | Action |
| --- | --- |
| title screen: Demo Team button, D, or `?demo=1` | skip the roll and start with a level 100 team: Infernape, shiny Rayquaza, Latios, shiny Jirachi, Tinkaton (party cap 5) |
| WASD / arrows | move, 8 directions, 4 tiles/s; the party steers around you in formation |
| 1-4, or click the move wheel | the lead casts a move where you face (0.3 s cast, telegraph on the ground, 1.5-6 s cooldowns) |
| Shift+1-6, or click the bag | use an item; a ball's key arms it, and the armed ball's key again cycles to the next ball type |
| Tab, or click the tabs above the bag | switch between the Bag and the Held & TMs tab |
| Shift+1-6 on the Held & TMs tab | give the lead a held item, or teach it a TM (pick the move to replace with 1-4, Esc to keep them) |
| hold Space, release | aim an arc toward the nearest wild Pokémon and throw the armed ball |
| E beside a vendor | open the stall: 1-9 buys, E or Esc leaves (Poké Dollars come from knockouts) |
| E beside the Castle Champion | challenge him (a friendly bout; beat his team for ₽3000 and prizes) |
| click a portrait | swap the lead; click a behaviour chip to cycle Aggressive / Guard / Passive / Hold / Roam |
| walk over an item ball | open it: a popup reveals the contents. Poké Ball = common, Great Ball = uncommon, Ultra Ball = rare; a Premier Ball holds an eliminated trainer's bag, the Master Ball appears by the crystal when the final darkness begins, Darkrai leaves a Cherish Ball (a Dark-type held item and a full party heal) |
| Shift+number on a Crystal Shard | clears the darkness in a 5-tile circle around you for 10 s |
| stand on a Ranger outpost pad | full party heal over 3 s; a beacon tells every trainer you are there |

Every 90 s the Shadow Crystal pulses and darkness sweeps inward from the
edges. In the dark a Pokémon grows drowsy after 4 s and falls asleep,
sleepers take Bad Dreams damage every second, wild Pokémon get a purple
aura and cannot be caught. Full Heal (or three seconds back in the light)
wakes them. When the last safe circle closes, Darkrai appears at the
crystal and hunts the remaining trainers with Dark Void rings and Dark
Pulse lines.

URL flags for testing: `?seed=<text>` fixes the island, `?party=0025,0387`
skips the title and roll with that party. `window.showdown` exposes the
live match in the console.

## Asset layout

Nothing appears in the game without an image under `assets/`. A missing
or broken file is drawn as a magenta box labeled with the asset name and
logged once as a console warning; the game never crashes on it.

```
assets/
  pokemon/<dex>/          SpriteCollab folder: AnimData.xml, credits.txt,
                          <Action>-Anim.png, -Shadow.png, -Offsets.png
  portraits/<dex>/        SpriteCollab portraits (Normal.png and the other
                          emotions) for the HUD
  rangers/                Shadows of Almia overworld NPC sheets (civ_00-12,
                          union_00-09) + manifest.json + README.md
  tiles/                  optional painted tileset + Tiled JSON map (see below)
  fx/guardian_signs/      256 Guardian Signs attack effects + manifest.json + contact_sheet.png (move VFX)
  items/                  Gen 4 bag icons, TM discs, balls/ (every ball sprite and the Crystal Shard vial)
  CREDITS.md              generated: SpriteCollab license and per-folder artists
data/
  species.json            dex, name, types, base stats, starter tier, wild biome, kit
  moves.json              38 moves: type, power, shape, cooldown, Guardian Signs fx parts, fallback VFX family
  items/items.json        balls, medicine, X items, held items and what they do
  items/tms.json          the 16 TMs and the move each one teaches
  items/loot.json         the three rarity tiers and what each item ball can contain
  types.json              the 18-type chart and type colours
  spawns.json             wild spawn tables per biome, starter and trainer pools
  characters.json         which manifest character plays each role (player, AI trainers, host, staff, grunt)
  config.json             every tunable (speeds, darkness schedule, catch, outposts…)
```

### Pokémon sprites

`assets/pokemon/<dex>/` is a SpriteCollab sprite folder copied as-is.
The loader (`src/sprites/animData.ts`, `src/sprites/pokemonSprite.ts`)
parses `AnimData.xml` for every `<Anim>`: `FrameWidth`, `FrameHeight`,
the per-frame `<Duration>` list in 60 fps ticks, `RushFrame`, `HitFrame`
and `ReturnFrame` (also accepted as `ReturnPoint`), and `<CopyOf>`
aliases. Sheets are 8 rows (down, down-right, right, up-right, up,
up-left, left, down-left) by N frame columns. The `-Shadow.png` sheet is
baked into the drop shadow (red/green/blue rings selected by
`ShadowSize`), and the `-Offsets.png` sheet (black head, red left hand,
green right hand, blue centre) anchors projectiles and beams to the
attacker's hands. Idle, Walk, Attack, Hurt, Sleep, Charge, Shoot and
Faint load up front; anything else in the XML loads on first use. If an
action has no sheet the next one in its fallback chain plays (Sleep →
Idle, Charge → Shoot → Attack → Idle, …) with one warning.

Character sprites always draw at an integer multiple of 3x with
nearest-neighbour filtering; the ground scales freely with the window.

### Adding a Pokémon

1. Fetch its folder and portraits with a sparse checkout (never clone the
   whole SpriteCollab repo):
   ```
   python3 scripts/fetch-sprites.py 0448            # one or more dex numbers
   python3 scripts/fetch-sprites.py 0384:shiny      # the shiny set, stored as assets/pokemon/0384-shiny
   python3 scripts/fetch-sprites.py --list scripts/species-list.txt
   ```
   This writes `assets/pokemon/0448/` and `assets/portraits/0448/` and
   regenerates `assets/CREDITS.md`. (Dropping a folder copied by hand into
   `assets/pokemon/<dex>/` works the same; run
   `python3 scripts/fetch-sprites.py --credits` afterwards.)
2. Add an entry to `data/species.json` with its types, base stats, starter
   `tier`, optional wild `biome` (meadow, forest, shore, water) and a kit of
   four move ids from `data/moves.json`.
3. Put the dex number in a spawn table or pool in `data/spawns.json`.

No code changes: the registry preloads every species listed in
`species.json`.

### Trainers and NPCs

The humans are generic overworld NPCs from Pokémon Ranger 2: Shadows of
Almia (ripped by Lemon for The Spriters Resource), one packed PNG per
character under `assets/rangers/`. `assets/rangers/manifest.json` gives
each character's cell size (`frame_w`, `frame_h`, 20-26 by 32-36 px) and
the shared 15-frame table: `idle_down` (0), `idle_left` (1), `idle_up`
(2), `walk_left` (3-8, a six-frame cycle), `walk_down` (9-11), `walk_up`
(12-14); right-facing poses are the left ones mirrored (`mirror`). Sprites
are anchored bottom-centre and drawn at the same integer 3x as the Pokémon.

`data/characters.json` says who plays which role:

| role | character | used for |
| --- | --- | --- |
| `player` | `union_00` | you |
| `trainer_a`, `trainer_b` | `union_06`, `union_08` | the AI trainers Rook and Marlo |
| `host` | `union_05` | the Ranger Union host on the title screen |
| `staff_a`, `staff_b` | `civ_06`, `civ_09` | the staff patrolling the two outposts |
| `grunt` | `dimsun_grunt` | Team Dim Sun; no sheet yet, so it is the labeled placeholder |

To recast a role, change its `character` to any key in the manifest. To
add a sheet, pack its 15 frames left to right in the same order, add an
entry to the manifest with its cell size, and point a role at it.

### Swapping in a painted tileset

The ground is a `GroundRenderer` (`src/ground/types.ts`): `biomeAt`,
`walkable`, `reachable`, `minimapColor`, `decor` and `drawGround`. Two
implementations exist:

- `ProceduralGround` (default): simplex-noise biomes blended with soft
  gradients, baked once per match into padded 8x8-tile chunks with
  brush-stroke detail, grain and scattered trees and rocks. The HUD labels
  it as a stand-in.
- `TiledGround`: a Tiled JSON map with embedded tilesets whose images sit
  under `assets/tiles/`.

To use painted art (for example the Daniel Thomas hand-painted Grassland
and Mine packs, 128x128 tiles): export the map from Tiled as JSON with the
tilesets **embedded** to `assets/tiles/map.json`, keep the tileset PNGs
next to it, set `map.tileSize` in `data/config.json` to the tile size, and
give tiles gameplay properties in Tiled: `biome` (string: meadow, forest,
shore or water; also allowed as a layer property) and `solid` (bool), or
name a layer `collision`. Water is solid. Layers draw in order with smooth
filtering. Nothing else changes: the match, minimap, spawns and darkness
read the interface only. If `map.json` is absent the procedural ground is
used with a console warning.

### Move effects

Every move lists Guardian Signs effects in `data/moves.json` under `fx`:
`{ "id": "fx_040", "anchor": "attacker", "mode": "stream" }` and so on, in
playback order. `anchor` is `target` (at each Pokémon hit, or the aimed
tile), `attacker` (centred on the user) or `projectile` (flies user to
target rotated to its travel direction; the target parts listed after it
play on arrival). `mode` is `beam` (the strip tiled from user to target),
`stream` (stretched) or `status` (loops above the head). `fps` defaults to
15, `scale` to 3 pixels per source pixel, `tint` is optional. Each effect
lights the scene with its sheet's dominant colour. The capture sequence
uses 176 (flash on impact), 144 (the "sucked in" swirl), 014 (click
sparkle) and 066 (burst); Darkrai's Bad Dreams loop 158 on sleepers.
`src/vfx/fxLibrary.ts` loads the sheets from `manifest.json`; a move with
no `fx`, or whose sheet is missing, falls back to the procedural family in
`vfx` (`src/vfx/visuals.ts`).

### Balls

All fifteen balls use `assets/items/balls/` in the bag, on the ground and
in flight; the open frame (top half lifted, white flash) and the ±20°
wobble are built in code. Catch modifiers: Poké ×1, Great ×1.5, Ultra ×2,
Master always, Net ×3 on Bug/Water, Dive ×3.5 on a target standing in
water, Nest better on low levels, Repeat ×3 on species already in the
party, Timer up to ×4 as the match goes on, Dusk ×3 inside the darkness,
Heal fully heals its catch, Quick ×5 in the first 90 s, Luxury, Premier
and Cherish ×1 (`ballModifier` in `src/sim/catching.ts`).

## Architecture

```
src/core       fixed 60 Hz loop with render interpolation, input, seeded RNG, simplex noise
src/sprites    AnimData/Offsets parsers, sprite registry and animation player, Almia NPC sheets, placeholders
src/ground     GroundRenderer, procedural painter, Tiled loader
src/render     view/camera (continuous ground scale, integer sprite scale), world drawing, WebGL lighting pass
src/sim        pure simulation: data accessors, battle (areas, damage, status), AI, catching, darkness, items, match
src/vfx        Guardian Signs effect sheets (fxLibrary, fxVisuals), the procedural fallback families, lights, floating numbers
src/ui         title, starter roll, match screen (events → VFX/hit-stop), HUD, results
scripts/       fetch-sprites.py (sparse checkout + credits)
```

The simulation never touches a canvas; the battle system emits events
(`cast`, `resolve`, `hit`, `status`, `faint`, `caught`, …) that the match
screen turns into effects, hit-stop and floating numbers.

## Lighting

The world renders to an offscreen canvas and lights to a second one; the
WebGL pass (`src/render/lighting.ts`) applies a warm daylight tint that
shifts cold over the match, the darkness ring, additive lights (stronger
in the dark), a vignette and a depth-of-field blur over the top 20% of the
screen. Every sprite also gets a soft elliptical shadow plus its
SpriteCollab Shadow sheet. Without WebGL the same look is approximated in
Canvas 2D.

## The map

The match plays on an authored map, `assets/maps/almia.json`
(preview: `assets/maps/almia_preview.png`), built by `scripts/mapgen/build.py`
(`python3 scripts/mapgen/build.py`, needs numpy, scipy and Pillow).

Almia is a terraced island that opens to the south: two highland corners, the
summit with its lake, a terrace, and the lowlands, separated by cliff bands
that always run coast to coast. Two rivers cascade over every band. The Shadow
Crystal stands on the summit's prow at the map centre, above the grand stair,
which is where the darkness closes. Around it: the Crystal Shrine, Lakeside
(a stilt house on the lake, a pier into the north cove), the Old Stone Mill,
the Spring outpost, the Hollow Graveyard, the Quarry, the Windmill Fields, the
terrace orchards, Westbrook Village, Almia Town with its market square and
ranch, and Fisher's Cove on the beach.

How it is built:

- `designer2.py` lays out the terrain as labels (sea, grass, sand, cliff face,
  river) using only shapes the Sunnyside artist draws: two-row cliff bands,
  straight or at 45 degrees inland, one row per two columns on the coast;
  one-water rivers in straight runs; beaches under the cliffs.
- `almia.py` places the roads, ladders, bridges, piers, caves and every
  district. Buildings are cut whole from the pack's demo room (`bspecs.py`,
  `lib.py`); everything else is a whole stamp from the sheet or one of the
  pack's sprites (trees, animals, boats, windmills, crops). Nothing is cropped.
- `resolve.py` picks every tile by example from the demo room: each cell's
  neighbourhood is matched against what the artist drew there, then a repair
  pass keeps only tile pairs the artist actually used next to each other.
- `export.py` writes the map file: tile layers (index plus GameMaker flip
  flags), buildings and stamps as objects, sprites, and walkability,
  reachability, biome and minimap grids.

`src/ground/staticGround.ts` renders that file (animated water and foam are
baked per animation state, objects are depth-sorted with the characters); if
it is missing the old island generator in `src/ground/sunnysideGround.ts` is
used instead.
