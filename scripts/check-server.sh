#!/usr/bin/env bash
# What CI runs (.github/workflows/ci.yml), on this machine: builds, starts the built server on a
# scratch database, runs every end-to-end check against it, and stops it.
#   bash scripts/check-server.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export DATA_DIR="${DATA_DIR:-$(mktemp -d)}" OPS_TOKEN="${OPS_TOKEN:-local-ops-token-0000}"
npx tsc --noEmit
bash scripts/check_moves.sh
npm test --silent
npm run build:client --silent
npm run build:server --silent
PORT=8787 SERVER_KIND=dev LOBBY_WAIT=4 MATCH_SIZE=4 MIN_PLAYERS=1 DIST_DIR=dist \
  node --disable-warning=ExperimentalWarning dist-server/main.js > "$DATA_DIR/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 90); do curl -sf localhost:8787/health > /dev/null && break; sleep 1; done
npx tsx server/checks/teams.ts
npx tsx server/checks/gameplay.ts | tail -1
npx tsx server/checks/combat.ts | tail -1
npx tsx server/checks/online_events.ts | tail -1
npx tsx server/checks/lagcomp.ts > /dev/null && echo "lag compensation ok"
npx tsx server/checks/social.ts | tail -1
npx tsx server/checks/moderation.ts | tail -1
npx tsx server/checks/ops.ts 2>/dev/null | tail -1
npx tsx server/bots.ts 3 30 > /dev/null && echo "bots ok"
echo "All server checks passed ($DATA_DIR)"
