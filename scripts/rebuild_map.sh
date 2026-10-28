#!/usr/bin/env bash
# The island, rebuilt from its generators in the one supported order, every stage included:
#   1. build3.py        terrain, towns, the castle's Tiled area (scripts/fantasy/areas/castle.tmx),
#                       objects, shadows, animated scenery, collision; writes the paving mask
#   2. polish3.py       the landscaper pass (groves, verges, beaches, reeds) and the reachability check
#   3. pave_smooth.py   the curved paving overlay for the courtyard and the arena (two ground renders)
#   4. center_blend.py  the colour blend where the centre meadow meets the other lands (a ground render)
#   5. minimap_from_render.py  the minimap and preview from a full render
# Renders go through the game's own renderer (tools/mapshot.html), so a dev server is needed; one is
# started on PORT (default 5179) if none is running there. Needs the Fan-tasy pack: FANTASY_DIR.
#   FANTASY_DIR=/path/to/fantasy bash scripts/rebuild_map.sh [workdir]
set -euo pipefail
cd "$(dirname "$0")/.."
: "${FANTASY_DIR:?set FANTASY_DIR to the Fan-tasy tileset folder}"
export FANTASY_DIR
PORT="${PORT:-5179}"
W="${1:-$(mktemp -d)}"
mkdir -p "$W"
NAME=almia3
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  npx vite --port "$PORT" --host 127.0.0.1 > "$W/vite.log" 2>&1 &
  VITE=$!
  trap 'kill $VITE 2>/dev/null || true' EXIT
  for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
fi
shot() { python3 scripts/mapgen/mapshot.py "$1" "$2" "$PORT" > /dev/null; }
echo "1. build3";            python3 scripts/fantasy/build3.py > "$W/build3.log" 2>&1 || { tail -20 "$W/build3.log"; exit 1; }
echo "2. polish3";           (cd scripts/fantasy && python3 polish3.py --write) > "$W/polish3.log" 2>&1 || { tail -20 "$W/polish3.log"; exit 1; }
grep -E "reachable now|POIs" "$W/polish3.log"
echo "3. pave_smooth";       shot "$W/ground_paved.png" "layer=ground&blend=0&overlay=0"
                             shot "$W/ground_unpaved.png" "layer=ground&blend=0&overlay=0&skip=Courtyard"
                             python3 scripts/mapgen/pave_smooth.py "$NAME" "$W/ground_paved.png" "$W/ground_unpaved.png"
echo "4. center_blend";      shot "$W/ground.png" "layer=ground&blend=0"
                             python3 scripts/mapgen/center_blend.py "$NAME" "$W/ground.png"
echo "5. minimap";           shot "$W/all.png" "layer=all"
                             python3 scripts/mapgen/minimap_from_render.py "$NAME" "$W/all.png"
echo "done: renders in $W (all.png is the finished island at 16 px a tile)"
