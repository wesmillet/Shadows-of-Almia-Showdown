#!/usr/bin/env python3
"""Fill assets/rangers/ with overworld walking sheets.

The demo wants Pokémon Ranger overworld sheets for the player, two AI
trainers, the patrolling Rangers and the lobby host. No open repository
ships those, so this script fetches stand-ins: the Pokémon Platinum field
sprites from the pret/pokeplatinum decompilation (a sparse checkout of
res/graphics/field_sprites only, never the whole repo). The decomp stores
them as indexed PNGs whose palette index 0 is the transparent background.

Each sheet is one column of 32x32 frames, four frames per facing, facings in
the order up, down, left, right (the player sheets add a running set after
the walking frames, which the game ignores).

To use real Pokémon Ranger sheets, drop files with the same names and layout
over the ones written here and update assets/rangers/manifest.json.

Set POKEPLATINUM_DIR to reuse an existing sparse checkout.
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
DEST = os.path.join(ROOT, 'assets', 'rangers')

# role -> (source sheet, frames per facing, display name)
ROLES = {
    'player': ('player/player_m.png', 'Lucas (stand-in for the player Ranger)'),
    'trainer_a': ('npc/ace_trainer_m.png', 'Ace Trainer (stand-in for AI trainer A)'),
    'trainer_b': ('npc/ace_trainer_f.png', 'Ace Trainer (stand-in for AI trainer B)'),
    'ranger': ('npc/camper.png', 'Camper (stand-in for the patrolling Rangers)'),
    'host': ('npc/picnicker.png', 'Picnicker (stand-in for the Ranger lobby host)'),
}

CREDITS = """Overworld walking sheets in this folder are stand-ins for Pokémon Ranger
sheets: Pokémon Platinum field sprites by Game Freak / The Pokémon Company /
Nintendo, taken from the pret/pokeplatinum decompilation
(https://github.com/pret/pokeplatinum) by scripts/fetch-rangers.py, which
keys out palette index 0. Non-commercial fan project use only.

Layout: one column of 32x32 frames, four per facing, facings up, down,
left, right. manifest.json names which file plays which role.
"""


def ensure_repo():
    if not os.path.isdir(os.path.join(WORK, '.git')):
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--no-checkout', REPO, WORK], check=True)
    subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', '/res/graphics/field_sprites/npc/*',
                    '/res/graphics/field_sprites/player/*'], cwd=WORK, check=True)
    subprocess.run(['git', 'checkout'], cwd=WORK, check=True, capture_output=True)


def keyed(path):
    """Indexed PNG -> RGBA with palette index 0 transparent."""
    im = Image.open(path)
    if im.mode != 'P':
        return im.convert('RGBA')
    idx = im.load()
    rgba = im.convert('RGBA')
    px = rgba.load()
    for y in range(im.height):
        for x in range(im.width):
            if idx[x, y] == 0:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def main():
    ensure_repo()
    os.makedirs(DEST, exist_ok=True)
    manifest = {
        'frameWidth': 32,
        'frameHeight': 32,
        'framesPerFacing': 4,
        'facings': ['up', 'down', 'left', 'right'],
        'walkCycle': [0, 1, 2, 3],
        'roles': {},
    }
    for role, (rel, name) in ROLES.items():
        src = os.path.join(WORK, 'res', 'graphics', 'field_sprites', rel)
        if not os.path.isfile(src):
            print(f'!! {role}: {rel} not in the checkout', file=sys.stderr)
            continue
        im = keyed(src)
        # Keep only the walking frames (4 facings x 4 frames).
        im = im.crop((0, 0, 32, 32 * 16))
        im.save(os.path.join(DEST, f'{role}.png'))
        manifest['roles'][role] = {'file': f'{role}.png', 'name': name, 'standIn': True}
        print(f'{role}: {rel} -> assets/rangers/{role}.png')
    with open(os.path.join(DEST, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    with open(os.path.join(DEST, 'CREDITS.txt'), 'w') as f:
        f.write(CREDITS)


if __name__ == '__main__':
    main()
