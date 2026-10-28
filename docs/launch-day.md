# Launch day notes (online release)

What to do, in order, the day the online build goes live. Written the night of the big polish
pass; the code side of the launch review is done and verified by
`server/checks/launch_check.ts`.

## 1. Size the machine before anyone queues

`fly.toml` is set to `shared-cpu-2x` with 1 GB. Shared CPUs get a small baseline (about 1/16 of
a core each) plus a burst allowance; once the burst runs out the whole server is throttled and
every match turns to slow motion at once. One match costs roughly 9% of a core before
compression. For a real launch:

```sh
fly scale vm performance-1x --memory 2048    # or performance-2x if Reddit goes well
```

Memory matters too: each match worker is about 110 MB, and the worker count follows machine
memory, so 1 GB caps how many matches can run cleanly.

## 2. Deploy from the online branch, by hand

The deploy workflow (`.github/workflows/server.yml`) fires on pushes to `main`, and `main` has
no server code, so it never fires on its own. Deploy either way:

- `fly deploy --config fly.toml` from a checkout of `online`, or
- GitHub → Actions → the server workflow → Run workflow → branch `online`, target `live`.

Set `OPS_TOKEN` as a Fly secret first (`fly secrets set OPS_TOKEN=...`): it is what lets a
deploy drain politely, letting running matches finish instead of killing them.

Keep it at ONE machine (`fly scale count 1`): the hub lives in memory and SQLite has a single
writer. Two machines means two separate games.

## 3. Smoke-test the live server

```sh
npx tsx server/checks/launch_check.ts https://<the-server-host>
```

It checks the launch-critical paths end to end: solo queue filling with bots, Start now, a
dropped connection rejoining with the room still alive, and a second tab taking the session
over cleanly.

## 4. Watch the right numbers

- The server alerts itself when steps fall behind for 30 s ("Time for a bigger machine").
- GoatCounter (wesmillet.goatcounter.com): page views, plus `match-started`, `match-finished`
  and `match-won` events. Visits without `match-started` mean the page loads but people bounce
  before rolling a starter.

## What was fixed for launch (already in)

- A solo player's match survives reloads and wifi blips (45 s reconnect window, room stays
  open, the match resumes where it was).
- Two tabs no longer kick each other in a loop; the newest tab wins and resumes the match.
- The match screen says "Connection lost... reconnecting" and recovers, or returns to the hub
  with a reason; nothing hangs forever (queue, lobby, joining a match all time out or answer).
- Dead connections are detected on both sides (server pings + buffered-bytes cap; client
  reconnects after 9 s of silence).
- "Start now with bots" in casual lobbies, so the first players of the day never stare at a
  full 60 s countdown alone.
- A player who drops mid-duel keeps fighting (their lead picks its own moves) until the
  reconnect window runs out.

## Known limits (fine for v1, worth knowing)

- Everyone's position goes to every client for the minimap radar; a traffic-reader can see the
  whole map. Client-authoritative nothing: the server checks commands, so this is scouting,
  not cheating.
- "Watch the rest" is unavailable when the last human goes out (the room closes with them).
- Starter rerolls outside a match are unlimited.
