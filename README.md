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

The title screen is a live corner of the island: small wild Pokémon wander
in, Darkrai drifts between the trees putting them to sleep with Dark Void and
blasting the sleepers, and now and then Cresselia flies in, wakes them with
moonlight and fights Darkrai until one of them is driven off.

Title → **Roll Starter** → three reels each roll a rarity, then a Pokémon of
that rarity. Pick one of the three (click its card, or press 1-3); that is
your starter. For now a **Reroll (R)** button deals a fresh three.

| Rarity | Chance | Pokémon |
| --- | --- | --- |
| Common | 50% | Pikachu, Meowth, Magikarp, Psyduck, Geodude, Shinx, Starly, Bidoof |
| Uncommon | 27% | Elekid, Magby, Smoochum, Tyrogue, Munchlax, Eevee |
| Rare | 13% | every region's starter trio, Kanto to Paldea (27), and Riolu |
| Epic | 7% | the pseudo-legendary lines: Dratini, Larvitar, Bagon, Beldum, Gible, Deino, Goomy, Jangmo-o, Dreepy, Frigibax |
| Mythic | 3% | Mew, Celebi, Jirachi, Manaphy, Shaymin, Victini, Marshadow, Meltan |

Each starter comes with its whole evolution line (`scripts/add_starters.py`
writes the species from PokeAPI data; the tiers live in `data/spawns.json`
`starterTiers`). You start at a random spot near the coast of the 320x224
island, a new one every match, with seven rival trainers spread round the
coast away from you; the wild Pokémon round every starting point stay at
their land's base levels. Last trainer standing wins.

The island: the Shadow Crystal on a terrace in an open plain at the centre,
and four lands round it, each with its own wild Pokémon, a boss, and a town
with a healer and three market stalls: Frostmere in the snowfields,
Emberwood in the red autumn wood, Sunreach in the desert, Greenhollow in the
forest. The castle stands in a clearing in the south-east forest: a square
walled hold, open through gates in its north and south walls (a round tower
either side of each), with a keep on the north wall and a courtyard battlefield where the Castle
Champion takes on challengers. Pokémon are drawn at their Pokédex size next
to the trainers (1.6 m) and evolve at their canonical levels. Small ones are
lifted on a ramp so nothing draws under about 0.9 m (Pikachu and Eevee stay
smaller than Riolu), long and coiled ones (Gyarados, Steelix, Milotic,
Serperior, Dragonair) are measured along their length, and giants stop at
6 m (Wailord). See `sizes` in `data/config.json`.

Wild Pokémon by land (common, uncommon, rare, boss ♛). The outer lands
start at levels 2-7 for training; levels climb steadily toward the crystal,
up to about 24 extra at the centre (wild Pokémon there are met already evolved).

| Land | Common | Uncommon | Rare | Boss |
| --- | --- | --- | --- | --- |
| Forest | Grubbin, Starly, Applin, Budew, Wurmple | Tropius | Turtwig, Treecko, Ralts | Ursaring (Lv 20) |
| Red forest | Solosis, Fomantis, Impidimp, Charcadet, Deerling | Musharna | Zorua | Gallade (Lv 26) |
| Snow | Snover, Alolan Vulpix, Amaura, Spheal | Absol | Frigibax | Avalugg (Lv 28) |
| Desert | Sandile, Trapinch, Darumaka, Hippowdon | | Larvitar | Steelix (Lv 36) |

The central plain and the beaches take the table of the nearest land.

**One-on-one trainer battles.** When two trainers come within 6 tiles of
each other in sight, both parties go back into their balls and each sends
out one Pokémon. The camera closes in, your trainer stands back, and the
movement keys steer your Pokémon while the mouse buttons (or 1-2, Q/E) cast its moves the way it faces (straight at the opponent when it is roughly ahead). When it faints,
pick the next one (1-6 or click its portrait). The battle ends when one side
has nobody left; the loser is out of the match. The Castle Champion's bout
works the same way (and a loss there is friendly).

**Visitors.** Four things roam the island besides the rivals (`src/sim/visitors.ts`):

- the **Wandering Merchant** (gold dot on the minimap): Space beside him opens a stall of rare things the
  towns don't sell (Rare Candy, Exp. Share, Lucky Egg, a Master Ball, held items, a Crystal Shard and the
  stone of the day);
