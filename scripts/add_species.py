#!/usr/bin/env python3
"""Adds Pokemon (with their whole evolution lines) to data/species.json.

  python3 scripts/add_species.py <pokeapi-csv-dir> 0118 0223 ...

Like scripts/add_starters.py but for any list of dex numbers and without
touching the starter tiers: new species get base stats, types and Pokedex
height from PokeAPI's data/v2/csv files; species already present are left
alone. Evolutions use PokeAPI's level, else LEVEL_FALLBACK, else 36. Run
scripts/fetch-sprites.py, scripts/measure_species.py and
scripts/learnsets.py afterwards.
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('starters', os.path.join(ROOT, 'scripts', 'add_starters.py'))
starters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(starters)
rows = starters.rows

# Evolutions with no level in the games (trades, beauty, ...).
LEVEL_FALLBACK = {**starters.LEVEL_FALLBACK, '0230': 50, '0350': 30}
# Regional or later-generation evolutions the default form never takes here.
SKIP = starters.SKIP | {'0864', '0904'}  # Cursola (Galarian Corsola), Overqwil (Hisuian Qwilfish)


def main(csvdir, wanted):
    pokemon = {int(r['species_id']): r for r in rows(csvdir, 'pokemon') if r['is_default'] == '1'}
    stat_names = {r['id']: r['identifier'] for r in rows(csvdir, 'stats')}
    key = {'hp': 'hp', 'attack': 'atk', 'defense': 'def', 'special-attack': 'spa', 'special-defense': 'spd', 'speed': 'spe'}
    stats = {}
    for r in rows(csvdir, 'pokemon_stats'):
        n = stat_names.get(r['stat_id'])
        if n in key:
            stats.setdefault(int(r['pokemon_id']), {})[key[n]] = int(r['base_stat'])
    type_names = {r['id']: r['identifier'] for r in rows(csvdir, 'types')}
    types = {}
    for r in sorted(rows(csvdir, 'pokemon_types'), key=lambda r: int(r['slot'])):
        types.setdefault(int(r['pokemon_id']), []).append(type_names[r['type_id']])
    names = {int(r['pokemon_species_id']): r['name'] for r in rows(csvdir, 'pokemon_species_names') if r['local_language_id'] == '9'}
    children = {}
    for r in rows(csvdir, 'pokemon_species'):
        if r['evolves_from_species_id']:
            children.setdefault(int(r['evolves_from_species_id']), []).append(int(r['id']))
    evo_level = {}
    for r in rows(csvdir, 'pokemon_evolution'):
        sid = int(r['evolved_species_id'])
        if r['minimum_level'] and sid not in evo_level:
            evo_level[sid] = int(r['minimum_level'])

    sp_path = os.path.join(ROOT, 'data', 'species.json')
    S = json.load(open(sp_path))
    have = {s['dex']: s for s in S['species']}
    added = []

    def add_line(sid):
        dex = f'{sid:04d}'
        kids = [k for k in children.get(sid, []) if f'{k:04d}' not in SKIP]
        if dex in have:
            kids = [int(e['to'].split('-')[0]) for e in have[dex].get('evolves', [])]
        else:
            p = pokemon[sid]
            pid = int(p['id'])
            st = stats[pid]
            e = dict(dex=dex, name=names[sid], types=types[pid],
                     stats={k: st[k] for k in ('hp', 'atk', 'def', 'spa', 'spd', 'spe')},
                     tier=0, moves=[], heightM=int(p['height']) / 10)
            if kids:
                e['evolves'] = [dict(to=f'{k:04d}', level=evo_level.get(k) or LEVEL_FALLBACK.get(f'{k:04d}') or 36) for k in kids]
            S['species'].append(e)
            have[dex] = e
            added.append(dex)
        for k in kids:
            add_line(k)

    for d in wanted:
        add_line(int(d))
    json.dump(S, open(sp_path, 'w'), indent=2, ensure_ascii=False)
    open(sp_path, 'a').write('\n')
    print(f'{len(added)} species added:', ' '.join(added))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
