# Online combat checks (two real browsers)

`tools/online-combat/` plays fights between two real Chromium clients (Playwright) connected to a
local server built from this branch, and compares each screen with the server's own state.

    bash tools/online-combat/run.sh <out dir> [runs per profile]

## How it works

- **Server:** the normal server build (`dist-server/main.js`) as a dev server (`SERVER_KIND=dev`),
  matches in the main thread (`ROOM_WORKERS=0`), two-player matches, and `DEV_PROBE=1`, which turns
  on `server/devProbe.ts`: read the authoritative match state and its hit/heal/faint log, and stage
  a fight (move a trainer or Pokémon, set HP or moves, give a Pokémon, cut a player's socket).
  `main.ts` routes `/api/dev/*` only when all three of `SERVER_KIND=dev`, `DEV_PROBE=1` and
  `ROOM_WORKERS=0` hold; the live server (`SERVER_KIND=live`) never does, and neither does the demo.
- **Clients:** two browsers load the built game from that server, go online as guests and start a
  private match. Moves are made as a player makes them: the mouse over the target where that screen
  draws it, then a click (left: first move, right: second).
- **Comparison:** after each scenario the harness polls up to 4 s until both screens show what the
  server has (HP, fainted, position within 0.45 tiles) and reports how long that took; a screen that
  never agrees fails. It also looks for stale copies of Pokémon on either screen.

## Network profiles

Server-side, each way, testing only (both settings are ignored when `SERVER_KIND=live`):

| profile | setting | round trip |
|---|---|---|
| plain | none (localhost) | under 1 ms |
| lat120 | `SIM_LATENCY_MS=120` | 240 ms |
| jitter | `SIM_LATENCY_MS=60 SIM_JITTER_MS=150` | 120 to 420 ms, varying per message |

Jitter keeps message order (one queue per connection), as TCP does. **Packet loss is not simulated:**
the game runs over WebSockets, which run over TCP, so a lost packet is retransmitted and the player
sees extra delay, never a missing message; the jitter profile stands in for that. **Brief
interruptions** are scenario 7 in every profile: the server destroys B's socket (as a network loss
would) and B's browser is held offline for 5 s, then reconnects into the running match.

## Scenarios

1. A damaging hit knocks a Pokémon out: server and both screens agree on HP 0 and fainted; B's party shows it; a fainted Pokémon takes no further hits.
2. Knockback on open ground, against a wall, into a corner, in a one-tile passage: it lands on open ground and both screens show it where the server has it.
3. A lunge at a target that walks away; a lunge with a wall in the way (no hit through it).
4. A projectile at a target that runs off; a projectile into a wall (the target behind it is not hit).
5. Drain: a lethal hit heals from the HP actually taken; a user knocked out before its move lands gets no heal.
6. Switching the lead; both trainers attacking at the same moment.
7. A dropped connection: B sees it, A fights on, B rejoins and shows what happened while away.
8. A one-on-one trainer battle to elimination: B picks each next Pokémon on its own screen, the match ends on the server, A sees the win and B the loss.

## Results

Final run, 29 October 2026, this branch: two runs of each profile, **36 of 36 checks passed in all
six runs** (table: `docs/online-combat-results.md`). The trainers started in different corners of
the map each run (north, south, east and west), so the fights were staged on different ground. Every
screen agreed with the server at the first or second look: within 0.99 to 1.10 s of the action at
worst, of which 0.8 s is the check's fixed wait before it first looks (median 0.96 s; jitter was no
slower than plain).

Two checks were added along the way and pass: knockback on open ground must actually move the
target, and the dropped-connection check now also requires B to show the server's HP after it
rejoins (a move fired just before B came back can land after the "while away" reading).

Not covered: more than two players at once, mounted or Pokémon-mode (steered) fights, and real
network paths (the delays are added on the server; the browsers are on the same machine).

Harness problems met and fixed on the way (none of them game bugs): staging a fight too far from A
put the target off A's screen; wild Pokémon near some spawns knocked A down before the first
scenario; a fleeing target could walk the trainers into battle range; a "thin wall" picked over
water (shots fly over water by design).

## Bugs found and fixed

- **A Pokémon could stay drawn tiles away from where the server had it** (`src/net/mirror.ts`).
  Positions glide between updates. A jump (snap) left an older glide running, which carried the
  Pokémon back toward its old spot; and an update arriving mid-glide that changed only x kept y at
  the glide's halfway point. The server sends only what changed, so the wrong y stayed until the
  Pokémon moved again. Seen under jitter (B's screen showed its own Pokémon 7 tiles north for the
  rest of the scenario). Regression test: `server/mirrorGlide.test.ts` (fails without the fix).
- **A dead connection took about 21 s to notice** (`src/net/connection.ts`): 9 s of silence, then
  Chromium waited for a closing handshake that never came. The line is now given up as soon as the
  silence is noticed.
- **A tab taken over by another took about 5 s to close through Fly** (`server/main.ts`): the
  server waited out the closing handshake. Connections the server ends are now cut 250 ms after the
  close frame. This was the smoke test's "first tab closed" failure: the first tab was closed with
  the right code, but after the check had stopped waiting. The check now waits for the close event
  and also requires it within 2 s.
- In the harness only: separate timers for delayed messages could reorder them, which made a
  rejoin's state arrive before its start message. Fixed with one ordered queue per connection.
