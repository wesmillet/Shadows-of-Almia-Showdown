# Nightfall Royale

A browser demo: a Pokémon battle royale with Pokémon Mystery Dungeon
(PMDCollab SpriteCollab) character sprites over hi-res painted terrain.
Single HTML entry, TypeScript, Vite, Canvas 2D for the world and a WebGL
lighting pass on top. Non-commercial fan project; every artist is listed in
`assets/CREDITS.md`.

```
npm install
npm run dev        # http://localhost:5173/
npm test           # Vitest unit tests for the simulation and the loaders
npm run build      # typecheck + production build into dist/ (assets copied)
```

## Playing

Title → **Roll Starter** → a vertical reel of four candidates spins and
stops. Click a card (or press 1-4), reroll up to three times (each reroll
removes the strongest tier from the pool), confirm. You spawn on the edge
of a 48x48 island with your starter behind you; two AI trainers spawn on
other edges. Last trainer standing wins.

| Input | Action |
| --- | --- |
| WASD / arrows | move, 8 directions, 4 tiles/s; the party follows in a line |
| walk into a wild Pokémon | start a fight (camera eases in 10%) |
| 1-4 while fighting, or click the move wheel | cast a move (0.3 s cast, telegraph on the ground, 1.5-6 s cooldowns) |
| 1-6 outside a fight, Shift+1-6 anytime, or click the bag | use an item (balls arm themselves) |
| hold Space, release | aim an arc toward the nearest wild Pokémon and throw the armed ball |
| click a portrait | swap the lead; fainted members leave the line |
| walk over an item | pick it up (bag of six; balls stack) |
| stand on a Ranger outpost pad | full party heal over 3 s; a beacon tells every trainer you are there |

Every 90 s the Shadow Crystal pulses and darkness sweeps inward from the
edges. In the dark a Pokémon grows drowsy after 4 s and falls asleep,
sleepers take Bad Dreams damage every second, wild Pokémon get a purple
aura and cannot be caught. Full Heal (or three seconds back in the light)
wakes them. When the last safe circle closes, Darkrai appears at the
crystal and hunts the remaining trainers with Dark Void rings and Dark
Pulse lines.

URL flags for testing: `?seed=<text>` fixes the island, `?party=0025,0387`
skips the title and roll with that party. `window.nightfall` exposes the
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
  rangers/                overworld walking sheets + manifest.json (per-character
                          slicing) + CREDITS.txt
  tiles/                  optional painted tileset + Tiled JSON map (see below)
  vfx/                    optional hand-made effect strips (see moves.json)
  CREDITS.md              generated: SpriteCollab license and per-folder artists
data/
  species.json            dex, name, types, base stats, starter tier, wild biome, kit
  moves.json              22 moves: type, power, shape, cooldown, VFX family, animation
  items.json              the ground items and what they do
  types.json              the 18-type chart and type colours
  spawns.json             wild spawn tables per biome, starter and trainer pools
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

`assets/rangers/manifest.json` slices each character's sheet because frame
sizes differ per sheet:

```json
"player": { "file": "player.png", "layout": "grid", "frameWidth": 20, "frameHeight": 38,
            "facings": ["down", "left", "right", "up"], "framesPerFacing": 3,
            "walkCycle": [0, 1, 2, 1], "idleFrame": 1, "footY": 36 }
```

`layout: "grid"` is one row per facing (the Pokémon Ranger: Shadows of
Almia 3-frame walk); `layout: "column"` stacks every frame in one column.
The roles are `player`, `trainer_a`, `trainer_b` (the two AI Top Rangers),
`ranger` (patrols), `grunt` (Team Dim Sun) and `host` (title screen). The
Almia sheets are not in any open repository, so `scripts/fetch-rangers.py`
fills the roles with Pokémon Platinum field sprites from the
pret/pokeplatinum decompilation as stand-ins (marked `standIn: true`); the
`grunt` role ships without a sheet and shows the labeled placeholder. Drop
the real sheets over the same file names and update the slicing entries.

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

### Hand-made move effects

Every move names one of five procedural VFX families (`burst`,
`projectile`, `beam`, `ring`, `cloud`) parameterised by its type colour and
`size`. Set `"strip": "ember.png"` on a move to play
`assets/vfx/ember.png` instead: a horizontal strip of square frames at
18 fps (`SpriteStripVisual` in `src/vfx/visuals.ts`).

## Architecture

```
src/core       fixed 60 Hz loop with render interpolation, input, seeded RNG, simplex noise
src/sprites    AnimData/Offsets parsers, sprite registry and animation player, ranger sheets, placeholders
src/ground     GroundRenderer, procedural painter, Tiled loader
src/render     view/camera (continuous ground scale, integer sprite scale), world drawing, WebGL lighting pass
src/sim        pure simulation: data accessors, battle (areas, damage, status), AI, catching, darkness, items, match
src/vfx        the five VFX families, sprite strips, lights, floating numbers
src/ui         title, starter roll, match screen (events → VFX/shake/hit-stop), HUD, results
scripts/       fetch-sprites.py (sparse checkout + credits), fetch-rangers.py (Platinum stand-ins)
```

The simulation never touches a canvas; the battle system emits events
(`cast`, `resolve`, `hit`, `status`, `faint`, `caught`, …) that the match
screen turns into effects, hit-stop, shake and floating numbers.

## Lighting

The world renders to an offscreen canvas and lights to a second one; the
WebGL pass (`src/render/lighting.ts`) applies a warm daylight tint that
shifts cold over the match, the darkness ring, additive lights (stronger
in the dark), a vignette and a depth-of-field blur over the top 20% of the
screen. Every sprite also gets a soft elliptical shadow plus its
SpriteCollab Shadow sheet. Without WebGL the same look is approximated in
Canvas 2D.
