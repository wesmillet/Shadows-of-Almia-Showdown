# Change report: 27-28 October 2026

Commits: `5c30cfa7` on `online`, ported to `main` as `b0b0e77b`, merged back (`0199bdc3`).

## 1. Ordinary wild Pokémon

### Added families and where they live

| Family | Land | Placement | Weight | Levels |
| --- | --- | --- | --- | --- |
| Archen, Archeops | Desert | Rocky habitat only (the two mesas and their skirts), 2-3 habitat slots a match | 4 | 5-8 + radial bonus |
| Sigilyph | Desert | Ruins habitat only, shares 3-4 ruins slots with Baltoy | 3 | 5-8 + radial bonus |
| Baltoy, Claydol | Desert | Ruins habitat only | 5 | land base + radial bonus |
| Numel, Camerupt | Desert | Fixed table, anywhere in the land | 7 | land base + radial bonus |
| Skorupi, Drapion | Desert | Fixed table | 7 | land base + radial bonus |
| Helioptile, Heliolisk | Desert | Fixed table | 6 | land base + radial bonus |
| Orthworm | Desert | Fixed table, somewhat uncommon | 2.5 | 6-9 + radial bonus |
| Sandygast, Palossand | Desert | Beach habitat only (sand shore nearest the desert), 2-3 slots | 6 | land base + radial bonus |
| Alolan Sandshrew, Alolan Sandslash | Snow | Fixed table | 7 | land base + radial bonus |
| Vanillite, Vanillish, Vanilluxe | Snow | Fixed table | 8 | land base + radial bonus |
| Seel, Dewgong | Snow | Beach habitat only (snowy shore), 2-3 slots | 6 | land base + radial bonus |
| Galarian Darumaka, Galarian Darmanitan | Snow | Rotation pool | 4 | land base + radial bonus |
| Delibird | Snow | Rotation pool | 4 | land base + radial bonus |
| Cetoddle, Cetitan | Snow | Rotation pool | 4 | land base + radial bonus |
| Cryogonal | Snow | Rotation pool | 4 | land base + radial bonus |

Families are added once, by their first form. Evolution is the existing system: level evolutions happen
by level (Claydol 36, Camerupt 33, Drapion 40, Palossand 42, Archeops 37, Vanillish 35, Vanilluxe 47,
Dewgong 34). Stone evolutions follow the Vulpix pattern: Heliolisk by Sun Stone, Alolan Sandslash,
Galarian Darmanitan and Cetitan by Ice Stone. Those are met unevolved in the wild except as Alphas.

### Not added

- **Tirtouga and Carracosta.** SpriteCollab has no sprites for either.
- **Dwebble and Crustle.** SpriteCollab has no Crustle sprites. I did not want to add Dwebble as a line
  that can never evolve.

Both are ready to add when the art exists.

### Other table changes

- Desert count 38 to 40, snow 44 to 46. The habitat slots are part of the land's count.
- Weights:
  - Snow: Snover, Alolan Vulpix, Spheal and Snom 10 to 8, Cubchoo 8 to 7.
  - Desert: Sandile and Trapinch 10 to 8, Darumaka 10 to 7.
  - Forest: Wurmple 12 to 11.
- Amaura moved from the snow table to the snow rotation.
- **Duplicates fixed.** 17 rotation entries duplicated their land's fixed table, so a match that drew one
  lost a rotation pick:
  - Forest (8): Grubbin, Wurmple, Budew, Starly, Applin, Tropius, Turtwig, Treecko.
  - Autumn (6): Charcadet, Zorua, Impidimp, Deerling, Solosis, Musharna.
  - Snow (2): Spheal, Frigibax.
  - Desert (2): Hippopotas, Darumaka.

  They were removed, and the code now skips table species too.
- **Rotation picks are drawn by weight, without repeats.** They used to be drawn uniformly, which ignored
  the weights. The 1.2-weight starters and pseudo-legendary first forms are therefore drawn into a match
  less often than the 4-weight regulars.
- Guaranteed Mega-line placements (Charmander, Gastly, Snorunt, Absol, Riolu, Ralts, Larvitar) are
  unchanged.
- **Respawns:** the game has no wild respawns. The initial spawn is every wild a match gets, plus
  fishing. My earlier project brief said otherwise; that was wrong.

### Measured before and after

200 reproducible seeds through the real `Match` spawn code (`scratchpad/spawnstats.mts`). Initial spawns
only. Ordinary wilds only, not stronger encounters.

