#!/usr/bin/env python3
"""Shiny colours for every species, as palette swaps (data/shiny.json).

SpriteCollab's shiny sheets (sprite/<dex>/0000/0001/, portrait/<dex>/0000/0001/)
are recolours of the normal ones, pixel for pixel. Instead of shipping a
second copy of every sheet, this reads the normal and shiny Idle sheet (and
Normal portrait) side by side and keeps only the colour pairs; the game
recolours the normal sheets with them when a shiny appears.

Usage:
  SPRITECOLLAB_DIR=/path/to/sparse/checkout python3 scripts/shiny-palettes.py

data/shiny.json: { "<dex>": { "sprite": [[normal, shiny], ...], "portrait": [[normal, shiny], ...] } }
with colours as 0xRRGGBB integers. Species with a "-" in their key (forms,
the hand-fetched "-shiny" sets) are skipped.
"""
import collections
import importlib.util
import io
import json
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('fetch_sprites', os.path.join(ROOT, 'scripts', 'fetch-sprites.py'))
fs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fs)
OUT = os.path.join(ROOT, 'data', 'shiny.json')


def blob(path):
    """A file at HEAD of the sparse checkout (fetched on demand), or None."""
    r = subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=fs.WORK, capture_output=True)
    return r.stdout if r.returncode == 0 and r.stdout else None


def pairs(normal, shiny):
    """The colour swap between two same-sized images: each opaque normal colour's commonest shiny colour."""
    a = normal.convert('RGBA')
    b = shiny.convert('RGBA')
    if a.size != b.size:
        return None
    votes = collections.defaultdict(collections.Counter)
    pa = a.load()
    pb = b.load()
    w, h = a.size
    for y in range(h):
        for x in range(w):
            ca = pa[x, y]
            cb = pb[x, y]
            if ca[3] < 128 or cb[3] < 128:
                continue
            votes[(ca[0] << 16) | (ca[1] << 8) | ca[2]][(cb[0] << 16) | (cb[1] << 8) | cb[2]] += 1
    out = []
    for src, c in sorted(votes.items()):
        dst = c.most_common(1)[0][0]
        if dst != src:
            out.append([src, dst])
    return out


def main():
    fs.ensure_repo()
    species = json.load(open(os.path.join(ROOT, 'data', 'species.json')))['species']
    dexes = sorted({s['dex'] for s in species if '-' not in s['dex']})
    result = json.load(open(OUT)) if os.path.isfile(OUT) else {}
    missing = []
    for dex in dexes:
        if dex in result:
            continue
        entry = {}
        local = os.path.join(fs.SPRITES, dex, 'Idle-Anim.png')
        shiny = blob(f'sprite/{dex}/0000/0001/Idle-Anim.png')
        if os.path.isfile(local) and shiny:
            p = pairs(Image.open(local), Image.open(io.BytesIO(shiny)))
            if p:
                entry['sprite'] = p
        local = os.path.join(fs.PORTRAITS, dex, 'Normal.png')
        shiny = blob(f'portrait/{dex}/0000/0001/Normal.png')
        if os.path.isfile(local) and shiny:
            p = pairs(Image.open(local), Image.open(io.BytesIO(shiny)))
            if p:
                entry['portrait'] = p
        if entry.get('sprite'):
            result[dex] = entry
        else:
            missing.append(dex)
        print(dex, 'ok' if dex in result else 'no shiny sheet', flush=True)
    json.dump(result, open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(result)} shiny palettes; none for {len(missing)}: {" ".join(missing)}')


if __name__ == '__main__':
    sys.exit(main())
