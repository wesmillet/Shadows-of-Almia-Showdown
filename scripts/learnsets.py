#!/usr/bin/env python3
"""Level-up learnsets for every species, written into data/species.json as `learnset`:
[[level, moveId], ...]. A Pokemon knows the last four moves it has reached by its level,
so a fresh low-level Pokemon starts with two or three moves and learns the rest as it levels.

  python3 scripts/learnsets.py

Each species climbs its own types' move ladders (data in LADDERS below), physical or special
by whichever attack stat is higher, with a normal-type opener and a status move early on.
A second type (or Normal for single-type species) adds coverage. The hand-picked kit in
`moves` is folded in, so every species keeps its signature moves. OVERRIDES pin whole
learnsets where the formula would miss the point (Darkrai keeps its fixed boss kit).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIES = os.path.join(ROOT, 'data', 'species.json')
MOVES = os.path.join(ROOT, 'data', 'moves.json')

# type: weak, mid1, mid2, strong, ultimate as (physical, special), plus a status move
LADDERS = {
    'normal':   [('tackle', 'tackle'), ('headbutt', 'swift'), ('slash', 'swift'), ('body-slam', 'hyper-voice'), ('double-edge', 'hyper-voice'), 'growl'],
    'fire':     [('ember', 'ember'), ('flame-wheel', 'fire-spin'), ('fire-fang', 'flamethrower'), ('fire-punch', 'flamethrower'), ('fire-blast', 'fire-blast'), 'will-o-wisp'],
    'water':    [('water-gun', 'bubble'), ('water-pulse', 'water-pulse'), ('aqua-tail', 'bubble-beam'), ('aqua-tail', 'surf'), ('hydro-pump', 'hydro-pump'), None],
    'electric': [('thunder-shock', 'thunder-shock'), ('spark', 'charge-beam'), ('thunder-fang', 'discharge'), ('wild-charge', 'thunderbolt'), ('wild-charge', 'thunder'), 'thunder-wave'],
    'grass':    [('vine-whip', 'absorb'), ('razor-leaf', 'mega-drain'), ('seed-bomb', 'magical-leaf'), ('leaf-blade', 'energy-ball'), ('leaf-blade', 'solar-beam'), 'stun-spore'],
    'ice':      [('ice-shard', 'powder-snow'), ('ice-fang', 'icy-wind'), ('avalanche', 'aurora-beam'), ('icicle-crash', 'ice-beam'), ('icicle-crash', 'blizzard'), None],
    'fighting': [('karate-chop', 'force-palm'), ('low-kick', 'force-palm'), ('double-kick', 'aura-sphere'), ('brick-break', 'aura-sphere'), ('close-combat', 'aura-sphere'), 'bulk-up'],
    'poison':   [('poison-sting', 'smog'), ('poison-fang', 'acid'), ('poison-jab', 'sludge'), ('poison-jab', 'sludge-bomb'), ('poison-jab', 'sludge-bomb'), None],
    'ground':   [('mud-slap', 'mud-slap'), ('sand-tomb', 'mud-shot'), ('bulldoze', 'mud-shot'), ('drill-run', 'earth-power'), ('earthquake', 'earth-power'), 'sand-attack'],
    'flying':   [('peck', 'gust'), ('wing-attack', 'gust'), ('aerial-ace', 'air-slash'), ('aerial-ace', 'air-slash'), ('brave-bird', 'air-slash'), 'agility'],
    'psychic':  [('confusion', 'confusion'), ('psycho-cut', 'psybeam'), ('zen-headbutt', 'psybeam'), ('zen-headbutt', 'psychic'), ('zen-headbutt', 'psychic'), 'calm-mind'],
    'bug':      [('fury-cutter', 'struggle-bug'), ('bug-bite', 'struggle-bug'), ('x-scissor', 'signal-beam'), ('x-scissor', 'bug-buzz'), ('x-scissor', 'bug-buzz'), 'string-shot'],
    'rock':     [('rock-throw', 'rock-throw'), ('rock-tomb', 'ancient-power'), ('rock-slide', 'ancient-power'), ('stone-edge', 'power-gem'), ('stone-edge', 'power-gem'), 'harden'],
    'ghost':    [('astonish', 'night-shade'), ('shadow-sneak', 'hex'), ('shadow-claw', 'hex'), ('shadow-claw', 'shadow-ball'), ('shadow-claw', 'shadow-ball'), None],
    'dragon':   [('twister', 'twister'), ('dragon-breath', 'dragon-breath'), ('dragon-claw', 'dragon-pulse'), ('dragon-claw', 'dragon-pulse'), ('outrage', 'draco-meteor'), 'dragon-dance'],
    'dark':     [('bite', 'snarl'), ('feint-attack', 'snarl'), ('night-slash', 'dark-pulse'), ('crunch', 'dark-pulse'), ('crunch', 'dark-pulse'), 'scary-face'],
    'steel':    [('metal-claw', 'metal-claw'), ('bullet-punch', 'metal-claw'), ('iron-head', 'flash-cannon'), ('iron-tail', 'flash-cannon'), ('heavy-slam', 'flash-cannon'), 'iron-defense'],
    'fairy':    [('fairy-wind', 'fairy-wind'), ('disarming-voice', 'disarming-voice'), ('play-rough', 'draining-kiss'), ('play-rough', 'dazzling-gleam'), ('play-rough', 'moonblast'), 'charm'],
}
# Primary type at these levels; the second type (or Normal) fills in between.
PRIMARY = [5, 14, 22, 32, 44]
SECOND = [9, 18, 28, 38]
STATUS_LEVEL = 11
# Openers by body: claws scratch, beaks peck, everything else tackles.
SCRATCH = {'0390', '0391', '0392', '0252', '0253', '0254', '0447', '0448', '0443', '0444', '0445', '0551', '0552', '0553', '0570', '0571', '0359', '0217', '0216', '0753', '0754'}
PECK = {'0396', '0397', '0398', '0393', '0394', '0395'}
OVERRIDES = {
    # Darkrai: the finale boss casts its kit by slot (Dark Void first, Dark Pulse second).
    '0491': None,
    # Munchlax and Snorlax: the slams (they leap and land on the target).
    '0446': [[1, 'tackle'], [1, 'growl'], [14, 'headbutt'], [22, 'slash'], [32, 'body-slam'], [40, 'heavy-slam']],
    '0143': [[1, 'tackle'], [1, 'growl'], [14, 'headbutt'], [22, 'slash'], [32, 'body-slam'], [40, 'heavy-slam']],
}


def build(sp, moves):
    phys = sp['stats']['atk'] >= sp['stats']['spa']
    pick = lambda pair: pair[0] if phys else pair[1]
    types = sp['types']
    out = []
    def add(level, mid):
        if mid and mid in moves and all(m != mid for _, m in out): out.append((level, mid))
    opener = 'scratch' if sp['dex'].split('-')[0] in SCRATCH else 'peck' if sp['dex'].split('-')[0] in PECK else 'tackle'
    add(1, opener)
    add(1, LADDERS['normal'][5])
    lad = LADDERS.get(types[0], LADDERS['normal'])
    for lv, pair in zip(PRIMARY, lad[:5]): add(lv, pick(pair))
    # Mixed attackers (attack and special attack within 10) also get the other strong move a little later.
    if abs(sp['stats']['atk'] - sp['stats']['spa']) <= 10:
        add(PRIMARY[3] + 4, lad[3][1] if phys else lad[3][0])
    second = LADDERS.get(types[1]) if len(types) > 1 else LADDERS['normal']
    for lv, pair in zip(SECOND, second[:4]): add(lv, pick(pair))
    if lad[5]: add(STATUS_LEVEL, lad[5])
    # The hand-picked kit stays: each kit move comes in at a level that fits its power.
    for mid in sp.get('moves', []):
        m = moves.get(mid)
        if not m: continue
        p = m['power']
        lv = 12 if p <= 0 else 7 if p <= 40 else 16 if p <= 60 else 26 if p <= 80 else 36
        add(lv, mid)
    out.sort(key=lambda e: e[0])  # stable: same-level moves keep their order
    return [[lv, mid] for lv, mid in out]


def main():
    S = json.load(open(SPECIES))
    moves = {m['id']: m for m in json.load(open(MOVES))['moves']}
    n = 0
    for sp in S['species']:
        key = sp['dex']
        if key in OVERRIDES and OVERRIDES[key] is None:
            sp.pop('learnset', None)
            continue
        sp['learnset'] = OVERRIDES.get(key) or build(sp, moves)
        n += 1
    json.dump(S, open(SPECIES, 'w'), indent=2, ensure_ascii=False)
    open(SPECIES, 'a').write('\n')
    print(f'learnsets for {n} species')
    for name in ('Pikachu', 'Turtwig', 'Grubbin', 'Snover', 'Steelix', 'Ralts', 'Gallade'):
        sp = next(s for s in S['species'] if s['name'] == name)
        print(name, sp['learnset'])


if __name__ == '__main__':
    main()
