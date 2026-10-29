# Change report: 29 October 2026 (overnight)

Order of work, as briefed: the admin dashboard, online combat reliability, then the dialogue
export. The castle, landscaping and tileset were not touched.

## 1. Admin dashboard

At **/admin** on the game server (`https://almia-showdown.fly.dev/admin`), and from an **Admin**
button on the online hub that only an admin account sees. Read-only: there is no editing, granting,
currency change, ban or delete anywhere in it.

- **Online:** players connected, signed in and guests, computer trainers in matches (counted
  separately, never as players), and where everyone is: online menu; lobby, queue or party;
  playing; spectating; disconnected with the seat held. One row per player, guests labelled. The
  page explains how players are counted (one account however many tabs, since a new tab takes over;
  one guest per browser). Refreshes every 10 s while the tab is open and visible, nothing while hidden.
  A closed tab leaves the list at once; a dead network within about 30 s (the server's 15 s heartbeat).
- **Live matches:** each running match: mode, time played, spectators, every trainer (human, guest or computer, and whether a human is still connected). Same 10 s refresh.
- **Match history:** date, mode, duration, winner, trainers (humans and computer trainers apart),
  with filters (mode, trainer name, include called-off matches) and pages of 25. A match opens to every trainer's place and
  stats.
- **Accounts:** search by username; an account shows id, created, last seen, role, sign-in kind,
  standing, progression (XP, achievements, career stats), currencies (none are saved: Poké Dollars
  start fresh every match, said so), the storage chest, and the PC, loaded when the account is
  opened. The page says the PC is the saved account data and a match party is never shown. The
  account's matches link to their history entries.
- **Never shown:** password hashes, session tokens, recovery codes or any other secret (the API
  selects named columns only; a check fails if any secret-looking field appears).
- **Access:** every `/api/admin/*` endpoint checks, on the server, that the session's account has
  `role = 'admin'` and is not banned. The display name plays no part. Anything else gets 403; any
  method but GET gets 405. The page itself holds no data.
- **Storage:** two new tables, `match_log` and `match_log_players`, and a `last_seen` column on
  accounts, added by the existing migration step (nothing existing is rewritten). The date
  tracking began is stored and shown on the history page.

Checked by `server/checks/admin_dashboard.ts` (in CI and `scripts/check-server.sh`): refused for no
session, a forged cookie, a guest, a player, a moderator and a lookalike of the admin's name; two
tabs of one account count once; two guests count twice; a disconnect leaves the list; lobby state;
search with underscores; an account with its PC; a finished two-player match appears in history,
on both accounts and under the filters. Looked at in a browser too.

**Only from this release on:** full match records (duration, winner, every trainer with computer
trainers marked, places and stats, called-off matches) and accounts' last-seen times. Earlier
matches exist only for signed-in players (their place, outcome and stats) and open from an
account's page; the history page shows how many there are and when full tracking began. Before
this release, last seen falls back to the device log where there is one.

## 2. Online combat

`tools/online-combat/` drives two real browsers against a local server and compares each screen
with the server. See `docs/online-combat.md` for the method, the network profiles and the results.

Bugs found and fixed:

- **Pokémon drawn in the wrong place** (`src/net/mirror.ts`): a snap left an older glide running,
  and an update mid-glide that changed only one coordinate froze the other halfway. The Pokémon
  stayed drawn up to several tiles off until it moved again. Regression test
  `server/mirrorGlide.test.ts`.
- **A dead connection took about 21 s to notice** (`src/net/connection.ts`); now about 9 s.
- **The smoke test's "first tab closed" failure:** the first tab was closed with the right code,
  but the close reaches the browser about 5 s later through Fly's proxy (measured live: 5086 ms,
  even with the server cutting the socket 250 ms after its close frame), longer than the check
  waited. The server now also sends a `bye` message with the close code just before closing, and
  the browser stands down on that at once (a taken-over tab, a kick or a ban). The check waits up
  to 10 s for the close itself and requires the `bye` within 2 s.

## 3. Dialogue export

`docs/dialogue/dialogue-export.md` (source), `dialogue-export.pdf` (readable), `.json` (the same
data) and `dropped.json` (strings judged not to be player-facing, for spot checks). Regenerate with
`bash tools/dialogue/make.sh`. 1338 distinct lines, grouped by where the player meets them, each
with a stable id, exact wording, speaker or place, condition, sources and status; placeholders are
explained with examples. A review section at the end lists contradictions and inconsistencies;
no wording was changed.
