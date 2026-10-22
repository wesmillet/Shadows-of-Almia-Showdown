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
  press a key and numbers each step's keys; the server applies them one per step and says which it
  used last, and the browser replays the rest on top of the server's position (client-side
  prediction). Measured at 300 ms round trip, corrections stay under a hundredth of a tile.
- **Fair hits on a slow connection**: a cast names the opponent under your reticle as your screen
  shows it; the server aims at where that opponent really is, if it is close enough to your aim.
- **Compression**: updates are compressed (about 2 KB/s per player on the wire).

## Playing together

| | |
|---|---|
| **Casual** | Anyone, alone or in a party. |
| **Ranked** | Signed-in players, solo. Glicko-2 rating extended to free-for-all placements (`server/rating.ts`); five placement games, then a tier (Bronze to Master). Seasons last `SEASON_DAYS` (60) from `SEASON_START`; each starts everyone halfway back to 1500. Computer trainers count as weaker opponents and stop helping past 1750, so the top tiers take real players. Lobbies match by rating, the window widening while they wait. |
| **Parties** | Friends, up to four. The leader starts the match; everyone picks a starter; the party plays as a squad (teammates never fight; the last squad standing wins, knocked-out members included). |
| **Private lobbies** | A host makes one and shares the five-letter code. Rules: trainers (2-8), computer trainers on/off, starter level, teams (solo, pairs, fours, pick), storm speed, the rare-item chest. Nothing from a private match is kept (no stats, no Pokémon), so they can not be farmed. After the match everyone is back in the lobby. |
| **Friends** | Requests by trainer name (asking back accepts). Friends show what they are doing. |
| **Watching** | A friend's match, the featured match (most players), or the rest of your own after being knocked out (your squad first). Spectators are 4 seconds behind, so watching can not help a player. ←/→ switch whom the camera follows. |
| **Replays** | Every match is recorded (`server/replays.ts`): what any trainer could see, nobody's bag, keyframed every 30 s for seeking, about 2 KB/s. Space pause, ←/→ 10 s, ↑/↓ speed, Q/E switch trainer. The oldest go once they pass `REPLAY_MB` (400). |

## Progress (`src/net/progression.ts`)

- **Trainer XP and levels**: every casual or ranked match a signed-in player finishes earns XP for
  playing, for each trainer outlasted, for winning, knockouts, catches, damage and time survived
  (ranked +25%). The end screen lists it line by line.
- **Looks**: the townsfolk and the first Ranger are free; the other Rangers unlock with levels (2 to
  25), and the two named trainers with achievements (Wren: win a match; Kit: reach Gold). The
  server checks every look (`/api/look`), and guests wear free looks only.
- **Achievements**: 25, from one match (10 knockouts, a shiny in your party at the end...) or totals
  (100 catches, level 25, Master tier...). Several give a **title**, worn on your profile and shown
  under your name in battles.
- **Profiles**: in the game (click a name) and as a page to share: `/u/<name>` (level, title, rank,
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
| `RANKED_WAIT=120` | Seconds a ranked lobby waits for players (default 120 live, twice `LOBBY_WAIT` elsewhere) |
| `SEASON_START`, `SEASON_DAYS` | When ranked season 1 starts (ISO date) and how long seasons last |
| `REPLAYS=0`, `REPLAY_MB=400` | Turn recording off; how much disk replays may use |
| `SIM_LATENCY_MS=100` | Testing: pretend every message takes this long each way (never on live) |
| `DATA_DIR=...` | Where the database file goes (default `.data/`) |

`npx tsx server/bots.ts 3 60` connects three fake players to a running server and plays for a
minute (a quick load and protocol check, with bandwidth). `npx tsx server/headless.ts 120 3` runs a
whole match without any network, to measure the simulation's speed.

Checks (each exits non-zero on a failure):

```
npx tsx server/checks/social.ts      # against a running server (MATCH_SIZE=4 LOBBY_WAIT=4): accounts,
                                     # friends, party squads, watching, ranked, private lobbies, replays
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
4. **First deploy by hand** (optional, the workflow does the same):
   `fly deploy --config fly.demo.toml` and `fly deploy --config fly.toml`.
5. **The domain**: buy it (Cloudflare Registrar or Porkbun), then
   ```
   fly certs add example.gg --app almia-showdown
   fly certs add demo.example.gg --app almia-showdown-demo
   ```
   and add the DNS records `fly certs show` prints at the registrar. Set `PUBLIC_URL` in each
   `.toml` to its address.
6. **Sign in with Google** (optional): Google Cloud Console -> APIs & Services -> Credentials ->
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
- **Moderation** (on the server):
  ```
  fly ssh console --app almia-showdown -C "node dist-server/admin.js reports"
  fly ssh console --app almia-showdown -C "node dist-server/admin.js mute SomeName 60"
  fly ssh console --app almia-showdown -C "node dist-server/admin.js ban SomeName"
  ```
  Also `player`, `unban`, `delete` (removes an account and everything kept for it, for a player's
  request), `chat 50`, `resolve <report id>`, `mod <name>`.
- **Backups**: Fly snapshots each volume daily (kept 5 days). `fly volumes snapshots list`.

## Capacity and cost

A match costs about 1.5 ms of CPU per simulation step (60 a second), about 9% of a CPU core, and
each player about 15-20 KB/s. The live config (`shared-cpu-2x`, 1 GB, about $10-12 a month) runs a
couple of matches comfortably; for more, `fly scale vm performance-1x` (about $30 a month) runs
around eight at once. The demo server sleeps when unused and costs little. Everything runs on one
machine (the lobby and matches are in memory, and SQLite has one writer), so scale up, not out.

## Safety notes

- Passwords are stored as salted scrypt hashes; sessions are random tokens in HttpOnly, Secure,
  SameSite cookies, and the database keeps only their SHA-256. Sign-in and sign-up are
  rate-limited; POST requests need a header other sites can not send.
- Chat: signed-in players only, 200 characters, 5 messages per 10 s, a word filter
  (`server/moderation.ts`), mute (hides a player for you) and report (to the moderators).
- Players may be young: accounts ask for a trainer name only (the sign-up box says not to use a
  real name) and no email is kept. Before launch, publish a short privacy policy saying what is
  kept (name, password hash, game saves, chat) and how to ask for deletion (`admin.js delete`).
- This is a fan game: keep it free, with no ads or payments.
