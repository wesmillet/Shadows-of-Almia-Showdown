#!/usr/bin/env python3
"""Marks each Guardian Signs effect's lead-in in assets/fx/guardian_signs/manifest.json: the frames at
its start that show less than a quarter of its fullest frame's pixels (a burst still a speck, rock
spikes not yet up). An impact played on a Pokemon that is hit skips them (src/ui/matchScreen.ts
spawnFx), so it is at full size in the frame the damage lands instead of a few frames later.

    python3 scripts/fx_lead_in.py
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'assets', 'fx', 'guardian_signs')
PATH = os.path.join(DIR, 'manifest.json')
m = json.load(open(PATH))
for e in m['effects'].values():
    a = np.asarray(Image.open(os.path.join(DIR, e['file'])).convert('RGBA'))[:, :, 3] > 0
    fw, n = e['frame_w'], e['frames']
    cov = [int(a[:, i * fw:(i + 1) * fw].sum()) for i in range(n)]
    top = max(cov) or 1
    lead = 0
    while lead < n - 1 and cov[lead] < 0.25 * top:
        lead += 1
    e['lead_in'] = lead
m['lead_in_comment'] = ('lead_in: frames at the start of an effect that show less than a quarter of its fullest frame. An impact '
                        'played on a Pokemon that is hit starts after them (src/ui/matchScreen.ts spawnFx). scripts/fx_lead_in.py.')
json.dump(m, open(PATH, 'w'), indent=1)
print(sum(1 for e in m['effects'].values() if e['lead_in']), 'effects with a lead-in')
