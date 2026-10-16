#!/usr/bin/env python3
"""Box icons for the PC screen: assets/pc-icons/<dex>.png, trimmed to their pixels.

  python3 scripts/pc-icons.py <PokeAPI/sprites checkout> <msikma/pokesprite checkout>

Gen 5 (Black/White) PC icons from PokeAPI/sprites (sprites/pokemon/versions/generation-v/icons)
for #1-649; the Gen 7 icons from the same repository for #650-809 (Gen 5 has none for them);
the Gen 8 box icons from msikma/pokesprite (pokemon-gen8/regular/<name>.png) for #810-898.
Newer Pokémon have no box icon in either source and the PC draws their portrait instead.
Sparse checkouts are enough: only the files for species in data/species.json are read.
"""
import json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'pc-icons')


def trim(im):
    im = im.convert('RGBA')
    box = im.getbbox()
    return im.crop(box) if box else im


def main(pokeapi, pokesprite):
    os.makedirs(OUT, exist_ok=True)
    species = json.load(open(os.path.join(ROOT, 'data', 'species.json')))['species']
    done, missing = 0, []
    for s in species:
        dex = s['dex'].split('-')[0]
        n = int(dex)
        dst = os.path.join(OUT, dex + '.png')
        if os.path.exists(dst):
            continue
        if n <= 649:
            src = os.path.join(pokeapi, 'sprites/pokemon/versions/generation-v/icons', f'{n}.png')
        elif n <= 809:
            src = os.path.join(pokeapi, 'sprites/pokemon/versions/generation-vii/icons', f'{n}.png')
        else:
            slug = s['name'].lower().replace(' ', '-').replace("'", '').replace('.', '')
            src = os.path.join(pokesprite, 'pokemon-gen8/regular', f'{slug}.png')
        if not os.path.exists(src):
            missing.append(s['name'])
            continue
        trim(Image.open(src)).save(dst)
        done += 1
    print(f'{done} icons written; none for: {", ".join(sorted(set(missing)))}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
