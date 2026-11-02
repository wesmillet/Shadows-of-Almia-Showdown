# Running the live server

The live game is the Fly app `almia-showdown` (https://almia-showdown.fly.dev): one machine,
performance-1x with 2 GB, region iad, with the 1 GB volume `almia_data` (database, backups,
replays). The offline demo is GitHub Pages, built from `main` on every push.

## Deploy

1. Push the change to `online` (and the offline version to `main`); wait for **Checks** on `online`.
2. Look at https://almia-showdown.fly.dev/health: deploy when `rooms` is 0 (a deploy restarts the
   server; matches still running get 4 minutes, then are called off with nothing counted).
3. GitHub → Actions → **Launch online server** → Run workflow, app `almia-showdown`, region `iad`,
   size **launch** (the default; `friends` would shrink the machine to shared CPU and 1 GB).
   It builds `online`, and the build label it gives the server is `online`'s commit.
4. Actions → **Smoke test online server**: health, admin pages refused without the role, a match
   with computer trainers, a dropped connection, a second tab. The result is posted as an issue.
5. Optional, for bigger releases: Actions → **Live session check**, mode `prepare` before the deploy
   and `play` after it (a test account's PC across the restart, then five browsers play a match).

If Fly answers 401 Unauthorized in the launch issue, the deploy key in the repository secret
`FLY_API_TOKEN` is no longer valid: make a new deploy token at fly.io/apps/almia-showdown/tokens and
update that secret (Settings → Secrets and variables → Actions → Repository secrets).

## Roll back

From a computer with `flyctl` signed in:

```
fly releases --app almia-showdown --image          # the images of earlier releases
fly deploy --app almia-showdown --config fly.toml --image registry.fly.io/almia-showdown:<tag> \
  --vm-size performance-1x --vm-memory 2048
```

Or move `online` back to the earlier commit (git revert) and run **Launch online server** again.
If the bad release changed the database, restore a backup from before it too (below).

## Backups and restore

- Every 15 minutes the database is copied (without pausing matches) to `/data/backups` on the
  volume: the last 8 plus one a day for a week. One more on every shutdown.
- Off the machine only if S3-compatible storage is set up (`fly storage create`, which sets
  `AWS_ENDPOINT_URL_S3`, `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Whether it
  is: the Server tab of /mod shows the backups and whether S3 is on, and the server's first log
  line says "Backups: every 15 min on the volume (no S3 storage set up)" or names the bucket.
  Without S3, a lost volume loses the backups with it (Fly also snapshots volumes daily).
- Restore:
  ```
  fly ssh console --app almia-showdown -C "node dist-server/admin.js backups"     # what there is
  # Drain first (/mod, Server tab), wait for rooms 0 on /health, then:
  fly ssh console --app almia-showdown -C "node dist-server/admin.js restore <file | s3:hourly/07.db.gz> --drained"
  fly machine restart --app almia-showdown                                          # straight away
  ```
  The replaced database is kept beside it as `almia.db.before-restore-<time>`. Afterwards check
  /health and an account (`admin.js player <name>`).

## Watching it

- **/health**: rooms, players, queued, lobbies, draining.
- **/admin** (admin accounts only): who is online and where, live matches, match history, accounts.
- **/mod**, Server tab: players and matches over time, simulation time per step, workers, errors
  (server and browser), backups.
- **Logs** (`fly logs --app almia-showdown`): a line when each match starts and ends; `ALERT`
  lines for trouble (also sent to `ALERT_WEBHOOK_URL` if set). A crashed match tells its players it
  was called off and does not count; they go back to the hub.

## Capacity

Measured locally, one running 10-trainer match costs about 40% of a core and 115 MB. The machine
has one dedicated core, so plan on **2 to 3 matches at once: about 20 to 30 players in matches**.
There is no cap: past that, every match slows down together (the `ALERT` about falling behind,
and `step_ms` on the Server tab). If that happens often, scale up the one machine
(`fly scale vm performance-2x --app almia-showdown`), which costs more.

Limits that do exist: 12 connections from one IP address, and a connection that sends more than
120 messages a second is closed.

## Lobby rule

A public match needs 5 real players before computer trainers fill the other seats (and the
server enforces at least 5 on live). Until then the lobby shows "Waiting for N more players
(5 needed before bots fill in)" and waits. Admin accounts can start at once with computer
trainers. Anyone can host a private lobby and start it with bots, but nothing from a private
match is saved.
