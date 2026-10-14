# Nightfall Royale: build plan

A standalone browser demo: a Pokémon battle royale with PMD SpriteCollab
character sprites over hi-res painted terrain. TypeScript, Vite, one HTML
entry, Canvas 2D for the world and a hand-written WebGL post pass for the
lighting. No game framework.

## Layout

```
assets/pokemon/<dex>/     SpriteCollab folder (AnimData.xml, *-Anim/-Offsets/-Shadow.png, credits.txt)
assets/portraits/<dex>/   SpriteCollab portraits (Normal.png and the other emotions)
assets/rangers/           overworld walking sheets + manifest.json (per-character slicing)
assets/tiles/             painted 128 px tilesets + Tiled JSON maps (optional; procedural fallback)
assets/CREDITS.md         generated from every credits.txt
data/*.json               species, moves, items, types, spawns, config
src/core                  loop (fixed step + interpolation), input, rng, noise, math
src/sprites               AnimData parser, Offsets parser, sprite loader, animation player, ranger sheets, placeholders
src/ground                GroundRenderer interface, ProceduralGround, TiledGround, decor
src/render                view/camera, world drawing, WebGL lighting pass, VFX families, floating text
src/sim                   types chart, damage, entities, battle, AI, wild, items, catching, darkness, match
src/ui                    screens (title, roll, match, end) and the HUD
scripts/                  fetch-sprites.py, fetch-rangers.py
```

## Fixed decisions

- Internal render size follows the window (16:9 letterbox, device pixels
  capped at 2x). Ground scale is continuous (`view.scale`); character
  sprites use `round(3 * view.scale)`, never fractional, nearest filtering.
- Simulation at 60 Hz fixed steps; render interpolates between the last two
  states. Game time is the only clock the sim reads.
- 48x48 tile map, 128 px tiles. Ground is baked once per match into 8x8-tile
  chunk canvases (1024 px each) and drawn with smooth filtering.
- Everything drawn comes from `/assets`; a missing file becomes a labeled
  placeholder (magenta box with the asset name) and one console warning.
- All content in `/data` JSON: species (dex, types, stats, tier, moves,
  biome), moves (type, power, shape, cooldown, VFX family, anim), items,
  18-type chart, spawn tables, tunables.

## Milestones (one commit each)

1. Sprite loader (AnimData + Offsets + Shadow), ranger sheets, procedural
   ground with decor, fixed-step loop, player + follower line, camera.
2. Battle: engage, telegraphs, 5 VFX families, damage/type chart, status,
   hit-stop, shake, damage numbers, WebGL lighting with VFX light, HUD.
3. Items, inventory, catching (aim arc, wobble), AI trainers (roam, seek,
   engage, flee), Ranger outpost, elimination.
4. Darkness pulses, drowsy/sleep/Bad Dreams, aura, Darkrai finale.
5. Title, starter roll, win/loss screens, README.
