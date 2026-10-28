# Online play

Everything online runs as one program we own: `server/`. It serves the game's pages and art, runs
every match, the matchmaking lobby and the global chat, and keeps accounts and saves in a SQLite
file. There is no third-party backend; the only outside services are the machine it runs on (Fly.io),
the domain, and (optionally) Google for "Sign in with Google".

## How it works

- **The server runs the match.** It runs the same simulation as the offline game (`src/sim`), 60
  steps a second. A browser sends only its movement keys, its cursor and commands ("cast move 1",
  "throw the ball in slot 2 here", "buy line 3"). Every command goes through the same `Match`
  method the offline game calls, so cooldowns, money, bag contents and party rules are checked on
  the server; `server/commands.ts` adds the checks the offline screen used to do (standing at the
  shop, the ball within throwing range, the styler loop within reach). Starter rolls come from a
  seed the server picks, and it only accepts one of the three Pokémon it offered.
- **Browsers mirror what they can see.** 20 times a second each player is sent the changes to the
  part of the island around them (`server/view.ts`, `src/net/sync.ts`), about 15-20 KB/s. The
  browser keeps a mirror of the match (`src/net/mirror.ts`) and draws it with the ordinary match
  screen. Other players' bags and money are never sent.
- **Saves live on the server** for signed-in players: the PC box (Pokémon kept after a win or with an
  Extraction Voucher), the storage chest, the trainer look and stats. Guests can play but nothing
  is kept.
- **Seats** (`src/sim/seat.ts`): a match holds up to eight humans; computer trainers fill the rest.
- **Instant movement**: the browser walks your trainer (or the Pokémon you steer) the moment you
  press a key and numbers each step's keys; the server applies every one of them, in order, one per
  step, and says which it used last, and the browser replays the rest on top of the server's
  position (client-side prediction). A late frame makes the server wait a step rather than guess,
  so its path is always the one the browser predicted. Measured at 300 ms round trip, corrections
  stay under a thousandth of a tile.
- **Fair hits on a slow connection**: a cast names the opponent under your reticle as your screen
  shows it; the server aims at where that opponent really is, if it is close enough to your aim.
- **Compression**: updates are compressed (about 2 KB/s per player on the wire).

## Playing together

| | |
|---|---|
| **Public matches** | Anyone, alone or in a party. Eight trainers; a lobby needs four real players before computer trainers fill the other seats, and neither the wait running out nor "Start now with bots" starts it with fewer (the lobby says how many more are needed). `MIN_PLAYERS` can lower that for testing, never on the live server. Ranked play has been retired: there is no ranked queue, board or standing any more (old ratings stay in the database, untouched). |
| **Parties** | Friends, up to four. The leader starts the match; everyone picks a starter; the party plays as a squad (teammates never fight; the last squad standing wins, knocked-out members included). |
| **Private lobbies** | A host makes one and shares the five-letter code. Rules: trainers (2-8), computer trainers on/off, starter level, teams (solo, pairs, fours, pick), storm speed, the rare-item chest. Nothing from a private match is kept (no stats, no Pokémon, no Extraction Voucher reaches a PC, no storage-chest change is saved), so they can not be farmed. Their replays are for their own players only. After the match everyone is back in the lobby. |
| **Friends** | Requests by trainer name (asking back accepts). Friends show what they are doing. |
| **Watching** | A friend's match, the featured match (most players), or the rest of your own after being knocked out (your squad first). Spectators are 4 seconds behind, so watching can not help a player. ←/→ switch whom the camera follows. |
| **Replays** | Every match is recorded (`server/replays.ts`): what any trainer could see, nobody's bag, keyframed every 30 s for seeking, about 2 KB/s. Space pause, ←/→ 10 s, ↑/↓ speed, Q/E switch trainer. The oldest go once they pass `REPLAY_MB` (400). |

## Progress (`src/net/progression.ts`)

- **Trainer XP and levels**: every public match a signed-in player finishes earns XP for
  playing, for each trainer outlasted, for winning, knockouts, catches, damage and time survived.
  The end screen lists it line by line.