- **Ace Trainer Celeste** (pink dot): Space for a one-on-one battle with Garchomp, Lucario and Gyarados a
  few levels above your best. Win and she gives you a shiny (Lucario, Garchomp, Dragonite, Tyranitar or
  Gyarados) or a powerful Pokémon (Metagross, Salamence, Goodra, Dragapult...) at your level. Lose and she
  patches your team up; try again a minute later;
- **Hoopa** (violet dot): Space and it opens a ring portal; a legendary (Ho-Oh, Suicune, Latios,
  Rayquaza or Raikou) comes through with triple HP and challenges you to a **legend bout**, fought like a trainer
  battle (see below). Hoopa only turns up in about one
  match in seven (`visitors.hoopaChance`; add `?hoopa=1` to the address to force it). Once per match;
- **Lugia** sleeps in **Tide Lake** (the lake between the plain and the autumn wood). Only a Super Rod
  cast into the lake can hook it (3% of bites, once a match): the water churns, Lugia bursts out
  (Guardian Signs' own Lugia sheet, fx_135, in a column of spray), leaps ashore beside you and fights as
  a legendary.

The map also has more ways down from high ground: every plateau now has a flight of stairs in each long
south face (about every 22 tiles), on top of the ones where roads climb.

**Statuses.** Burn (half physical damage, ticks), paralysis (slower, sometimes
skips a move), sleep, and three more: poison ticks 7% of max HP every 2 s until
cured (Poison and Steel types are immune); freeze stops a Pokémon for 2.5-4 s
and a Fire hit thaws it (Ice and Fire types are immune); confusion lasts 4-6 s
and sends 40% of its moves off in a random direction. Poison, ice and psychic
moves cause them (`EXTRA_STATUS` in `scripts/moves.py`). Healing at an outpost cures all.

**Items for levels and evolution.** Rare Candy (a level for the lead), Exp.
Share (held: full XP even waiting in its ball), Lucky Egg (held: 1.5x XP).
Evolution stones (Fire, Water, Thunder, Leaf, Ice, Moon, Sun, Shiny, Dusk,
Dawn) evolve the lead when its species has that stone evolution: Pikachu,
Eevee (five of its forms; Espeon, Umbreon and Sylveon still come by level),
Kirlia to Gallade, Roselia, Doublade, Charjabug, Vulpix and Alolan Vulpix.
Each town's medicine stall sells its own stone and the Wandering Merchant has
a stone of the day; stones are not found in item balls. Great and Ultra Balls
can hold the **Snag Machine** (Shift+number beside a rival's fainted Pokémon
to claim it), Mega Stones, Extraction Vouchers and **Max Revives** (a fainted
Pokémon back at full HP; the Wandering Merchant sells them too).

**Two out at a time.** Every trainer has at most two Pokémon out: the first
two in party order that can still fight. The others wait in their balls (a
small ball on their portrait) and one comes out when an outside Pokémon
faints or you swap the order by clicking a portrait.

**Levels and damage.** XP to the next level is 30 + 5L + 0.15L², and a
knockout pays 25 + 10 per level of the fallen Pokémon (up to double against
higher levels): an even fight is worth about a level and a quarter early on,
one level around level 25 and under a level by level 40. The partner out beside the dealer takes half, Pokémon in
their balls 40%, and a catch gives the lead three quarters of a
knockout. About one wild Pokémon in eight is an **Elite** (gold name): 5-9
levels higher, often already evolved, worth 1.6x XP; land bosses pay 3x.
About one wild Pokémon in fifty is **shiny** (four times that for Alphas):
real shiny colours from SpriteCollab, a light-blue "Shiny" name and a glint
that twinkles on its body; it stays shiny when caught and when it evolves.
The shiny colours are stored as palette swaps in `data/shiny.json`
(`scripts/shiny-palettes.py` reads each species' normal and shiny Idle sheet
and portrait from SpriteCollab), so no second copy of the sheets ships.
Wild levels climb toward the Shadow Crystal: base levels at the coast, the
30s to about 60 in the middle (mostly evolved). Within 55 tiles of the crystal
about one wild in fourteen is an **Alpha** (the Alpha mark by its red name, a red glow with embers drifting off it, drawn half again as big):
about ten levels above the wilds around it (at most 65), always the last form of its line, worth 2.5x XP. Knocking one out
or catching it always drops an Ultra Ball prize: a rare TM (40%), two Rare
Candies (35%) or a rare-tier roll (25%), plus a 12% chance of an Extraction
Voucher on top.
Every hit is scaled by `battle.damageScale` (0.55), so fights last several
exchanges.

**Moves.** Every species has a level-up learnset (`learnset` in
`data/species.json`, generated by `scripts/learnsets.py`): a Pokémon knows
two moves at a time: the newest two attacks it has reached (a status move
only fills a slot no attack can). On levelling up, a free slot takes the new
move; with both full, a stronger new move replaces the weaker one by itself.
A TM asks which of the two to forget (1-2, Esc keeps them).
Legendaries and mythicals have **signature moves**, always among the two they
know, built from the biggest Guardian Signs sheets: Aeroblast (Lugia, a white
wind beam into a swirl), Sacred Fire (Ho-Oh, a fire eruption in a ring of
flame, burns half the time), Dragon Ascent (Rayquaza, a meteor crashing down),
Luster Purge (Latios, a pink pillar), Doom Desire (Jirachi, a falling star
and a golden blast), Hyperspace Hole (Hoopa), Spectral Thief (Marshadow) and
V-create (Victini). Thunder now strikes as a lightning geyser.
Body Slam and Heavy Slam are leaps: the attacker jumps into the air, comes
down just in front of the target and the landing bursts out in a shockwave
with a screen shake (Snorlax and Munchlax learn both; Munchlax now lives in
the forest). The move library
(`data/moves.json`, generated by `scripts/moves.py`) has 164 moves, each with
one animation recipe: a carrier (beam, projectile or falling object), one
impact on the body, at most one aftershock.

| Input | Action |
| --- | --- |
| title screen: Move Gallery button, M, or `?moves=1` | every move in the game cast in turn at a practice dummy, by a Pokémon that learns it: Left/Right browse, Space replays, P pauses the slideshow, T filters by type, Esc returns to the title |
| title screen: Demo Team button, D, or `?demo=1` | skip the roll and start with a level 100 team: Infernape, shiny Rayquaza, Latios, shiny Jirachi, Tinkaton (party cap 5) |
| WASD / arrows | move, 8 directions, 4 tiles/s; the party steers around you in formation |
| mouse | aim: a reticle marks where a single-target move lands (up to 5.6 tiles out). Within 1.6 tiles of an enemy it snaps onto it (red) and the move goes where that Pokémon stands; nothing tracks it after the cast, so it can still step out |
| left click / right click on the field | cast move 1 / move 2 at the aim point (hold a mouse button to keep casting as the move comes off cooldown); Q/E, 1-2 and clicking the move buttons work too. 0.3 s cast, telegraph on the ground, 1.5-6 s cooldowns; lines and cones fire toward the aim |
| click one of your Pokémon on the field | **Pokémon mode**: you steer that Pokémon with the movement keys and its moves (mouse buttons, Q/E, 1-2) fire the way it faces, at the nearest enemy roughly ahead within 6 tiles; a ring and an arrow mark it, the camera rides with it and your trainer follows a few steps behind. Esc, or a click on your trainer, goes back to trainer mode (which shows no aim at all) |
| R | auto-battle on or off (on at the start): the lead picks its own moves and targets while you steer, including in one-on-one battles; you can still cast by hand |
| Shift+1-6, or click the bag | use an item; a ball's key arms it, and the armed ball's key again cycles to the next ball type |
| G, or click the tabs above the bag | switch between the Bag and the Held & TMs tab |
| Shift+1-6 on the Held & TMs tab | give the lead a held item, or teach it a TM (pick the move to replace with 1-2, Esc to keep them) |
| Space beside a person | talk: a vendor opens the stall (1-9 buys, Space or Esc leaves; Poké Dollars come from knockouts), a healer restores the party, the Castle Champion takes your challenge (a friendly bout; beat his team for ₽3000, items and a shiny Pokémon at your best level) |
| Space beside an item ball | pick it up: a popup reveals the contents |
| at a shop: click a bag slot or Shift+1-6 | sell one of that item for half its price (the lowest any shop asks; TMs, Mega Stones and vouchers have set values). G switches to the Held & TMs tab |
| Space with nothing in reach | dodge: your lead dashes the way you move (or face); hits in the first 0.3 s miss; 3 s cooldown (the pill above the move wheel) |
| hold C and draw loops with the mouse | the Capture Styler: each loop closed round a wild Pokémon counts toward calming it (2 loops, +1 per 10 levels, more for Elites and bosses). If it runs through your line, the line breaks and a loop is lost. A calmed Pokémon stops fighting for 12 s and every ball counts 4x against it |
| F (Tab or click a wild to switch target) | the ball locks onto the nearest catchable wild within 9 tiles (one fighting your team counts as closer), marked by turning brackets (green in range, red out of range). Tab steps through the wilds in range; clicking any wild on screen locks onto it, however far. A picked target holds until it faints, is caught or gets about a screen away (24 tiles); the brackets turn green once it is within a throw. F throws the armed ball at it; throws reach 7 tiles |
| M | Mega Evolve the Pokémon you steer (or your lead) when it holds its own Mega Stone; once a match |
| V | ride or fly on a mount in your party (Raikou, Koraidon, Miraidon ride; Latios, Staraptor fly); V again to get off |
| click a portrait | swap the lead; click a behaviour chip to cycle Attack (go after anything in range) / Guard (fight what comes near) / Passive (never starts a fight, even with auto-battle on; it dodges attacks and stays close) |
| hover a party card | a red X in its corner releases that Pokémon (click again on "Release?" to confirm): it walks off into the wild, calm for a while, and could be caught again. Not during a battle, and never your last one |
| hover a bag slot | the item's name; the count sits in the slot's corner; the red X throws the item away |
| item balls | Poké Ball = common, Great Ball = uncommon, Ultra Ball = rare; a Premier Ball holds an eliminated trainer's bag, the Master Ball appears by the crystal when the final darkness begins, Darkrai leaves a Cherish Ball (a Dark-type held item and a full party heal) |
| Shift+number on a Crystal Shard | clears the darkness in a 5-tile circle around you for 10 s |
| healers (one per town and one in the castle courtyard) | Space for a full party heal, every 20 s |

Every 200 s the Shadow Crystal pulses (five pulses) and darkness creeps
inward from the edges at 0.7 tiles a second, slow enough to walk ahead of. In the dark a Pokémon grows drowsy after 4 s and falls asleep,
sleepers take Bad Dreams damage every second, wild Pokémon get a purple
aura and cannot be caught. Three seconds back in the light
wakes them. When the last safe circle closes, Darkrai appears at the
crystal at level 100 and hunts the remaining trainers with Dark Void rings
and Dark Pulse lines.

**Your trainer.** **Trainer (C)** on the title screen picks your look from
every trainer sheet in `assets/rangers` (ten Ranger Union members and
thirteen townsfolk). The pick is kept in this browser (`src/look.ts`) and a
rival who wore that look switches to yours. All looks are free for now; they
are meant to become unlockables once the game is online.

**Mega Evolution.** Ten Pokémon can Mega Evolve: Charizard (X), Gengar,
Steelix, Tyranitar, Gardevoir, Absol, Glalie, Latios, Lucario and Gallade
(the Megas with full SpriteCollab sprite sets). Give one its own Mega Stone
(Held & TMs tab) and a glowing **MEGA EVOLVE · M** pill appears: press M and
it becomes its Mega form for the rest of the match, with the Mega's types
and base stats at its level. Each trainer can Mega Evolve once a match, and
rivals do it as soon as a stone holder is fighting. Mega Stones come from
Great and Ultra Ball loot (usually a stone for a Pokémon you have), and an Alpha of
one of these lines always drops its stone. A Mega sent to the PC is stored
as its regular form. Data: `scripts/megas.py` adds the Mega species and
stones; the rules are in `src/sim/mega.ts`.

**Fishing.** Carry a rod (Old Rod and Good Rod at the Poké Ball stalls, the
Super Rod from the Wandering Merchant; all three also turn up in item balls),
stand at the water's edge and press **Space** (or use the rod from the bag).
The line goes out, the bobber waits, and when the **!** pops up you have about
a second to press Space and hook it; moving reels the line in. What bites
depends on the rod (`data/fishing.json`):

| | common | uncommon | rare | item ball | Lugia |
|---|---|---|---|---|---|
| Old Rod | 80% | 17% | 3% | | |
| Good Rod | 55% | 30% | 10% | 5% | |
| Super Rod | 30% | 35% | 22% | 10% | 3% (Tide Lake only) |

Common bites are Magikarp, Goldeen, Tentacool, Remoraid, Finneon, Barboach,
Luvdisc and Horsea; uncommon ones Chinchou, Wailmer, Seaking, Octillery,
Lumineon, Whiscash, Qwilfish, Corsola, Tentacruel and Seadra; rare ones
Gyarados, Lapras, Dratini, Feebas, Relicanth, Kingdra, Milotic and Wailord.
Better rods hook higher levels (and the water near the crystal more still); a
hooked Pokémon bursts out of the water, leaps ashore and fights you.

**Riding and flying.** Press **V** with a mount in your party to ride it or
fly on it, and V again to get off. Raikou, Koraidon and Miraidon (its Low
Power ride form) carry you at 1.7x walking speed; Latios and Staraptor fly
you at 2.1x, over water, high enough that trainers can't start a battle with
you. The mount sits out of fights while it carries you; you can't land on
water, fish or steer a Pokémon while mounted, and a battle sets you down.
Raikou can come through Hoopa's portal and Celeste can give Koraidon or
Miraidon. Seat height, rear offset and a ridden size per mount live in
`riding` in `data/config.json`.

**Legend bouts.** Hoopa's portal legends and Lugia fight you one-on-one in
the battle ring, like a trainer: your team goes back in its balls and you send
them out one at a time. A legend is harder than any rival: it keeps to mid
range and strafes, dashes out of most of your telegraphs, recovers its moves
faster as it weakens, follows one cast with another when pressed ("getting
serious" under two thirds of its HP), and under a third it is **enraged**
(Attack and Speed up). Worn down to its last HP it joins you (or, with a full
party, leaves an Extraction Voucher). If it beats your whole team it vanishes
and your Pokémon are patched up; a legend bout never knocks you out of the
match. If you are already battling when it appears, it stays out as a wild
boss instead, and whoever wears it down gets it.

**Respawning.** If wild Pokémon knock out your whole party you are not
out: every item you carry drops where you fell (one Premier Ball) and you
come back at the nearest outpost outside the darkness with your party fully
healed. The wait grows as the match goes on: 8 s plus 4 s for each minute
played, up to 90 s (`respawn` in `data/config.json`). Losing to another
trainer, or to the darkness, still knocks you out, and nobody respawns once
the final showdown has started. Rivals follow the same rule.

**Extraction and the PC.** Pokémon can be kept between matches in your PC
(`src/pc.ts`, stored in this browser's localStorage, so it stays on this
device). There are two ways in: win a match and pick one Pokémon from your
party on the victory screen (1-6 or click, or Skip), or use an **Extraction
Voucher** mid-match (a rare find in Ultra Ball loot, or ₽6000 from the
Wandering Merchant): Shift+its slot opens a prompt, 1-6 or a click on a party
card picks who goes, and that Pokémon leaves the match in a beam of light
(not during a battle, and never your last one that can fight). **My PC (P)**
on the title screen shows everything extracted so far, with shinies, Alphas
and legends marked. Nothing in the PC comes back into a match yet.

**The final showdown.** The Shadow Crystal stands in the centre circle of a
paved battlefield on the plain, ringed by ruined pillars, purple banners and
crystal clusters. When only two trainers are left, both are called there:
after a five-second warning (and once any battle between them is over) they
are brought to either end, their teams are fully restored, and they battle
one-on-one. A rival team that fell far behind is lifted (and evolved) to three
levels under the strongest finalist, so the last battle is a real one. The
winner takes the match.

**Roads** wind across the island instead of running in straight lines: each
leg bends gently between its waypoints and the corners are rounded, while
every road still meets its town, gate or stairs head on. Signposts stand
where roads set out, lamp posts line the way, flowers, mushrooms and logs sit
on the verges, and the lakes have lily pads, lotus flowers and cattails.

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

Seven balls, each with a reason to carry it: Poké ×1, Great ×1.5, Ultra ×2,
Quick ×5 before the first darkness pulse (two sit near your start), Dusk ×3
inside the darkness, Net ×3 on Bug and Water Pokémon, and the Master Ball,
which never fails (`ballModifier` in `src/sim/catching.ts`). They use
`assets/items/balls/` in the bag, on the ground and in flight; the open frame
and the wobble are built in code. Premier and Cherish Balls still appear on
the ground as containers (an eliminated trainer's bag, Darkrai's reward).

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
