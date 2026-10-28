# Change report: 28 October 2026

Corrections to the 27 October work. Commits: `b2af2afe` on `online`, ported to `main` as `affa070e`,
merged back as `3c8f34e8`. CI passed on `online` (run 40633508259) and the GitHub Pages deploy of
`main` succeeded (run 40633499055). **The live online server was not redeployed** (see Unresolved).

## What was there before (inspected first)

- Starters and pseudo-legendaries were spread over three mechanisms: some were permanent table
  residents (Treecko, Turtwig, Frigibax, Larvitar at weight 1.2), most sat in rotation pools
  (drawn into 15-42% of matches), Charmander and Larvitar were also guaranteed by `megaLines`, and
  Oshawott had no wild route at all. Measured over 400 seeds: starters 0 to 1.00 per match,
  pseudo-legendaries 0.14 to 1.68.
- `megaLines` guaranteed one Charmander, Gastly, Snorunt, Riolu, Ralts, Larvitar and Absol every
  match. Gastly, Snorunt and Riolu had no other wild route; Steelix (Mega Steelix) had only the
  stronger encounter.
- Tirtouga, Carracosta, Dwebble and Crustle were in neither the species data nor the sprites; the
  27 October report said so, the encounter document did not.
- Stronger encounters were created without a shiny roll (`makeMon` with no shiny argument).
- `wild.shinyChance` was 0.002 with a hard-coded x4 for Alphas.
- Celeste's pool excluded legendary and Mythical species by `species.json` `class`, but the prize was
  then evolved with `formAtLevel` and only checked for shiny colours afterwards.

## Changes

### Starters and pseudo-legendaries (`spawns.json` `rare`)

All 27 main-series starters and the ten pseudo-legendary families left every land table and
rotation pool. A new rule places each of them in a match with a fixed probability: **starters 25%,
pseudo-legendaries 20%** (one Pokémon, `perMatch` in `spawns.json`), at a random ordinary spot of
its land, replacing that spot's table roll. Because the placement is per species and not a weight
inside a table, land size, table make-up and rotation no longer change availability. Levels are the
land's base + 3/+2, then the usual climb toward the crystal, so the outside-to-centre progression is
kept. Lands: grass starters and Goomy in the forest; fire starters, Deino and Dreepy in the red wood;
water starters (Oshawott included), Dratini, Beldum and Frigibax in the snow; Mudkip, Larvitar,
Bagon, Gible and Jangmo-o in the desert, as before.

### Mega guarantees removed

`megaLines` is gone. Riolu (forest, weight 1.5), Gastly (red wood, 1.5) and Snorunt (snow, 1.5) are
ordinary table residents; Ralts and Absol already were; Charmander and Larvitar follow the rare rule.
**Onix** was added on the desert rocks (evolves into Steelix at Lv 40) so Mega Steelix has an
ordinary route besides the stronger encounter. Latios (Mega Latios) stays portal-only as a legend.

### Tirtouga/Carracosta and Dwebble/Crustle

- Species data (stats, types, heights, evolutions at Lv 37 and 34), kits and learnsets, measured
  sprite bodies, shiny colours.
- Dwebble and Onix: SpriteCollab art. **Tirtouga, Carracosta and Crustle have no SpriteCollab
  overworld sprites** (checked against SpriteCollab on 28 October; only portraits exist). New
  `scripts/standin-sprites.py` builds stand-in sheets in the same format from the Gen V animated
  battle sprites (PokeAPI sprites repository): front view for down/left directions, back view for
  up, mirrored for the rest; Idle, Walk, Attack, Hurt and Sleep; shiny colours from the shiny
  battle sprites; SpriteCollab portraits. Folders carry a `STANDIN` file and are credited in
  `assets/CREDITS.md`; replace them when SpriteCollab art appears.
- Habitats: Tirtouga on the desert beaches (weight 4), Dwebble (5) and Onix (3) on the desert rocks
  with Archen. Desert habitat spots: ruins 3-4, rocks 4-5 (was 2-3), beach 3-4 (was 2-3).
- The desert rotation pool shrank to four once its starters and pseudo-legendaries left, so it now
  draws three of the four (`rotationPicksByLand`) to stay a rotation.

### Shinies

- `wild.shinyChance` 0.002 -> **0.01**, `alphaShinyMultiplier` 4 (configurable).
- Stronger encounters roll the same base chance; nothing else marks them.
- The online event boost (`shinyBoost`) multiplies the base once; Zoroark's 10% is untouched.
- Why 1%: a match starts with about 218 wild Pokémon and 6 stronger encounters, so 1% gives about
  2.3 shinies per match (measured 2.32, at least one in 92% of matches). A trainer meeting 40-60
  wilds sees one about every other match. At 0.2% it was 0.41 per match and 31% of matches.