- **Looks**: the first Ranger is free; the other Rangers unlock with levels (2 to 25), and the
  townsfolk are locked for now. The server checks every look (`/api/look`), and guests wear the
  free look only.
- **Achievements**: 21, from one match (10 knockouts, a shiny in your party at the end...) or totals
  (100 catches, level 25...); the four ranked ones left with ranked play. Several give a **title**, worn on your profile and shown
  under your name in battles.
- **Profiles**: in the game (click a name) and as a page to share: `/u/<name>` (level, title,
  stats, achievements, recent matches with links to their replays). `?replay=<match>` and
  `?profile=<name>` links open the game straight there.
- **Recovery codes**: no email is kept, so signing up shows eight one-time recovery codes; "Forgot
  your password?" takes your name, a code and a new password (and signs out every old session).
  New codes and a password change are on your own profile.

## Running it locally

```
npm install
npm run server        # the game server on :8787 (dev settings: 15 s lobby wait, rare-item chest on)
npx vite --port 5173  # the game; Vite passes /api and /ws through to the server
```

Open http://localhost:5173 and press **Play Online** (or O). Open a second browser window (or a
private one) to be a second player. Useful settings (environment variables):

| Setting | What it does |
|---|---|
| `LOBBY_WAIT=10` | Seconds a lobby waits for players before filling with computer trainers |
| `MATCH_SIZE=2` | Trainers per match (2 makes a quick 1v1) |
| `DEV_CLUSTER=1` | Players start side by side (testing PvP; ignored on the live server) |
| `RARE_CHEST=1` | The rare-item chest (default: on except on the live server) |
| `MIN_PLAYERS=4` | Real players a public lobby needs before computer trainers fill in (default half the lobby; never lower on live) |
| `MAX_PER_IP=12` | Game connections one address may hold at once (default 12 live, 64 elsewhere) |
| `REPLAYS=0`, `REPLAY_MB=400` | Turn recording off; how much disk replays may use |
| `SIM_LATENCY_MS=100` | Testing: pretend every message takes this long each way (never on live) |
| `ROOM_WORKERS=4` | At most this many match worker threads (default: from memory; 0: matches in the main thread) |
| `DATA_DIR=...` | Where the database file goes (default `.data/`) |

`npx tsx server/bots.ts 3 60` connects three fake players to a running server and plays for a
minute (a quick load and protocol check, with bandwidth). `npx tsx server/headless.ts 120 3` runs a
whole match without any network, to measure the simulation's speed.

Checks (each exits non-zero on a failure):

```
npx tsx server/checks/social.ts      # against a running server (MATCH_SIZE=4 LOBBY_WAIT=4): accounts,
                                     # friends, party squads, watching, private lobbies, replays
npx tsx server/checks/queue.ts       # against a running server with MATCH_SIZE=8: the four-player minimum
npx tsx server/checks/gameplay.ts    # Eggs, the forest stranger, private rules, chests, stronger encounters
npx tsx server/checks/online_events.ts  # the same through a Room and the browser's decoder
npx tsx server/checks/teams.ts       # squads in the simulation
npx tsx server/checks/lagcomp.ts     # lag-compensated casts
```

## Two servers: live and demo

| | Live (`fly.toml`) | Demo (`fly.demo.toml`) |
|---|---|---|
| Who | Players | You, testing new changes |
| Gets new code | When you choose (Actions -> Game server -> Run workflow -> live) | Every push to `main`, automatically |
| Database | Its own | Its own (separate accounts and saves) |
| Lobby wait | 60 s | 20 s |
| Rare-item chest | Off | On |
| When idle | Always on | Sleeps; the first visit wakes it in a few seconds |

## One-time setup

1. **Fly.io account**: sign up at fly.io (a card is needed even for small use) and install `flyctl`.
2. **Create the two apps and their disks** (names must be unique on Fly; change them in the two
   `.toml` files if these are taken):
   ```
   fly apps create almia-showdown
   fly apps create almia-showdown-demo
   fly volumes create almia_data --app almia-showdown --region iad --size 1
   fly volumes create almia_demo_data --app almia-showdown-demo --region iad --size 1
   ```
