#!/usr/bin/env python3
"""Adds the starter-roll tiers and every species they need (with evolution lines)
to data/species.json and data/spawns.json.

  python3 scripts/add_starters.py <pokeapi-csv-dir>

The CSV dir holds PokeAPI's data/v2/csv files: pokemon, pokemon_stats,
pokemon_types, types, pokemon_species, pokemon_evolution, pokemon_species_names.
Species already in species.json are left alone (their hand-tuned kits stay);
new ones get base stats, types and Pokedex height from PokeAPI. Evolutions use
the level from PokeAPI; stone, trade and friendship evolutions get a level
that fits the line (see LEVEL_FALLBACK). Run scripts/learnsets.py afterwards
for learnsets, scripts/fetch-sprites.py for sprites and
scripts/measure_species.py for body sizes.
"""
import csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Starter roll tiers: weight is the percent chance of rolling that tier; each
# Pokemon inside a tier is equally likely.
TIERS = [
    dict(id='common', name='Common', weight=55, color='#b8b8c8',
         dex=['0025', '0052', '0129', '0054', '0074', '0403', '0396', '0399']),
    dict(id='uncommon', name='Uncommon', weight=27, color='#6fd37a',
         dex=['0239', '0240', '0238', '0236', '0446', '0447', '0133']),
    dict(id='rare', name='Rare', weight=13, color='#5aa8ff',
         dex=['0001', '0004', '0007', '0152', '0155', '0158', '0252', '0255', '0258',
              '0387', '0390', '0393', '0495', '0498', '0501', '0650', '0653', '0656',
              '0722', '0725', '0728', '0810', '0813', '0816', '0906', '0909', '0912']),
    dict(id='epic', name='Epic', weight=4, color='#b06cff',
         dex=['0147', '0246', '0371', '0374', '0443', '0633', '0704', '0782', '0885', '0996']),
    dict(id='mythic', name='Mythic', weight=1, color='#ffcf4a',
         dex=['0151', '0251', '0385', '0490', '0492', '0494', '0808']),
]

# Evolutions with no level in the games (stones, trades, friendship, rain...).
LEVEL_FALLBACK = {
    '0124': 30,   # Smoochum -> Jynx
    '0125': 30,   # Elekid -> Electabuzz
    '0126': 30,   # Magby -> Magmar
    '0466': 45,   # Electabuzz -> Electivire
    '0467': 45,   # Magmar -> Magmortar
    '0143': 25,   # Munchlax -> Snorlax
    '0448': 30,   # Riolu -> Lucario (already present)
    '0706': 50,   # Sliggoo -> Goodra
}
# Mythicals and other lines that should not evolve here.
NO_EVOLVE = {'0808'}  # Meltan (Melmetal needs 400 candies)
# Regional-form evolutions the default form never takes (Galarian Meowth -> Perrserker).
SKIP = {'0863'}


def rows(d, name):
    with open(os.path.join(d, name + '.csv'), newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def main(csvdir):
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
    rolled = {d for t in TIERS for d in t['dex']}
    added = []

    def add_line(sid):
        dex = f'{sid:04d}'
        kids = [] if dex in NO_EVOLVE else [k for k in children.get(sid, []) if f'{k:04d}' not in SKIP]
        if dex in have:
            # Existing species keep their own evolutions.
            kids = [int(e['to'].split('-')[0]) for e in have[dex].get('evolves', [])]
        else:
            p = pokemon[sid]
            pid = int(p['id'])
            st = stats[pid]
            e = dict(dex=dex, name=names[sid], types=types[pid],
                     stats={k: st[k] for k in ('hp', 'atk', 'def', 'spa', 'spd', 'spe')},
                     tier=1 if dex in rolled else 0, moves=[], heightM=int(p['height']) / 10)
            if kids:
                e['evolves'] = [dict(to=f'{k:04d}', level=evo_level.get(k) or LEVEL_FALLBACK.get(f'{k:04d}') or 36) for k in kids]
            S['species'].append(e)
            have[dex] = e
            added.append(dex)
        for k in kids:
            add_line(k)

    for t in TIERS:
        for d in t['dex']:
            add_line(int(d))
            if have[d].get('tier', 0) == 0:
                have[d]['tier'] = 1
    json.dump(S, open(sp_path, 'w'), indent=2, ensure_ascii=False)
    open(sp_path, 'a').write('\n')

    spawn_path = os.path.join(ROOT, 'data', 'spawns.json')
    P = json.load(open(spawn_path))
    P['starterTiers'] = TIERS
    P['starterPool'] = [d for t in TIERS for d in t['dex']]
    json.dump(P, open(spawn_path, 'w'), indent=2, ensure_ascii=False)
    open(spawn_path, 'a').write('\n')
    print(f'{len(added)} species added:', ' '.join(added))


if __name__ == '__main__':
    main(sys.argv[1])