| | Before | After |
| --- | --- | --- |
| Wilds per match | 214.1 | 218.2 |
| Distinct families per match (mean, min-max) | 44.0 (38-51) | 57.5 (51-63) |
| Families seen across 200 seeds | 89 | 104 |
| Most common family's share | Sandile 4.9% | Fomantis 4.1% |
| Starter-family wilds per match | 8.7 | 6.3 |
| Pseudo-legendary first-form wilds per match | 6.3 | 4.2 (including the guaranteed Larvitar) |
| Desert: families per match | 8.3 | 14.6 |
| Desert: top species share | 28.9% | 16.2% |
| Desert: top three share | 65.3% | 39.4% |
| Snow: families per match | 11.8 | 13.9 |
| Snow: top species share | 20.3% | 17.2% |
| Snow: top three share | 49.8% | 41.7% |
| Forest: families per match | 12.0 | 13.3 |
| Autumn: families per match | 10.8 | 12.1 |

Measured presence of each new family:

| Family | Per match | Matches it appears in |
| --- | --- | --- |
| Archen | 2.5 | 100% |
| Sigilyph | 1.3 | 78% |
| Baltoy | 2.2 | 96% |
| Numel | 4.5 | 96% |
| Skorupi | 4.4 | 98% |
| Helioptile | 3.6 | 96% |
| Orthworm | 1.7 | 85% |
| Sandygast | 2.6 | 100% |
| Alolan Sandshrew | 4.6 | 98% |
| Vanillite | 5.2 | 98% |
| Seel | 2.5 | 100% |
| Cetoddle | 1.2 | 44% |
| Galarian Darumaka | 1.1 | 39% |
| Delibird | 1.3 | 46% |
| Cryogonal | 1.1 | 42% |

The radial level progression is unchanged. The new families are met from level 3 at the coast to the 60s
near the crystal.

### Assets

Sprites and portraits came through `scripts/fetch-sprites.py`. Orthworm and Iron Treads are sets
SpriteCollab still marks unfinished, so I added an opt-in `--allow-incomplete` flag to fetch them.

- **Orthworm** has every action except Hurt and Faint.
- **Iron Treads** has only Idle, Rotate and Sleep. It now rolls on its Rotate sheet when it moves (a
  generic Walk-to-Rotate fallback; Iron Treads is the only species without a Walk sheet).

Data came through the same pipeline as before:

- Base stats, types and heights: `scripts/add_species.py` from PokeAPI. The four regional forms came from
  PokeAPI's form rows.
- Learnsets and kits: `scripts/learnsets.py`. I gave kits to the stronger encounters and the main
  additions.
- Body sizes: `scripts/measure_species.py`.
- Shiny palettes: `scripts/shiny-palettes.py`, now extended to regional forms. Alolan Vulpix and Ninetales
  can be shiny now too.

Two new species have no shiny sheet in SpriteCollab, so they are never shiny:

- **Galarian Darumaka:** no shiny sheet at all.
- **Archen:** its shiny sheet does not match its normal one.

I checked every new species in the game in a browser, including shinies.

## 2. Stronger encounters (replacing the static land bosses)

### How many per land

Each land gets one to three stronger encounters per match (`spawns.json` `strong.count`). Measured over
200 seeds:

| Count | Configured | Forest | Autumn | Snow | Desert |
| --- | --- | --- | --- | --- | --- |
| One | 65% | 119 | 145 | 125 | 123 |
| Two | 27% | 60 | 42 | 59 | 57 |
| Three | 8% | 21 | 13 | 16 | 20 |

### How each one is chosen

- A land never gets the same species twice in one match.
- In a land with a pseudo-legendary selection, each encounter is from that selection with
  `pseudoChance` (10%). Otherwise it is a candidate, chosen by weight.
- The desert's two pseudo-legendaries split the 10% equally. A 40,000-draw unit test measures 10% in
  total, 5% Tyranitar and 5% Garchomp.

### Pools