3. **Let GitHub deploy**: `fly tokens create org -x 999999h`, then in the GitHub repository:
   Settings -> Secrets and variables -> Actions -> New secret `FLY_API_TOKEN` with that token.
   From then on every push to `main` updates the demo server; promote to live from the Actions tab.
   For gentle live deploys (no match cut short), make up a long random OPS_TOKEN and set it in both
   places: `fly secrets set OPS_TOKEN=... --app almia-showdown`, and the GitHub secret `OPS_TOKEN`.
   If the live server's address is not almia-showdown.fly.dev, set the repository *variable*
   `LIVE_URL` to it.
4. **Backups off the machine** (recommended): `fly storage create --app almia-showdown` (and again
   for the demo app). That makes a Tigris bucket and sets its variables on the app; backups start
   uploading on their own.
5. **Alerts** (recommended): make a Discord (or Slack) incoming webhook for a channel only you read,
   then `fly secrets set ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/... --app almia-showdown`.
6. **First deploy by hand** (optional, the workflow does the same):
   `fly deploy --config fly.demo.toml` and `fly deploy --config fly.toml`.
7. **The domain**: buy it (Cloudflare Registrar or Porkbun), then
   ```
   fly certs add example.gg --app almia-showdown
   fly certs add demo.example.gg --app almia-showdown-demo
   ```
   and add the DNS records `fly certs show` prints at the registrar. Set `PUBLIC_URL` in each
   `.toml` to its address.
8. **Sign in with Google** (optional): Google Cloud Console -> APIs & Services -> Credentials ->
   Create OAuth client ID (Web application). Authorized redirect URI:
   `https://example.gg/api/auth/google/callback` (and the demo's). Then
   ```
   fly secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... --app almia-showdown
   ```
   The button appears in the sign-in box once both are set. Only Google's account number and first
   name are used; no email is stored.

## Running it

- **Health**: https://example.gg/health shows matches running, players connected and queued.
- **Logs**: `fly logs --app almia-showdown` (each match start and result is logged).
- **Moderation**: the dashboard at https://example.gg/mod (sign in to the game with a moderator
  account first). Make the first administrator on the server:
  ```
  fly ssh console --app almia-showdown -C "node dist-server/admin.js admin YourName"
  ```
  The dashboard has: open reports (players' and the server's own); a page per player (stats,
  reports, anti-cheat flags, chat, devices and other accounts seen on them, history, and the
  **collection log**: every change to their PC and storage chest, with a snapshot of each Pokémon,
  from matches, trades, Wonder Trades, renames and account deletions, kept for good in the
  `collection_log` table for "my Pokémon is missing" reports) with mute,
  kick, ban (optionally with every device it used, and its recent addresses for a week), unban,
  and for admins roles and deleting an account; the chat log (remove a message from every open
  chat); flagged players; live matches (watch any); announcements; and the log of everything the
  moderators and the server did. `admin.js` still works from the console (`reports`, `player`,
  `mute`, `ban`, `unban`, `delete`, `chat`, `resolve`, `mod`, `admin`, `player-role`).
- **Anti-cheat**: the server runs every match, so a modified browser can not move faster, hit
  harder or spawn items. What it can do is send things an honest browser never sends (keys
  pressed harder than a key can be, a ball thrown across the island, someone else's Pokémon, a
  shop used from afar); those are refused and **flagged**. Enough flags in one match files a
  report automatically. Honest play (lag included) does not trip them.
- **Chat strikes**: a filtered word, flooding, or saying the same thing again is a strike; three
  in ten minutes mutes for 10 minutes, then an hour, then a day (and the second time in a week
  reports the player). SHOUTING is quietly lower-cased.
