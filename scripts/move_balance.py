#!/usr/bin/env python3
"""Move tuning, rerunnable: writes data/moves.json and data/items/tms.json in place.

  python3 scripts/move_balance.py

What it settles, for every move (signature moves keep their hand-tuned numbers):

- New moves that fill the gaps in the type ladders (scripts/learnsets.py), so a physical Fire
  Pokemon has physical Fire moves from the start and a special Steel one has a special Steel move.
- Cooldowns from one formula, so damage per second rises gently with power: a 120-power move is
  worth waiting for, a 40-power move is the filler between big hits. Area moves (lines, cones,
  rings) hit several Pokemon and so pay a little in damage per second; a move with a status
  chance pays for the status; a drawback (recoil, a stat drop on the user) earns a little back.
  Channelled beams are rated by what they deal over the whole channel.
- Recoil for the canon recoil moves (Double-Edge, Brave Bird, Wild Charge, Flare Blitz...).
- The body animation each move plays (Strike for punches and kicks, Swing for claws, tails and
  wings, Rotate for spins, Hop for stomps; data/moves.json `anim`).
- Where beams and projectiles leave the user (`origin`: mouth, the default; hands; body).
- Dashes (Quick Attack, Bullet Punch, Aerial Ace...) are contact moves: the user rushes in
  (battle.ts lunge) instead of firing a streak at the target.
- The TM list: mid-power moves are common TMs, the strongest moves and set-up moves are rare.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOVES = os.path.join(ROOT, 'data', 'moves.json')
TMS = os.path.join(ROOT, 'data', 'items', 'tms.json')
CONFIG = os.path.join(ROOT, 'data', 'config.json')


def fx(id_, anchor, **kw):
    return {'id': id_, 'anchor': anchor, **kw}


# ---------------------------------------------------------------- new moves
NEW = [
    {'id': 'flame-charge', 'name': 'Flame Charge', 'type': 'fire', 'category': 'physical', 'power': 50, 'shape': 'single',
     'vfx': 'burst', 'size': 1.0, 'stages': {'self': {'spe': 1}, 'chance': 1},
     'fx': [fx('fx_075', 'target', scale=1.2, fps=20), fx('fx_126', 'target', scale=1.2, delay=0.08)]},
    {'id': 'flare-blitz', 'name': 'Flare Blitz', 'type': 'fire', 'category': 'physical', 'power': 120, 'shape': 'single',
     'vfx': 'burst', 'size': 1.3, 'status': {'kind': 'burn', 'chance': 0.1}, 'recoil': 0.33,
     'fx': [fx('fx_075', 'target', scale=1.6, fps=20), fx('fx_148', 'target', scale=2.2, fps=14, tint='#ff9a3c', delay=0.06),
            fx('fx_126', 'target', scale=1.8, delay=0.14)], 'shake': 0.5},
    {'id': 'aqua-jet', 'name': 'Aqua Jet', 'type': 'water', 'category': 'physical', 'power': 40, 'shape': 'single',
     'vfx': 'burst', 'size': 0.8, 'fx': [fx('fx_144', 'target', scale=1.6, fps=24), fx('fx_070', 'target', scale=0.9, ground=True, delay=0.06)],
     'shake': 0.1},
    {'id': 'razor-shell', 'name': 'Razor Shell', 'type': 'water', 'category': 'physical', 'power': 75, 'shape': 'single',
     'vfx': 'burst', 'size': 1.0, 'stages': {'target': {'def': -1}, 'chance': 0.5},
     'fx': [fx('fx_116', 'target', scale=2.4, fps=34, tint='#7fc8ff'), fx('fx_070', 'target', scale=1.0, ground=True, delay=0.08)]},
    {'id': 'waterfall', 'name': 'Waterfall', 'type': 'water', 'category': 'physical', 'power': 80, 'shape': 'single',
     'vfx': 'burst', 'size': 1.0, 'fx': [fx('fx_144', 'target', scale=2.2, fps=24), fx('fx_070', 'target', scale=1.3, ground=True, delay=0.1)],
     'shake': 0.25},
    {'id': 'wave-crash', 'name': 'Wave Crash', 'type': 'water', 'category': 'physical', 'power': 120, 'shape': 'single',
     'vfx': 'burst', 'size': 1.3, 'recoil': 0.33,
     'fx': [fx('fx_144', 'target', scale=2.6, fps=22), fx('fx_017', 'target', scale=2.2, fps=12, tint='#8fd0ff', delay=0.08),
            fx('fx_070', 'target', scale=1.6, ground=True, delay=0.12)], 'shake': 0.5},
    {'id': 'mach-punch', 'name': 'Mach Punch', 'type': 'fighting', 'category': 'physical', 'power': 40, 'shape': 'single',
     'vfx': 'burst', 'size': 0.9, 'fx': [fx('fx_001', 'target', scale=2.2, fps=18), fx('fx_017', 'target', scale=1.4, fps=14, delay=0.04)],
     'shake': 0.1},
    {'id': 'dragon-tail', 'name': 'Dragon Tail', 'type': 'dragon', 'category': 'physical', 'power': 60, 'shape': 'single',
     'vfx': 'burst', 'size': 1.0, 'fx': [fx('fx_147', 'target', scale=2.1, fps=14, tint='#8f6bff'), fx('fx_001', 'target', scale=1.8, delay=0.06)],
     'shake': 0.2},
    {'id': 'mirror-shot', 'name': 'Mirror Shot', 'type': 'steel', 'category': 'special', 'power': 65, 'shape': 'single',
     'vfx': 'projectile', 'size': 1.0, 'stages': {'target': {'atk': -1}, 'chance': 0.3},
     'fx': [fx('fx_221', 'projectile', scale=1.6, speed=15, facing='none', tint='#e6ecff'), fx('fx_005', 'target', scale=1.8, fps=16)]},
    {'id': 'nuzzle', 'name': 'Nuzzle', 'type': 'electric', 'category': 'physical', 'power': 20, 'shape': 'single',
     'vfx': 'burst', 'size': 0.8, 'status': {'kind': 'paralysis', 'chance': 1},
     'fx': [fx('fx_201', 'target', scale=1.2, fps=16), fx('fx_157', 'target', scale=1.2, fps=20, delay=0.06)]},
]

# ---------------------------------------------------------------- body animations
ANIM = {}
for ids, anim in (
    # Punches, chops, kicks and palm strikes.
    ('karate-chop brick-break close-combat fire-punch ice-punch thunder-punch bullet-punch mach-punch force-palm low-kick '
     'rock-smash sucker-punch poison-jab', 'Strike'),
    ('double-kick', 'Double'),
    # Claws, blades, tails, vines and wings.
    ('scratch slash night-slash leaf-blade shadow-claw dragon-claw metal-claw x-scissor fury-cutter aqua-tail iron-tail '
     'dragon-tail vine-whip steel-wing wing-attack razor-shell', 'Swing'),
    # Spins.
    ('flame-wheel twister', 'Rotate'),
    # Stomps.
    ('earthquake bulldoze', 'Hop'),
    # Lunges and bites.
    ('tackle headbutt bite crunch fire-fang ice-fang thunder-fang poison-fang bug-bite double-edge wild-charge zen-headbutt '
     'iron-head spark flare-blitz brave-bird aerial-ace quick-attack aqua-jet shadow-sneak feint-attack lick astonish peck '
     'drill-run outrage return flame-charge nuzzle waterfall wave-crash play-rough', 'Attack'),
):
    for i in ids.split():
        ANIM[i] = anim

# Dashes: the user itself rushes in (contact), no streak fired at the target.
DASHES = {'quick-attack', 'bullet-punch', 'aerial-ace', 'shadow-sneak', 'feint-attack', 'brave-bird', 'aqua-jet', 'mach-punch'}

# Where ranged moves leave the user (the default is the mouth).
HANDS = {'aura-sphere', 'rock-throw', 'smack-down', 'shadow-ball', 'mud-shot', 'energy-ball', 'power-gem', 'seed-bomb'}
BODY = {'psycho-cut', 'air-slash', 'razor-leaf', 'magical-leaf', 'leafage', 'swift', 'ancient-power', 'sleep-powder',
        'stun-spore', 'ice-shard', 'charm', 'fairy-wind', 'sand-attack', 'mud-slap', 'dark-pulse', 'twister', 'mirror-shot',
        'thunder-wave', 'will-o-wisp'}

RECOIL = {'double-edge': 0.33, 'brave-bird': 0.33, 'wild-charge': 0.25, 'flare-blitz': 0.33, 'wave-crash': 0.33}

# Fast filler moves: canon priority moves. They keep a short cooldown (they're for finishing and
# chasing), which the formula pays for with a lower damage per second.
QUICK = {'quick-attack', 'bullet-punch', 'shadow-sneak', 'ice-shard', 'aqua-jet', 'mach-punch', 'sucker-punch'}


def cooldown(m, channel):
    """Seconds between uses: power / (damage per second the move is allowed), see the module doc."""
    p = m['power']
    if m['id'] in channel['moves']:
        p *= channel['powerMult']
    dps = 17 + 0.07 * m['power']
    dps *= {'single': 1.0, 'line': 0.85, 'cone': 0.85, 'ring': 0.75}.get(m['shape'], 1.0)
    if m['id'] in channel['moves']:
        # The user stands rooted while it pours out (channel.seconds): worth a little more.
        dps *= 1.08
    st = m.get('status')
    if st:
        dps *= 1 - 0.3 * min(1.0, st['chance'])
    stages = m.get('stages') or {}
    if stages.get('target'):
        dps *= 1 - 0.15 * stages.get('chance', 0)
    if any(v > 0 for v in (stages.get('self') or {}).values()):
        dps *= 1 - 0.2 * stages.get('chance', 0)
    if any(v < 0 for v in (stages.get('self') or {}).values()):
        dps *= 1.1
    if m.get('recoil'):
        dps *= 1.12
    if st and st['chance'] >= 0.5:
        # A sure status (Nuzzle) is not something to spam.
        return round(max(4.0, min(9.0, p / dps)) * 4) / 4
    if m['id'] in QUICK:
        dps *= 0.85
        return round(max(1.25, min(1.75, p / dps)) * 4) / 4
    return round(max(1.5, min(9.0, p / dps)) * 4) / 4


def main():
    data = json.load(open(MOVES))
    channel = json.load(open(CONFIG))['battle']['channel']
    moves = data['moves']
    ids = {m['id'] for m in moves}
    for n in NEW:
        if n['id'] not in ids:
            moves.append(dict(n))
    before = {m['id']: m['cooldown'] for m in moves if 'cooldown' in m}
    for m in moves:
        if m['id'] in ANIM:
            m['anim'] = ANIM[m['id']]
        m.setdefault('anim', 'Shoot' if m['category'] == 'special' else 'Attack')
        if m['id'] in RECOIL:
            m['recoil'] = RECOIL[m['id']]
        if m['id'] in DASHES:
            m['contact'] = True
            m['fx'] = [p for p in m.get('fx', []) if p['anchor'] != 'projectile']
        for p in m.get('fx', []) or []:
            ranged = p['anchor'] == 'projectile' or (p['anchor'] == 'attacker' and p.get('mode') in ('beam', 'stream'))
            if not ranged:
                p.pop('origin', None)
                continue
            if m['id'] in HANDS:
                p['origin'] = 'hands'
            elif m['id'] in BODY:
                p['origin'] = 'body'
            else:
                p.pop('origin', None)
        if m.get('signature') or m['category'] == 'status' or m['power'] <= 0:
            m.setdefault('cooldown', 6)
            continue
        m['cooldown'] = cooldown(m, channel)
    json.dump(data, open(MOVES, 'w'), indent=2, ensure_ascii=False)
    open(MOVES, 'a').write('\n')
    changed = [(m['id'], before.get(m['id']), m['cooldown']) for m in moves if before.get(m['id']) != m['cooldown']]
    print(f'{len(moves)} moves; cooldowns changed: {len(changed)}')
    for c in changed:
        print('  ', *c)

    # TMs: common ones are good mid-power moves; rare ones are the strongest moves and set-up moves.
    COMMON = ['energy-ball', 'brick-break', 'poison-jab', 'rock-slide', 'dragon-pulse',
              'fire-punch', 'thunder-punch', 'ice-punch', 'shadow-ball',
              'play-rough', 'waterfall', 'sucker-punch', 'air-slash', 'bulk-up', 'calm-mind',
              'aura-sphere', 'power-gem', 'dark-pulse', 'leaf-blade', 'will-o-wisp', 'thunder-wave']
    RARE = ['flamethrower', 'surf', 'thunderbolt', 'ice-beam', 'psychic', 'earthquake', 'sludge-bomb', 'stone-edge',
            'wild-charge', 'heat-wave', 'close-combat', 'dragon-dance',
            'earth-power', 'moonblast', 'brave-bird', 'outrage', 'hypnosis']
    all_ids = {m['id'] for m in moves}
    tms = json.load(open(TMS))
    tms['_comment'] = ("TMs teach `move` (moves.json id) to the lead when it is an attack of the kind the Pokemon fights with "
                       "(physical for a physical attacker, special for a special one, either for a mixed one), whatever its type: "
                       "sim/data.ts canLearnTm. Set-up moves go the same way (Swords Dance, Bulk Up, Agility, Dragon Dance to "
                       "physical fighters; Nasty Plot, Calm Mind to special ones). Icon = assets/items/tm-<type>.png. Rare TMs "
                       "(the strongest attacks and the set-up moves) only come from Ultra Ball loot and Alpha prizes.")
    tms['tms'] = [{'id': f'tm-{i}', 'move': i, 'rare': False} for i in COMMON if i in all_ids] + \
                 [{'id': f'tm-{i}', 'move': i, 'rare': True} for i in RARE if i in all_ids]
    json.dump(tms, open(TMS, 'w'), indent=2, ensure_ascii=False)
    open(TMS, 'a').write('\n')
    print(f"{len(tms['tms'])} TMs")


if __name__ == '__main__':
    main()