### Celeste

`celesteEligible` (legendary/Mythical by `species.json` `class`, from PokeAPI's `is_legendary` and
`is_mythical`; no Megas or variant folders; shiny colours) is applied to the pick and again to the
evolved form; an ineligible evolved form falls back to the pick (`celestePrize`).

### Other

- Egg steps: walking into a wall now adds nothing (the `net + 1e-6` slack let tiny amounts creep in).
- `src/main.ts` preloads rotation, rare and stronger-encounter species too.
- `docs/plan.md`: match modifiers recorded as a future idea, not implemented.

## Stronger encounters (unchanged rules)

Pools, counts (65/27/8%) and the 10% pseudo-legendary category are as selected on 27 October. In
the desert Tyranitar and Garchomp share the category (5% each). Measured over 400 seeds: Dragapult
16%, Baxcalibur 15%, Tyranitar 8%, Garchomp 8% of matches.

## Measured availability (400 seeds, 1001-1400, ordinary wild spawns, by family)

Starters, configured 25%: mean 0.26 per match, range 0.21 (Sobble) to 0.29 (Bulbasaur, Torchic).
Pseudo-legendaries, configured 20%: mean 0.20, range 0.16 (Gible) to 0.23 (Dreepy, Jangmo-o).
The spread is sampling noise (about plus or minus 0.04 at 400 matches). 71-87% of each family's
spawns are on its land's own ground, the rest on bordering meadows and beaches. Per-family tables
with the other routes are in the encounter document.

## Checks performed

- `npx tsc --noEmit`; `vitest` (79 tests on `online`, including three new rare-group tests); client and
  server builds.
- `bash scripts/check-server.sh` locally (built server, teams, gameplay, online events, lag
  compensation, social, moderation, ops, bots): all passed. CI on `online` passed.
- New gameplay checks: Celeste over 60,000 prizes at random levels never gives a legendary, Mythical,
  Mega or variant (312 species given); every legendary/Mythical in the game is classified; stronger
  encounters were shiny 14 times in 1,709 over 300 matches.
- 400-seed spawn measurement before and after (same seeds).
- Browser check (Playwright, both branches' dev builds): Tirtouga, Carracosta, Dwebble, Crustle and
  Onix in the party, walking, fighting (Aqua Jet, Fury Cutter), shiny recolours, wild Tirtouga on a
  desert beach and Dwebble on the rocks; no new failed requests.
- `online_events` check: made independent of where a seed's wilds stand (it failed after the spawn
  change because a wild knocked the test trainer down), and it now lets queued input play out
  before checking that standing still adds no Egg steps.

## Unresolved

- **Live server not redeployed.** The deploy workflow was blocked by this session's permission
  rules; run "Launch online server" (size friends) to put this live. GitHub Pages is updated.
- Tirtouga, Carracosta and Crustle use stand-in sprites built from Gen V battle art, so they are not
  in SpriteCollab's style and have five animations.
- The forest still has no pseudo-legendary stronger-encounter category.
- Seven ordinary species have no shiny colours (Dragonair, Silcoon, Cascoon, Armarouge, Dewott,
  Archen, Galarian Darumaka), so they are never shiny and Celeste never gives them.
- Axew and Larvesta are in the Breeder's Egg list but not in the game.

## Evening pass: admin start, ten trainers, privacy, portraits and map fixes

Pictures for everything below are in `docs/polish-2026-10-28/admin-and-map/`.

### Admin start (server)

- An account with the admin role can start a public lobby at any time, alone included; the other
  seats fill with computer trainers. The server decides this from the signed-in account's id and
  its role in the accounts database (`hub.isAdmin`: not a guest, not banned, `role = 'admin'`); the
  display name plays no part. A lookalike name (`wes…x`) gets nothing.
- Everyone else keeps the normal rule: Start now appears only once five real players are in.
- The lobby shows the admin a "Start now (admin)" button; an admin start takes everyone already in
  the lobby along.
- Checked by `server/checks/admin_start.ts` (in CI and `scripts/check-server.sh`) against a server
  with the standard settings, using the same admin command line as the live server, and in a
  browser (`lobby_admin.png`, `lobby_ordinary.png`, `match_admin_start_ten.png`).
- **To use it live, the Wes account must hold the admin role there**:
  `fly ssh console --app almia-showdown -C "node dist-server/admin.js admin Wes"`.

### Ten trainers