- **Backups** (`server/backup.ts`): every 15 minutes the database is copied without pausing
  matches, gzipped, and kept on the volume (the last 8 and one a day for a week) and, with S3
  storage set up, uploaded: `live/latest.db.gz`, `live/hourly/<HH>.db.gz` (24 hours) and
  `live/daily/<date>.db.gz` (add a lifecycle rule to the bucket to expire old dailies). A last one
  is made on every shutdown. Fly also snapshots the volume daily. To restore:
  ```
  fly ssh console --app almia-showdown -C "node dist-server/admin.js backups"   # what is on the volume
  fly machine stop --app almia-showdown
  fly machine start --app almia-showdown  # then, quickly, before anyone plays:
  fly ssh console --app almia-showdown -C "node dist-server/admin.js restore s3:hourly/07.db.gz"
  fly machine restart --app almia-showdown
  ```
  (`restore <file>` takes a file in /data/backups too; the replaced database is kept beside it.)
- **Deploys without cutting matches short**: the live deploy (Actions) first stops new matches
  (players in the hub are told an update is coming), waits up to 20 minutes for the ones running,
  then deploys. Whatever is still running when Fly stops the machine gets 4 more minutes, then is
  called off with nothing counted (no loss, no rating change). The demo server just deploys.
- **Watching it run**: the dashboard's Server tab (players, matches, simulation time per step,
  bandwidth, memory over the last hour; backups; errors from the server and from players'
  browsers, grouped). The same numbers go to Fly's Grafana (Prometheus, fly.toml `[metrics]`).
  Alerts (ALERT_WEBHOOK_URL) on: each deploy, a new kind of error, a match crashing (it is called
  off on its own; the others go on), the server falling behind for half a minute (time to `fly
  scale vm`), backups failing twice.
- **Events** (dashboard -> Events): Double XP, a shiny boost, a faster (or slower) storm, or a
  timed announcement. Everyone online sees them in the hub and hears when they start and end.
- **Checks**: every push runs `.github/workflows/ci.yml` (types, unit tests, both builds, then a
  real server from the build with every end-to-end check and bots). The same on your machine:
  `bash scripts/check-server.sh`. Deploys only happen after the checks pass.

## Capacity and cost

Each match runs in its own worker thread (`server/remoteRoom.ts`, `server/roomWorker.ts`), with one
loaded and waiting so a new match starts at once. Building a match's island takes a few hundred
milliseconds; in a thread of its own that never stalls anyone else (measured: the worst gap between
a playing match's updates while six others started went from about a second to 73 ms), the server
uses every CPU core, and a match that fails takes nobody else with it. A worker costs about 60 MB,
so the number of workers follows the machine's memory (`ROOM_WORKERS` overrides it; 0 runs matches
in the main thread). Past that, matches share the least busy worker.

A match costs about 1.5 ms of CPU per simulation step (60 a second), about 9% of a CPU core, and
each player about 2 KB/s on the wire. The live config (`shared-cpu-2x`, 1 GB, about $10-12 a month)
runs about six matches; `fly scale vm shared-cpu-4x --vm-memory 2048` (about $25 a month) runs
around fifteen, and `performance-4x` more. The Server tab and the alerts say when it is time. The
demo server sleeps when unused and costs little. Everything runs on one machine (the lobby is in
memory, and SQLite has one writer), so scale up, not out.

## Safety notes

- Passwords are stored as salted scrypt hashes; sessions are random tokens in HttpOnly, Secure,
  SameSite cookies, and the database keeps only their SHA-256. Sign-in and sign-up are
  rate-limited; POST requests need a header other sites can not send.
- Chat: signed-in players only, 200 characters, 5 messages per 10 s, a word filter
  (`server/moderation.ts`), mute (hides a player for you) and report (to the moderators).
- Players may be young: accounts ask for a trainer name only (the sign-up box says not to use a
  real name) and no email is kept. The privacy page is at /privacy (linked from sign-up): what is
  kept, who sees it, and how to have an account deleted. Set `PRIVACY_CONTACT` (an email address or
  a link) to where deletion requests should go; without it, the page says to ask in the chat.
- This is a fan game: keep it free, with no ads or payments.
