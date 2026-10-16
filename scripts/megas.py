#!/usr/bin/env python3
"""Adds the Mega Evolutions to data/species.json and their Mega Stones to
data/items/items.json (idempotent: entries are rewritten in place).

  python3 scripts/fetch-sprites.py 0006:mega_x 0094:mega ...   # sprites first
  python3 scripts/megas.py

Only Megas with a full SpriteCollab sprite set are included. A Mega keeps its
base form's learnset, kit and size fields; types, base stats and Pokedex
height come from the main series. `megaOf` names the base form and `stone`
the held item that lets it Mega Evolve (src/sim/mega.ts).
"""
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('measure', os.path.join(ROOT, 'scripts', 'measure_species.py'))
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)

# base dex, sprite folder, name, stone id, stone name, types, hp atk def spa spd spe, heightM
MEGAS = [
    ('0006', '0006-mega_x', 'Mega Charizard X', 'charizardite-x', 'Charizardite X', ['fire', 'dragon'], (78, 130, 111, 130, 85, 100), 1.7),
    ('0094', '0094-mega', 'Mega Gengar', 'gengarite', 'Gengarite', ['ghost', 'poison'], (60, 65, 80, 170, 95, 130), 1.4),
    ('0208', '0208-mega', 'Mega Steelix', 'steelixite', 'Steelixite', ['steel', 'ground'], (75, 125, 230, 55, 95, 30), 10.5),
    ('0248', '0248-mega', 'Mega Tyranitar', 'tyranitarite', 'Tyranitarite', ['rock', 'dark'], (100, 164, 150, 95, 120, 71), 2.5),
    ('0282', '0282-mega', 'Mega Gardevoir', 'gardevoirite', 'Gardevoirite', ['psychic', 'fairy'], (68, 85, 65, 165, 135, 100), 1.6),
    ('0359', '0359-mega', 'Mega Absol', 'absolite', 'Absolite', ['dark'], (65, 150, 60, 115, 60, 115), 1.2),
    ('0362', '0362-mega', 'Mega Glalie', 'glalitite', 'Glalitite', ['ice'], (80, 120, 80, 120, 80, 100), 2.1),
    ('0381', '0381-mega', 'Mega Latios', 'latiosite', 'Latiosite', ['dragon', 'psychic'], (80, 130, 100, 160, 120, 110), 2.3),
    ('0448', '0448-mega', 'Mega Lucario', 'lucarionite', 'Lucarionite', ['fighting', 'steel'], (70, 145, 88, 140, 70, 112), 1.3),
    ('0475', '0475-mega', 'Mega Gallade', 'galladite', 'Galladite', ['psychic', 'fighting'], (68, 165, 95, 65, 115, 110), 1.6),
]


def main():
    sp_path = os.path.join(ROOT, 'data', 'species.json')
    it_path = os.path.join(ROOT, 'data', 'items', 'items.json')
    sp = json.load(open(sp_path))
    it = json.load(open(it_path))
    by_dex = {s['dex']: s for s in sp['species']}
    items = {i['id']: i for i in it['items']}
    for base_dex, folder, name, stone, stone_name, types, st, height in MEGAS:
        if not os.path.isfile(os.path.join(ROOT, 'assets', 'pokemon', folder, 'AnimData.xml')):
            print('skip (no sprites):', folder)
            continue
        base = by_dex[base_dex]
        entry = {k: v for k, v in base.items() if k not in ('dex', 'name', 'types', 'stats', 'heightM', 'body', 'shiny', 'evolves')}
        entry.update({
            'dex': folder, 'name': name, 'types': types,
            'stats': dict(zip(('hp', 'atk', 'def', 'spa', 'spd', 'spe'), st)),
            'heightM': height, 'megaOf': base_dex, 'stone': stone,
        })
        entry['body'] = measure.body(folder)
        if folder in by_dex:
            sp['species'][sp['species'].index(by_dex[folder])] = entry
        else:
            sp['species'].append(entry)
        item = {'id': stone, 'name': stone_name, 'short': stone_name[:8], 'kind': 'hold', 'effect': 'mega',
                'megaFor': base_dex, 'desc': f'Held by {base["name"]}: press M to Mega Evolve it (once a match)'}
        if stone in items:
            it['items'][it['items'].index(items[stone])] = item
        else:
            it['items'].append(item)
        print(name, entry['body'])
    json.dump(sp, open(sp_path, 'w'), indent=2, ensure_ascii=False)
    open(sp_path, 'a').write('\n')
    json.dump(it, open(it_path, 'w'), indent=2, ensure_ascii=False)
    open(it_path, 'a').write('\n')


if __name__ == '__main__':
    main()
