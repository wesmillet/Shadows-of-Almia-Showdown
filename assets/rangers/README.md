# Ranger / NPC sprites

Generic NPC overworld sprites from Pokémon Ranger 2: Shadows of Almia, ripped by Lemon
for The Spriters Resource ("NPCs (Set 1)" and "Ranger Union NPCs"). Sliced into one
packed PNG per character; the orange key colour was made transparent.

- `civ_00` to `civ_12`: Almia civilians
- `union_00` to `union_09`: Ranger Union staff
- `manifest.json`: per-character frame size and the shared animation table

Frame order in every sheet (15 frames, left to right, sprite anchored bottom-center):

| index | animation |
|---|---|
| 0 | idle_down |
| 1 | idle_left |
| 2 | idle_up |
| 3-8 | walk_left (6-frame run cycle) |
| 9-11 | walk_down |
| 12-14 | walk_up |

Right-facing frames are mirrored from the left-facing ones. No named Ranger characters are used.
- `civ_13`: a nurse, recoloured from civ_03 (pink hair, white apron) for the healers
