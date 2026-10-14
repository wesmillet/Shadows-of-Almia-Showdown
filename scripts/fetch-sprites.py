#!/usr/bin/env python3
"""Fetch Pokémon sprite folders and portraits from PMDCollab SpriteCollab
(CC BY-NC 4.0) with a sparse checkout, never a full clone.

Usage:
  python3 scripts/fetch-sprites.py 0025 0491
  python3 scripts/fetch-sprites.py --list scripts/species-list.txt
  python3 scripts/fetch-sprites.py --credits      # only rebuild assets/CREDITS.md

For each dex number the top-level files of sprite/<dex>/ (AnimData.xml,
credits.txt and every *-Anim.png, *-Offsets.png, *-Shadow.png) are copied to
assets/pokemon/<dex>/, and the top-level files of portrait/<dex>/ (one 40x40
PNG per emotion plus credits.txt) to assets/portraits/<dex>/. Alternate forms
and shinies (the numbered subfolders) are not fetched.

assets/CREDITS.md is regenerated from every credits.txt, with artist names
resolved through SpriteCollab's credit_names.txt.

Set SPRITECOLLAB_DIR to reuse an existing sparse checkout (default
/tmp/spritecollab).
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.environ.get('SPRITECOLLAB_DIR', '/tmp/spritecollab')
REPO = 'https://github.com/PMDCollab/SpriteCollab'
ASSETS = os.path.join(ROOT, 'assets')
SPRITES = os.path.join(ASSETS, 'pokemon')
PORTRAITS = os.path.join(ASSETS, 'portraits')


def git(*args, **kw):
    return subprocess.run(['git', *args], cwd=WORK, check=True, capture_output=True, text=True, **kw)


def ensure_repo():
    if not os.path.isdir(os.path.join(WORK, '.git')):
        os.makedirs(os.path.dirname(WORK) or '.', exist_ok=True)
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO, WORK],
                       check=True, env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'})
        git('sparse-checkout', 'set', '--no-cone', '/tracker.json', '/credit_names.txt')


def sparse_add(patterns):
    current = [p for p in git('sparse-checkout', 'list').stdout.split('\n') if p]
    wanted = sorted(set(current + patterns))
    git('sparse-checkout', 'set', '--no-cone', '--stdin', input='\n'.join(wanted) + '\n')


def top_level_files(tree_path):
    """Files directly inside a folder of the checkout, from the tree objects
    (available even though blobs are filtered)."""
    out = git('ls-tree', '--name-only', 'HEAD', tree_path + '/').stdout.split('\n')
    files = []
    for line in out:
        if not line:
            continue
        name = line.rsplit('/', 1)[-1]
        if '.' in name:  # subfolders are bare numbers (0000, 0001, ...)
            files.append(name)
    return files


def load_names():
    names = {}
    path = os.path.join(WORK, 'credit_names.txt')
    if not os.path.isfile(path):
        return names
    with open(path, encoding='utf-8') as f:
        next(f, None)
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if parts and parts[0]:
                names[parts[0]] = {'name': parts[0], 'contact': parts[2] if len(parts) > 2 else ''}
    return names


def parse_credits(path):
    """credits.txt lines: date, credit id, status (CUR/OLD), license, sheets."""
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 2:
                continue
            rows.append({'date': parts[0][:10], 'id': parts[1], 'status': parts[2] if len(parts) > 2 else '',
                         'items': parts[4] if len(parts) > 4 else ''})
    return rows


def build_credits(tracker=None):
    names = load_names()
    tracker = tracker or {}
    lines = ['# Credits', '',
             'Pokémon sprites and portraits are from the PMDCollab SpriteCollab project',
             '(https://github.com/PMDCollab/SpriteCollab), licensed CC BY-NC 4.0',
             '(https://creativecommons.org/licenses/by-nc/4.0/). Pokémon is a trademark of',
             'Nintendo / Creatures Inc. / GAME FREAK inc. Nightfall Royale is a',
             'non-commercial fan demo.', '',
             'Each folder keeps its original `credits.txt` (date, artist id, current/old,',
             'license, sheets). The current artists per folder, resolved through',
             '`credit_names.txt`, are listed below.', '']
    for kind, base in (('Sprites', SPRITES), ('Portraits', PORTRAITS)):
        if not os.path.isdir(base):
            continue
        lines += [f'## {kind}', '']
        for dex in sorted(os.listdir(base)):
            cpath = os.path.join(base, dex, 'credits.txt')
            if not os.path.isfile(cpath):
                continue
            label = tracker.get(dex, {}).get('name', '')
            lines.append(f'### {dex} {label}'.rstrip())
            for row in parse_credits(cpath):
                who = names.get(row['id'], {'name': row['id'], 'contact': ''})
                contact = f" ({who['contact']})" if who['contact'] else ''
                tag = ' (earlier version)' if row['status'] == 'OLD' else ''
                lines.append(f"- {who['name']}{contact}{tag}: {row['items'] or 'all'}")
            lines.append('')
    rangers = os.path.join(ASSETS, 'rangers', 'CREDITS.txt')
    if os.path.isfile(rangers):
        lines += ['## Trainer and NPC sheets', '', 'See `assets/rangers/CREDITS.txt`.', '']
    tiles = os.path.join(ASSETS, 'tiles', 'CREDITS.txt')
    if os.path.isfile(tiles):
        lines += ['## Terrain', '', 'See `assets/tiles/CREDITS.txt`.', '']
    with open(os.path.join(ASSETS, 'CREDITS.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines).rstrip() + '\n')


def main(argv):
    specs = []
    args = list(argv)
    credits_only = False
    while args:
        a = args.pop(0)
        if a == '--list':
            with open(args.pop(0)) as f:
                for line in f:
                    line = line.split('#', 1)[0].strip()
                    if line:
                        specs.append(line)
        elif a == '--credits':
            credits_only = True
        else:
            specs.append(a)
    ensure_repo()
    tracker = json.load(open(os.path.join(WORK, 'tracker.json')))
    if credits_only:
        build_credits(tracker)
        return
    if not specs:
        sys.exit(__doc__)

    dexes = []
    for s in specs:
        dex = s.zfill(4)
        node = tracker.get(dex)
        if node is None:
            print(f'!! {dex}: not in tracker.json', file=sys.stderr)
        elif node.get('sprite_complete', 0) == 0:
            print(f'!! {dex} ({node.get("name")}): no sprites drawn yet', file=sys.stderr)
        else:
            dexes.append(dex)

    plan = {}
    pats = []
    for d in dexes:
        sheets = top_level_files(f'sprite/{d}')
        ports = top_level_files(f'portrait/{d}')
        plan[d] = (sheets, ports)
        pats += [f'/sprite/{d}/{f}' for f in sheets]
        pats += [f'/portrait/{d}/{f}' for f in ports]
    sparse_add(pats)

    for d, (sheets, ports) in plan.items():
        dest = os.path.join(SPRITES, d)
        os.makedirs(dest, exist_ok=True)
        n = 0
        for f in sheets:
            src = os.path.join(WORK, 'sprite', d, f)
            if os.path.isfile(src):
                shutil.copyfile(src, os.path.join(dest, f))
                n += 1
        p = 0
        if ports:
            pdest = os.path.join(PORTRAITS, d)
            os.makedirs(pdest, exist_ok=True)
            for f in ports:
                src = os.path.join(WORK, 'portrait', d, f)
                if os.path.isfile(src):
                    shutil.copyfile(src, os.path.join(pdest, f))
                    p += 1
        anims = sorted(f[:-9] for f in sheets if f.endswith('-Anim.png'))
        print(f'{d} {tracker[d]["name"]}: {n} files, {len(anims)} actions, {p} portrait files')

    names = os.path.join(WORK, 'credit_names.txt')
    if os.path.isfile(names):
        shutil.copyfile(names, os.path.join(SPRITES, 'credit_names.txt'))
    build_credits(tracker)


if __name__ == '__main__':
    main(sys.argv[1:])
