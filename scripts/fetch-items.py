#!/usr/bin/env python3
"""Fetch Gen 4 item icons from the pret/pokeplatinum decompilation (sparse
checkout of res/items only) into assets/items/.

Icons are 32x32 indexed PNGs whose real colours live in a JASC .pal file named
by the item's data JSON (several items share one sprite with their own
palette: Super Potion is potion.png + super_potion.pal, every TM is tm.png +
tm_<type>.pal). Palette index 0 is transparent.

Every ball (bag icon, ground item, capture throw) uses the project's own
assets/items/balls/ set (see its README); no Platinum ball art is fetched.
The open and wobble frames are built in code from the closed sprite.

Set POKEPLATINUM_DIR to reuse an existing sparse checkout (default
/tmp/pokeplatinum).
"""
import json
import os
import subprocess
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Pillow is required: pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.environ.get('POKEPLATINUM_DIR', '/tmp/pokeplatinum')
REPO = 'https://github.com/pret/pokeplatinum'
DEST = os.path.join(ROOT, 'assets', 'items')
ICONS = os.path.join(WORK, 'res', 'items', 'icons')
DATA = os.path.join(WORK, 'res', 'items', 'data')

# game item id -> decomp item name
ITEMS = {
    'potion': 'potion', 'super-potion': 'super_potion', 'hyper-potion': 'hyper_potion',
    'full-heal': 'full_heal', 'revive': 'revive',
    'x-attack': 'x_attack', 'x-defend': 'x_defense', 'x-speed': 'x_speed',
    'leftovers': 'leftovers', 'focus-sash': 'focus_sash', 'choice-band': 'choice_band', 'life-orb': 'life_orb',
    'charcoal': 'charcoal', 'mystic-water': 'mystic_water', 'magnet': 'magnet', 'miracle-seed': 'miracle_seed',
    'never-melt-ice': 'nevermeltice', 'black-belt': 'black_belt', 'soft-sand': 'soft_sand', 'sharp-beak': 'sharp_beak',
    'twisted-spoon': 'twistedspoon', 'poison-barb': 'poison_barb', 'hard-stone': 'hard_stone', 'spell-tag': 'spell_tag',
    'dragon-fang': 'dragon_fang', 'black-glasses': 'blackglasses', 'metal-coat': 'metal_coat', 'silk-scarf': 'silk_scarf',
    'rare-candy': 'rare_candy', 'exp-share': 'exp_share', 'lucky-egg': 'lucky_egg',
    'fire-stone': 'fire_stone', 'water-stone': 'water_stone', 'thunder-stone': 'thunderstone', 'leaf-stone': 'leaf_stone',
    'moon-stone': 'moon_stone', 'sun-stone': 'sun_stone', 'shiny-stone': 'shiny_stone', 'dusk-stone': 'dusk_stone',
    'dawn-stone': 'dawn_stone',
}
TM_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying',
            'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel']

CREDITS = """Item icons: Pokémon Platinum, by Game Freak / The Pokémon Company /
Nintendo, taken from the pret/pokeplatinum decompilation
(https://github.com/pret/pokeplatinum) by scripts/fetch-items.py (icons
recoloured with their JASC palettes, palette index 0 keyed out).
Non-commercial fan project use only.

<item>.png            32x32 Gen 4 bag icon (medicine, X items, held items)
tm-<type>.png         the TM disc in that type's colour
balls/                every ball and the Crystal Shard vial: see balls/README.md
ice-stone.png         the Water Stone recoloured icy (Gen 4 has no Ice Stone)
"""


def ensure_repo():
    if not os.path.isdir(os.path.join(WORK, '.git')):
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--no-checkout', REPO, WORK], check=True)
    current = subprocess.run(['git', 'sparse-checkout', 'list'], cwd=WORK, capture_output=True, text=True).stdout.split('\n')
    wanted = sorted(set([p for p in current if p] + ['/res/items/data/*', '/res/items/icons/*']))
    subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', '--stdin'], cwd=WORK, input='\n'.join(wanted) + '\n', check=True, text=True)
    subprocess.run(['git', 'checkout'], cwd=WORK, check=True, capture_output=True)


def read_pal(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        lines = [ln.strip() for ln in f if ln.strip()]
    colours = []
    for ln in lines[3:]:
        parts = ln.split()
        if len(parts) >= 3:
            colours.append(tuple(int(p) for p in parts[:3]))
    return colours


def icon_rgba(sprite, palette):
    im = Image.open(os.path.join(ICONS, sprite + '.png'))
    if im.mode != 'P':
        return im.convert('RGBA')
    pal_path = os.path.join(ICONS, palette + '.pal')
    colours = read_pal(pal_path) if os.path.isfile(pal_path) else None
    if colours is None:
        base = im.getpalette()
        colours = [tuple(base[i:i + 3]) for i in range(0, len(base), 3)]
    idx = im.load()
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    px = out.load()
    for y in range(im.height):
        for x in range(im.width):
            i = idx[x, y]
            if i == 0:
                continue
            c = colours[i] if i < len(colours) else (255, 0, 255)
            px[x, y] = (c[0], c[1], c[2], 255)
    return out


def main():
    ensure_repo()
    os.makedirs(DEST, exist_ok=True)
    n = 0
    for item_id, name in ITEMS.items():
        data_path = os.path.join(DATA, name + '.json')
        if not os.path.isfile(data_path):
            print(f'!! {item_id}: no data for {name}', file=sys.stderr)
            continue
        icon = json.load(open(data_path)).get('icon', {})
        sprite = icon.get('sprite', name + '_NCGR').replace('_NCGR', '')
        palette = icon.get('palette', name + '_NCLR').replace('_NCLR', '')
        if not os.path.isfile(os.path.join(ICONS, sprite + '.png')):
            print(f'!! {item_id}: icon sprite {sprite}.png missing', file=sys.stderr)
            continue
        icon_rgba(sprite, palette).save(os.path.join(DEST, f'{item_id}.png'))
        n += 1
    for t in TM_TYPES:
        pal = f'tm_{t}' if os.path.isfile(os.path.join(ICONS, f'tm_{t}.pal')) else 'tm_normal'
        icon_rgba('tm', pal).save(os.path.join(DEST, f'tm-{t}.png'))
        n += 1
    # fairy has no Gen 4 disc: reuse the psychic colouring
    icon_rgba('tm', 'tm_psychic').save(os.path.join(DEST, 'tm-fairy.png'))
    with open(os.path.join(DEST, 'CREDITS.txt'), 'w') as f:
        f.write(CREDITS)
    print(f'wrote {n} files to assets/items/')


if __name__ == '__main__':
    main()
