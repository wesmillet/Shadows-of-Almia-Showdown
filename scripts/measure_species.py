#!/usr/bin/env python3
"""Writes each species' canonical size and measured sprite body into data/species.json.

  python3 scripts/measure_species.py

Size fields live in species.json (this script only measures `body`):
heightM is the Pokédex height (metres). `along` says which sprite extent that
figure is measured on: 'height' (default), or 'length' for species whose
Pokédex figure is a nose-to-tail length (the sprite's longest side). `coil`
scales the figure for serpents drawn coiled up (the visible extent of a
coiled body is a fraction of its length). `bodyPx` overrides the measured
height when the sprite carries something bigger than the body (Tinkaton's
hammer). `body` is measured here: the widest and tallest opaque extent of
the down-facing Idle frames, in sprite pixels.
"""
import json, os, xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))



def body(dex):
    root = ET.parse(f'{ROOT}/assets/pokemon/{dex}/AnimData.xml').getroot()
    anims = {a.findtext('Name'): a for a in root.iter('Anim')}
    name = 'Idle'
    while anims[name].findtext('CopyOf'):        # Idle may reuse another action's sheet
        name = anims[name].findtext('CopyOf')
    a = anims[name]
    fw, fh = int(a.findtext('FrameWidth')), int(a.findtext('FrameHeight'))
    im = np.array(Image.open(f'{ROOT}/assets/pokemon/{dex}/{name}-Anim.png').convert('RGBA'))[:, :, 3]
    w = h = 0
    for i in range(im.shape[1] // fw):
        ys, xs = np.nonzero(im[0:fh, i * fw:(i + 1) * fw])
        if len(ys):
            w = max(w, int(xs.max() - xs.min() + 1)); h = max(h, int(ys.max() - ys.min() + 1))
    return [w, h]


def main():
    path = f'{ROOT}/data/species.json'
    d = json.load(open(path))
    for s in d['species']:
        assert 'heightM' in s, f"{s['dex']} {s['name']}: no heightM"
        s['body'] = body(s['dex'])
    json.dump(d, open(path, 'w'), indent=2, ensure_ascii=False)
    open(path, 'a').write('\n')
    print('measured', len(d['species']), 'species')


if __name__ == '__main__':
    main()