| Land | Candidates (weight, levels) | Pseudo-legendary (10%) |
| --- | --- | --- |
| Forest | Ursaring (1, 20-24), Slaking (1, 24-28), Snorlax (1, 22-26), Scizor (1, 24-28), Kleavor (1, 24-28) | **None yet: your choice** |
| Autumn | Gallade (1, 26-30), Gardevoir (1, 26-30), Gengar (1, 26-30) | Dragapult (30-34) |
| Snow | Avalugg (1, 28-32), Abomasnow (1, 27-31), Glalie (1, 27-31), Froslass (1, 27-31), Sneasler (1, 28-32) | Baxcalibur (32-36) |
| Desert | Steelix (1, 34-38), Drapion (1, 32-36), Cofagrigus (1, 32-36), Iron Treads (0.4, 30-40) | Tyranitar (36-40) 5%, Garchomp (36-40) 5% |

### Measured over 200 seeds

| Land | Pseudo-legendary share of encounters | Other picks |
| --- | --- | --- |
| Autumn | Dragapult 10.7% | |
| Snow | Baxcalibur 8.2% | |
| Desert | Tyranitar 3.7%, Garchomp 4.0% | Iron Treads 14% (configured 10.6%) |

These are sampling noise around the configured rates. Iron Treads is placed in the desert, not the centre.

### Placement and behaviour

- **Placement:** deep inside the land, at least 12 tiles from each other and 45 from any start.
- **Visuals:** the old land bosses had no label, icon or aura (I checked the renderer, the HUD, the
  minimap and the sync). The only star in the game is Darkrai's, and Darkrai is not a land encounter.
  Shiny and Alpha marks are untouched.
- **Behaviour kept (internally still `landBoss`):**
  - they keep to a small patch and are slow to anger (`bossWanderRadius`, `bossAggroRange`);
  - knockback does not move them;
  - rivals' AI does not hunt them;
  - they pay 3x XP (`xpBossMultiplier`);
  - the Capture Styler needs 4 extra loops;
  - their shiny chance stays 0, as the old bosses had.
- **Megas:** Steelix, Gengar, Gardevoir, Glalie, Gallade and Tyranitar have supported Megas already, and
  their stones work as before. I did not add Megas or stones for Scizor, Abomasnow, Garchomp or anything
  else.

## 3. The disguised Zoroark

**When:** about 5% of matches (`spawns.json` `events.zoroark`).

**Who:** a "Wandering Girl" walks the forest and never leaves it. She uses `civ_10`, the only townsfolk
sheet no role used. Nothing on her names Zoroark, including what the browser is sent.

**The reveal:**

- Space shows a line of dialogue: "Hee hee... you saw through me!"
- A shadow swirl plays (fx_114, purple tint).
- She is removed, and a wild Zoroark (level 24-30) stands in her place. It fights and is caught like any
  other wild Pokémon.
- The player is told "It was Zoroark all along!"
- It is shiny 10% of the time. That roll is this event's own; global odds are unchanged.

**Online:** it is all server-side. Two players pressing Space in the same step get one Zoroark; a later
Space finds nobody; a reconnecting browser sees one Zoroark and no stranger. All of this is verified in
`server/checks/online_events.ts`.

## 4. Items and Eggs

### Crystal Shard

Removed from items, loot, the merchant, the dev chest, the use action, the light-zone code, the icon,
docs and Scholar Imani's advice. Saved chests holding it, or an old bag Egg, drop it safely when loaded:
both the server and offline chest loaders keep only ids that exist.

### Eggs

- **Where they live:** Eggs live in `trainer.eggs` and take a party slot (`partySize` counts them in
  every capacity check). They are not in `party`, so they never fight, lead or count as a fighter.
- **What the browser gets:** each Egg's progress only (`id`, `steps`, `need`). What hatches is kept on
  the server.
- **The trade:** the Breeder's trade is one for one, so a full party works. The traded Pokémon's held
  item comes back to you. One Egg per trainer per match.
- **Hatching:** 450 steps (`config.json` `eggs.hatchSteps`), about 80 to 100 seconds of real walking.
  - Steps are counted on the server from the trainer's own movement in each step, capped at their
    walking or riding speed.
  - Standing still, walking into a wall and being pushed count nothing.
  - Oversized or bursty input frames are clamped to one frame per step.
- **Fainting and wipe-outs:** a wipe-out keeps the Egg with you. An Egg unhatched at match end is lost,
  like everything else not extracted. The PC rules are unchanged; Eggs are never PC entries.
- **What hatches:**

| Egg holds | Chance |
| --- | --- |
| One of the ordinary lines | 95% in total, equally likely: Dratini, Larvitar, Bagon, Beldum, Gible, Deino, Goomy, Dreepy |
| A small Mythical | 5% in total, 0.625% each: Mew, Celebi, Jirachi, Manaphy, Shaymin, Victini, Marshadow, Meltan |

  Every Mythical here is 0.7 m or smaller and tagged `mythical` (not `legendary`) in `species.json`, from
  PokeAPI. Darkrai and Hoopa are left out: they have their own events.

