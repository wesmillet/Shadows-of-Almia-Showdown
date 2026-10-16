#!/usr/bin/env python3
"""The move library: every move's numbers and its animation recipe, written into data/moves.json.

  python3 scripts/moves.py

Recipes use the Guardian Signs effect sheets (assets/fx/guardian_signs) in one grammar:
a carrier (a beam or stream from the user, a projectile, or a drop from the sky), one
impact on the body of each Pokemon hit, and at most one aftershock. Rings and puddles lie
flat on the ground under the Pokemon. Heavy moves shake the camera.

Moves already in data/moves.json keep their numbers unless this file lists them in NEW;
every move takes its effects from RECIPES (a move missing there is an error).
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'moves.json')


def T(id, **k): return dict(id=id, anchor='target', **k)
def A(id, **k): return dict(id=id, anchor='attacker', **k)
def PR(id, **k): return dict(id=id, anchor='projectile', **k)
def SKY(id, **k): return dict(id=id, anchor='sky', **k)


PINK, PSY, POISON, BUG, STEEL, DRAGON, LEAF, ICE, DARK, FIREO, ELEC = (
    '#ffa8e8', '#ff8ad8', '#c070ff', '#9bd13a', '#d0d8e8', '#9a7bff', '#9cff6b', '#bfe9ff', '#6a3ab0', '#ff9a3c', '#ffe27a')

# id: ([parts], shake)
RECIPES = {
    # ---------------------------------------------------------------- Legendary signature moves
    # (the biggest Guardian Signs sheets: the lightning geyser, the fire eruption, the meteor,
    #  the purple pillar, the red blast)
    'aeroblast': ([A('fx_216', mode='beam', scale=1.8, seconds=1.1, fps=12, tint='#e6f4ff'), T('fx_200', scale=2.6, fps=10, delay=0.2),
                   T('fx_017', scale=3.4, fps=11, tint='#cfe9ff', delay=0.35), T('fx_067', scale=3, ground=True, fps=10, delay=0.35)], 0.7),
    'sacred-fire': ([T('fx_175', scale=2.6, ground=True, fps=9), T('fx_255', scale=2.2, fps=10, lift=2.4, delay=0.1), T('fx_191', scale=2.2, fps=8, delay=0.5)], 0.7),
    'dragon-ascent': ([SKY('fx_210', scale=2.2, speed=13, facing='none', height=11), T('fx_223', scale=3.2, fps=12), T('fx_067', scale=3.4, ground=True, fps=10),
                       T('fx_246', scale=2.6, ground=True, fps=6, delay=0.1)], 1.0),
    'luster-purge': ([T('fx_093', scale=2, fps=8, lift=3.4, tint='#ffd2f4'), T('fx_197', scale=2.2, fps=10, delay=0.35), T('fx_190', scale=2.2, ground=True, fps=10, tint='#ff9ae6')], 0.55),
    'doom-desire': ([SKY('fx_239', scale=2.2, speed=9, facing='none', height=12), T('fx_223', scale=3, fps=12, tint='#fff1a0'), T('fx_175', scale=3, ground=True, fps=9, tint='#fff1a0'),
                     T('fx_239', scale=2.4, fps=8, delay=0.2)], 0.9),
    'hyperspace-hole': ([T('fx_190', scale=2.8, ground=True, fps=9, tint='#d08cff'), T('fx_196', scale=2.8, fps=10, delay=0.25), T('fx_197', scale=2, fps=10, delay=0.45)], 0.6),
    'spectral-thief': ([T('fx_242', scale=3.2, fps=10), T('fx_206', scale=2.6, fps=9, delay=0.15), T('fx_187', scale=2.6, fps=11, delay=0.35)], 0.55),
    'v-create': ([T('fx_175', scale=3, ground=True, fps=9), T('fx_255', scale=2.4, fps=11, lift=2.6), T('fx_223', scale=3.2, fps=12, delay=0.25)], 1.0),
    # ---------------------------------------------------------------- Normal
    'tackle': ([T('fx_001', scale=2.4)], 0),
    'scratch': ([T('fx_116', scale=2, fps=32)], 0),
    'quick-attack': ([PR('fx_131', scale=2, speed=24, facing='right'), T('fx_001', scale=2.2)], 0),
    'howl': ([A('fx_028', scale=1.2, ground=True, fps=20)], 0),
    'return': ([T('fx_017', scale=2.2, fps=12)], 0.25),
    'growl': ([PR('fx_167', scale=2, speed=8, facing='none', fps=8), T('fx_133', scale=1.4, fps=16, tint='#ff9a9a')], 0),
    'leer': ([T('fx_190', scale=1.3, fps=12, tint='#ff6b6b')], 0),
    'scary-face': ([T('fx_190', scale=1.6, fps=10, tint='#ff3b3b')], 0),
    'headbutt': ([T('fx_017', scale=2, fps=12)], 0.2),
    # Body Slam and Heavy Slam are leaps: the attacker jumps and comes down on the target (leap in the move),
    # so the art is the landing: a burst on the body and a wide shockwave on the ground.
    'body-slam': ([T('fx_017', scale=2.8, fps=14), T('fx_067', scale=2.2, ground=True, fps=14, delay=0.03)], 0.6),
    'double-edge': ([T('fx_017', scale=2.6, fps=12), T('fx_148', scale=2, fps=14, delay=0.06)], 0.5),
    'hyper-voice': ([A('fx_024', scale=1.8, ground=True, fps=20), T('fx_001', scale=2, delay=0.15)], 0.15),
    'swift': ([PR('fx_221', scale=1.8, speed=14, facing='none', tint=ELEC), T('fx_005', scale=1.8, fps=16)], 0),
    'slash': ([T('fx_116', scale=2.6, fps=34)], 0),
    'sing': ([PR('fx_168', scale=2, speed=6, facing='none', fps=8)], 0),
    'harden': ([A('fx_012', scale=1.1, ground=True, fps=14, tint='#c8d0e0')], 0),
    'swords-dance': ([A('fx_024', scale=1.1, ground=True, fps=22, tint='#ff8a6b')], 0),
    'agility': ([A('fx_146', scale=1.6, fps=30)], 0),
    # ---------------------------------------------------------------- Fighting
    'rock-smash': ([T('fx_148', scale=2, fps=14), T('fx_023', scale=2.2, delay=0.08)], 0.2),
    'brick-break': ([T('fx_017', scale=2.2, fps=12)], 0.3),
    'karate-chop': ([T('fx_148', scale=1.8, fps=14)], 0),
    'low-kick': ([T('fx_148', scale=1.8, fps=14), T('fx_067', scale=1, ground=True, fps=14)], 0.1),
    'double-kick': ([T('fx_001', scale=2), T('fx_001', scale=2.2, delay=0.16)], 0),
    'force-palm': ([T('fx_148', scale=2, fps=14, tint='#8ab8ff')], 0.15),
    'aura-sphere': ([PR('fx_172', scale=0.9, speed=10, facing='none', fps=10, tint='#6fb0ff'), T('fx_012', scale=1.2, fps=16)], 0.15),
    'close-combat': ([T('fx_017', scale=2), T('fx_148', scale=2, delay=0.12), T('fx_017', scale=2.4, delay=0.24)], 0.5),
    'bulk-up': ([A('fx_028', scale=1, ground=True, fps=20, tint='#ff9a5a')], 0),
    # ---------------------------------------------------------------- Flying
    'wing-attack': ([T('fx_146', scale=2, fps=32)], 0),
    'aerial-ace': ([PR('fx_131', scale=2, speed=28, facing='right'), T('fx_147', scale=1.8, fps=14)], 0),
    'gust': ([T('fx_200', scale=1.4, fps=14)], 0),
    'peck': ([T('fx_001', scale=1.6)], 0),
    'air-slash': ([PR('fx_130', scale=2, speed=16, facing='none', tint='#d8f0ff'), T('fx_147', scale=1.6, fps=14)], 0),
    'brave-bird': ([PR('fx_131', scale=2.4, speed=30, facing='right', tint=ELEC), T('fx_147', scale=2.4, fps=14), T('fx_017', scale=2, delay=0.05)], 0.5),
    # ---------------------------------------------------------------- Fire
    'ember': ([PR('fx_134', scale=2.2, speed=10, facing='none'), T('fx_126', scale=1.8, fps=14)], 0),
    'flamethrower': ([A('fx_107', mode='beam', scale=1.5, seconds=0.75, fps=16), T('fx_055', scale=2, fps=16, delay=0.15)], 0),
    'will-o-wisp': ([PR('fx_208', scale=2.4, speed=7, facing='none', fps=10), T('fx_126', scale=1.4, tint='#b07bff')], 0),
    'flame-wheel': ([T('fx_075', scale=1.2, fps=20), T('fx_126', scale=1.4, delay=0.1)], 0),
    'fire-fang': ([T('fx_118', scale=1.9, fps=24, tint=FIREO), T('fx_126', scale=1.4, delay=0.12)], 0),
    'fire-punch': ([T('fx_148', scale=2, fps=14, tint=FIREO), T('fx_126', scale=1.4, delay=0.08)], 0.15),
    'fire-spin': ([T('fx_075', scale=1.3, fps=16, lift=0.25)], 0),
    'heat-wave': ([T('fx_053', scale=1.6, fps=14)], 0.15),
    'fire-blast': ([PR('fx_174', scale=1.6, speed=9, facing='none'), T('fx_043', scale=1.6, fps=14)], 0.45),
    # ---------------------------------------------------------------- Water
    'water-gun': ([A('fx_105', mode='beam', scale=1.3, seconds=0.45, fps=16), T('fx_070', scale=1.4, ground=True, delay=0.1)], 0),
    'surf': ([A('fx_070', scale=3.2, ground=True, fps=12), T('fx_081', scale=1.8, fps=16, delay=0.15)], 0.35),
    'bubble': ([PR('fx_162', scale=2, speed=8, facing='none', fps=10), T('fx_225', scale=1.4, fps=14)], 0),
    'bubble-beam': ([PR('fx_227', scale=1.4, speed=10, facing='none', fps=10), T('fx_228', scale=1.8, fps=14)], 0),
    'water-pulse': ([PR('fx_163', scale=1.4, speed=10, facing='none', fps=10), T('fx_070', scale=1.3, ground=True, fps=14)], 0),
    'aqua-tail': ([T('fx_144', scale=2, fps=24), T('fx_070', scale=1.2, ground=True, delay=0.1)], 0.2),
    'hydro-pump': ([A('fx_109', mode='beam', scale=1.6, seconds=0.8, fps=14, tint='#4aa8ff'), T('fx_256', scale=1.2, fps=18, delay=0.15)], 0.4),
    # ---------------------------------------------------------------- Electric
    'thunder-shock': ([A('fx_110', mode='beam', scale=1.4, seconds=0.4, fps=18), T('fx_157', scale=2, fps=24)], 0),
    'thunderbolt': ([A('fx_111', mode='beam', scale=1.6, seconds=0.6, fps=18), T('fx_090', scale=1.8, fps=14)], 0.15),
    'discharge': ([A('fx_233', scale=2.2, fps=20), T('fx_157', scale=2, fps=24, delay=0.12)], 0.2),
    'thunder-wave': ([PR('fx_096', scale=2, speed=9, facing='none', fps=12)], 0),
    'wild-charge': ([T('fx_073', scale=1.5, fps=14)], 0.3),
    'spark': ([T('fx_201', scale=1.6, fps=16)], 0),
    'thunder-fang': ([T('fx_118', scale=1.9, fps=24, tint=ELEC), T('fx_157', scale=1.8, fps=24, delay=0.1)], 0),
    'thunder-punch': ([T('fx_148', scale=2, fps=14, tint=ELEC), T('fx_090', scale=1.4, fps=16, delay=0.08)], 0.15),
    'charge-beam': ([A('fx_098', mode='beam', scale=1.2, seconds=0.4, fps=18), T('fx_157', scale=1.8, fps=24)], 0),
    'thunder': ([T('fx_254', scale=1.1, fps=16, lift=2.9), T('fx_090', scale=2, fps=14, delay=0.25)], 0.55),
    # ---------------------------------------------------------------- Grass
    'razor-leaf': ([PR('fx_153', scale=3, speed=12, facing='none', fps=16), T('fx_199', scale=1.6, fps=14)], 0),
    'energy-ball': ([PR('fx_173', scale=0.9, speed=8, facing='none', fps=10), T('fx_014', scale=1.4, tint=LEAF, fps=22)], 0),
    'sleep-powder': ([PR('fx_022', scale=2, speed=7, facing='none', fps=10, tint='#e8ff9a'), T('fx_046', scale=1.8, tint='#e8ff9a', fps=12)], 0),
    'stun-spore': ([PR('fx_022', scale=2, speed=7, facing='none', fps=10, tint=ELEC), T('fx_046', scale=1.8, tint=ELEC, fps=12)], 0),
    'leafage': ([PR('fx_199', scale=1.5, speed=12, facing='none', fps=16), T('fx_001', scale=2, tint=LEAF)], 0),
    'vine-whip': ([T('fx_064', scale=1.6, fps=18)], 0),
    'absorb': ([T('fx_021', scale=1.8, fps=14, tint=LEAF)], 0),
    'mega-drain': ([T('fx_022', scale=2, fps=14, tint=LEAF)], 0),
    'giga-drain': ([T('fx_014', scale=1.6, fps=20, tint=LEAF), T('fx_022', scale=2, fps=14, tint=LEAF, delay=0.2)], 0),
    'magical-leaf': ([PR('fx_199', scale=1.5, speed=13, facing='none', fps=16, tint='#c8ff6b'), T('fx_001', scale=2, tint=LEAF)], 0),
    'seed-bomb': ([PR('fx_125', scale=2.4, speed=11, arc=1, facing='none'), T('fx_029', scale=1.6, fps=18, tint='#7ad04a')], 0.2),
    'leaf-blade': ([T('fx_123', scale=2.4, fps=34, tint='#7ad04a')], 0),
    'solar-beam': ([A('fx_112', mode='beam', scale=1.4, seconds=0.8, fps=10), T('fx_014', scale=2, fps=20, tint='#fff2a0')], 0.4),
    # ---------------------------------------------------------------- Ice
    'ice-beam': ([A('fx_109', mode='beam', scale=1.3, seconds=0.7, fps=14), T('fx_076', scale=1.3, fps=16, delay=0.2)], 0),
    'powder-snow': ([PR('fx_046', scale=1.8, speed=9, facing='none', fps=10), T('fx_204', scale=1.6, fps=16)], 0),
    'ice-shard': ([PR('fx_136', scale=2.2, speed=20, facing='up'), T('fx_204', scale=1.5, fps=16)], 0),
    'icicle-crash': ([SKY('fx_198', scale=1.5, speed=16, facing='none', height=6), T('fx_066', scale=1.6, fps=20)], 0.4),
    'ice-fang': ([T('fx_118', scale=1.9, fps=24, tint=ICE), T('fx_204', scale=1.4, fps=16, delay=0.1)], 0),
    'ice-punch': ([T('fx_148', scale=2, fps=14, tint=ICE), T('fx_204', scale=1.4, fps=16, delay=0.08)], 0.15),
    'aurora-beam': ([A('fx_108', mode='beam', scale=1.4, seconds=0.55, fps=14, tint='#ffb8f0'), T('fx_204', scale=1.4, fps=16, tint='#ffd0f4')], 0),
    'icy-wind': ([PR('fx_046', scale=1.8, speed=9, facing='none', fps=10), T('fx_047', scale=1.6, fps=14)], 0),
    'avalanche': ([SKY('fx_094', scale=1.6, speed=14, facing='none', height=5), T('fx_046', scale=2, fps=12)], 0.3),
    'blizzard': ([A('fx_046', scale=3.2, fps=10), T('fx_076', scale=1.3, fps=16, delay=0.2)], 0.3),
    # ---------------------------------------------------------------- Poison
    'poison-sting': ([PR('fx_129', scale=2, speed=18, facing='up'), T('fx_159', scale=1.6, fps=12)], 0),
    'poison-jab': ([T('fx_017', scale=1.7, tint=POISON, fps=14), T('fx_159', scale=2, fps=12, delay=0.08)], 0),
    'sludge-bomb': ([PR('fx_158', scale=1.1, speed=9, arc=1.4, facing='none', fps=8), T('fx_068', scale=1.3, ground=True, fps=14)], 0.15),
    'acid': ([PR('fx_159', scale=2, speed=9, arc=0.6, facing='none', fps=10), T('fx_235', scale=1, ground=True, fps=16)], 0),
    'smog': ([T('fx_056', scale=1.8, fps=14)], 0),
    'poison-fang': ([T('fx_118', scale=1.9, fps=24, tint=POISON), T('fx_159', scale=1.8, fps=12, delay=0.1)], 0),
    'sludge': ([PR('fx_158', scale=0.9, speed=9, arc=1, facing='none', fps=8), T('fx_056', scale=1.6, fps=14)], 0),
    # ---------------------------------------------------------------- Ground
    'bulldoze': ([A('fx_026', scale=1.7, ground=True, fps=22), T('fx_067', scale=1.4, ground=True, fps=14, delay=0.1)], 0.3),
    'earthquake': ([A('fx_026', scale=2.6, ground=True, fps=20), A('fx_245', scale=2, ground=True, fps=8), T('fx_072', scale=1.8, fps=16, delay=0.15)], 0.7),
    'mud-shot': ([PR('fx_183', scale=1.3, speed=11, facing='none'), T('fx_083', scale=1.1, ground=True, fps=14)], 0),
    'mud-slap': ([PR('fx_183', scale=1, speed=12, facing='none'), T('fx_083', scale=0.9, ground=True, fps=14)], 0),
    'sand-attack': ([PR('fx_023', scale=1.6, speed=12, facing='none', fps=10, tint='#e8d08a'), T('fx_067', scale=1, ground=True, fps=14)], 0),
    'sand-tomb': ([T('fx_067', scale=1.6, ground=True, fps=10), T('fx_023', scale=2, fps=12, tint='#e0c070', delay=0.1)], 0.15),
    'drill-run': ([T('fx_148', scale=2, fps=14, tint='#c89a5a'), T('fx_072', scale=1.6, fps=16, delay=0.1)], 0.25),
    'earth-power': ([T('fx_026', scale=1.2, ground=True, fps=20), T('fx_089', scale=1.2, fps=18, lift=1.0, delay=0.1)], 0.4),
    # ---------------------------------------------------------------- Bug
    'x-scissor': ([T('fx_123', scale=2.1, fps=32, tint='#9be35a')], 0),
    'bug-bite': ([T('fx_118', scale=1.9, fps=24, tint=BUG)], 0),
    'string-shot': ([PR('fx_131', scale=1.6, speed=16, facing='right'), T('fx_048', scale=1.4, fps=30)], 0),
    'struggle-bug': ([T('fx_120', scale=1.6, fps=30, tint=BUG)], 0),
    'fury-cutter': ([T('fx_123', scale=1.8, fps=34, tint='#c8ff6b')], 0),
    'signal-beam': ([A('fx_102', mode='beam', scale=1.3, seconds=0.5, fps=14, tint='#e0ff6b'), T('fx_041', scale=1.6, fps=16, tint='#e0ff6b')], 0),
    'bug-buzz': ([A('fx_024', scale=1.8, ground=True, fps=20, tint=BUG), T('fx_001', scale=2, tint=BUG, delay=0.15)], 0.15),
    # ---------------------------------------------------------------- Rock
    'rock-throw': ([PR('fx_150', scale=2.6, speed=10, arc=1.2, facing='none'), T('fx_023', scale=2, fps=14)], 0.1),
    'rock-slide': ([SKY('fx_240', scale=1.4, speed=14, facing='none', height=7), T('fx_023', scale=2.2, fps=14)], 0.35),
    'stone-edge': ([T('fx_244', scale=1.3, fps=22, lift=1.1)], 0.45),
    'rock-tomb': ([SKY('fx_149', scale=1.6, speed=14, facing='none', height=6), T('fx_023', scale=2.2, fps=14)], 0.3),
    'ancient-power': ([PR('fx_240', scale=1.1, speed=9, arc=0.8, facing='none'), T('fx_023', scale=2, fps=14)], 0.15),
    'smack-down': ([PR('fx_150', scale=2.4, speed=14, facing='none'), T('fx_023', scale=1.8, fps=14)], 0.1),
    'power-gem': ([PR('fx_221', scale=1.8, speed=14, facing='none', tint='#ff8ad8'), T('fx_005', scale=2, fps=16, tint='#ffb0e0')], 0),
    # ---------------------------------------------------------------- Ghost
    'shadow-ball': ([PR('fx_170', scale=1.8, speed=9, facing='none'), T('fx_187', scale=2, fps=12)], 0.15),
    'lick': ([T('fx_116', scale=1.6, fps=30, tint=POISON)], 0),
    'astonish': ([T('fx_049', scale=1.2, fps=20)], 0),
    'shadow-claw': ([T('fx_123', scale=2.2, fps=34, tint='#7a4cc8')], 0),
    'hex': ([T('fx_186', scale=1.2, fps=12)], 0),
    'night-shade': ([T('fx_042', scale=1.4, fps=12)], 0),
    'shadow-sneak': ([PR('fx_131', scale=2, speed=26, facing='right', tint='#5a3aa0'), T('fx_187', scale=1.6, fps=12)], 0),
    # ---------------------------------------------------------------- Dragon
    'dragon-pulse': ([A('fx_102', mode='beam', scale=1.5, seconds=0.6, fps=14, tint=DRAGON), T('fx_097', scale=1.5, fps=12, tint='#a57bff')], 0.15),
    'dragon-breath': ([A('fx_107', mode='beam', scale=1.3, seconds=0.6, fps=16, tint=DRAGON), T('fx_031', scale=2, fps=14, tint='#b090ff', delay=0.15)], 0),
    'dragon-claw': ([T('fx_123', scale=2.2, fps=34, tint='#7a5cff')], 0),
    'twister': ([A('fx_200', scale=2, fps=14, tint='#b8a0ff')], 0),
    'outrage': ([T('fx_017', scale=2.4, fps=12, tint=DRAGON), T('fx_017', scale=2, fps=12, tint=DRAGON, delay=0.15)], 0.5),
    'draco-meteor': ([SKY('fx_132', scale=1.2, speed=12, facing='none', height=8), T('fx_043', scale=1.6, fps=14)], 0.7),
    'dragon-dance': ([A('fx_024', scale=1.2, ground=True, fps=22, tint=DRAGON)], 0),
    # ---------------------------------------------------------------- Dark
    'bite': ([T('fx_118', scale=1.9, fps=24)], 0),
    'crunch': ([T('fx_118', scale=2.4, fps=24), T('fx_241', scale=1.8, fps=18, delay=0.3)], 0.2),
    'dark-pulse': ([A('fx_114', scale=2.4, ground=True, fps=18), PR('fx_187', scale=2, speed=12, facing='none', fps=12), T('fx_177', scale=1.8, fps=20)], 0.15),
    'dark-void': ([A('fx_114', scale=3.6, ground=True, fps=14), T('fx_215', scale=1.6, ground=True, fps=10, delay=0.2)], 0),
    'feint-attack': ([PR('fx_131', scale=2, speed=26, facing='right', tint='#5a3aa0'), T('fx_241', scale=1.6, fps=18)], 0),
    'night-slash': ([T('fx_123', scale=2.2, fps=34, tint=DARK)], 0),
    'snarl': ([T('fx_177', scale=1.8, fps=20)], 0),
    'sucker-punch': ([T('fx_148', scale=2, fps=14, tint=DARK)], 0.15),
    'nasty-plot': ([A('fx_034', scale=1.6, fps=14)], 0),
    # ---------------------------------------------------------------- Steel
    'iron-head': ([T('fx_017', scale=2.1, fps=12, tint=STEEL), T('fx_005', scale=2, fps=14, delay=0.06)], 0.3),
    'metal-claw': ([T('fx_123', scale=2, fps=34, tint=STEEL)], 0),
    'iron-tail': ([T('fx_017', scale=2.4, fps=12, tint=STEEL), T('fx_001', scale=2, delay=0.06)], 0.4),
    'flash-cannon': ([A('fx_101', mode='beam', scale=1.4, seconds=0.55, fps=14, tint='#f0f4ff'), T('fx_005', scale=2, fps=16)], 0.15),
    'bullet-punch': ([PR('fx_131', scale=2, speed=30, facing='right', tint=STEEL), T('fx_001', scale=2)], 0),
    'steel-wing': ([T('fx_146', scale=2, fps=30, tint=STEEL)], 0),
    'iron-defense': ([A('fx_012', scale=1.2, ground=True, fps=14, tint=STEEL)], 0),
    'heavy-slam': ([T('fx_017', scale=3.0, fps=14), T('fx_067', scale=2.6, ground=True, fps=14, delay=0.03)], 0.75),
    # ---------------------------------------------------------------- Psychic
    'confusion': ([T('fx_214', scale=1.6, fps=18)], 0),
    'psybeam': ([A('fx_102', mode='beam', scale=1.3, seconds=0.6, fps=14, tint=PSY), T('fx_041', scale=1.6, fps=16)], 0),
    'psycho-cut': ([PR('fx_130', scale=2, speed=16, facing='none', tint=PSY), T('fx_123', scale=2, fps=32, tint=PSY)], 0),
    'hypnosis': ([T('fx_190', scale=1.4, fps=10)], 0),
    'psychic': ([T('fx_214', scale=2.2, fps=18), T('fx_188', scale=1.1, fps=24, delay=0.2)], 0.2),
    'zen-headbutt': ([T('fx_017', scale=2.2, fps=12, tint=PSY)], 0.2),
    'calm-mind': ([A('fx_214', scale=1.4, fps=16)], 0),
    # ---------------------------------------------------------------- Fairy
    'fairy-wind': ([PR('fx_022', scale=2, speed=11, facing='none', fps=12, tint=PINK), T('fx_014', scale=1.4, fps=22, tint=PINK)], 0),
    'dazzling-gleam': ([A('fx_203', scale=1.4, fps=12), A('fx_028', scale=2.2, ground=True, fps=20, tint='#ffc4f0'), T('fx_041', scale=1.6, fps=16, delay=0.15)], 0.15),
    'disarming-voice': ([A('fx_028', scale=1.4, ground=True, fps=20, tint=PINK), T('fx_041', scale=1.2, fps=16, delay=0.1)], 0),
    'draining-kiss': ([T('fx_214', scale=1.4, fps=18, tint='#ff9ec8')], 0),
    'moonblast': ([PR('fx_205', scale=0.9, speed=9, facing='none', fps=8), T('fx_188', scale=1.2, fps=24)], 0.25),
    'play-rough': ([T('fx_031', scale=2, fps=16), T('fx_001', scale=2, tint=PINK, delay=0.15), T('fx_001', scale=2.2, delay=0.3)], 0.2),
    'charm': ([PR('fx_152', scale=2, speed=8, facing='none', fps=6), T('fx_041', scale=1.2, fps=16, tint='#ff9ec8')], 0),
}

# New moves: id: (name, type, category, power, shape, cooldown, anim, extra)
S, L, C, RG, SF = 'single', 'line', 'cone', 'ring', 'self'
NEW = {
    'growl': ('Growl', 'normal', 'status', 0, C, 5, 'Charge', {'stages': {'target': {'atk': -1}, 'chance': 1}}),
    'leer': ('Leer', 'normal', 'status', 0, C, 5, 'Charge', {'stages': {'target': {'def': -1}, 'chance': 1}}),
    'scary-face': ('Scary Face', 'normal', 'status', 0, S, 6, 'Charge', {'stages': {'target': {'spe': -2}, 'chance': 1}}),
    'headbutt': ('Headbutt', 'normal', 'physical', 70, S, 3.5, 'Attack', {}),
    'body-slam': ('Body Slam', 'normal', 'physical', 85, S, 4.5, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.3}, 'leap': True, 'cast': 0.6}),
    'double-edge': ('Double-Edge', 'normal', 'physical', 120, S, 6, 'Attack', {}),
    'hyper-voice': ('Hyper Voice', 'normal', 'special', 90, RG, 5, 'Charge', {}),
    'swift': ('Swift', 'normal', 'special', 60, S, 2.5, 'Shoot', {}),
    'slash': ('Slash', 'normal', 'physical', 70, S, 3, 'Attack', {}),
    'sing': ('Sing', 'normal', 'status', 0, S, 7, 'Charge', {'status': {'kind': 'sleep', 'chance': 0.55}}),
    'harden': ('Harden', 'normal', 'status', 0, SF, 6, 'Charge', {'stages': {'self': {'def': 1}, 'chance': 1}}),
    'swords-dance': ('Swords Dance', 'normal', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'atk': 2}, 'chance': 1}}),
    'agility': ('Agility', 'psychic', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'spe': 2}, 'chance': 1}}),
    'karate-chop': ('Karate Chop', 'fighting', 'physical', 50, S, 2, 'Attack', {}),
    'low-kick': ('Low Kick', 'fighting', 'physical', 60, S, 2.5, 'Attack', {}),
    'double-kick': ('Double Kick', 'fighting', 'physical', 60, S, 2.5, 'Attack', {}),
    'force-palm': ('Force Palm', 'fighting', 'physical', 60, S, 3, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.3}}),
    'aura-sphere': ('Aura Sphere', 'fighting', 'special', 80, S, 4, 'Shoot', {}),
    'close-combat': ('Close Combat', 'fighting', 'physical', 120, S, 6, 'Attack', {'stages': {'self': {'def': -1}, 'chance': 1}}),
    'bulk-up': ('Bulk Up', 'fighting', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'atk': 1, 'def': 1}, 'chance': 1}}),
    'gust': ('Gust', 'flying', 'special', 40, S, 2, 'Shoot', {}),
    'peck': ('Peck', 'flying', 'physical', 35, S, 1.6, 'Attack', {}),
    'air-slash': ('Air Slash', 'flying', 'special', 75, S, 3.5, 'Shoot', {}),
    'brave-bird': ('Brave Bird', 'flying', 'physical', 120, S, 6, 'Attack', {}),
    'flame-wheel': ('Flame Wheel', 'fire', 'physical', 60, S, 2.5, 'Attack', {'status': {'kind': 'burn', 'chance': 0.1}}),
    'fire-fang': ('Fire Fang', 'fire', 'physical', 65, S, 3, 'Attack', {'status': {'kind': 'burn', 'chance': 0.1}}),
    'fire-punch': ('Fire Punch', 'fire', 'physical', 75, S, 3.5, 'Attack', {'status': {'kind': 'burn', 'chance': 0.1}}),
    'fire-spin': ('Fire Spin', 'fire', 'special', 35, S, 2, 'Shoot', {'status': {'kind': 'burn', 'chance': 0.2}}),
    'heat-wave': ('Heat Wave', 'fire', 'special', 95, C, 5, 'Charge', {'status': {'kind': 'burn', 'chance': 0.1}}),
    'fire-blast': ('Fire Blast', 'fire', 'special', 110, S, 6, 'Charge', {'status': {'kind': 'burn', 'chance': 0.1}}),
    'bubble': ('Bubble', 'water', 'special', 40, C, 2, 'Shoot', {}),
    'bubble-beam': ('Bubble Beam', 'water', 'special', 65, S, 3, 'Shoot', {'stages': {'target': {'spe': -1}, 'chance': 0.1}}),
    'water-pulse': ('Water Pulse', 'water', 'special', 60, S, 3, 'Shoot', {}),
    'aqua-tail': ('Aqua Tail', 'water', 'physical', 90, S, 4.5, 'Attack', {}),
    'hydro-pump': ('Hydro Pump', 'water', 'special', 110, L, 6, 'Charge', {}),
    'spark': ('Spark', 'electric', 'physical', 65, S, 3, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.3}}),
    'thunder-fang': ('Thunder Fang', 'electric', 'physical', 65, S, 3, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.1}}),
    'thunder-punch': ('Thunder Punch', 'electric', 'physical', 75, S, 3.5, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.1}}),
    'charge-beam': ('Charge Beam', 'electric', 'special', 50, L, 2.5, 'Shoot', {'stages': {'self': {'atk': 1}, 'chance': 0.7}}),
    'thunder': ('Thunder', 'electric', 'special', 110, S, 6, 'Charge', {'status': {'kind': 'paralysis', 'chance': 0.3}}),
    'stun-spore': ('Stun Spore', 'grass', 'status', 0, C, 6, 'Shoot', {'status': {'kind': 'paralysis', 'chance': 0.75}}),
    'vine-whip': ('Vine Whip', 'grass', 'physical', 45, S, 2, 'Attack', {}),
    'absorb': ('Absorb', 'grass', 'special', 20, S, 1.5, 'Shoot', {}),
    'mega-drain': ('Mega Drain', 'grass', 'special', 40, S, 2.5, 'Shoot', {}),
    'giga-drain': ('Giga Drain', 'grass', 'special', 75, S, 4, 'Charge', {}),
    'magical-leaf': ('Magical Leaf', 'grass', 'special', 60, S, 2.5, 'Shoot', {}),
    'seed-bomb': ('Seed Bomb', 'grass', 'physical', 80, S, 4, 'Shoot', {}),
    'leaf-blade': ('Leaf Blade', 'grass', 'physical', 90, S, 4, 'Attack', {}),
    'solar-beam': ('Solar Beam', 'grass', 'special', 120, L, 7, 'Charge', {}),
    'ice-fang': ('Ice Fang', 'ice', 'physical', 65, S, 3, 'Attack', {}),
    'ice-punch': ('Ice Punch', 'ice', 'physical', 75, S, 3.5, 'Attack', {}),
    'aurora-beam': ('Aurora Beam', 'ice', 'special', 65, L, 3, 'Shoot', {'stages': {'target': {'atk': -1}, 'chance': 0.1}}),
    'icy-wind': ('Icy Wind', 'ice', 'special', 55, C, 3, 'Shoot', {'stages': {'target': {'spe': -1}, 'chance': 1}}),
    'avalanche': ('Avalanche', 'ice', 'physical', 60, S, 3, 'Attack', {}),
    'blizzard': ('Blizzard', 'ice', 'special', 110, RG, 6, 'Charge', {}),
    'acid': ('Acid', 'poison', 'special', 40, C, 2, 'Shoot', {'stages': {'target': {'def': -1}, 'chance': 0.1}}),
    'smog': ('Smog', 'poison', 'special', 30, C, 2, 'Shoot', {}),
    'poison-fang': ('Poison Fang', 'poison', 'physical', 50, S, 2.5, 'Attack', {}),
    'sludge': ('Sludge', 'poison', 'special', 65, S, 3, 'Shoot', {}),
    'mud-slap': ('Mud-Slap', 'ground', 'special', 20, S, 1.5, 'Shoot', {}),
    'sand-attack': ('Sand Attack', 'ground', 'status', 0, C, 5, 'Shoot', {'stages': {'target': {'spe': -1}, 'chance': 1}}),
    'sand-tomb': ('Sand Tomb', 'ground', 'physical', 35, S, 2, 'Charge', {}),
    'drill-run': ('Drill Run', 'ground', 'physical', 80, S, 4, 'Attack', {}),
    'earth-power': ('Earth Power', 'ground', 'special', 90, S, 4.5, 'Charge', {}),
    'string-shot': ('String Shot', 'bug', 'status', 0, C, 5, 'Shoot', {'stages': {'target': {'spe': -2}, 'chance': 1}}),
    'struggle-bug': ('Struggle Bug', 'bug', 'special', 50, C, 2.5, 'Shoot', {'stages': {'target': {'atk': -1}, 'chance': 1}}),
    'fury-cutter': ('Fury Cutter', 'bug', 'physical', 40, S, 1.6, 'Attack', {}),
    'signal-beam': ('Signal Beam', 'bug', 'special', 75, L, 3.5, 'Shoot', {}),
    'bug-buzz': ('Bug Buzz', 'bug', 'special', 90, RG, 5, 'Charge', {}),
    'rock-tomb': ('Rock Tomb', 'rock', 'physical', 60, S, 3, 'Attack', {'stages': {'target': {'spe': -1}, 'chance': 1}}),
    'ancient-power': ('Ancient Power', 'rock', 'special', 60, S, 3, 'Shoot', {'stages': {'self': {'atk': 1, 'def': 1}, 'chance': 0.1}}),
    'smack-down': ('Smack Down', 'rock', 'physical', 50, S, 2.5, 'Shoot', {}),
    'power-gem': ('Power Gem', 'rock', 'special', 80, S, 4, 'Shoot', {}),
    'lick': ('Lick', 'ghost', 'physical', 30, S, 1.6, 'Attack', {'status': {'kind': 'paralysis', 'chance': 0.3}}),
    'astonish': ('Astonish', 'ghost', 'physical', 30, S, 1.6, 'Attack', {}),
    'shadow-claw': ('Shadow Claw', 'ghost', 'physical', 70, S, 3, 'Attack', {}),
    'hex': ('Hex', 'ghost', 'special', 65, S, 3, 'Charge', {}),
    'night-shade': ('Night Shade', 'ghost', 'special', 50, S, 2.5, 'Charge', {}),
    'shadow-sneak': ('Shadow Sneak', 'ghost', 'physical', 40, S, 1.6, 'Attack', {}),
    'dragon-claw': ('Dragon Claw', 'dragon', 'physical', 80, S, 3.5, 'Attack', {}),
    'twister': ('Twister', 'dragon', 'special', 40, RG, 2.5, 'Charge', {}),
    'outrage': ('Outrage', 'dragon', 'physical', 120, S, 6, 'Attack', {}),
    'draco-meteor': ('Draco Meteor', 'dragon', 'special', 130, S, 8, 'Charge', {'stages': {'self': {'atk': -2}, 'chance': 1}}),
    'dragon-dance': ('Dragon Dance', 'dragon', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'atk': 1, 'spe': 1}, 'chance': 1}}),
    'feint-attack': ('Feint Attack', 'dark', 'physical', 60, S, 2.5, 'Attack', {}),
    'night-slash': ('Night Slash', 'dark', 'physical', 70, S, 3, 'Attack', {}),
    'snarl': ('Snarl', 'dark', 'special', 55, C, 3, 'Shoot', {'stages': {'target': {'atk': -1}, 'chance': 1}}),
    'sucker-punch': ('Sucker Punch', 'dark', 'physical', 70, S, 3, 'Attack', {}),
    'nasty-plot': ('Nasty Plot', 'dark', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'atk': 2}, 'chance': 1}}),
    'metal-claw': ('Metal Claw', 'steel', 'physical', 50, S, 2, 'Attack', {'stages': {'self': {'atk': 1}, 'chance': 0.1}}),
    'iron-tail': ('Iron Tail', 'steel', 'physical', 100, S, 5, 'Attack', {'stages': {'target': {'def': -1}, 'chance': 0.3}}),
    'flash-cannon': ('Flash Cannon', 'steel', 'special', 80, L, 4, 'Charge', {}),
    'bullet-punch': ('Bullet Punch', 'steel', 'physical', 40, S, 1.6, 'Attack', {}),
    'steel-wing': ('Steel Wing', 'steel', 'physical', 70, S, 3, 'Attack', {}),
    'iron-defense': ('Iron Defense', 'steel', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'def': 2}, 'chance': 1}}),
    'heavy-slam': ('Heavy Slam', 'steel', 'physical', 80, S, 4, 'Attack', {'leap': True, 'cast': 0.7}),
    'psychic': ('Psychic', 'psychic', 'special', 90, S, 4.5, 'Charge', {'stages': {'target': {'def': -1}, 'chance': 0.1}}),
    'zen-headbutt': ('Zen Headbutt', 'psychic', 'physical', 80, S, 4, 'Attack', {}),
    'calm-mind': ('Calm Mind', 'psychic', 'status', 0, SF, 8, 'Charge', {'stages': {'self': {'atk': 1, 'def': 1}, 'chance': 1}}),
    'disarming-voice': ('Disarming Voice', 'fairy', 'special', 40, RG, 2.5, 'Charge', {}),
    'draining-kiss': ('Draining Kiss', 'fairy', 'special', 50, S, 2.5, 'Shoot', {}),
    'moonblast': ('Moonblast', 'fairy', 'special', 95, S, 5, 'Charge', {'stages': {'target': {'atk': -1}, 'chance': 0.3}}),
    'play-rough': ('Play Rough', 'fairy', 'physical', 90, S, 4.5, 'Attack', {'stages': {'target': {'atk': -1}, 'chance': 0.1}}),
    'charm': ('Charm', 'fairy', 'status', 0, S, 6, 'Charge', {'stages': {'target': {'atk': -2}, 'chance': 1}}),
    # legendary signature moves: big, slow, and always known by their owners (data.ts movesAt)
    'aeroblast': ('Aeroblast', 'flying', 'special', 100, L, 6, 'Shoot', {'signature': True, 'cast': 0.6}),
    'sacred-fire': ('Sacred Fire', 'fire', 'physical', 100, S, 6, 'Charge', {'signature': True, 'cast': 0.55, 'status': {'kind': 'burn', 'chance': 0.5}}),
    'dragon-ascent': ('Dragon Ascent', 'flying', 'physical', 120, S, 8, 'Charge', {'signature': True, 'cast': 0.7, 'stages': {'self': {'def': -1}, 'chance': 1}}),
    'luster-purge': ('Luster Purge', 'psychic', 'special', 95, S, 6, 'Charge', {'signature': True, 'cast': 0.55, 'stages': {'target': {'def': -1}, 'chance': 0.5}}),
    'doom-desire': ('Doom Desire', 'steel', 'special', 140, S, 10, 'Charge', {'signature': True, 'cast': 0.8}),
    'hyperspace-hole': ('Hyperspace Hole', 'psychic', 'special', 80, S, 5, 'Charge', {'signature': True, 'cast': 0.55}),
    'spectral-thief': ('Spectral Thief', 'ghost', 'physical', 90, S, 5.5, 'Attack', {'signature': True, 'cast': 0.45}),
    'v-create': ('V-create', 'fire', 'physical', 180, S, 12, 'Charge', {'signature': True, 'cast': 0.7, 'stages': {'self': {'def': -1, 'spe': -1}, 'chance': 1}}),
}
VFX = {S: 'burst', L: 'beam', C: 'cloud', RG: 'ring', SF: 'ring'}

# Poison, freeze and confusion on the moves that cause them in the games (applied to any move in moves.json).
EXTRA_STATUS = {
    'poison-sting': ('poison', 0.3), 'poison-jab': ('poison', 0.3), 'sludge': ('poison', 0.3), 'sludge-bomb': ('poison', 0.3),
    'smog': ('poison', 0.4), 'poison-fang': ('poison', 0.5), 'acid': ('poison', 0.15),
    'ice-beam': ('freeze', 0.12), 'blizzard': ('freeze', 0.12), 'powder-snow': ('freeze', 0.12), 'ice-punch': ('freeze', 0.12),
    'ice-fang': ('freeze', 0.1),
    'confusion': ('confusion', 0.2), 'psybeam': ('confusion', 0.2), 'water-pulse': ('confusion', 0.2), 'signal-beam': ('confusion', 0.15),
}


def main():
    data = json.load(open(PATH))
    by = {m['id']: m for m in data['moves']}
    for mid, (name, typ, cat, power, shape, cd, anim, extra) in NEW.items():
        m = by.get(mid) or {'id': mid}
        m.update({'name': name, 'type': typ, 'category': cat, 'power': power, 'shape': shape, 'cooldown': cd,
                  'vfx': VFX[shape], 'anim': anim, 'size': 1.0})
        m.update(extra)
        by[mid] = m
    missing = [mid for mid in by if mid not in RECIPES]
    if missing: sys.exit(f'no recipe for: {missing}')
    for mid, (kind, chance) in EXTRA_STATUS.items():
        if mid in by and 'status' not in by[mid]: by[mid]['status'] = {'kind': kind, 'chance': chance}
    for mid, m in by.items():
        parts, shake = RECIPES[mid]
        m['fx'] = parts
        if shake: m['shake'] = shake
        else: m.pop('shake', None)
    data['moves'] = list(by.values())
    json.dump(data, open(PATH, 'w'), indent=2, ensure_ascii=False)
    open(PATH, 'a').write('\n')
    print(f'{len(by)} moves')


if __name__ == '__main__':
    main()
