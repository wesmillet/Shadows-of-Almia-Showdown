# Move audit: 28 October 2026

Every move in `data/moves.json` (175) was reviewed one by one: its numbers and shape, how it is
classified (contact lunge, slam, projectile, beam, falling, area, self), what the effects show, and
how it played in the Move Gallery and in combat on the real map. The table at the end has one row
per move. Data changes are applied by `scripts/move_audit.py`; mechanics changes are in
`src/sim/battle.ts`, `src/sim/data.ts`, `src/sim/match.ts` and `src/ui/matchScreen.ts`.

## What was wrong in the shared systems

1. **Contact moves hit from wherever the cast was aimed.** A contact move (Tackle, Bite, the
   punches, slashes) set off a lunge, but the hit was decided only by whether the target stood
   inside the aim circle (about 1 tile round the target), and the lunge kept the aim point on the
   target. So a lunge stopped by a wall, or one that never got close, still did full damage: the
   damage came from the cast, not from the contact. The lunge itself could cover any distance
   (it sped up to arrive on time), so a target picked 5.6 tiles away was effectively hit at range.
2. **Shots chased their targets.** Damage from a projectile or a falling move waited for it to
   arrive, then landed on the target wherever it had gone, while the effect landed where the target
   had been.
3. **Nothing stopped at walls.** Shots, beams, cones and rings passed through buildings, cliff
   faces, rocks and trunks.
4. **The AI picked contact moves for targets out of reach**, which (with 1) meant hits at range.
5. **A missed contact move drew its impact on the target** it never reached.

## What changed

- **Contact needs contact** (`data.contactReach`, `BattleSystem.resolve`): a contact move or a
  slam lands only on a body its user is touching when it strikes: the two radii (the attacker's
  own counting for at most 1.2 tiles, so a huge sprite gets no extra reach), plus 0.45 tiles of
  slack (`battle.lunge.reachSlack`) for a target still moving in the last frame. A slam counts
  from where it comes down in front of its target.
- **Lunges have a length** (`battle.lunge.maxTiles` = 3, `startLunge`, `stepLunge`): the lunge
  covers at most 3 tiles (times the move's `dash`), at a capped speed, following a target that
  moves. A target further off is lunged at and missed. Measured on the map: Tackle lands from 1 to
  4.5 tiles centre to centre and misses from 5.5 (it lunges 3.2 tiles and stops).
- **Priority dashes** (`dash` in moves.json): Quick Attack and Aqua Jet x1.35, Mach Punch, Bullet
  Punch and Shadow Sneak x1.3, Sucker Punch x1.25: a faster, longer lunge (Quick Attack lands from
  4.4 tiles, not from 6.5). This is the difference between Quick Attack and Tackle; neither hits
  without getting there.
- **Shots land where they were thrown** (`stepFlights`): a target that has moved more than about
  1.3 tiles (plus its body) from where it stood when the move resolved is missed, with a "Missed!"
  label. It used to be hit wherever it had run to.
- **Line of fire** (`match.shotClear`, `BattleSystem.shotLine`): shots, beams, cones and rings stop
  at ground nobody can stand on that isn't water (two samples in a row along the line: walls,
  cliff faces, rocks, trunks, buildings; the half tile at each end is skipped). Moves that fall
  from the sky (Rock Slide, Icicle Crash, Draco Meteor, the legends' drops) and contact moves are
  not affected. Water does not block.
- **The AI only picks a contact move or slam when the target is within its reach**
  (`chooseMove`); otherwise it uses a ranged move or keeps closing in (the battle AIs already
  approach to `moveReach`).
- **Auto-battle aims at its target** (`castToward` with a target): the lead's contact moves lunge
  after the Pokémon it chose instead of at the spot it stood on.
- **A whiffed contact move or slam** plays its impact in the air just in front of its user.
- **Shoves** (`shove`): slams now shove on landing; `knock` scales a move's shove (Dragon Tail
  x2.4: about 0.8 tiles; Heavy Slam x1.6; Body Slam x1.3; Iron Tail and Wave Crash x1.2; Lick and
  Nuzzle x0.5; Bug Bite x0.7; Double Kick and Fury Cutter x0.6). A target already sliding is not
  shoved again (no chains from several attackers at once). Unchanged and still in force: bosses,
  legends, Alphas, Shadow Pokémon, Pokémon mid-leap and much bigger bodies are never shoved, beams
  and other non-contact moves never shove, and walls stop a shove (`tryMove`). No resistance or
  immunity rule was changed.