## 5. Celeste and the Merchant

### Celeste's reward

Celeste gives a shiny Pokémon picked uniformly from every eligible ordinary species (307 today). Eligible
means:

- not `legendary` or `mythical` in species.json;
- not a Mega form;
- not a variant folder (shiny sets, shadows, Darkrai's final form, Hoopa Unbound). Regional forms count.
- has shiny colours, so the prize is always shiny.

The pick is then grown to the form its level reaches (`formAtLevel`, level evolutions only), when that
form can be shiny too. The level is still your best Pokémon's level. A full party still gets the existing
voucher plus P$2000. The Castle Champion is unchanged.

### Merchant and stones

The Merchant no longer sells stones or the Crystal Shard. His other stock and the Storm Mask chance are
unchanged.

Five of the ten stones were only obtainable from the Merchant: Water, Thunder, Shiny, Dusk and Dawn. They
are what Raichu, Vaporeon, Jolteon, Vikavolt, Roserade, Aegislash and Gallade evolve with. So every town's
medicine stall now sells two stones:

| Town | Stones |
| --- | --- |
| Frostmere | Ice, Water |
| Emberwood | Fire, Dusk |
| Sunreach | Sun, Thunder |
| Greenhollow | Leaf, Shiny |
| Castle | Moon, Dawn |

## 6. Online

### Ranked removed

- The queue, the rating code, the ranked leaderboard, `/api/ranked` and `/api/season` are gone.
- Profile standings, the end-screen rating line, the ranked XP bonus, the four ranked achievements and
  their titles are gone.
- An old client asking for ranked plays casual.
- The `ratings` table and earned achievement rows stay in the database untouched.

### Lobbies

- Eight players, and four real players are needed before bots fill the remaining seats. Neither the
  countdown nor "Start now" bypasses that.
- The server sends the minimum, and the lobby shows "Waiting for N more players (4 needed before bots
  fill in)".
- On the live server `MIN_PLAYERS` can no longer lower it; test servers may.
- Private lobby rules are unchanged.
- Tested against a running local server with real WebSocket clients and with four real browsers.

### Integrity audit

A separate read-only audit agent tested this locally (never against the live server). I fixed the
findings in the table:

| Finding | Severity | Fix |
| --- | --- | --- |
| A private lobby with the rare-item chest wrote every tester item into the player's permanent chest, on live too; the same happened on demo and dev for every match | Critical | The rare-item chest is never saved, and private matches save no chest change |
| Extraction Vouchers in private matches put Pokémon in the PC | Critical | Vouchers do nothing in private matches, and the room never forwards them |
| A failed API call (for example an oversized body) never got an answer | Medium | Every handler is awaited; oversized bodies get 413 |
| One oversized WebSocket frame raised an uncaught exception | Medium | An error handler closes only that socket |
| No per-address connection cap | Medium | 12 game connections per address on live |
| Restore deleted the old database's write-ahead log | Medium | Restore checkpoints and keeps the log with the old copy, and checks the backup's integrity first |
| No record to investigate collection changes | Medium | A `collection_log` table and a "Collection log" panel on the moderator player page (details below) |
| Trade accept took any truthy value | Low | Accept must be exactly `true` |
| Match ids could collide | Low | Random 64-bit ids |
| Extraction and match recording were not atomic | Low | Each runs in one transaction |
| Items taken out of a chest were lost when a match was called off | Low | They go back in on a drain or crash abort; the messages now say so honestly |
| Chest stacks over 9999 vanished on load | Low | Stacks are capped at 9999 |
| Private-match replays were open to anyone with the id | Low | Only their own players can watch them |
| No limits on renames and reports | Low | 3 renames a day, 10 reports an hour |
| A password change or recovery left game sockets open | Low | The account's game connection is closed |
| No Origin check on WebSocket upgrades | Low | Checked on live |
| A missing `SERVER_KIND` on Fly ran the server as dev | Low | The server refuses to start |
| Admin CLI actions were not logged | Low | They go into the moderators' log |

The collection log records:

- PC adds, trades and Wonder Trades both ways, with Pokémon snapshots;
- chest changes, before and after;
- renames;
- accounts deleted from the mod API or the admin CLI, archived with their PC and trade history before
  the delete.

