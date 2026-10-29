#!/usr/bin/env bash
# Runs the online combat checks (combat.cjs) against a local dev server under three network
# profiles, restarting the server for each, and writes a summary.
#   bash tools/online-combat/run.sh <out dir> [runs per profile]
# Profiles (server-side, each way, testing only: server/main.ts SIM_LATENCY_MS / SIM_JITTER_MS):
#   plain   no added delay (localhost)
#   lat120  120 ms each way (240 ms round trip)
#   jitter  60 ms each way plus 0-150 ms at random per message (order kept, as on TCP)
# Connection interruptions are scenario 7 in every profile (the server cuts the socket; the browser
# is held offline for 5 s). Packet loss is not simulated: the game runs over WebSockets (TCP), where
# a lost packet is retransmitted and shows up as extra delay, which the jitter profile covers.
set -u
cd "$(dirname "$0")/../.."
OUT="${1:-combat-out}"
RUNS="${2:-1}"
mkdir -p "$OUT"
npm run build:client --silent >/dev/null
npm run build:server --silent >/dev/null
PORT=8796
start() {
  for p in $(ps -eo pid,args | awk '$2=="node" && $0 ~ /dist-server\/main\.js/ && $0 ~ /DEV_PROBE/ {print $1}'); do kill "$p"; done
  for p in $(ps -eo pid,args | awk -v port="$PORT" '$2=="node" && $0 ~ /main\.js/ {print $1}'); do kill "$p"; done
  for i in $(seq 1 60); do curl -s -o /dev/null "localhost:$PORT/health" || break; sleep 1; done
  DATA="$(mktemp -d)"
  env PORT=$PORT SERVER_KIND=dev ROOM_WORKERS=0 DEV_PROBE=1 MATCH_SIZE=2 MIN_PLAYERS=2 LOBBY_WAIT=3 DIST_DIR=dist DATA_DIR="$DATA" METRICS_PORT=9097 "$@" \
    node --disable-warning=ExperimentalWarning dist-server/main.js > "$DATA/server.log" 2>&1 &
  for i in $(seq 1 60); do curl -sf "localhost:$PORT/health" > /dev/null && break; sleep 1; done
}
for n in $(seq 1 "$RUNS"); do
  for profile in "plain" "lat120 SIM_LATENCY_MS=120" "jitter SIM_LATENCY_MS=60 SIM_JITTER_MS=150"; do
    set -- $profile
    label="$1"; shift
    start "$@"
    node tools/online-combat/combat.cjs "http://127.0.0.1:$PORT" "$OUT" "${label}_$n" | tail -1
  done
done
for p in $(ps -eo pid,args | awk '$2=="node" && $0 ~ /main\.js/ {print $1}'); do kill "$p"; done
node -e '
const fs = require("fs"); const dir = process.argv[1];
const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")));
const names = [...new Set(runs.flatMap((r) => r.results.map((x) => x.name)))];
let md = "| check | " + runs.map((r) => r.label).join(" | ") + " |\n|---|" + runs.map(() => "---").join("|") + "|\n";
for (const n of names) md += "| " + n + " | " + runs.map((r) => { const x = r.results.find((y) => y.name === n); return !x ? "" : x.pass === true ? "pass" : x.pass === false ? "**FAIL**" : "n/a"; }).join(" | ") + " |\n";
fs.writeFileSync(dir + "/summary.md", md); console.log(md);
' "$OUT"