Unchanged on purpose: damage, cooldowns, power, status chances, cast times and the camera-shake
rule (only the three great legends' moves shake).

## Effects changed (one idea per move, matching what the move does)

See the rows marked **Changed** below: Quick Attack (was identical to Tackle), Brick Break (white
disc white-out), Sleep Powder and Stun Spore (landed as ice), Energy Ball (drain sparkle), Poison
Jab (Psychic's eye ring), Fairy Wind (white disc), Iron Head (electric burst), Ice Punch and Ice
Beam (the freeze block on every hit implied a freeze that happens 10-12% of the time; a real freeze
shows its own status effect), Icy Wind (ice pillar), Lick and Astonish (their effects were swapped
in spirit: claw marks on a lick).

## How it was checked

- **Move Gallery, every move**: each of the 175 moves cast at the practice dummy in a browser
  (Playwright, the dev build); three frames per move captured and looked at (screenshots are in the
  work folder, not committed). In the same run each move's timing was measured: when its damage
  landed and when its effects started (column "Gallery"). Every non-self move landed a hit on the
  dummy and no move's damage came before its effect had started.
- **Combat on the real map** (`server/checks/combat.ts`, now in CI and `scripts/check-server.sh`):
  Tackle at 1 to 6 tiles; Quick Attack at 4.4 and 6.5; four pairs of body sizes (Pikachu, Magikarp,
  Steelix, Wailord) close and far; a target running away and one sidestepping; Rock Throw at a target
  that ran and one that stayed; a real wall on the map (Tackle stopped at it, Ember blocked, Icicle
  Crash over it); shoves for Tackle, Dragon Tail and Body Slam, none from Flamethrower's pulses or on a
  stronger encounter, a shove into a wall stopping on open ground; three Tackles on one target at once.
- **Unit tests** (`src/sim/battle.test.ts`): contact lands close and misses when the lunge never gets
  there; lunge length and the dash; the AI not choosing an out-of-reach contact move; a shot missing a
  target that moved; a wall stopping a shot and not a falling move.
- **A real offline match** in the browser (47 s, auto-battle and the whole island's fights): 254 hits,
  119 of them contact moves, none landed from more than 3 tiles; no page errors.
- **Online**: the full server check suite (online events, lag compensation, bots playing matches on the
  built server) passed. The sim runs on the server, so the rules are the same online; clients do not
  re-decide hits. I did not play an online match in a browser.

## Limitations

- The gallery frames are single moments at three times; effects that last two or three frames at
  the headless browser's 18 fps were often between frames. Timing was measured instead (column).
- The gallery uses one dummy (Sawsbuck) and the earliest learner of each move as the caster, so
  type immunities show "No effect" for some moves (Lick, Shadow Ball, Hex, Night Shade, Shadow
  Sneak, Spectral Thief, Astonish on a Normal dummy); their effects still play.
- Line of fire treats cliff faces as walls, so Pokémon on two levels of a cliff cannot shoot each
  other. A move falling from the sky still can.
- `scripts/moves.py` and `scripts/move_balance.py` are behind `data/moves.json` (66 cooldowns and many
  effects differ). Rerunning `move_balance.py` would change 66 cooldowns; `moves.py` now only fills in
  moves that have no effects unless given ids or `--all`. `scripts/move_audit.py` holds this audit's data
  changes and is safe to rerun.
- Psybeam keeps a cyan wave: the library has no pink beam strip.

## Every move

Columns: move; type, category, power; how it reaches; reach in tiles; effects (status, stat changes,
recoil, shove); effect sheets (`fx_` id and anchor); what the gallery run measured; notes and changes.

| Move | Type | Kind | Reach | Effects | FX | Gallery | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tackle | normal phys 40 | contact lunge | lunge <= 3.0 + touch | - | 001 targ, 067 targ gnd | gallery: hit at 259 ms, effect from 280 ms, lunged 2.02 t | Short bodily impact: lunge, white burst, dust. Measured: lands from 1 to 4.5 tiles, misses from 5.5. |
| Scratch | normal phys 40 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 001 targ | gallery: hit at 104 ms, effect from 129 ms, lunged 1.95 t | No change. |
| Quick Attack | normal phys 40 | contact lunge (dash x1.35) | lunge <= 4.1 + touch | - | 005 targ, 067 targ gnd | gallery: hit at 136 ms, effect from 151 ms, lunged 1.84 t | **Changed.** Effects were identical to Tackle: now a sharp star impact and a lighter dust puff. Dash 1.35: lunges faster and up to 4 tiles. |
| Bite | dark phys 60 | contact lunge | lunge <= 3.0 + touch | - | 118 targ | gallery: hit at 194 ms, effect from 210 ms, lunged 2.02 t | No change. |
| Rock Smash | fighting phys 40 | contact lunge | lunge <= 3.0 + touch | target def -1 (50%) | 148 targ, 023 targ | gallery: hit at 155 ms, effect from 171 ms, lunged 1.6 t | No change. |
| Wing Attack | flying phys 60 | contact lunge | lunge <= 3.0 + touch | - | 146 targ | gallery: hit at 115 ms, effect from 138 ms, lunged 1.98 t | No change. |
| Ember | fire spec 40 | single, projectile | aim <= 5.6, r 1.0 | burn 10% | 134 proj, 126 targ | gallery: hit at 614 ms, effect from 306 ms | No change. |
| Water Gun | water spec 40 | single, beam | aim <= 5.6, r 1.0 | - | 105 atta/beam, 070 targ gnd | gallery: hit at 250 ms, effect from 160 ms | No change. |
| Rock Throw | rock phys 50 | single, projectile | aim <= 5.6, r 1.0 | - | 150 proj, 023 targ | gallery: hit at 661 ms, effect from 344 ms | Thrown: misses a target that runs clear of the landing point (measured). |
| Shadow Ball | ghost spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 186 proj, 037 targ | gallery: hit at 565 ms, effect from 152 ms | No change. |
| Thunder Shock | electric spec 40 | line, beam | line to 5.4 | paralysis 10% | 110 atta/beam, 157 targ | gallery: hit at 169 ms, effect from 112 ms | No change. |
| Razor Leaf | grass phys 55 | cone, projectile | cone to 4.6 | - | 153 proj, 199 targ | gallery: hit at 389 ms, effect from 133 ms | No change. |
| Psybeam | psychic spec 65 | channelled beam | line to 5.4 | confusion 20% | 102 atta/beam, 041 targ | gallery: hit at 367 ms, effect from 265 ms | Channelled beam; the library has no pink beam strip, the cyan wave (fx_102) stays. |
| Ice Beam | ice spec 90 | channelled beam | line to 5.4 | freeze 12% | 109 atta/beam, 204 targ | gallery: hit at 352 ms, effect from 219 ms | **Changed.** Same: the freeze block on every target replaced by an ice shatter (fx_204). Channelled beam. |
| Dark Pulse | dark spec 80 | channelled beam | line to 5.4 | - | 113 atta/beam, 177 targ | gallery: hit at 284 ms, effect from 200 ms | Channelled beam. |
| Discharge | electric spec 80 | ring, at once | ring 0.5-3.7 | paralysis 30% | 233 atta, 157 targ | gallery: hit at 163 ms, effect from 182 ms | No change. |
| Bulldoze | ground phys 60 | ring, at once | ring 0.5-3.7 | - | 026 atta gnd, 067 targ gnd | gallery: hit at 308 ms, effect from 324 ms | No change. |
| Dark Void | dark stat 0 | ring, at once | ring 0.5-3.7 | sleep 60% | 114 atta gnd, 215 targ gnd | gallery: hit at 174 ms, effect from 200 ms | No change. |
| Sleep Powder | grass stat 0 | cone, projectile | cone to 4.6 | sleep 75% | 022 proj, 021 targ | gallery: hit at 767 ms, effect from 277 ms | **Changed.** Landed as Powder Snow's icy puffs (fx_046): now a lavender powder sparkle (fx_021). |
| Thunder Wave | electric stat 0 | single, projectile | aim <= 5.6, r 1.0 | paralysis 90% | 096 proj, 157 targ | gallery: hit at 491 ms, effect from 116 ms | No change. |
| Will-O-Wisp | fire stat 0 | single, projectile | aim <= 5.6, r 1.0 | burn 85% | 208 proj, 035 targ | gallery: hit at 556 ms, effect from 119 ms | No change. |
| Howl | normal stat 0 | self | - | self atk +1 (100%) | 028 atta gnd | gallery: self move, effect at 153 ms | No change. |
| Flamethrower | fire spec 90 | channelled beam | line to 5.4 | burn 10% | 107 atta/beam, 055 targ | gallery: hit at 195 ms, effect from 146 ms | Channelled beam: pulses every 0.25 s, never shoves (measured), stops at walls. |
| Surf | water spec 90 | ring, at once | ring 0.5-3.7 | - | 070 atta gnd, 124 atta gnd, 144 targ | gallery: hit at 194 ms, effect from 212 ms | No change. |
| Thunderbolt | electric spec 90 | channelled beam | line to 5.4 | paralysis 10% | 111 atta/beam, 090 targ | gallery: hit at 254 ms, effect from 135 ms | Channelled beam. |
| Energy Ball | grass spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 173 proj, 202 targ | gallery: hit at 552 ms, effect from 168 ms | **Changed.** Burst into the drain moves' sparkle ring (fx_014): now a green energy burst (fx_202). |
| Crunch | dark phys 80 | contact lunge | lunge <= 3.0 + touch | - | 118 targ, 241 targ | gallery: hit at 115 ms, effect from 130 ms, lunged 1.27 t | No change. |
| Brick Break | fighting phys 75 | contact lunge | lunge <= 3.0 + touch | - | 148 targ, 017 targ | gallery: hit at 168 ms, effect from 183 ms, lunged 1.87 t | **Changed.** Second part was fx_004, a big white disc that whited out the target: now a starburst (fx_017). |
| Earthquake | ground phys 100 | ring, at once | ring 0.5-3.7 | - | 026 atta gnd, 245 atta gnd, 072 targ | gallery: hit at 295 ms, effect from 312 ms | No change. |
| Aerial Ace | flying phys 60 | contact lunge | lunge <= 3.0 + touch | - | 147 targ | gallery: hit at 126 ms, effect from 140 ms, lunged 1.98 t | No change. |
| Poison Jab | poison phys 80 | contact lunge | lunge <= 3.0 + touch | poison 30% | 148 targ, 159 targ | gallery: hit at 129 ms, effect from 148 ms, lunged 1.6 t | **Changed.** Played Psychic's eye ring (fx_041): now a purple jab strike (fx_148) and the poison puff. |
| Sludge Bomb | poison spec 90 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 158 proj, 068 targ gnd | gallery: hit at 466 ms, effect from 128 ms | No change. |
| Rock Slide | rock phys 75 | cone, falls from the sky | cone to 4.6 | - | 240 sky, 023 targ | gallery: hit at 678 ms, effect from 302 ms | No change. |
| Dragon Pulse | dragon spec 85 | channelled beam | line to 5.4 | - | 104 atta/beam, 097 targ | gallery: hit at 431 ms, effect from 330 ms | Channelled beam. |
| Stone Edge | rock phys 100 | single, at once | aim <= 5.6, r 1.0 | - | 244 targ | gallery: hit at 196 ms, effect from 213 ms | Physical but not contact (spikes rise under the target): ranged single, no lunge. Correct. |
| Wild Charge | electric phys 90 | contact lunge | lunge <= 3.0 + touch | recoil 0.25 | 232 atta, 073 targ, 233 targ | gallery: hit at 168 ms, effect from 184 ms, lunged 1.92 t | No change. |
| X-Scissor | bug phys 80 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 123 targ | gallery: hit at 190 ms, effect from 205 ms, lunged 2.03 t | No change. |
| Return | normal phys 90 | contact lunge | lunge <= 3.0 + touch | - | 017 targ | gallery: hit at 114 ms, effect from 129 ms, lunged 1.86 t | No change. |
| Poison Sting | poison phys 25 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 129 proj, 159 targ | gallery: hit at 436 ms, effect from 300 ms | No change. |
| Bug Bite | bug phys 60 | contact lunge | lunge <= 3.0 + touch | knock x0.7 | 118 targ | gallery: hit at 204 ms, effect from 219 ms, lunged 2.03 t | **Changed.** Knock x0.7. |
| Leafage | grass phys 40 | single, projectile | aim <= 5.6, r 1.0 | - | 199 proj, 001 targ | gallery: hit at 566 ms, effect from 295 ms | No change. |
| Powder Snow | ice spec 40 | cone, projectile | cone to 4.6 | freeze 12% | 046 proj, 204 targ | gallery: hit at 687 ms, effect from 316 ms | No change. |
| Ice Shard | ice phys 40 | single, projectile | aim <= 5.6, r 1.0 | - | 136 proj, 204 targ | gallery: hit at 448 ms, effect from 284 ms | No change. |
| Icicle Crash | ice phys 85 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 198 sky, 066 targ | gallery: hit at 400 ms, effect from 117 ms | Falls from the sky: not stopped by walls (measured), by design. |
| Fairy Wind | fairy spec 40 | single, projectile | aim <= 5.6, r 1.0 | - | 160 proj, 205 targ | gallery: hit at 598 ms, effect from 337 ms | **Changed.** Threw a big white disc (fx_203): now a pink gust (fx_160). |
| Dazzling Gleam | fairy spec 80 | ring, at once | ring 0.5-3.7 | - | 203 atta, 205 atta gnd, 041 targ | gallery: hit at 207 ms, effect from 224 ms | No change. |
| Confusion | psychic spec 50 | single, at once | aim <= 5.6, r 1.0 | confusion 20% | 214 targ | gallery: hit at 293 ms, effect from 314 ms | No change. |
| Psycho Cut | psychic phys 70 | single, projectile | aim <= 5.6, r 1.0 | - | 130 proj, 123 targ | gallery: hit at 269 ms, effect from 71 ms | Physical projectile (a thrown blade): no lunge. Correct. |
| Hypnosis | psychic stat 0 | single, at once | aim <= 5.6, r 1.0 | sleep 60% | 190 targ | gallery: hit at 173 ms, effect from 195 ms | No change. |
| Iron Head | steel phys 80 | contact lunge | lunge <= 3.0 + touch | - | 017 targ, 005 targ | gallery: hit at 113 ms, effect from 131 ms, lunged 1.86 t | **Changed.** Struck with an electric burst (fx_073): now a steel-tinted starburst (fx_017). |
| Mud Shot | ground spec 55 | single, projectile | aim <= 5.6, r 1.0 | - | 183 proj, 083 targ gnd | gallery: hit at 590 ms, effect from 315 ms | No change. |
| Dragon Breath | dragon spec 60 | cone, beam | cone to 4.6 | paralysis 30% | 107 atta/beam, 031 targ | gallery: hit at 226 ms, effect from 72 ms | No change. |
| Growl | normal stat 0 | cone, projectile | cone to 4.6 | target atk -1 (100%) | 167 proj, 133 targ | gallery: hit at 537 ms, effect from 186 ms | No change. |
| Leer | normal stat 0 | cone, at once | cone to 4.6 | target def -1 (100%) | 190 targ | gallery: hit at 287 ms, effect from 301 ms | No change. |
| Scary Face | normal stat 0 | single, at once | aim <= 5.6, r 1.0 | target spe -2 (100%) | 196 targ, 190 targ gnd | gallery: hit at 265 ms, effect from 281 ms | No change. |
| Headbutt | normal phys 70 | contact lunge | lunge <= 3.0 + touch | - | 017 targ, 036 targ | gallery: hit at 208 ms, effect from 222 ms, lunged 2.02 t | No change. |
| Body Slam | normal phys 85 | slam (leap) | jump <= 4.2 + touch | paralysis 30%; knock x1.3 | 017 targ, 067 targ gnd | gallery: hit at 602 ms, effect from 626 ms, lunged 2.33 t | **Changed.** Slams now shove on landing (knock x1.3) and land only if the slam came down touching the target. |
| Double-Edge | normal phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33 | 017 targ, 148 targ | gallery: hit at 125 ms, effect from 140 ms, lunged 1.84 t | No change. |
| Hyper Voice | normal spec 90 | ring, at once | ring 0.5-3.7 | - | 024 atta gnd, 133 targ | gallery: hit at 152 ms, effect from 167 ms | No change. |
| Swift | normal spec 60 | single, projectile | aim <= 5.6, r 1.0 | - | 176 proj, 005 targ | gallery: hit at 351 ms, effect from 114 ms | No change. |
| Slash | normal phys 70 | contact lunge | lunge <= 3.0 + touch | - | 147 targ, 116 targ | gallery: hit at 180 ms, effect from 201 ms, lunged 2.02 t | No change. |
| Sing | normal stat 0 | single, projectile | aim <= 5.6, r 1.0 | sleep 55% | 168 proj, 133 targ | gallery: hit at 674 ms, effect from 134 ms | No change. |
| Harden | normal stat 0 | self | - | self def +1 (100%) | 012 atta gnd | gallery: self move, effect at 135 ms | No change. |
| Swords Dance | normal stat 0 | self | - | self atk +2 (100%) | 024 atta gnd | gallery: self move, effect at 182 ms | No change. |
| Agility | psychic stat 0 | self | - | self spe +2 (100%) | 146 atta | gallery: self move, effect at 173 ms | No change. |
| Karate Chop | fighting phys 50 | contact lunge | lunge <= 3.0 + touch | - | 148 targ | gallery: hit at 179 ms, effect from 194 ms, lunged 1.87 t | No change. |
| Low Kick | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | - | 148 targ, 067 targ gnd | gallery: hit at 113 ms, effect from 128 ms, lunged 1.87 t | No change. |
| Double Kick | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | knock x0.6 | 001 targ, 001 targ | gallery: hit at 119 ms, effect from 136 ms, lunged 1.79 t | **Changed.** Knock x0.6. Two impacts 0.16 s apart, one damage roll (as before). |
| Force Palm | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | paralysis 30% | 148 targ | gallery: hit at 152 ms, effect from 167 ms, lunged 1.87 t | No change. |
| Aura Sphere | fighting spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 172 proj, 012 targ | gallery: hit at 643 ms, effect from 279 ms | No change. |
| Close Combat | fighting phys 120 | contact lunge | lunge <= 3.0 + touch | self def -1 (100%) | 017 targ, 148 targ, 017 targ | gallery: hit at 159 ms, effect from 179 ms, lunged 1.87 t | Three staggered impacts, one damage roll. |
| Bulk Up | fighting stat 0 | self | - | self atk +1 (100%); self def +1 (100%) | 028 atta gnd | gallery: self move, effect at 175 ms | No change. |
| Gust | flying spec 40 | single, projectile | aim <= 5.6, r 1.0 | - | 160 proj, 200 targ | gallery: hit at 445 ms, effect from 133 ms | No change. |
| Peck | flying phys 35 | contact lunge | lunge <= 3.0 + touch | - | 001 targ | gallery: hit at 201 ms, effect from 215 ms, lunged 1.98 t | No change. |
| Air Slash | flying spec 75 | single, projectile | aim <= 5.6, r 1.0 | - | 130 proj, 147 targ | gallery: hit at 678 ms, effect from 496 ms | No change. |
| Brave Bird | flying phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33 | 147 targ, 001 targ | gallery: hit at 75 ms, effect from 96 ms, lunged 1.11 t | No change. |
| Flame Wheel | fire phys 60 | contact lunge | lunge <= 3.0 + touch | burn 10% | 075 targ, 126 targ | gallery: hit at 151 ms, effect from 165 ms, lunged 1.95 t | No change. |
| Fire Fang | fire phys 65 | contact lunge | lunge <= 3.0 + touch | burn 10% | 118 targ, 126 targ | gallery: hit at 148 ms, effect from 162 ms, lunged 1.95 t | No change. |
| Fire Punch | fire phys 75 | contact lunge | lunge <= 3.0 + touch | burn 10% | 148 targ, 126 targ | gallery: hit at 158 ms, effect from 174 ms, lunged 1.95 t | No change. |
| Fire Spin | fire spec 35 | single, at once | aim <= 5.6, r 1.0 | burn 20% | 087 targ gnd, 069 targ | gallery: hit at 63 ms, effect from 86 ms | No change. |
| Heat Wave | fire spec 95 | cone, projectile | cone to 4.6 | burn 10% | 074 proj, 053 targ | gallery: hit at 494 ms, effect from 142 ms | No change. |
| Fire Blast | fire spec 110 | single, projectile | aim <= 5.6, r 1.0 | burn 10% | 222 proj, 040 targ, 087 targ gnd | gallery: hit at 535 ms, effect from 186 ms | No change. |
| Bubble | water spec 40 | cone, projectile | cone to 4.6 | - | 162 proj, 225 targ | gallery: hit at 688 ms, effect from 287 ms | No change. |
| Bubble Beam | water spec 65 | single, projectile | aim <= 5.6, r 1.0 | target spe -1 (10%) | 227 proj, 228 targ | gallery: hit at 363 ms, effect from 78 ms | No change. |
| Water Pulse | water spec 60 | single, projectile | aim <= 5.6, r 1.0 | confusion 20% | 163 proj, 124 targ gnd, 144 targ | gallery: hit at 520 ms, effect from 92 ms | No change. |
| Aqua Tail | water phys 90 | contact lunge | lunge <= 3.0 + touch | - | 144 targ, 070 targ gnd | gallery: hit at 119 ms, effect from 132 ms, lunged 1.89 t | No change. |
| Hydro Pump | water spec 110 | channelled beam | line to 5.4 | - | 105 atta/beam, 256 targ | gallery: hit at 387 ms, effect from 186 ms | Channelled beam. |
| Spark | electric phys 65 | contact lunge | lunge <= 3.0 + touch | paralysis 30% | 201 targ | gallery: hit at 199 ms, effect from 216 ms, lunged 1.92 t | No change. |
| Thunder Fang | electric phys 65 | contact lunge | lunge <= 3.0 + touch | paralysis 10% | 118 targ, 157 targ | gallery: hit at 228 ms, effect from 255 ms, lunged 1.92 t | No change. |
| Thunder Punch | electric phys 75 | contact lunge | lunge <= 3.0 + touch | paralysis 10% | 148 targ, 090 targ | gallery: hit at 144 ms, effect from 159 ms, lunged 1.92 t | No change. |
| Charge Beam | electric spec 50 | line, beam | line to 5.4 | self atk +1 (20%) | 098 atta/beam, 157 targ | gallery: hit at 166 ms, effect from 80 ms | No change. |
| Thunder | electric spec 110 | single, at once | aim <= 5.6, r 1.0 | paralysis 30% | 254 targ, 090 targ | gallery: hit at 146 ms, effect from 164 ms | No change. |
| Stun Spore | grass stat 0 | cone, projectile | cone to 4.6 | paralysis 75% | 022 proj, 021 targ | gallery: hit at 573 ms, effect from 118 ms | **Changed.** Landed as icy puffs (fx_046): now a yellow powder sparkle (fx_021). |
| Vine Whip | grass phys 45 | contact lunge | lunge <= 3.0 + touch | - | 064 targ | gallery: hit at 163 ms, effect from 177 ms, lunged 2.02 t | No change. |
| Absorb | grass spec 30 | single, at once | aim <= 5.6, r 1.0 | - | 021 targ, 021 atta | gallery: hit at 154 ms, effect from 186 ms | No change. |
| Mega Drain | grass spec 40 | single, at once | aim <= 5.6, r 1.0 | - | 022 targ, 014 atta | gallery: hit at 93 ms, effect from 107 ms | No change. |
| Giga Drain | grass spec 75 | single, at once | aim <= 5.6, r 1.0 | - | 014 targ, 022 targ, 014 atta | gallery: hit at 194 ms, effect from 207 ms | No change. |
| Magical Leaf | grass spec 60 | single, projectile | aim <= 5.6, r 1.0 | - | 199 proj, 001 targ | gallery: hit at 462 ms, effect from 124 ms | No change. |
| Seed Bomb | grass phys 80 | single, projectile | aim <= 5.6, r 1.0 | - | 125 proj, 029 targ | gallery: hit at 396 ms, effect from 109 ms | Physical projectile. Correct. |
| Leaf Blade | grass phys 90 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 199 targ | gallery: hit at 197 ms, effect from 212 ms, lunged 2.02 t | No change. |
| Solar Beam | grass spec 120 | channelled beam | line to 5.4 | - | 112 atta/stream, 014 targ | gallery: hit at 118 ms, effect from 134 ms | Channelled stream. |
| Ice Fang | ice phys 65 | contact lunge | lunge <= 3.0 + touch | freeze 10% | 118 targ, 046 targ | gallery: hit at 185 ms, effect from 200 ms, lunged 1.82 t | No change. |
| Ice Punch | ice phys 75 | contact lunge | lunge <= 3.0 + touch | freeze 12% | 046 targ, 204 targ | gallery: hit at 133 ms, effect from 150 ms, lunged 1.84 t | **Changed.** Encased every target in the freeze block (fx_076) though it freezes 12% of the time: now an ice shatter (fx_204); a real freeze shows the freeze status effect. |
| Aurora Beam | ice spec 65 | channelled beam | line to 5.4 | target atk -1 (10%) | 108 atta/beam, 204 targ | gallery: hit at 391 ms, effect from 316 ms | Channelled beam. |
| Icy Wind | ice spec 55 | cone, projectile | cone to 4.6 | target spe -1 (30%) | 200 proj, 046 targ | gallery: hit at 475 ms, effect from 123 ms | **Changed.** Raised an ice pillar (fx_047) on each target: now frost puffs (fx_046). Sweep carrier (grounded gust). |
| Avalanche | ice phys 60 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 094 sky, 046 targ | gallery: hit at 582 ms, effect from 167 ms | No change. |
| Blizzard | ice spec 110 | ring, at once | ring 0.5-3.7 | freeze 12% | 028 atta gnd, 046 atta, 066 targ | gallery: hit at 175 ms, effect from 196 ms | No change. |
| Acid | poison spec 40 | cone, projectile | cone to 4.6 | poison 15%; target def -1 (10%) | 159 proj, 235 targ gnd | gallery: hit at 634 ms, effect from 118 ms | No change. |
| Smog | poison spec 30 | cone, projectile | cone to 4.6 | poison 20% | 056 proj, 056 targ | gallery: hit at 563 ms, effect from 91 ms | No change. |
| Poison Fang | poison phys 50 | contact lunge | lunge <= 3.0 + touch | poison 30% | 118 targ, 159 targ | gallery: hit at 171 ms, effect from 187 ms, lunged 1.7 t | No change. |
| Sludge | poison spec 65 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 158 proj, 056 targ | gallery: hit at 598 ms, effect from 126 ms | No change. |
| Mud-Slap | ground spec 30 | single, projectile | aim <= 5.6, r 1.0 | - | 183 proj, 083 targ gnd | gallery: hit at 534 ms, effect from 299 ms | No change. |
| Sand Attack | ground stat 0 | cone, projectile | cone to 4.6 | target spe -1 (100%) | 023 proj, 067 targ gnd | gallery: hit at 758 ms, effect from 537 ms | No change. |
| Sand Tomb | ground phys 35 | single, at once | aim <= 5.6, r 1.0 | - | 067 targ gnd, 200 targ | gallery: hit at 156 ms, effect from 172 ms | Physical, not contact (the sand rises round the target). Correct. |
| Drill Run | ground phys 80 | contact lunge | lunge <= 3.0 + touch | - | 200 targ, 072 targ | gallery: hit at 165 ms, effect from 180 ms, lunged 1.84 t | No change. |
| Earth Power | ground spec 90 | single, at once | aim <= 5.6, r 1.0 | - | 026 targ gnd, 089 targ | gallery: hit at 293 ms, effect from 312 ms | No change. |
| String Shot | bug stat 0 | cone, projectile | cone to 4.6 | target spe -2 (100%) | 131 proj, 048 targ | gallery: hit at 324 ms, effect from 119 ms | No change. |
| Struggle Bug | bug spec 50 | cone, at once | cone to 4.6 | target atk -1 (30%) | 120 targ | gallery: hit at 229 ms, effect from 244 ms | No change. |
| Fury Cutter | bug phys 40 | contact lunge | lunge <= 3.0 + touch | knock x0.6 | 123 targ | gallery: hit at 172 ms, effect from 189 ms, lunged 2.03 t | **Changed.** Knock x0.6. |
| Signal Beam | bug spec 75 | channelled beam | line to 5.4 | confusion 15% | 099 atta/beam, 041 targ | gallery: hit at 264 ms, effect from 229 ms | Channelled beam. |
| Bug Buzz | bug spec 90 | ring, at once | ring 0.5-3.7 | - | 024 atta gnd, 001 targ | gallery: hit at 214 ms, effect from 239 ms | No change. |
| Rock Tomb | rock phys 60 | single, falls from the sky | aim <= 5.6, r 1.0 | target spe -1 (30%) | 149 sky, 023 targ | gallery: hit at 455 ms, effect from 100 ms | No change. |
| Ancient Power | rock spec 60 | single, projectile | aim <= 5.6, r 1.0 | self atk +1 (10%); self def +1 (10%) | 240 proj, 023 targ | gallery: hit at 466 ms, effect from 117 ms | No change. |
| Smack Down | rock phys 50 | single, projectile | aim <= 5.6, r 1.0 | - | 150 proj, 023 targ | gallery: hit at 355 ms, effect from 191 ms | No change. |
| Power Gem | rock spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 253 proj, 005 targ | gallery: hit at 309 ms, effect from 116 ms | No change. |
| Lick | ghost phys 30 | contact lunge | lunge <= 3.0 + touch | paralysis 30%; knock x0.5 | 049 targ | gallery: hit at 168 ms, effect from 196 ms, lunged 1.72 t | **Changed.** Showed claw marks (fx_116): now a pink splat (fx_049). Shove x0.5. |
| Astonish | ghost phys 30 | contact lunge | lunge <= 3.0 + touch | - | 196 targ | gallery: hit at 124 ms, effect from 140 ms, lunged 1.88 t | **Changed.** Had the splat that suits a lick: now jagged shock lines (fx_196). |
| Shadow Claw | ghost phys 70 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 241 targ | gallery: hit at 129 ms, effect from 145 ms, lunged 1.84 t | No change. |
| Hex | ghost spec 65 | single, at once | aim <= 5.6, r 1.0 | - | 061 targ gnd, 186 targ | gallery: hit at 156 ms, effect from 176 ms | No change. |
| Night Shade | ghost spec 50 | single, beam | aim <= 5.6, r 1.0 | - | 050 atta/stream, 042 targ | gallery: hit at 174 ms, effect from 189 ms | No change. |
| Shadow Sneak | ghost phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 187 targ | gallery: hit at 64 ms, effect from 78 ms, lunged 1.88 t | **Changed.** Dash 1.3 (priority). |
| Dragon Claw | dragon phys 80 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 031 targ | gallery: hit at 180 ms, effect from 195 ms, lunged 1.84 t | No change. |
| Twister | dragon spec 40 | line, projectile | line to 5.4 | - | 081 proj, 200 targ | gallery: hit at 579 ms, effect from 158 ms | Sweep: one tornado crosses the line, impacts as it passes each target. |
| Outrage | dragon phys 120 | contact lunge | lunge <= 3.0 + touch | - | 024 atta gnd, 053 targ, 017 targ | gallery: hit at 157 ms, effect from 175 ms, lunged 1.84 t | No change. |
| Draco Meteor | dragon spec 130 | single, falls from the sky | aim <= 5.6, r 1.0 | self atk -2 (100%) | 132 sky, 043 targ | gallery: hit at 791 ms, effect from 210 ms | No change. |
| Dragon Dance | dragon stat 0 | self | - | self atk +1 (100%); self spe +1 (100%) | 024 atta gnd, 097 atta/status | gallery: self move, effect at 202 ms | No change. |
| Feint Attack | dark phys 60 | contact lunge | lunge <= 3.0 + touch | - | 241 targ | gallery: hit at 168 ms, effect from 183 ms, lunged 1.99 t | No change. |
| Night Slash | dark phys 70 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 121 targ | gallery: hit at 139 ms, effect from 155 ms, lunged 1.99 t | No change. |
| Snarl | dark spec 55 | cone, at once | cone to 4.6 | target atk -1 (30%) | 177 targ | gallery: hit at 99 ms, effect from 114 ms | No change. |
| Sucker Punch | dark phys 70 | contact lunge (dash x1.25) | lunge <= 3.8 + touch | - | 148 targ | gallery: hit at 105 ms, effect from 120 ms, lunged 1.72 t | **Changed.** Dash 1.25 (priority). |
| Nasty Plot | dark stat 0 | self | - | self atk +2 (100%) | 034 atta/status | gallery: self move, effect at 204 ms | No change. |
| Metal Claw | steel phys 50 | contact lunge | lunge <= 3.0 + touch | self atk +1 (10%) | 123 targ | gallery: hit at 148 ms, effect from 168 ms, lunged 1.87 t | No change. |
| Iron Tail | steel phys 100 | contact lunge | lunge <= 3.0 + touch | target def -1 (30%); knock x1.2 | 147 targ, 001 targ | gallery: hit at 131 ms, effect from 149 ms, lunged 1.86 t | **Changed.** Knock x1.2. |
| Flash Cannon | steel spec 80 | channelled beam | line to 5.4 | - | 101 atta/stream, 005 targ | gallery: hit at 131 ms, effect from 152 ms | Channelled stream. |
| Bullet Punch | steel phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 001 targ | gallery: hit at 140 ms, effect from 154 ms, lunged 1.86 t | **Changed.** Dash 1.3 (priority). |
| Steel Wing | steel phys 70 | contact lunge | lunge <= 3.0 + touch | - | 146 targ | gallery: hit at 103 ms, effect from 120 ms, lunged 1.72 t | No change. |
| Iron Defense | steel stat 0 | self | - | self def +2 (100%) | 012 atta gnd, 142 atta/status | gallery: self move, effect at 159 ms | No change. |
| Heavy Slam | steel phys 80 | slam (leap) | jump <= 4.2 + touch | knock x1.6 | 017 targ, 067 targ gnd | gallery: hit at 717 ms, effect from 734 ms, lunged 2.09 t | **Changed.** Knock x1.6 on landing; lands only if the slam came down touching the target. |
| Psychic | psychic spec 90 | single, at once | aim <= 5.6, r 1.0 | target def -1 (10%) | 214 targ, 188 targ | gallery: hit at 165 ms, effect from 183 ms | No change. |
| Zen Headbutt | psychic phys 80 | contact lunge | lunge <= 3.0 + touch | - | 203 targ, 017 targ | gallery: hit at 97 ms, effect from 120 ms, lunged 1.86 t | No change. |
| Calm Mind | psychic stat 0 | self | - | self atk +1 (100%); self def +1 (100%) | 214 atta/status | gallery: self move, effect at 231 ms | No change. |
| Disarming Voice | fairy spec 40 | ring, at once | ring 0.5-3.7 | - | 205 atta gnd, 041 targ | gallery: hit at 270 ms, effect from 286 ms | No change. |
| Draining Kiss | fairy spec 50 | single, projectile | aim <= 5.6, r 1.0 | - | 152 proj, 041 targ, 014 atta | gallery: hit at 637 ms, effect from 302 ms | No change. |
| Moonblast | fairy spec 95 | single, falls from the sky | aim <= 5.6, r 1.0 | target atk -1 (30%) | 205 sky, 188 targ | gallery: hit at 623 ms, effect from 139 ms | No change. |
| Play Rough | fairy phys 90 | contact lunge | lunge <= 3.0 + touch | target atk -1 (10%) | 031 targ, 001 targ, 001 targ | gallery: hit at 80 ms, effect from 100 ms, lunged 1.18 t | Three staggered impacts, one damage roll. |
| Charm | fairy stat 0 | single, projectile | aim <= 5.6, r 1.0 | target atk -2 (100%) | 152 proj, 041 targ, 152 targ/status | gallery: hit at 523 ms, effect from 136 ms | No change. |
| Aeroblast | flying spec 100 | channelled beam | line to 5.4 | - | 103 atta/stream, 200 targ, 067 targ gnd | gallery: hit at 610 ms, effect from 633 ms | Channelled stream (Lugia). |
| Sacred Fire | fire phys 100 | single, falls from the sky | aim <= 5.6, r 1.0 | burn 50% | 222 sky, 175 targ gnd, 255 targ, 191 targ | gallery: hit at 1251 ms, effect from 661 ms | No change. |
| Dragon Ascent | flying phys 120 | single, falls from the sky | aim <= 5.6, r 1.0 | self def -1 (100%) | 210 sky, 223 targ, 067 targ gnd, 246 targ gnd | gallery: hit at 1601 ms, effect from 798 ms | No change. |
| Luster Purge | psychic spec 95 | single, at once | aim <= 5.6, r 1.0 | target def -1 (50%) | 093 targ, 197 targ, 190 targ gnd | gallery: hit at 521 ms, effect from 538 ms | No change. |
| Doom Desire | steel spec 140 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 239 sky, 223 targ, 175 targ gnd, 239 targ | gallery: hit at 1989 ms, effect from 770 ms | No change. |
| Hyperspace Hole | psychic spec 80 | single, at once | aim <= 5.6, r 1.0 | - | 190 targ gnd, 196 targ, 197 targ | gallery: hit at 581 ms, effect from 601 ms | No change. |
| Spectral Thief | ghost phys 90 | contact lunge | lunge <= 3.0 + touch | - | 242 targ, 206 targ, 187 targ | gallery: hit at 153 ms, effect from 185 ms, lunged 1.72 t | Contact with a 0.45 s cast; as V-create. |
| V-create | fire phys 180 | contact lunge | lunge <= 3.0 + touch | self def -1 (100%); self spe -1 (100%) | 175 targ gnd, 255 targ, 223 targ | gallery: hit at 67 ms, effect from 87 ms, lunged 1.72 t | Contact with a 0.7 s cast: the lunge sets the strike time, so the wind-up is the lunge itself. |
| Shadow Storm | dark spec 75 | ring, at once | ring 0.5-3.7 | - | 114 atta gnd, 200 atta, 200 targ | gallery: hit at 896 ms, effect from 916 ms | No change. |
| Flame Charge | fire phys 50 | contact lunge | lunge <= 3.0 + touch | self spe +1 (100%) | 209 atta gnd, 075 targ, 126 targ | gallery: hit at 131 ms, effect from 148 ms, lunged 1.95 t | No change. |
| Flare Blitz | fire phys 120 | contact lunge | lunge <= 3.0 + touch | burn 10%; recoil 0.33 | 075 targ, 148 targ, 126 targ | gallery: hit at 162 ms, effect from 177 ms, lunged 1.95 t | No change. |
| Aqua Jet | water phys 40 | contact lunge (dash x1.35) | lunge <= 4.1 + touch | - | 144 targ, 070 targ gnd | gallery: hit at 101 ms, effect from 116 ms, lunged 1.85 t | **Changed.** Dash 1.35 (priority): faster, longer lunge. |
| Razor Shell | water phys 75 | contact lunge | lunge <= 3.0 + touch | target def -1 (50%) | 116 targ, 070 targ gnd | gallery: hit at 149 ms, effect from 164 ms, lunged 1.9 t | No change. |
| Waterfall | water phys 80 | contact lunge | lunge <= 3.0 + touch | - | 144 targ, 070 targ gnd | gallery: hit at 123 ms, effect from 137 ms, lunged 1.78 t | No change. |
| Wave Crash | water phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33; knock x1.2 | 144 targ, 017 targ, 070 targ gnd | gallery: hit at 110 ms, effect from 124 ms, lunged 1.28 t | **Changed.** Knock x1.2. |
| Mach Punch | fighting phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 001 targ, 017 targ | gallery: hit at 124 ms, effect from 140 ms, lunged 1.95 t | **Changed.** Dash 1.3 (priority). |
| Dragon Tail | dragon phys 60 | contact lunge | lunge <= 3.0 + touch | knock x2.4 | 147 targ, 001 targ | gallery: hit at 176 ms, effect from 199 ms, lunged 1.84 t | **Changed.** Knock x2.4: throws its target clear (0.8 tiles measured), the one move whose point is the shove. |
| Mirror Shot | steel spec 65 | single, projectile | aim <= 5.6, r 1.0 | target atk -1 (30%) | 221 proj, 005 targ | gallery: hit at 325 ms, effect from 121 ms | No change. |
| Nuzzle | electric phys 20 | contact lunge | lunge <= 3.0 + touch | paralysis 100%; knock x0.5 | 201 targ, 157 targ | gallery: hit at 151 ms, effect from 167 ms, lunged 1.92 t | **Changed.** Knock x0.5 (a nuzzle, not a shove). |

