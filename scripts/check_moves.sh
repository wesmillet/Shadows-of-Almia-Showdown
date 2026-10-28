#!/usr/bin/env bash
# The move library rebuilds to itself: moves.py, move_balance.py and move_audit.py, in the supported
# order, run on a copy of data/ and must leave data/moves.json and data/items/tms.json unchanged.
# A difference means a script has fallen behind the data (or the data was edited by hand without
# the script that owns that field): fix the script, don't let a rerun overwrite the library.
#   bash scripts/check_moves.sh
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp -r scripts data "$T/"
(cd "$T" && python3 scripts/moves.py > /dev/null && python3 scripts/move_balance.py > /dev/null && python3 scripts/move_audit.py > /dev/null)
python3 - "$T" <<'PY'
import json, sys
t = sys.argv[1]
bad = 0
for f in ('data/moves.json', 'data/items/tms.json'):
    if json.load(open(f)) != json.load(open(f'{t}/{f}')):
        a = {m['id']: m for m in json.load(open(f)).get('moves', [])}
        b = {m['id']: m for m in json.load(open(f'{t}/{f}')).get('moves', [])}
        diff = sorted({k for k in a.keys() | b.keys() if a.get(k) != b.get(k)})
        print(f'{f} would change on a rebuild', diff[:20] if diff else '(comment or order)')
        bad = 1
print('move scripts rebuild the library unchanged' if not bad else 'move scripts are out of step with the data')
sys.exit(bad)
PY