Checked and found sound, with no change needed:

- Trade and Wonder Trade atomicity, ownership re-checks, consent, replays, duplicate and simultaneous
  offers.
- Movement, aim, cooldown, catch-range, shop and money validation.
- Malformed messages, payload size and message and command flood limits.
- Seat restore on reconnect.
- Authorization on account, mod and ops routes.
- Secrets: none in the repository or its history, none in the client bundle, none in the logs.
- Backup and restore round trip.

Not fixed:

- The admin CLI's ban does not ban devices, and its unban does not lift device or address bans.
- `/api/client-error` can still make up to 20 webhook alerts an hour per address.
- `Fly-Client-IP` is trusted (normal behind Fly's proxy).
- An account banned after making a trade offer can still have that offer accepted.

**No credential rotation is needed from this audit.** The one past exposure is the Fly org token and 2FA
recovery codes pasted in chat earlier. Only you can confirm those were revoked and regenerated.

## 7. Held items

### Bugs fixed

- **Leftovers** used the Pokémon's attack-pacing timer (`busy`) as its own, so a holder below full HP
  attacked late or not at all. It has its own timer now.
- **Equipping** with a full Held & TMs tab destroyed the previously held item. The swap is now refused
  and nothing is lost.
- A Pokémon **glowing on its way to Mega Evolution** could have its stone swapped out. It keeps the
  stone now (already true once Mega Evolved).
- **Releasing a Pokémon**, or trading it to the Breeder, lost its held item. The item comes back to the
  tab when there is room.
- **Life Orb recoil** showed as a burn tick. It shows as recoil now.
- **Descriptions:** held items had none. Each now states its real effect, and the bag popup shows it.
  Bag tools (Capture Styler, Storm Mask) now say they work from the bag rather than "press its number
  key".

Checked and correct: Focus Sash (once, only from full HP, consumed); Life Orb recoil (once per move, not
per beam pulse or per target); type boosters; Choice Band; Exp. Share; Lucky Egg (knockouts, shares and
catches); held items through evolution, fainting and reconnects; Mega Stones.

### Balance notes (no change made)

- **Choice Band** is strictly better than other options for physical attackers here: it has no move
  lock.
- **Life Orb** at 1.3x for 10% HP per move is strong with channelled beams, since one recoil buys a
  whole beam.
- **Leftovers** also heals in the ball.
- Held items sent to the PC with their Pokémon (vouchers, wins) are gone for good.
- The 16 type boosters overlap heavily with each other.

## 8. Verification

### Tests and checks

- Type check: passes.
- Unit tests: 76 pass on online and 61 on main. New tests cover the spawn rules, stronger-encounter
  odds, items, stones, the matchmaker minimum and retired ranked.
- New checks:
  - `server/checks/gameplay.ts`: Eggs, Zoroark, private rules, chests, Celeste, stronger encounters,
    Leftovers.
  - `server/checks/online_events.ts`: a real Room with the browser's decoder.
  - `server/checks/queue.ts`: a real server with eight seats.
- The full local suite passed: social, moderation, ops, teams, lag compensation, bots.
- CI on online passed for the first time in a while. Its earlier failures were stale checks from the
  levels-off and four-player changes, which I fixed.
- The Pages deploy for main passed.

### Seen in a real browser

- The new species and their shinies.
- The stranger.
- Eggs in the HUD.
- The main build offline.
- Four real browsers through the online queue on a local server into a match.

I did not play through the Breeder trade or the Zoroark reveal in a real browser. Those are covered by
the simulation and Room checks.

### Deploy

The live deploy (workflow run 40611689283, from main) succeeded: the Fly deploy step, which waits for the new machine's health checks, passed. I could not reach https://almia-showdown.fly.dev from this environment to check `/health` myself.

## Unresolved

1. **Forest pseudo-legendary:** not chosen. The pool has an empty slot ready.
2. **Tirtouga line and Dwebble line:** not added; there are no sprites.
3. **Galarian Darumaka and Archen:** cannot be shiny (no usable shiny sheets).
4. **Iron Treads:** has only three animations.
5. **Audit items left open:** see the "Not fixed" list in section 6.
6. **Desert pseudo-legendary first forms:** went from 3.4 to 2.0 per match, still including the
   guaranteed Larvitar. If you want more Gibles and Bagons, raise their rotation weight.
