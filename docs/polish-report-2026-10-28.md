# Polish pass: 28 October 2026

The island's objects, obstacles and shadows, and every move. The move-by-move record is
`docs/move-audit-2026-10-28.md`; before-and-after pictures are in `docs/polish-2026-10-28/`.

## Map

All changes are in the generators, so they survive a rebuild (build3, then polish3, then
center_blend and minimap_from_render; rerunning build3 and polish3 gives a byte-identical map).
The castle's Tiled area is untouched.

### Shadows (`scripts/fantasy/shadows3.py`, new; used by content3, build3 and polish3)

What the artist does (studied in the pack's sample maps): a round "Short" shadow decal sized to the
object, centred on its base a few pixels right (light from the upper left), under palms, cacti,
rocks and stumps, rarely under trees, never under banners, lamps, signs, bushes or buildings. The
pack's pictures have no baked-in shadows.

What the island did: the same 40 or 48 px disc under every wide picture (a cypress, an oak and a
purple banner alike), none under palms or cacti, and none under the beach palms at all (their
shadows were dropped on the way out of build3). Where two discs overlapped they were drawn twice,
so overlaps showed as dark blobs.

Now:
- One rule for every picture: what it is from its file name (tree, bare tree, palm, cactus, stump,
  rock), how big from its own alpha mask (the widest row of the canopy, the trunk's position at
  the base). A tree's disc is 0.45 of its canopy (at most 40 px), a palm's 0.55 (at most 40), a bare
  tree's 0.35, a cactus 16 or 24 by its size, a stump 16 or 32, a rock 0.8 of its width (none for
  pebbles); placed under the trunk, 2 px right and up. Banners, lamps, bushes and props get none.
- The renderer (`src/ground/fanGround.ts`) draws a shadow layer's discs as one shape and then fades
  it, so overlapping shadows no longer darken.
- Checked at gameplay zoom in the forest, autumn wood, snowfield, desert, meadow, ruins, mountain
  and towns.

### Objects and composition

- **Town plazas** (`towns3.py`): the fourth prop spot was inside the third market stand in every
  town (Greenhollow's lamp post stood on the pink awning). The props now go in purposeful spots: the
  north-east corner, beside the well (the lamp, where the town has one), a pair together in the
  south-west corner, one by the healer. Props side by side never overlap.
- **Things standing inside other things** (`build3.settle`): different placers (towns, farms, road
  decor, woods, shores) didn't see each other's objects: a lamp stood inside a rune rock on the
  mountain, cacti inside a dead tree and a house, a palm inside a palm, a rock inside a tree. Where a
  solid object's base stands in another's base, the smaller one goes, with its shadow (8 removed).
- **Scatter** (`polish3.py`): banners, lamps, signs, tombstones, skulls, crates, barrels, benches,
  ruins pieces and farm crops are no longer scattered over the wilds (a purple banner alone in a
  meadow, corn in the forest); only flora and rocks are. New pieces keep clear of other objects'
  bases (a bush used to be set inside a big tree's trunk) and of upright pictures they would
  overlap by a third (a dead tree growing out of a palm, a log lying on a hedge).
- A measured check over the whole map: no solid object stands inside another (was 34).

### Collision and routes

polish3's reachability check passes after every change: every point of interest, town, outpost and
spawn is reachable, and no walkable area was cut off (44,862 reachable tiles; the blocked tiles are
the new trunks only). The combat check also confirms knockback stops at walls and leaves Pokémon on
open ground.

## Moves

Summary (details and the per-move table in the audit):
- Contact moves land only when their user is touching the target; lunges have a length (3 tiles,
  more for the priority dashes); a lunge stopped by a wall or a target that runs is a miss.
- Shots land where they were thrown (a target that ran clear is missed) and stop at walls; falling
  moves don't.
- The AI picks contact moves only in reach; auto-battle lunges after the Pokémon it chose.
- Shoves: slams shove on landing, Dragon Tail throws its target clear, light moves barely move
  anyone; no stacking; walls stop them.
- 13 moves had effects that showed the wrong thing (Quick Attack identical to Tackle, powders
  landing as ice, Poison Jab and Iron Head with other types' effects, the freeze block on every Ice
  Punch); fixed.

## Checks

- `scripts/check-server.sh` (TypeScript, unit tests, client and server builds, every server check
  including the new `server/checks/combat.ts` and the online event, lag compensation and bot checks):
  all pass. `online_events.ts` was fixed to count only the Zoroark it reveals (with the new map a wild
  Zorua could already have grown into one elsewhere).
- Move Gallery in a browser, all 175 moves (frames and timing); a 47 s offline match in a browser
  (254 hits, no contact hit from more than 3 tiles, no errors); full-map and close-up renders.

## Not done or not fully verified

- I did not play an online match in a browser; the online rules are the server's simulation, which
  the server checks exercise.
- Tall grass near the lake shore and a reed that looked mid-lake: checked, the reeds all stand within
  two tiles of land; not changed.
- The castle and arena plazas stay open (combat space).
- polish3's scatter is random: the pass changed which pieces landed where in places it did not
  otherwise touch (same density and palette).
- `scripts/moves.py` and `scripts/move_balance.py` are behind `data/moves.json` (see the audit).
