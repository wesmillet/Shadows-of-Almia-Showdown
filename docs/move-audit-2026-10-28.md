# Move audit: 28 October 2026 (corrected the same day)

Every move in `data/moves.json` (175) reviewed one by one: numbers and shape, how it reaches its
target (contact lunge, slam, projectile, beam, falling, area, self), what its effects show, how it
played in the Move Gallery and in combat on the real map. One row per move at the end.

This version replaces the first one. That one claimed "no move's damage came before its effect had
started"; its own numbers (Tackle: hit 259 ms, effect 280 ms) contradicted it, and an effect that has
started says nothing about whether the impact and the HP drop line up. The corrections are below,
with what was measured and how.

## How the moves were measured (and how the first audit got it wrong)

The first audit timed moves in a real-time headless browser running at 12 to 18 frames a second:
two clocks (the page's wall clock for the hit, the effect list for the effects), a starting point
taken after the gallery had already cast, and only three screenshots per move. Its numbers were
not comparable with each other.

This time the browser's clock and `requestAnimationFrame` are driven by hand, one 1/60 s frame at a
time, so every frame is simulated and rendered (`framestep.cjs`, in the work folder). On that one
clock, for every move: the cast, the planned strike (the move's `cast`, or the attack animation's
strike frame), the lunge or leap, the strike (the move resolving), the damage (`landHit`), and the
first frame in which the impact effect is actually drawn. Separately, nine consecutive frames around
every move's hit were captured and looked at (175 strips), plus longer runs for the moves whose
effects were in doubt.

## What the measurements showed, and the fixes

1. **Impacts and damage were out of step for 31 moves.** Beams and streams (Flamethrower, Ice
   Beam, Water Gun...) drew their impact the moment they fired and dealt the damage 0.1 s later; ring
   and area moves with a delayed impact (Earthquake, Surf, Blizzard...) dealt damage up to 0.2 s
   before the impact appeared; projectiles drew their impact one frame (sometimes 3, for Ember) before
   the damage, because the flight on screen was timed separately from the simulation's. Now the
   damage waits for the move's first impact (`battle.strikeDelay`), beam impacts wait for the beam to
   reach out (`BEAM_REACH`), a projectile's flight on screen takes exactly the simulation's time (read
   from the hit in flight), effects added during a step start on the next frame like the simulation
   does, and a hit-stop holds shots in flight too. Measured after: in all 166 moves that strike a target
   the damage and the first drawn impact are in the same frame (the other 9 are set-up moves on the
   user, with no target).
2. **The white hit flash hid impacts.** The two-frame white flash lasted through the whole hit-stop
   (seven frames), so the body was flat white while the impact was drawn on it. It is now two frames.
3. **Impacts began as specks.** 59 effect sheets start with nearly empty frames (a burst still a few
   pixels); an impact on a Pokémon hit now starts past them (`lead_in` in the manifest,
   `scripts/fx_lead_in.py`), so it is at full size in the frame the HP drops.
4. **Lunges skipped wind-ups.** A contact move's lunge set its strike time to the lunge's length,
   so V-create (0.7 s wind-up) struck after 0.133 s and Spectral Thief (0.45 s) after 0.133 s
   (frame-stepped on the 28 October build). Now the user winds up where it stands and then lunges,
   striking on its planned time (V-create 0.75 s, Spectral Thief 0.50 s); the priority dashes
   (`dash`) still go at once. No other move struck before its planned time.
5. **Vine Whip** charged in bodily like Tackle and grew vines over a third of a second. It now lashes
   from range (`reach`: up to about 2.7 tiles past its body without moving) with a thin vine and a cut.
6. **Draining moves did not heal.** Absorb, Mega Drain, Giga Drain and Draining Kiss had no
   healing in the code at all (the first audit's table simply had no column for it). Now (`drain`)
   the user gets back a share of the HP the hit actually took (half; Draining Kiss three quarters),
   never past full, nothing on a miss, nothing once fainted, and a target's last HP counts only for
   what it really lost. No type is immune to Grass or Fairy, so there is no immunity case; none of the
   four is channelled or multi-hit. Unit tests cover each case.
7. **Online, a remote player's hit could show before its lunge.** In the first two-browser test the
   other player's Tackle showed its damage while its attacker was still drawn 4.3 tiles away: the
   update's events played at once while its positions were still gliding in. Events now wait for
   their update's glide (`mirror.ts`); the last blow of a match is shown, not dropped.
8. Fairy Wind's flat disc impact replaced by a sparkle burst.

## Contact and collision (kept, extended)

`server/checks/combat.ts` (in CI) still checks Tackle at 1 to 6 tiles, Quick Attack's dash, four
pairs of body sizes, a running and a sidestepping target, a thrown shot at a target that ran, a real
wall (contact, shot, falling move), shoves, and three attackers at once. Added: the space between
the two drawn bodies at the moment of the hit, for small and large Pokémon (at most 0.5 tiles,
measured in the step the hit lands), and Vine Whip's reach (lands from 3.2 tiles without moving,
not from 7.5).

## The effects library

All 256 Guardian Signs sheets were looked at on the contact sheet (`assets/fx/guardian_signs`),
their families as the README groups them. 142 are used by moves and 6 more by the interface; 108
are not used. The unused are mostly duplicates of used ones in other colours or sizes, single-frame
fragments meant as projectiles (sparks, leaves, shards), long ambient loops (56-frame auras), and
the large legend-scale eruptions already used once each. An effect was replaced only where the one
used showed the wrong thing (ice on a powder, an electric burst on a steel strike, a freeze block on
a hit that rarely freezes, claw marks on a lick); effects that read correctly in the frame strips were
kept, even where a colour match existed elsewhere.

## Online

Two browsers, one local server (`SERVER_KIND=dev`, 80 ms of simulated latency each way,
`DEV_GATHER=1` to start them side by side), each browser clicking its moves at the other's Pokémon,
recorded on video, five matches, in some of them one browser dropped offline for 4 seconds.

- In every match both browsers showed the same hits, the same damage and the same result.
- Contact hits: before the event fix, the remote screen showed a Tackle's damage with its attacker
  still drawn 4.31 tiles away; after it, every contact hit on both screens was shown with the bodies
  0.3 to 1.42 tiles apart centre to centre (touching, for these sizes).
- Reconnecting mid-match: one browser dropped at 9 s; play resumed when it came back and both screens
  went on to show the same 19 hits. In two other matches the dropped player lost while offline and
  came back to its result screen.
- No player's Pokémon jumped on screen (a few wild ones far off moved over a tile between the slow
  headless frames). The headless browsers ran at about 5 frames a second under the recorder, so the
  videos are choppy; frame-level timing was checked offline with the stepped clock.