- Public matches: 10 trainers, at least 5 real players before computer trainers fill in
  (`server/main.ts`, `fly.toml`, `fly.demo.toml` `MATCH_SIZE = "10"`). Private lobbies: 2 to 10
  (default 10). Offline: 9 rivals, so 10 in all (`data/config.json`). Lobby and hub text updated.

### Chat and the minimap

- Global chat is gone from matches (playing and watching); the hub and lobby keep it.
- The minimap shows no other trainers; squadmates only, in blue. The server no longer sends anyone
  the positions of opponents outside their view (the radar holds squadmates only, plus a count of
  trainers left for the banner); opponents nearby are still sent and drawn as before. Checked in
  `server/checks/online_events.ts`.

### Party portraits

- Cause: the portraits are opaque 40 px squares. They were drawn at 1x at least and clipped to the
  border plus 2 px, so on smaller windows they ran over the slot's border and into the lead's
  corner brackets (Smoochum was the lead in the report, Tirtouga was not). Now the portrait sits
  inside the border with the same margin at every size, at the largest whole-pixel scale that fits;
  where even 1x is too big, its middle is shown at 1x (pixels stay crisp). Before and after at four
  window sizes: `hud_portraits_before_after.png`.

### Map (all in the generators and the castle's Tiled source; full rebuild run)

- **River crossings.** A road that crosses the river now runs straight across it (design3
  `river_crossings`): a three-tile road centred on the bridge's middle row, four tiles of straight
  road at each end, stray road stubs beside it removed, and the bridge picture now covers exactly
  the walkable deck (it sat half a tile west of it). Nothing tall stands beside the approaches.
  A second bridge carries a new road from the north road over the river to Emberwood.
  Collision follows the same cells; the reachability check passes.
- **Castle walls.** Cause, from the castle's own layers and the artist's Bosk Barracks: the side
  walls are four tiles between their edge pieces, but the plank floor (whose planks run from the
  middle of its first tile to the middle of its last) was laid three tiles wide, so a strip of the
  island's grass showed between the planks and the outer edge on both walls, and inside the corner
  towers' open tops. The planks now run under all four (`castlekit.close_edges`, applied to
  `areas/castle.tmx` and to future exports). Separately, the centre colour blend tinted the pale
  parapet stones of the west towers green (it classed them as sand); castle stone is now left alone.
- **Town fences removed.** No town is fenced; the woods and meadow run straight into the towns.
  Buildings, NPCs, plazas and roads are unchanged; farm fences stay.

### Checks

`scripts/check-server.sh` (TypeScript, move scripts, 89 unit tests, builds, every server check
including the new admin start) passes. `server/checks/gameplay.ts` had a fragile check exposed by
the new map (the Breeder wanted the starter's species and took it); fixed.

### Party order on screen (follow-up)

The Poké Ball drawn on a portrait waiting in its ball is gone. Instead the party column lists the
Pokémon that are out first, then those waiting in their balls, then the fainted; the party's own
order (which decides who comes out) is unchanged, and clicks still go to the right Pokémon.
`party_out_first.png`: before and after the lead faints.

### Afternoon: Tackle, the castle court, the south gate, the desert

- **Tackle** is a plain body blow: the ground ripple (`fx_067`) is gone, only the hit burst remains
  (`data/moves.json`, and its recipe in `scripts/moves.py`; the move scripts still rebuild the
  library unchanged).
- **The castle court's centre** has a paved medallion: rings of darker and lighter slabs and four
  studs, as paving shapes in `areas/castle.tmx` (editable in Tiled). The smoothing pass
  (`scripts/mapgen/pave_smooth.py`) now lets a slab oval drawn over a light one take its curve back,
  so nested rings come out clean. `castle_centre_before_after.png`.
- **The south gate is open**: the gatehouse shows the kit's open arch instead of the wooden door,
  the parapet above the passage opens, and the slab walk runs from the court through the arch to
  the road. Walkable end to end (the parapet row used to block it). Changed in the castle's Tiled
  file and in `castlekit.py` for future exports; the smoothing overlay no longer paints over the
  castle's own tiles. `castle_south_gate_before_after.png`.
- **The round raised mesa west of Sunreach is gone**: flat desert there now (`design3.py`). The rocky
  Pokémon that lived on it still spawn in the same area. `desert_west_before_after.png`.
- Checks: `scripts/check-server.sh` passes; the full map was rebuilt and every point of interest is
  reachable.
- **The castle court's plaza** keeps its square shape with rounded corners (48 px). It is a
  `corner` property on the plaza's Paving rectangle in `areas/castle.tmx` (any Paving rectangle
  can have one), applied by the smoothing pass. `castle_plaza_rounded_corners.png`.
