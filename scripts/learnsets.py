#!/usr/bin/env python3
"""Level-up learnsets for every species, written into data/species.json as `learnset`:
[[level, moveId], ...], plus each species' attacking `role` and a role-true `moves` kit.

  python3 scripts/learnsets.py

A Pokemon knows the newest two attacks it has reached (sim/data.ts movesAt, MOVE_SLOTS), so the
order matters: its own type's ladder and its second type's ladder (or Normal coverage) take turns,
and at most levels it knows one move of each.

Role. Each species fights physically, specially or both: physical when its Attack is at least 10%
above its Sp. Atk, special the other way round, mixed in between. ROLE pins the Pokemon whose canon
style differs from that rule (Infernape and Blaziken punch and kick, Gardevoir and Charizard don't).
A physical Pokemon only learns physical attacks, a special one special attacks; a mixed one climbs
its better side and also learns the other side's strong move of its own type.

Kit. `moves` is the hand-picked identity of a species (Infernape: Flare Blitz, Close Combat...).
An attack in it that doesn't fit the role is swapped for its counterpart (MIRROR: Flamethrower for
a physical Pokemon becomes Fire Punch). Each kit attack then takes over the ladder rung of its type
whose power is closest below it, so the species reaches it at the right point of its climb (Close
Combat replaces Brick Break at the top of Infernape's Fighting ladder); one with no rung to take
comes in at a level that fits its power.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIES = os.path.join(ROOT, 'data', 'species.json')
MOVES = os.path.join(ROOT, 'data', 'moves.json')

# type: five rungs as (physical, special), weak to ultimate, plus a status move. None: no move of that
# kind at that rung (the species keeps what it has).
LADDERS = {
    'normal':   [('tackle', None), ('headbutt', 'swift'), ('slash', 'swift'), ('body-slam', 'hyper-voice'), ('double-edge', 'hyper-voice'), 'growl'],
    'fire':     [('flame-charge', 'ember'), ('flame-wheel', 'fire-spin'), ('fire-fang', 'flamethrower'), ('fire-punch', 'heat-wave'), ('flare-blitz', 'fire-blast'), 'will-o-wisp'],
    'water':    [('aqua-jet', 'water-gun'), ('aqua-jet', 'water-pulse'), ('razor-shell', 'bubble-beam'), ('waterfall', 'surf'), ('wave-crash', 'hydro-pump'), None],
    'electric': [('nuzzle', 'thunder-shock'), ('spark', 'charge-beam'), ('thunder-fang', 'discharge'), ('thunder-punch', 'thunderbolt'), ('wild-charge', 'thunder'), 'thunder-wave'],
    'grass':    [('vine-whip', 'absorb'), ('razor-leaf', 'mega-drain'), ('seed-bomb', 'magical-leaf'), ('leaf-blade', 'energy-ball'), ('leaf-blade', 'solar-beam'), 'stun-spore'],
    'ice':      [('ice-shard', 'powder-snow'), ('ice-fang', 'icy-wind'), ('avalanche', 'aurora-beam'), ('ice-punch', 'ice-beam'), ('icicle-crash', 'blizzard'), None],
    'fighting': [('karate-chop', None), ('low-kick', None), ('double-kick', 'aura-sphere'), ('brick-break', 'aura-sphere'), ('close-combat', 'aura-sphere'), 'bulk-up'],
    'poison':   [('poison-sting', 'smog'), ('poison-fang', 'acid'), ('poison-jab', 'sludge'), ('poison-jab', 'sludge-bomb'), ('poison-jab', 'sludge-bomb'), None],
    'ground':   [('sand-tomb', 'mud-slap'), ('sand-tomb', 'mud-shot'), ('bulldoze', 'mud-shot'), ('drill-run', 'earth-power'), ('earthquake', 'earth-power'), 'sand-attack'],
    'flying':   [('peck', 'gust'), ('wing-attack', 'gust'), ('aerial-ace', 'air-slash'), ('aerial-ace', 'air-slash'), ('brave-bird', 'air-slash'), 'agility'],
    'psychic':  [(None, 'confusion'), ('psycho-cut', 'psybeam'), ('zen-headbutt', 'psybeam'), ('zen-headbutt', 'psychic'), ('zen-headbutt', 'psychic'), 'calm-mind'],
    'bug':      [('fury-cutter', 'struggle-bug'), ('bug-bite', 'struggle-bug'), ('x-scissor', 'signal-beam'), ('x-scissor', 'bug-buzz'), ('x-scissor', 'bug-buzz'), 'string-shot'],
    'rock':     [('rock-throw', None), ('rock-tomb', 'ancient-power'), ('rock-slide', 'ancient-power'), ('stone-edge', 'power-gem'), ('stone-edge', 'power-gem'), 'harden'],
    'ghost':    [('astonish', 'night-shade'), ('shadow-sneak', 'hex'), ('shadow-claw', 'hex'), ('shadow-claw', 'shadow-ball'), ('shadow-claw', 'shadow-ball'), None],
    'dragon':   [(None, 'twister'), ('dragon-tail', 'dragon-breath'), ('dragon-claw', 'dragon-pulse'), ('dragon-claw', 'dragon-pulse'), ('outrage', 'draco-meteor'), 'dragon-dance'],
    'dark':     [('bite', 'snarl'), ('feint-attack', 'snarl'), ('night-slash', 'dark-pulse'), ('crunch', 'dark-pulse'), ('crunch', 'dark-pulse'), 'scary-face'],
    'steel':    [('metal-claw', None), ('bullet-punch', 'mirror-shot'), ('iron-head', 'mirror-shot'), ('iron-tail', 'flash-cannon'), ('heavy-slam', 'flash-cannon'), 'iron-defense'],
    'fairy':    [(None, 'fairy-wind'), (None, 'disarming-voice'), ('play-rough', 'draining-kiss'), ('play-rough', 'dazzling-gleam'), ('play-rough', 'moonblast'), 'charm'],
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
# Legendary and mythical signature moves, known from level 1 (and always kept: data.ts movesAt).
SIGNATURE = {'0249': 'aeroblast', '0250': 'sacred-fire', '0384': 'dragon-ascent', '0381': 'luster-purge', '0385': 'doom-desire',
             '0720': 'hyperspace-hole', '0802': 'spectral-thief', '0494': 'v-create'}

# Canon fighting style where the stat rule would say otherwise (by base dex: forms and shinies follow).
P, S, M = 'physical', 'special', 'mixed'
ROLE = {
    # Starters and their lines.
    '0390': P, '0391': P, '0392': P,            # Chimchar line: Mach Punch, Close Combat, Flare Blitz
    '0255': P, '0256': P, '0257': P,            # Torchic line: Blaze Kick, Sky Uppercut
    '0007': S, '0008': S, '0009': S,            # Squirtle line: Water Gun to Hydro Pump
    '0152': S, '0153': S, '0154': S,            # Chikorita line: Magical Leaf, Petal Blizzard aside
    '0495': S, '0496': S, '0497': S,            # Snivy line: Leaf Storm
    '0501': S, '0502': S, '0503': S,            # Oshawott line
    '0656': S, '0657': S, '0658': S,            # Froakie line: Water Shuriken, Dark Pulse
    '0722': P, '0723': P, '0724': P,            # Rowlet line: Spirit Shackle, Leaf Blade
    '0725': P, '0726': P, '0727': P,            # Litten line: Darkest Lariat
    '0935': P,                                  # Charcadet
    # Others whose stats sit level or lean the other way.
    '0025': S, '0026': S,                       # Pikachu, Raichu: Thunderbolt
    '0239': P, '0125': P, '0466': P,            # Elekid line: Thunder Punch
    '0240': S, '0126': S, '0467': S,            # Magby line: Flamethrower
    '0401': P, '0402': P,                       # Kricketot, Kricketune
    '0197': P,                                  # Umbreon
    '0459': S, '0460': S,                       # Snover, Abomasnow: Blizzard
    '0361': P, '0362': P,                       # Snorunt, Glalie: Ice Fang, Crunch
    '0331': P, '0332': P,                       # Cacnea, Cacturne: Seed Bomb, Sucker Punch
    '0038': S,                                  # Ninetales
    '0840': P,                                  # Applin
    '0269': S,                                  # Dustox
    '0357': S,                                  # Tropius
    '0753': P, '0754': P,                       # Fomantis, Lurantis
    '0053': P,                                  # Persian
    '0236': P,                                  # Tyrogue
    '0704': S, '0705': S, '0706': S,            # Goomy line
    '0784': P,                                  # Kommo-o
    '0251': S, '0490': S, '0492': S,            # Celebi, Manaphy, Shaymin
    '0494': P,                                  # Victini: V-create
    '0488': S, '0249': S,                       # Cresselia, Lugia
    '0230': S, '0131': S,                       # Kingdra, Lapras
    '0223': S, '0224': S,                       # Remoraid, Octillery
    '0320': S, '0321': S,                       # Wailmer, Wailord
    '0339': P, '0340': P,                       # Barboach, Whiscash
    '0456': S, '0457': S,                       # Finneon, Lumineon
    '0322': S, '0323': S,                       # Numel, Camerupt: Earth Power, Flamethrower
    '0769': S, '0770': S,                       # Sandygast, Palossand: Shadow Ball, Earth Power
    '0343': S, '0344': S,                       # Baltoy, Claydol: Psybeam, Earth Power
    '0694': S, '0695': S,                       # Helioptile, Heliolisk: Thunderbolt
    '0582': S, '0583': S, '0584': S,            # Vanillite line: Ice Beam, Blizzard
    '0615': S,                                  # Cryogonal
    '0086': S, '0087': S,                       # Seel, Dewgong: Aurora Beam, Ice Beam
    '0959': P,                                  # Tinkaton
    '0006-mega_x': P, '0362-mega': P,           # Mega Charizard X, Mega Glalie
}

# An attack that doesn't fit a role, and its counterpart of the same type for the other side.
PAIRS = [
    ('ember', 'flame-charge'), ('fire-spin', 'flame-wheel'), ('flamethrower', 'fire-punch'), ('heat-wave', 'fire-punch'),
    ('fire-blast', 'flare-blitz'),
    ('water-gun', 'aqua-jet'), ('bubble', 'aqua-jet'), ('water-pulse', 'razor-shell'), ('bubble-beam', 'razor-shell'),
    ('surf', 'waterfall'), ('hydro-pump', 'aqua-tail'),
    ('thunder-shock', 'nuzzle'), ('charge-beam', 'spark'), ('discharge', 'thunder-fang'), ('thunderbolt', 'thunder-punch'),
    ('thunder', 'wild-charge'),
    ('absorb', 'vine-whip'), ('mega-drain', 'razor-leaf'), ('magical-leaf', 'razor-leaf'), ('giga-drain', 'seed-bomb'),
    ('energy-ball', 'seed-bomb'), ('solar-beam', 'leaf-blade'),
    ('powder-snow', 'ice-shard'), ('icy-wind', 'ice-fang'), ('aurora-beam', 'avalanche'), ('ice-beam', 'ice-punch'),
    ('blizzard', 'icicle-crash'),
    ('aura-sphere', 'brick-break'),
    ('smog', 'poison-sting'), ('acid', 'poison-fang'), ('sludge', 'poison-jab'), ('sludge-bomb', 'poison-jab'),
    ('mud-slap', 'sand-tomb'), ('mud-shot', 'bulldoze'), ('earth-power', 'drill-run'),
    ('gust', 'wing-attack'), ('air-slash', 'aerial-ace'),
    ('confusion', 'psycho-cut'), ('psybeam', 'psycho-cut'), ('psychic', 'zen-headbutt'),
    ('struggle-bug', 'bug-bite'), ('signal-beam', 'x-scissor'), ('bug-buzz', 'x-scissor'),
    ('ancient-power', 'rock-tomb'), ('power-gem', 'rock-slide'),
    ('night-shade', 'shadow-sneak'), ('hex', 'shadow-claw'), ('shadow-ball', 'shadow-claw'),
    ('twister', 'dragon-tail'), ('dragon-breath', 'dragon-tail'), ('dragon-pulse', 'dragon-claw'), ('draco-meteor', 'outrage'),
    ('snarl', 'bite'), ('dark-pulse', 'crunch'),
    ('mirror-shot', 'iron-head'), ('flash-cannon', 'iron-head'),
    ('fairy-wind', 'play-rough'), ('disarming-voice', 'play-rough'), ('draining-kiss', 'play-rough'),
    ('dazzling-gleam', 'play-rough'), ('moonblast', 'play-rough'),
    ('swift', 'headbutt'), ('hyper-voice', 'double-edge'),
]
TO_PHYSICAL = {s: p for s, p in PAIRS}
# The way back: the special move of the same type nearest in power.
TO_SPECIAL = {
    'flame-charge': 'ember', 'flame-wheel': 'fire-spin', 'fire-fang': 'flamethrower', 'fire-punch': 'flamethrower',
    'flare-blitz': 'fire-blast', 'aqua-jet': 'water-gun', 'razor-shell': 'water-pulse', 'waterfall': 'surf',
    'aqua-tail': 'surf', 'wave-crash': 'hydro-pump', 'nuzzle': 'thunder-shock', 'spark': 'charge-beam',
    'thunder-fang': 'discharge', 'thunder-punch': 'thunderbolt', 'wild-charge': 'thunderbolt', 'vine-whip': 'absorb',
    'razor-leaf': 'magical-leaf', 'seed-bomb': 'energy-ball', 'leaf-blade': 'energy-ball', 'leafage': 'magical-leaf',
    'ice-shard': 'powder-snow', 'ice-fang': 'icy-wind', 'avalanche': 'aurora-beam', 'ice-punch': 'ice-beam',
    'icicle-crash': 'ice-beam', 'karate-chop': 'aura-sphere', 'low-kick': 'aura-sphere', 'double-kick': 'aura-sphere',
    'brick-break': 'aura-sphere', 'close-combat': 'aura-sphere', 'force-palm': 'aura-sphere', 'rock-smash': 'aura-sphere',
    'poison-sting': 'smog', 'poison-fang': 'sludge', 'poison-jab': 'sludge-bomb', 'sand-tomb': 'mud-shot',
    'bulldoze': 'mud-shot', 'drill-run': 'earth-power', 'earthquake': 'earth-power', 'peck': 'gust', 'wing-attack': 'gust',
    'aerial-ace': 'air-slash', 'brave-bird': 'air-slash', 'psycho-cut': 'psybeam', 'zen-headbutt': 'psychic',
    'fury-cutter': 'struggle-bug', 'bug-bite': 'struggle-bug', 'x-scissor': 'bug-buzz', 'rock-throw': 'ancient-power',
    'rock-tomb': 'ancient-power', 'rock-slide': 'power-gem', 'stone-edge': 'power-gem', 'smack-down': 'ancient-power',
    'astonish': 'night-shade', 'lick': 'night-shade', 'shadow-sneak': 'night-shade', 'shadow-claw': 'shadow-ball',
    'dragon-tail': 'dragon-breath', 'dragon-claw': 'dragon-pulse', 'outrage': 'draco-meteor', 'bite': 'snarl',
    'feint-attack': 'snarl', 'night-slash': 'dark-pulse', 'crunch': 'dark-pulse', 'sucker-punch': 'dark-pulse',
    'metal-claw': 'mirror-shot', 'bullet-punch': 'mirror-shot', 'iron-head': 'flash-cannon', 'iron-tail': 'flash-cannon',
    'steel-wing': 'flash-cannon', 'heavy-slam': 'flash-cannon', 'play-rough': 'moonblast', 'tackle': 'swift',
    'scratch': 'swift', 'quick-attack': 'swift', 'headbutt': 'swift', 'slash': 'swift', 'return': 'hyper-voice',
    'body-slam': 'hyper-voice', 'double-edge': 'hyper-voice',
}

# Kits pinned outright, for Pokemon whose identity the stat rule and the mirror can't find.
KITS = {
    '0390': ['scratch', 'flame-charge', 'mach-punch', 'flame-wheel'],
    '0391': ['mach-punch', 'flame-wheel', 'fire-punch', 'double-kick'],
    '0392': ['flare-blitz', 'close-combat', 'mach-punch', 'fire-punch'],
    '0255': ['scratch', 'flame-charge', 'double-kick', 'flame-wheel'],
    '0256': ['flame-wheel', 'double-kick', 'fire-punch', 'brick-break'],
    '0257': ['flare-blitz', 'close-combat', 'fire-punch', 'double-kick'],
    '0445': ['dragon-claw', 'earthquake', 'crunch', 'stone-edge'],
    '0007': ['bubble', 'water-pulse', 'water-gun', 'bubble-beam'],
    '0008': ['bubble', 'water-pulse', 'swift', 'bubble-beam'],
    '0009': ['water-pulse', 'hydro-pump', 'flash-cannon', 'surf'],
    '0448': ['aura-sphere', 'close-combat', 'flash-cannon', 'dark-pulse'],
    '0447': ['quick-attack', 'force-palm', 'aura-sphere', 'metal-claw'],
    # The stronger wild encounters (spawns.json strong pools) and the October 2026 additions.
    '0289': ['body-slam', 'double-edge', 'slash', 'earthquake'],          # Slaking
    '0212': ['bullet-punch', 'x-scissor', 'iron-head', 'aerial-ace'],     # Scizor
    '0900': ['stone-edge', 'x-scissor', 'rock-slide', 'close-combat'],    # Kleavor
    '0478': ['ice-beam', 'shadow-ball', 'icy-wind', 'hex'],               # Froslass
    '0903': ['close-combat', 'poison-jab', 'brick-break', 'aerial-ace'],  # Sneasler
    '0563': ['shadow-ball', 'hex', 'psychic', 'will-o-wisp'],             # Cofagrigus
    '0990': ['earthquake', 'iron-head', 'heavy-slam', 'bulldoze'],        # Iron Treads
    '0452': ['crunch', 'poison-jab', 'x-scissor', 'poison-fang'],         # Drapion
    '0567': ['rock-slide', 'aerial-ace', 'stone-edge', 'brave-bird'],     # Archeops
    '0968': ['iron-tail', 'heavy-slam', 'bulldoze', 'iron-head'],         # Orthworm
    # October 28: the desert's coast and rocks (Tirtouga, Dwebble) and Onix, Steelix's ordinary route.
    '0564': ['aqua-jet', 'rock-throw', 'bite', 'ancient-power'],          # Tirtouga
    '0565': ['aqua-tail', 'stone-edge', 'crunch', 'waterfall'],           # Carracosta
    '0557': ['rock-throw', 'bug-bite', 'smack-down', 'fury-cutter'],      # Dwebble
    '0558': ['stone-edge', 'x-scissor', 'rock-slide', 'razor-shell'],     # Crustle
    '0095': ['rock-throw', 'rock-tomb', 'bulldoze', 'iron-tail'],         # Onix
    '0225': ['ice-shard', 'aerial-ace', 'icicle-crash', 'brave-bird'],    # Delibird
    '0975': ['icicle-crash', 'body-slam', 'avalanche', 'heavy-slam'],     # Cetitan
    '0555-galar': ['icicle-crash', 'fire-punch', 'avalanche', 'headbutt'],  # Galarian Darmanitan
}


def role_of(sp):
    key = sp['dex']
    base = key.split('-')[0]
    if key in ROLE:
        return ROLE[key]
    if base in ROLE and not key.endswith('-mega') and not key.endswith('-mega_x'):
        return ROLE[base]
    a, s = sp['stats']['atk'], sp['stats']['spa']
    if a >= s * 1.1:
        return P
    if s >= a * 1.1:
        return S
    return M


def fit(mid, role, moves):
    """The kit move for this role: itself if it fits, else its counterpart (None when there is none)."""
    m = moves.get(mid)
    if not m:
        return None
    if m['category'] == 'status' or m.get('signature') or role == M:
        return mid
    if role == P and m['category'] == 'special':
        return TO_PHYSICAL.get(mid)
    if role == S and m['category'] == 'physical':
        return TO_SPECIAL.get(mid)
    return mid


def build(sp, role, kit, moves):
    # The better side for a mixed Pokemon's ladders (its other side's strong move comes later).
    side = role if role != M else (P if sp['stats']['atk'] >= sp['stats']['spa'] else S)
    pick = lambda pair: pair[0] if side == P else pair[1]
    types = sp['types']
    out = []

    def add(level, mid):
        if mid and mid in moves and all(m != mid for _, m in out):
            out.append([level, mid])

    lad = LADDERS.get(types[0], LADDERS['normal'])
    if side == P:
        opener = 'scratch' if sp['dex'].split('-')[0] in SCRATCH else 'peck' if sp['dex'].split('-')[0] in PECK else 'tackle'
        add(1, opener)
    else:
        # A special attacker starts with its type's first special move (Pikachu: Thunder Shock).
        sec = LADDERS.get(types[1]) if len(types) > 1 else None
        add(1, pick(lad[0]) or (pick(sec[0]) if sec else None) or 'tackle')
    add(1, LADDERS['normal'][5])
    for lv, pair in zip(PRIMARY, lad[:5]):
        add(lv, pick(pair))
    if role == M:
        other = lad[3][1] if side == P else lad[3][0]
        add(PRIMARY[3] + 4, other)
    second = LADDERS.get(types[1]) if len(types) > 1 else LADDERS['normal']
    for lv, pair in zip(SECOND, second[:4]):
        add(lv, pick(pair))
    if lad[5]:
        add(STATUS_LEVEL, lad[5])

    # Kit attacks take over the rung of their type closest below them in power.
    for mid in kit:
        m = moves.get(mid)
        if not m or any(x == mid for _, x in out):
            continue
        if m['category'] == 'status' or m['power'] <= 0:
            add(12, mid)
            continue
        rungs = [e for e in out if moves[e[1]]['type'] == m['type'] and moves[e[1]]['category'] == m['category']
                 and moves[e[1]]['power'] <= m['power'] and e[1] not in kit and e[0] > 1]
        if rungs:
            best = max(rungs, key=lambda e: (moves[e[1]]['power'], e[0]))
            best[1] = mid
        else:
            p = m['power']
            add(7 if p <= 40 else 16 if p <= 60 else 26 if p <= 80 else 36 if p <= 100 else 42, mid)
    out.sort(key=lambda e: e[0])  # stable: same-level moves keep their order
    # A rung taken over twice over leaves a duplicate: keep the first.
    seen, clean = set(), []
    for lv, mid in out:
        if mid not in seen:
            seen.add(mid)
            clean.append([lv, mid])
    return clean


def main():
    S_ = json.load(open(SPECIES))
    moves = {m['id']: m for m in json.load(open(MOVES))['moves']}
    n = 0
    for sp in S_['species']:
        key = sp['dex']
        role = role_of(sp)
        sp['role'] = role
        base = key.split('-')[0]
        kit = KITS.get(key) or (KITS.get(base) if key.endswith('-shiny') else None) or sp.get('moves', [])
        new_kit = []
        for mid in kit:
            f = fit(mid, role, moves)
            if f and f not in new_kit:
                new_kit.append(f)
        if key in OVERRIDES and OVERRIDES[key] is None:
            sp.pop('learnset', None)
            continue
        sp['moves'] = new_kit[:4] if len(new_kit) >= 2 else sp.get('moves', [])
        sp['learnset'] = OVERRIDES.get(key) or build(sp, role, sp['moves'], moves)
        # A kit is four moves: two that mirrored onto the same counterpart leave a gap, filled from
        # the top of the learnset.
        for _, mid in reversed(sp['learnset']):
            if len(sp['moves']) >= 4:
                break
            if mid not in sp['moves']:
                sp['moves'].append(mid)
        sig = SIGNATURE.get(base)
        if sig and sig in moves and all(m != sig for _, m in sp['learnset']):
            sp['learnset'] = [[1, sig]] + sp['learnset']
        n += 1
    json.dump(S_, open(SPECIES, 'w'), indent=2, ensure_ascii=False)
    open(SPECIES, 'a').write('\n')
    print(f'learnsets for {n} species')
    for name in ('Infernape', 'Garchomp', 'Charizard', 'Lucario', 'Pikachu', 'Gyarados', 'Blastoise'):
        sp = next(s for s in S_['species'] if s['name'] == name)
        print(name, sp['role'], sp['moves'], sp['learnset'])


if __name__ == '__main__':
    main()