- Not seen online: a Pokémon fainting on both screens after the event fix (these level-5 duels ended
  by the battle's own rules before a knockout; the code path that shows the last blow was changed
  but not watched in a browser), a shove seen from the far side, and real packet loss beyond the
  simulated latency.

## Limitations

- The Move Gallery uses one dummy (Sawsbuck) and the earliest learner as the caster, so a few moves
  show "No effect" on it (Ghost moves on a Normal type); their effects still play.
- Line of fire treats cliff faces as walls (only falling moves reach across levels).
- Psybeam keeps its cyan wave: the library has no pink beam strip.

## The move library's source and rebuild order

`data/moves.json` is the source of truth. The three scripts each own some fields and, run in the
supported order, rebuild it unchanged (`bash scripts/check_moves.sh`, in CI):

    python3 scripts/moves.py && python3 scripts/move_balance.py && python3 scripts/move_audit.py

- `moves.py`: first numbers and effect recipes for moves not yet in the library. It no longer
  rewrites existing moves (it used to reset 65 cooldowns, 23 animations and Twister's shape);
  `--reset id` and `--all` do that on purpose.
- `move_balance.py`: cooldowns from one formula, animations, recoil, origins, the TM list. It now
  keeps Sucker Punch's hand-set 2.4 s (the only cooldown off the formula) and the current TM comment.
  Its cooldowns already matched the library: the "66 cooldowns" in the first audit were what
  `moves.py` would have overwritten, not `move_balance.py`.
- `move_audit.py`: this audit's effect, dash, knock, drain and reach changes.

## Every move

Columns: move; type, category, power; how it reaches; reach in tiles (scaled); effects; effect
sheets (`fx_` id and anchor); measured on the stepped clock (strike, lunge, damage, first drawn
impact); notes and changes.

| Move | Type | Kind | Reach | Effects | FX | Measured | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tackle | normal phys 40 | contact lunge | lunge <= 3.0 + touch | - | 001 targ, 067 targ gnd | strike 350 ms, lunge 133-133, damage 350 ms, impact same frame | Short bodily impact: lunge, white burst, dust. Measured: lands from 1 to 4.5 tiles, misses from 5.5. |
| Scratch | normal phys 40 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 001 targ | strike 217 ms, lunge 33-33, damage 217 ms, impact same frame | No change. |
| Quick Attack | normal phys 40 | contact lunge (dash x1.35) | lunge <= 4.1 + touch | - | 005 targ, 067 targ gnd | strike 150 ms, lunge 17-83, damage 150 ms, impact same frame | **Changed.** Effects were identical to Tackle: now a sharp star impact and a lighter dust puff. Dash 1.35: lunges faster and up to 4 tiles. |
| Bite | dark phys 60 | contact lunge | lunge <= 3.0 + touch | - | 118 targ | strike 217 ms, lunge 0-167, damage 217 ms, impact same frame | No change. |
| Rock Smash | fighting phys 40 | contact lunge | lunge <= 3.0 + touch | target def -1 (50%) | 148 targ, 023 targ | strike 350 ms, damage 350 ms, impact same frame | No change. |
| Wing Attack | flying phys 60 | contact lunge | lunge <= 3.0 + touch | - | 146 targ | strike 350 ms, lunge 167-300, damage 350 ms, impact same frame | No change. |
| Ember | fire spec 40 | single, projectile | aim <= 5.6, r 1.0 | burn 10% | 134 proj, 126 targ | strike 317 ms, damage 650 ms, impact same frame | No change. |
| Water Gun | water spec 40 | single, beam | aim <= 5.6, r 1.0 | - | 105 atta/beam, 070 targ gnd | strike 133 ms, damage 333 ms, impact same frame | No change. |
| Rock Throw | rock phys 50 | single, projectile | aim <= 5.6, r 1.0 | - | 150 proj, 023 targ | strike 317 ms, damage 650 ms, impact same frame | Thrown: misses a target that runs clear of the landing point (measured). |
| Shadow Ball | ghost spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 186 proj, 037 targ | strike 183 ms, damage 550 ms, impact same frame | No change. |
| Thunder Shock | electric spec 40 | line, beam | line to 5.4 | paralysis 10% | 110 atta/beam, 157 targ | strike 133 ms, damage 233 ms, impact same frame | No change. |
| Razor Leaf | grass phys 55 | cone, projectile | cone to 4.6 | - | 153 proj, 199 targ | strike 133 ms, damage 400 ms, impact same frame | No change. |
| Psybeam | psychic spec 65 | channelled beam | line to 5.4 | confusion 20% | 102 atta/beam, 041 targ | strike 317 ms, damage 417 ms, impact same frame | Channelled beam; the library has no pink beam strip, the cyan wave (fx_102) stays. |
| Ice Beam | ice spec 90 | channelled beam | line to 5.4 | freeze 12% | 109 atta/beam, 204 targ | strike 183 ms, damage 483 ms, impact same frame | **Changed.** Same: the freeze block on every target replaced by an ice shatter (fx_204). Channelled beam. |
| Dark Pulse | dark spec 80 | channelled beam | line to 5.4 | - | 113 atta/beam, 177 targ | strike 183 ms, damage 283 ms, impact same frame | Channelled beam. |
| Discharge | electric spec 80 | ring, at once | ring 0.5-3.7 | paralysis 30% | 233 atta, 157 targ | strike 183 ms, damage 317 ms, impact same frame | No change. |
| Bulldoze | ground phys 60 | ring, at once | ring 0.5-3.7 | - | 026 atta gnd, 067 targ gnd | strike 317 ms, damage 417 ms, impact same frame | No change. |
| Dark Void | dark stat 0 | ring, at once | ring 0.5-3.7 | sleep 60% | 114 atta gnd, 215 targ gnd | strike 183 ms, damage 383 ms, impact same frame | No change. |
| Sleep Powder | grass stat 0 | cone, projectile | cone to 4.6 | sleep 75% | 022 proj, 021 targ | strike 317 ms, damage 783 ms, impact same frame | **Changed.** Landed as Powder Snow's icy puffs (fx_046): now a lavender powder sparkle (fx_021). |
| Thunder Wave | electric stat 0 | single, projectile | aim <= 5.6, r 1.0 | paralysis 90% | 096 proj, 157 targ | strike 133 ms, damage 500 ms, impact same frame | No change. |
| Will-O-Wisp | fire stat 0 | single, projectile | aim <= 5.6, r 1.0 | burn 85% | 208 proj, 035 targ | strike 133 ms, damage 600 ms, impact same frame | No change. |
| Howl | normal stat 0 | self | - | self atk +1 (100%) | 028 atta gnd | self: no hit (set-up) | No change. |
| Flamethrower | fire spec 90 | channelled beam | line to 5.4 | burn 10% | 107 atta/beam, 055 targ | strike 317 ms, damage 567 ms, impact same frame | Channelled beam: pulses every 0.25 s, never shoves (measured), stops at walls. |
| Surf | water spec 90 | ring, at once | ring 0.5-3.7 | - | 070 atta gnd, 124 atta gnd, 144 targ | strike 183 ms, damage 333 ms, impact same frame | No change. |
| Thunderbolt | electric spec 90 | channelled beam | line to 5.4 | paralysis 10% | 111 atta/beam, 090 targ | strike 133 ms, damage 233 ms, impact same frame | Channelled beam. |
| Energy Ball | grass spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 173 proj, 202 targ | strike 133 ms, damage 533 ms, impact same frame | **Changed.** Burst into the drain moves' sparkle ring (fx_014): now a green energy burst (fx_202). |
| Crunch | dark phys 80 | contact lunge | lunge <= 3.0 + touch | - | 118 targ, 241 targ | strike 350 ms, damage 350 ms, impact same frame | No change. |
| Brick Break | fighting phys 75 | contact lunge | lunge <= 3.0 + touch | - | 148 targ, 017 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | **Changed.** Second part was fx_004, a big white disc that whited out the target: now a starburst (fx_017). |
| Earthquake | ground phys 100 | ring, at once | ring 0.5-3.7 | - | 026 atta gnd, 245 atta gnd, 072 targ | strike 317 ms, damage 467 ms, impact same frame | No change. |
| Aerial Ace | flying phys 60 | contact lunge | lunge <= 3.0 + touch | - | 147 targ | strike 350 ms, lunge 167-300, damage 350 ms, impact same frame | No change. |
| Poison Jab | poison phys 80 | contact lunge | lunge <= 3.0 + touch | poison 30% | 148 targ, 159 targ | strike 350 ms, damage 350 ms, impact same frame | **Changed.** Played Psychic's eye ring (fx_041): now a purple jab strike (fx_148) and the poison puff. |
| Sludge Bomb | poison spec 90 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 158 proj, 068 targ gnd | strike 133 ms, damage 500 ms, impact same frame | No change. |
| Rock Slide | rock phys 75 | cone, falls from the sky | cone to 4.6 | - | 240 sky, 023 targ | strike 317 ms, damage 733 ms, impact same frame | No change. |
| Dragon Pulse | dragon spec 85 | channelled beam | line to 5.4 | - | 104 atta/beam, 097 targ | strike 317 ms, damage 417 ms, impact same frame | Channelled beam. |
| Stone Edge | rock phys 100 | single, at once | aim <= 5.6, r 1.0 | - | 244 targ | strike 167 ms, damage 167 ms, impact same frame | Physical but not contact (spikes rise under the target): ranged single, no lunge. Correct. |
| Wild Charge | electric phys 90 | contact lunge | lunge <= 3.0 + touch | recoil 0.25 | 232 atta, 073 targ, 233 targ | strike 350 ms, damage 350 ms, impact same frame | No change. |
| X-Scissor | bug phys 80 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 123 targ | strike 350 ms, lunge 150-300, damage 350 ms, impact same frame | No change. |
| Return | normal phys 90 | contact lunge | lunge <= 3.0 + touch | - | 017 targ | strike 350 ms, lunge 200-300, damage 350 ms, impact same frame | No change. |
| Poison Sting | poison phys 25 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 129 proj, 159 targ | strike 317 ms, damage 500 ms, impact same frame | No change. |
| Bug Bite | bug phys 60 | contact lunge | lunge <= 3.0 + touch | knock x0.7 | 118 targ | strike 350 ms, lunge 150-300, damage 350 ms, impact same frame | **Changed.** Knock x0.7. |
| Leafage | grass phys 40 | single, projectile | aim <= 5.6, r 1.0 | - | 199 proj, 001 targ | strike 317 ms, damage 583 ms, impact same frame | No change. |
| Powder Snow | ice spec 40 | cone, projectile | cone to 4.6 | freeze 12% | 046 proj, 204 targ | strike 317 ms, damage 683 ms, impact same frame | No change. |
| Ice Shard | ice phys 40 | single, projectile | aim <= 5.6, r 1.0 | - | 136 proj, 204 targ | strike 317 ms, damage 483 ms, impact same frame | No change. |
| Icicle Crash | ice phys 85 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 198 sky, 066 targ | strike 133 ms, damage 450 ms, impact same frame | Falls from the sky: not stopped by walls (measured), by design. |
| Fairy Wind | fairy spec 40 | single, projectile | aim <= 5.6, r 1.0 | - | 160 proj, 031 targ | strike 317 ms, damage 617 ms, impact same frame | **Changed.** Threw a big white disc (fx_203), now a pink gust (fx_160); it also landed as a flat pink disc over the target (fx_205), now a pink sparkle burst (fx_031). |
| Dazzling Gleam | fairy spec 80 | ring, at once | ring 0.5-3.7 | - | 203 atta, 205 atta gnd, 041 targ | strike 183 ms, damage 333 ms, impact same frame | No change. |
| Confusion | psychic spec 50 | single, at once | aim <= 5.6, r 1.0 | confusion 20% | 214 targ | strike 317 ms, damage 317 ms, impact same frame | No change. |
| Psycho Cut | psychic phys 70 | single, projectile | aim <= 5.6, r 1.0 | - | 130 proj, 123 targ | strike 133 ms, damage 333 ms, impact same frame | Physical projectile (a thrown blade): no lunge. Correct. |
| Hypnosis | psychic stat 0 | single, at once | aim <= 5.6, r 1.0 | sleep 60% | 190 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Iron Head | steel phys 80 | contact lunge | lunge <= 3.0 + touch | - | 017 targ, 005 targ | strike 167 ms, lunge 17-17, damage 167 ms, impact same frame | **Changed.** Struck with an electric burst (fx_073): now a steel-tinted starburst (fx_017). |
| Mud Shot | ground spec 55 | single, projectile | aim <= 5.6, r 1.0 | - | 183 proj, 083 targ gnd | strike 317 ms, damage 617 ms, impact same frame | No change. |
| Dragon Breath | dragon spec 60 | cone, beam | cone to 4.6 | paralysis 30% | 107 atta/beam, 031 targ | strike 133 ms, damage 383 ms, impact same frame | No change. |
| Growl | normal stat 0 | cone, projectile | cone to 4.6 | target atk -1 (100%) | 167 proj, 133 targ | strike 183 ms, damage 583 ms, impact same frame | No change. |
| Leer | normal stat 0 | cone, at once | cone to 4.6 | target def -1 (100%) | 190 targ | strike 317 ms, damage 317 ms, impact same frame | No change. |
| Scary Face | normal stat 0 | single, at once | aim <= 5.6, r 1.0 | target spe -2 (100%) | 196 targ, 190 targ gnd | strike 317 ms, damage 317 ms, impact same frame | No change. |
| Headbutt | normal phys 70 | contact lunge | lunge <= 3.0 + touch | - | 017 targ, 036 targ | strike 217 ms, lunge 17-150, damage 217 ms, impact same frame | No change. |
| Body Slam | normal phys 85 | slam (leap) | jump <= 4.2 + touch | paralysis 30%; knock x1.3 | 017 targ, 067 targ gnd | strike 600 ms, leap from 17, damage 600 ms, impact same frame | **Changed.** Slams now shove on landing (knock x1.3) and land only if the slam came down touching the target. |
| Double-Edge | normal phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33 | 017 targ, 148 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Hyper Voice | normal spec 90 | ring, at once | ring 0.5-3.7 | - | 024 atta gnd, 133 targ | strike 183 ms, damage 333 ms, impact same frame | No change. |
| Swift | normal spec 60 | single, projectile | aim <= 5.6, r 1.0 | - | 176 proj, 005 targ | strike 133 ms, damage 367 ms, impact same frame | No change. |
| Slash | normal phys 70 | contact lunge | lunge <= 3.0 + touch | - | 147 targ, 116 targ | strike 217 ms, lunge 17-150, damage 217 ms, impact same frame | No change. |
| Sing | normal stat 0 | single, projectile | aim <= 5.6, r 1.0 | sleep 55% | 168 proj, 133 targ | strike 183 ms, damage 717 ms, impact same frame | No change. |
| Harden | normal stat 0 | self | - | self def +1 (100%) | 012 atta gnd | self: no hit (set-up) | No change. |
| Swords Dance | normal stat 0 | self | - | self atk +2 (100%) | 024 atta gnd | self: no hit (set-up) | No change. |
| Agility | psychic stat 0 | self | - | self spe +2 (100%) | 146 atta | self: no hit (set-up) | No change. |
| Karate Chop | fighting phys 50 | contact lunge | lunge <= 3.0 + touch | - | 148 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Low Kick | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | - | 148 targ, 067 targ gnd | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Double Kick | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | knock x0.6 | 001 targ, 001 targ | strike 350 ms, lunge 200-200, damage 350 ms, impact same frame | **Changed.** Knock x0.6. Two impacts 0.16 s apart, one damage roll (as before). |
| Force Palm | fighting phys 60 | contact lunge | lunge <= 3.0 + touch | paralysis 30% | 148 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Aura Sphere | fighting spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 172 proj, 012 targ | strike 317 ms, damage 650 ms, impact same frame | No change. |
| Close Combat | fighting phys 120 | contact lunge | lunge <= 3.0 + touch | self def -1 (100%) | 017 targ, 148 targ, 017 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | Three staggered impacts, one damage roll. |
| Bulk Up | fighting stat 0 | self | - | self atk +1 (100%); self def +1 (100%) | 028 atta gnd | self: no hit (set-up) | No change. |
| Gust | flying spec 40 | single, projectile | aim <= 5.6, r 1.0 | - | 160 proj, 200 targ | strike 133 ms, damage 467 ms, impact same frame | No change. |
| Peck | flying phys 35 | contact lunge | lunge <= 3.0 + touch | - | 001 targ | strike 183 ms, lunge 17-133, damage 183 ms, impact same frame | No change. |
| Air Slash | flying spec 75 | single, projectile | aim <= 5.6, r 1.0 | - | 130 proj, 147 targ | strike 317 ms, damage 517 ms, impact same frame | No change. |
| Brave Bird | flying phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33 | 147 targ, 001 targ | strike 350 ms, lunge 217-217, damage 350 ms, impact same frame | No change. |
| Flame Wheel | fire phys 60 | contact lunge | lunge <= 3.0 + touch | burn 10% | 075 targ, 126 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Fire Fang | fire phys 65 | contact lunge | lunge <= 3.0 + touch | burn 10% | 118 targ, 126 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Fire Punch | fire phys 75 | contact lunge | lunge <= 3.0 + touch | burn 10% | 148 targ, 126 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Fire Spin | fire spec 35 | single, at once | aim <= 5.6, r 1.0 | burn 20% | 087 targ gnd, 069 targ | strike 133 ms, damage 133 ms, impact same frame | No change. |
| Heat Wave | fire spec 95 | cone, projectile | cone to 4.6 | burn 10% | 074 proj, 053 targ | strike 133 ms, damage 533 ms, impact same frame | No change. |
| Fire Blast | fire spec 110 | single, projectile | aim <= 5.6, r 1.0 | burn 10% | 222 proj, 040 targ, 087 targ gnd | strike 183 ms, damage 550 ms, impact same frame | No change. |
| Bubble | water spec 40 | cone, projectile | cone to 4.6 | - | 162 proj, 225 targ | strike 317 ms, damage 717 ms, impact same frame | No change. |
| Bubble Beam | water spec 65 | single, projectile | aim <= 5.6, r 1.0 | target spe -1 (10%) | 227 proj, 228 targ | strike 133 ms, damage 467 ms, impact same frame | No change. |
| Water Pulse | water spec 60 | single, projectile | aim <= 5.6, r 1.0 | confusion 20% | 163 proj, 124 targ gnd, 144 targ | strike 133 ms, damage 467 ms, impact same frame | No change. |
| Aqua Tail | water phys 90 | contact lunge | lunge <= 3.0 + touch | - | 144 targ, 070 targ gnd | strike 350 ms, damage 350 ms, impact same frame | No change. |
| Hydro Pump | water spec 110 | channelled beam | line to 5.4 | - | 105 atta/beam, 256 targ | strike 183 ms, damage 433 ms, impact same frame | Channelled beam. |
| Spark | electric phys 65 | contact lunge | lunge <= 3.0 + touch | paralysis 30% | 201 targ | strike 200 ms, lunge 17-133, damage 200 ms, impact same frame | No change. |
| Thunder Fang | electric phys 65 | contact lunge | lunge <= 3.0 + touch | paralysis 10% | 118 targ, 157 targ | strike 200 ms, lunge 17-133, damage 200 ms, impact same frame | No change. |
| Thunder Punch | electric phys 75 | contact lunge | lunge <= 3.0 + touch | paralysis 10% | 148 targ, 090 targ | strike 200 ms, lunge 17-133, damage 200 ms, impact same frame | No change. |
| Charge Beam | electric spec 50 | line, beam | line to 5.4 | self atk +1 (20%) | 098 atta/beam, 157 targ | strike 133 ms, damage 233 ms, impact same frame | No change. |
| Thunder | electric spec 110 | single, at once | aim <= 5.6, r 1.0 | paralysis 30% | 254 targ, 090 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Stun Spore | grass stat 0 | cone, projectile | cone to 4.6 | paralysis 75% | 022 proj, 021 targ | strike 133 ms, damage 600 ms, impact same frame | **Changed.** Landed as icy puffs (fx_046): now a yellow powder sparkle (fx_021). |
| Vine Whip | grass phys 45 | contact lunge | lunge <= 3.0 + touch + 2.0 | reach +2.0 | 108 atta/stream, 116 targ | strike 183 ms, damage 283 ms, impact same frame | **Changed.** Charged in with a full-body lunge like Tackle and grew vines round the target over a third of a second (fx_064), so the hit came before anything showed. Now `reach` 2: it lashes from up to about 2.7 tiles past its body without moving (a thin green stream, fx_108 tinted, and a quick cut, fx_116), and only steps in if the target is further. Measured: lands from 3.2 tiles having moved 0. |
| Absorb | grass spec 30 | single, at once | aim <= 5.6, r 1.0 | drain 50% | 021 targ | strike 133 ms, damage 133 ms, impact same frame | **Changed.** Had no healing at all (the sparkle on the user played on every cast, hit or miss). Now drain 0.5: the user gets back half the HP the hit actually took, shown as a green number and sparkles on the user only when HP comes back. |
| Mega Drain | grass spec 40 | single, at once | aim <= 5.6, r 1.0 | drain 50% | 022 targ | strike 133 ms, damage 133 ms, impact same frame | **Changed.** Same as Absorb: drain 0.5, heal shown only when it happens. |
| Giga Drain | grass spec 75 | single, at once | aim <= 5.6, r 1.0 | drain 50% | 014 targ, 022 targ | strike 183 ms, damage 183 ms, impact same frame | **Changed.** Same: drain 0.5. |
| Magical Leaf | grass spec 60 | single, projectile | aim <= 5.6, r 1.0 | - | 199 proj, 001 targ | strike 133 ms, damage 383 ms, impact same frame | No change. |
| Seed Bomb | grass phys 80 | single, projectile | aim <= 5.6, r 1.0 | - | 125 proj, 029 targ | strike 133 ms, damage 433 ms, impact same frame | Physical projectile. Correct. |
| Leaf Blade | grass phys 90 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 199 targ | strike 217 ms, damage 217 ms, impact same frame | No change. |
| Solar Beam | grass spec 120 | channelled beam | line to 5.4 | - | 112 atta/stream, 014 targ | strike 183 ms, damage 283 ms, impact same frame | Channelled stream. |
| Ice Fang | ice phys 65 | contact lunge | lunge <= 3.0 + touch | freeze 10% | 118 targ, 046 targ | strike 200 ms, lunge 17-17, damage 200 ms, impact same frame | No change. |
| Ice Punch | ice phys 75 | contact lunge | lunge <= 3.0 + touch | freeze 12% | 046 targ, 204 targ | strike 350 ms, lunge 167-300, damage 350 ms, impact same frame | **Changed.** Encased every target in the freeze block (fx_076) though it freezes 12% of the time: now an ice shatter (fx_204); a real freeze shows the freeze status effect. |
| Aurora Beam | ice spec 65 | channelled beam | line to 5.4 | target atk -1 (10%) | 108 atta/beam, 204 targ | strike 317 ms, damage 417 ms, impact same frame | Channelled beam. |
| Icy Wind | ice spec 55 | cone, projectile | cone to 4.6 | target spe -1 (30%) | 200 proj, 046 targ | strike 317 ms, damage 683 ms, impact same frame | **Changed.** Raised an ice pillar (fx_047) on each target: now frost puffs (fx_046). Sweep carrier (grounded gust). |
| Avalanche | ice phys 60 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 094 sky, 046 targ | strike 167 ms, damage 450 ms, impact same frame | No change. |
| Blizzard | ice spec 110 | ring, at once | ring 0.5-3.7 | freeze 12% | 028 atta gnd, 046 atta, 066 targ | strike 133 ms, damage 333 ms, impact same frame | No change. |
| Acid | poison spec 40 | cone, projectile | cone to 4.6 | poison 15%; target def -1 (10%) | 159 proj, 235 targ gnd | strike 133 ms, damage 500 ms, impact same frame | No change. |
| Smog | poison spec 30 | cone, projectile | cone to 4.6 | poison 20% | 056 proj, 056 targ | strike 133 ms, damage 667 ms, impact same frame | No change. |
| Poison Fang | poison phys 50 | contact lunge | lunge <= 3.0 + touch | poison 30% | 118 targ, 159 targ | strike 350 ms, lunge 183-183, damage 350 ms, impact same frame | No change. |
| Sludge | poison spec 65 | single, projectile | aim <= 5.6, r 1.0 | poison 30% | 158 proj, 056 targ | strike 133 ms, damage 500 ms, impact same frame | No change. |
| Mud-Slap | ground spec 30 | single, projectile | aim <= 5.6, r 1.0 | - | 183 proj, 083 targ gnd | strike 133 ms, damage 400 ms, impact same frame | No change. |
| Sand Attack | ground stat 0 | cone, projectile | cone to 4.6 | target spe -1 (100%) | 023 proj, 067 targ gnd | strike 317 ms, damage 583 ms, impact same frame | No change. |
| Sand Tomb | ground phys 35 | single, at once | aim <= 5.6, r 1.0 | - | 067 targ gnd, 200 targ | strike 133 ms, damage 133 ms, impact same frame | Physical, not contact (the sand rises round the target). Correct. |
| Drill Run | ground phys 80 | contact lunge | lunge <= 3.0 + touch | - | 200 targ, 072 targ | strike 183 ms, lunge 17-133, damage 183 ms, impact same frame | No change. |
| Earth Power | ground spec 90 | single, at once | aim <= 5.6, r 1.0 | - | 026 targ gnd, 089 targ | strike 317 ms, damage 317 ms, impact same frame | No change. |
| String Shot | bug stat 0 | cone, projectile | cone to 4.6 | target spe -2 (100%) | 131 proj, 048 targ | strike 250 ms, damage 450 ms, impact same frame | No change. |
| Struggle Bug | bug spec 50 | cone, at once | cone to 4.6 | target atk -1 (30%) | 120 targ | strike 317 ms, damage 317 ms, impact same frame | No change. |
| Fury Cutter | bug phys 40 | contact lunge | lunge <= 3.0 + touch | knock x0.6 | 123 targ | strike 217 ms, lunge 17-167, damage 217 ms, impact same frame | **Changed.** Knock x0.6. |
| Signal Beam | bug spec 75 | channelled beam | line to 5.4 | confusion 15% | 099 atta/beam, 041 targ | strike 183 ms, damage 283 ms, impact same frame | Channelled beam. |
| Bug Buzz | bug spec 90 | ring, at once | ring 0.5-3.7 | - | 024 atta gnd, 001 targ | strike 183 ms, damage 333 ms, impact same frame | No change. |
| Rock Tomb | rock phys 60 | single, falls from the sky | aim <= 5.6, r 1.0 | target spe -1 (30%) | 149 sky, 023 targ | strike 167 ms, damage 517 ms, impact same frame | No change. |
| Ancient Power | rock spec 60 | single, projectile | aim <= 5.6, r 1.0 | self atk +1 (10%); self def +1 (10%) | 240 proj, 023 targ | strike 133 ms, damage 500 ms, impact same frame | No change. |
| Smack Down | rock phys 50 | single, projectile | aim <= 5.6, r 1.0 | - | 150 proj, 023 targ | strike 183 ms, damage 417 ms, impact same frame | No change. |
| Power Gem | rock spec 80 | single, projectile | aim <= 5.6, r 1.0 | - | 253 proj, 005 targ | strike 133 ms, damage 383 ms, impact same frame | No change. |
| Lick | ghost phys 30 | contact lunge | lunge <= 3.0 + touch | paralysis 30%; knock x0.5 | 049 targ | strike 167 ms, lunge 33-117, damage 167 ms, impact same frame | **Changed.** Showed claw marks (fx_116): now a pink splat (fx_049). Shove x0.5. |
| Astonish | ghost phys 30 | contact lunge | lunge <= 3.0 + touch | - | 196 targ | strike 200 ms, lunge 17-150, damage 200 ms, impact same frame | **Changed.** Had the splat that suits a lick: now jagged shock lines (fx_196). |
| Shadow Claw | ghost phys 70 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 241 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Hex | ghost spec 65 | single, at once | aim <= 5.6, r 1.0 | - | 061 targ gnd, 186 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Night Shade | ghost spec 50 | single, beam | aim <= 5.6, r 1.0 | - | 050 atta/stream, 042 targ | strike 183 ms, damage 283 ms, impact same frame | No change. |
| Shadow Sneak | ghost phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 187 targ | strike 167 ms, lunge 17-117, damage 167 ms, impact same frame | **Changed.** Dash 1.3 (priority). |
| Dragon Claw | dragon phys 80 | contact lunge | lunge <= 3.0 + touch | - | 116 targ, 031 targ | strike 183 ms, lunge 17-133, damage 183 ms, impact same frame | No change. |
| Twister | dragon spec 40 | line, projectile | line to 5.4 | - | 081 proj, 200 targ | strike 317 ms, damage 750 ms, impact same frame | Sweep: one tornado crosses the line, impacts as it passes each target. |
| Outrage | dragon phys 120 | contact lunge | lunge <= 3.0 + touch | - | 024 atta gnd, 053 targ, 017 targ | strike 183 ms, lunge 17-133, damage 183 ms, impact same frame | No change. |
| Draco Meteor | dragon spec 130 | single, falls from the sky | aim <= 5.6, r 1.0 | self atk -2 (100%) | 132 sky, 043 targ | strike 133 ms, damage 717 ms, impact same frame | No change. |
| Dragon Dance | dragon stat 0 | self | - | self atk +1 (100%); self spe +1 (100%) | 024 atta gnd, 097 atta/status | self: no hit (set-up) | No change. |
| Feint Attack | dark phys 60 | contact lunge | lunge <= 3.0 + touch | - | 241 targ | strike 350 ms, lunge 167-167, damage 350 ms, impact same frame | No change. |
| Night Slash | dark phys 70 | contact lunge | lunge <= 3.0 + touch | - | 123 targ, 121 targ | strike 350 ms, lunge 167-167, damage 350 ms, impact same frame | No change. |
| Snarl | dark spec 55 | cone, at once | cone to 4.6 | target atk -1 (30%) | 177 targ | strike 133 ms, damage 133 ms, impact same frame | No change. |
| Sucker Punch | dark phys 70 | contact lunge (dash x1.25) | lunge <= 3.8 + touch | - | 148 targ | strike 133 ms, lunge 17-67, damage 133 ms, impact same frame | **Changed.** Dash 1.25 (priority). |
| Nasty Plot | dark stat 0 | self | - | self atk +2 (100%) | 034 atta/status | self: no hit (set-up) | No change. |
| Metal Claw | steel phys 50 | contact lunge | lunge <= 3.0 + touch | self atk +1 (10%) | 123 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Iron Tail | steel phys 100 | contact lunge | lunge <= 3.0 + touch | target def -1 (30%); knock x1.2 | 147 targ, 001 targ | strike 167 ms, lunge 17-17, damage 167 ms, impact same frame | **Changed.** Knock x1.2. |
| Flash Cannon | steel spec 80 | channelled beam | line to 5.4 | - | 101 atta/stream, 005 targ | strike 183 ms, damage 283 ms, impact same frame | Channelled stream. |
| Bullet Punch | steel phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 001 targ | strike 133 ms, lunge 17-67, damage 133 ms, impact same frame | **Changed.** Dash 1.3 (priority). |
| Steel Wing | steel phys 70 | contact lunge | lunge <= 3.0 + touch | - | 146 targ | strike 167 ms, damage 167 ms, impact same frame | No change. |
| Iron Defense | steel stat 0 | self | - | self def +2 (100%) | 012 atta gnd, 142 atta/status | self: no hit (set-up) | No change. |
| Heavy Slam | steel phys 80 | slam (leap) | jump <= 4.2 + touch | knock x1.6 | 017 targ, 067 targ gnd | strike 700 ms, leap from 17, damage 700 ms, impact same frame | **Changed.** Knock x1.6 on landing; lands only if the slam came down touching the target. |
| Psychic | psychic spec 90 | single, at once | aim <= 5.6, r 1.0 | target def -1 (10%) | 214 targ, 188 targ | strike 183 ms, damage 183 ms, impact same frame | No change. |
| Zen Headbutt | psychic phys 80 | contact lunge | lunge <= 3.0 + touch | - | 203 targ, 017 targ | strike 167 ms, lunge 17-17, damage 167 ms, impact same frame | No change. |
| Calm Mind | psychic stat 0 | self | - | self atk +1 (100%); self def +1 (100%) | 214 atta/status | self: no hit (set-up) | No change. |
| Disarming Voice | fairy spec 40 | ring, at once | ring 0.5-3.7 | - | 205 atta gnd, 041 targ | strike 317 ms, damage 417 ms, impact same frame | No change. |
| Draining Kiss | fairy spec 50 | single, projectile | aim <= 5.6, r 1.0 | drain 75% | 152 proj, 041 targ | strike 317 ms, damage 683 ms, impact same frame | **Changed.** Same: drain 0.75 (the canon share). |
| Moonblast | fairy spec 95 | single, falls from the sky | aim <= 5.6, r 1.0 | target atk -1 (30%) | 205 sky, 188 targ | strike 183 ms, damage 683 ms, impact same frame | No change. |
| Play Rough | fairy phys 90 | contact lunge | lunge <= 3.0 + touch | target atk -1 (10%) | 031 targ, 001 targ, 001 targ | strike 317 ms, lunge 183-183, damage 317 ms, impact same frame | Three staggered impacts, one damage roll. |
| Charm | fairy stat 0 | single, projectile | aim <= 5.6, r 1.0 | target atk -2 (100%) | 152 proj, 041 targ, 152 targ/status | strike 183 ms, damage 583 ms, impact same frame | No change. |
| Aeroblast | flying spec 100 | channelled beam | line to 5.4 | - | 103 atta/stream, 200 targ, 067 targ gnd | strike 600 ms, damage 800 ms, impact same frame | Channelled stream (Lugia). |
| Sacred Fire | fire phys 100 | single, falls from the sky | aim <= 5.6, r 1.0 | burn 50% | 222 sky, 175 targ gnd, 255 targ, 191 targ | strike 567 ms, damage 1133 ms, impact same frame | No change. |
| Dragon Ascent | flying phys 120 | single, falls from the sky | aim <= 5.6, r 1.0 | self def -1 (100%) | 210 sky, 223 targ, 067 targ gnd, 246 targ gnd | strike 700 ms, damage 1467 ms, impact same frame | No change. |
| Luster Purge | psychic spec 95 | single, at once | aim <= 5.6, r 1.0 | target def -1 (50%) | 093 targ, 197 targ, 190 targ gnd | strike 567 ms, damage 567 ms, impact same frame | No change. |
| Doom Desire | steel spec 140 | single, falls from the sky | aim <= 5.6, r 1.0 | - | 239 sky, 223 targ, 175 targ gnd, 239 targ | strike 800 ms, damage 2017 ms, impact same frame | No change. |
| Hyperspace Hole | psychic spec 80 | single, at once | aim <= 5.6, r 1.0 | - | 190 targ gnd, 196 targ, 197 targ | strike 567 ms, damage 567 ms, impact same frame | No change. |
| Spectral Thief | ghost phys 90 | contact lunge | lunge <= 3.0 + touch | - | 242 targ, 206 targ, 187 targ | strike 500 ms, damage 500 ms, impact same frame | Contact with a 0.45 s wind-up: struck at 0.133 s before the fix, 0.50 s now. |
| V-create | fire phys 180 | contact lunge | lunge <= 3.0 + touch | self def -1 (100%); self spe -1 (100%) | 175 targ gnd, 255 targ, 223 targ | strike 750 ms, damage 750 ms, impact same frame | Contact with a 0.7 s wind-up. The lunge replaced the wind-up whenever it was shorter: frame-stepped on the 28 October build it struck 0.133 s after the cast, not 0.7 s (the earlier "hit at 67 ms" came from a real-time measurement that started late). Fixed for every contact move: the user winds up where it stands, then lunges, and strikes on its planned time. Now strikes at 0.75 s. |
| Shadow Storm | dark spec 75 | ring, at once | ring 0.5-3.7 | - | 114 atta gnd, 200 atta, 200 targ | strike 900 ms, damage 1000 ms, impact same frame | No change. |
| Flame Charge | fire phys 50 | contact lunge | lunge <= 3.0 + touch | self spe +1 (100%) | 209 atta gnd, 075 targ, 126 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Flare Blitz | fire phys 120 | contact lunge | lunge <= 3.0 + touch | burn 10%; recoil 0.33 | 075 targ, 148 targ, 126 targ | strike 183 ms, lunge 17-117, damage 183 ms, impact same frame | No change. |
| Aqua Jet | water phys 40 | contact lunge (dash x1.35) | lunge <= 4.1 + touch | - | 144 targ, 070 targ gnd | strike 150 ms, lunge 17-83, damage 150 ms, impact same frame | **Changed.** Dash 1.35 (priority): faster, longer lunge. |
| Razor Shell | water phys 75 | contact lunge | lunge <= 3.0 + touch | target def -1 (50%) | 116 targ, 070 targ gnd | strike 350 ms, damage 350 ms, impact same frame | No change. |
| Waterfall | water phys 80 | contact lunge | lunge <= 3.0 + touch | - | 144 targ, 070 targ gnd | strike 350 ms, lunge 183-183, damage 350 ms, impact same frame | No change. |
| Wave Crash | water phys 120 | contact lunge | lunge <= 3.0 + touch | recoil 0.33; knock x1.2 | 144 targ, 017 targ, 070 targ gnd | strike 233 ms, lunge 100-100, damage 233 ms, impact same frame | **Changed.** Knock x1.2. |
| Mach Punch | fighting phys 40 | contact lunge (dash x1.3) | lunge <= 3.9 + touch | - | 001 targ, 017 targ | strike 150 ms, lunge 17-100, damage 150 ms, impact same frame | **Changed.** Dash 1.3 (priority). |
| Dragon Tail | dragon phys 60 | contact lunge | lunge <= 3.0 + touch | knock x2.4 | 147 targ, 001 targ | strike 217 ms, damage 217 ms, impact same frame | **Changed.** Knock x2.4: throws its target clear (0.8 tiles measured), the one move whose point is the shove. |
| Mirror Shot | steel spec 65 | single, projectile | aim <= 5.6, r 1.0 | target atk -1 (30%) | 221 proj, 005 targ | strike 317 ms, damage 533 ms, impact same frame | No change. |
| Nuzzle | electric phys 20 | contact lunge | lunge <= 3.0 + touch | paralysis 100%; knock x0.5 | 201 targ, 157 targ | strike 200 ms, lunge 17-133, damage 200 ms, impact same frame | **Changed.** Knock x0.5 (a nuzzle, not a shove). |
