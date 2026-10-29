# Shadows of Almia Showdown: every player-facing line

Exported 2026-10-29 from the `online` branch for wording review. Nothing was reworded by this export.

## How to read this

- Each entry: its **id** (stable: derived from the text itself, so it stays the same while the wording does), the **exact wording**, **who says it or where it appears**, the **condition** that shows it (the nearest `if`, `case` or `? :` in the code, as written), and every **source** (file:line).
- Text in `{braces}` is filled in by the game: the expression is shown, with a representative example under it.
- Status: **active** (players see it), **unused** (behind a switch that is off, e.g. trainer levels), **legacy** (kept for old saves or retired features), **testing only** (dev builds or test switches), **admin only**.
- Identical text used in several places is listed once, with all its uses.
- Contradictions, stale references and confusing wording are collected in the **Review** section at the end. Nothing was changed.

## Coverage

Found by reading the code and data, not only by looking at screens:

1. **Code** (src/ and server/, 120 TypeScript files, tests excluded): every string and template literal, through the TypeScript compiler, kept when it reads as text a person sees and dropped when it is clearly an identifier, path, CSS, SQL, an event or animation name, a comparison or a log line. 121 text-like strings were dropped as log lines, comparisons or lookups (listed in `dropped.json` beside this file, for spot checks).
2. **Data**: item names, short labels and descriptions; move names; shop, stall and challenger text; character names; fishing rods; special events.
3. **The two dashboards** (/mod and the new /admin): the text in their HTML and the text their scripts write.

Not captured: Pokémon species names (data/species.json, the official names, 361 entries); the map's place names drawn into the island art; text inside images (the logo, the title art); browser-native messages (e.g. a failed connection page); and text the server builds from other text in ways the extractor can not see whole (each piece is listed, the sentence they make may not be). Strings assembled across several statements show as their separate parts.

**1336 distinct lines** (1167 active).

## 1. Title screen, options and offline setup

70 lines.

**T33CE41** · UI · *active*

> Loading…

- `src/main.ts:84` · status = · when `in boot()`

**TEF675B** · Screen text · *active*

> SHADOWS OF ALMIA SHOWDOWN

- `src/main.ts:90` · text · when `in boot()`

**TE3E55A** · UI · *active*

> url({import.meta.env.BASE_URL}assets/fonts/BoldPixels.ttf)

Placeholders: `import.meta.env.BASE_URL`  
Example: "url(…assets/fonts/BoldPixels.ttf)"

- `src/main.ts:96` · FontFace · when `in boot()`

**TB60079** · UI · *active*

> Loading sprites {done}/{total}

Placeholders: `done`, `total`  
Example: "Loading sprites …/3"

- `src/main.ts:113` · sprites.preload · when `in boot()`

**T0FF0C7** · UI · *active*

> Painting terrain {Math.round(p * 100)}%

Placeholders: `Math.round(p * 100)`  
Example: "Painting terrain …%"

- `src/main.ts:134` · createGround · when `in boot()`
- `src/main.ts:513` · createGround · when `if (regenerate)`

**T9707B4** · UI · *active*

> Heading out{progress}

Placeholders: `progress`  
Example: "Heading out…"

- `src/main.ts:173` · loadingScreen · when `in boot()`

**TE4115B** · UI · *active*

> Coming soon

- `src/main.ts:273` · return · when `if (req.soon \|\| !net)`

**TADA2E9** · UI · *active*

> Sign in

- `src/main.ts:276` · return · when `if (!me.signedIn)`
- `src/ui/onlineScreens.ts:295` · button · when `if (me.signedIn && me.user)`
- `src/ui/overlay.ts:268` · el · when `mode === 'signin' ?`
- `src/ui/overlay.ts:286` · el · when `mode === 'signin' ?`
- `src/ui/overlay.ts:297` · el · when `mode === 'signin' ?`

**TB1D982** · UI · *active*

> Level {req.level}

Placeholders: `req.level`  
Example: "Level 12"

- `src/main.ts:277` · return · when `req.level !== undefined ?`

**T514ECE** · UI · *active*

> Heading out

- `src/main.ts:367` · loadingScreen · when `in boot()`

**T8F7B16** · UI · *active*

> Could not join the match, sorry. Try again

- `src/main.ts:374` · showOnline · when `if (!ready)`

**T5D942F** · On-screen notice · *active*

> Connection lost... reconnecting

- `src/main.ts:402` · screen.say · when `if (st === 'down')`

**TAD3087** · UI · *active*

> This account started playing in another tab

- `src/main.ts:404` · bail · when `if (st === 'takenOver')`

**T87B233** · UI · *active*

> Your match ended while you were away

- `src/main.ts:411` · bail · when `if (playingId === start.matchId && mirror.staleFor() > 4)`

**T8AA3B9** · UI · *active*

> Joining the match ({h.delay} s behind)

Placeholders: `h.delay`  
Example: "Joining the match (… s behind)"

- `src/main.ts:439` · loadingScreen · when `in boot()`

**T35190A** · UI · *active*

> kept on the server

- `src/main.ts:495` · PcScreen · when `if (r.pc)`

**T35912D** · UI · *active*

> Painting a new island…

- `src/main.ts:510` · when `if (regenerate)`

**TB4F57C** · Screen text · *active*

> Move up

- `src/settings.ts:17` · label:

**T525DF5** · Screen text · *active*

> Move left

- `src/settings.ts:18` · label:

**T260FF8** · Screen text · *active*

> Move down

- `src/settings.ts:19` · label:

**T3A43E5** · Screen text · *active*

> Move right

- `src/settings.ts:20` · label:

**TAD1338** · Screen text · *active*

> Use move 1

- `src/settings.ts:21` · label:

**TC21572** · Screen text · *active*

> Use move 2

- `src/settings.ts:22` · label:

**T39ED96** · Screen text · *active*

> Talk / pick up / fish / dodge

- `src/settings.ts:23` · label:

**T0D8642** · Screen text · *active*

> Target nearest wild

- `src/settings.ts:24` · label:

**T2B0099** · Screen text · *active*

> Throw a ball

- `src/settings.ts:25` · label:

**T84B0A1** · Screen text · *active*

> Capture Styler (hold)

- `src/settings.ts:26` · label:

**TD8E2D6** · Screen text · *active*

> Ride / land

- `src/settings.ts:27` · label:

**TD20C9B** · Screen text · *active*

> Mega Evolve

- `src/settings.ts:28` · label:

**T36BC67** · Screen text · *active*

> Auto-battle on / off

- `src/settings.ts:29` · label:

**TD17FAE** · Screen text · *active*

> Held items & TMs

- `src/settings.ts:30` · label:

**TBE190D** · Screen text · *active*

> Music on / off

- `src/settings.ts:31` · label:

**TE936A6** · UI · *active*

> Num {code.slice(6)}

Placeholders: `code.slice(6)`  
Example: "Num K7Q2D"

- `src/settings.ts:84` · return · when `if (code.startsWith('Numpad'))`

**T494064** · UI · *active*

> Left Shift

- `src/settings.ts:86` · ShiftLeft: · when `in keyName()`

**T26A36A** · UI · *active*

> Right Shift

- `src/settings.ts:86` · ShiftRight: · when `in keyName()`

**TD5EEA2** · UI · *active*

> Left Ctrl

- `src/settings.ts:86` · ControlLeft: · when `in keyName()`

**TC797B6** · UI · *active*

> Right Ctrl

- `src/settings.ts:86` · ControlRight: · when `in keyName()`

**TC689A8** · UI · *active*

> Left Alt

- `src/settings.ts:86` · AltLeft: · when `in keyName()`

**TCDD21F** · UI · *active*

> Right Alt

- `src/settings.ts:86` · AltRight: · when `in keyName()`

**T2E1767** · UI · *active*

> Caps Lock

- `src/settings.ts:86` · CapsLock: · when `in keyName()`

**TC8F48E** · Screen text · *active*

> CHOOSE YOUR TRAINER

- `src/ui/characterScreen.ts:118` · heading · when `in render()`

**T07499C** · Screen text · *active*

> The first Ranger is free; more Rangers unlock with your trainer level online, and more trainers are coming soon

- `src/ui/characterScreen.ts:118` · heading · when `anyLocked ?`

**T50B286** · Screen text · *active*

> Pick the trainer you play as

- `src/ui/characterScreen.ts:118` · heading · when `anyLocked ?`

**TD1488E** · Screen text · *active*

> 🔒 {locked}

Placeholders: `locked`  
Example: "🔒 …"

- `src/ui/characterScreen.ts:151` · text · when `locked ?`

**TF6F337** · UI · *active*

> One target

- `src/ui/moveGallery.ts:26` · single:

**T7824EC** · UI · *active*

> Ring around the user

- `src/ui/moveGallery.ts:26` · ring:

**T6B11D5** · UI · *active*

> Power {mv.power}

Placeholders: `mv.power`  
Example: "Power …"

- `src/ui/moveGallery.ts:187` · facts = · when `mv.power > 0 ?`

**T435AA2** · UI · *active*

>   ({this.typeFilter} only)

Placeholders: `this.typeFilter`  
Example: "  (… only)"

- `src/ui/moveGallery.ts:194` · where = · when `this.typeFilter ?`

**TDA1858** · UI · *active*

> ← → browse  ·  Space replay  ·  P {this.auto ? 'pause' : 'play'}  ·  T type filter  ·  Esc back to title

Placeholders: `this.auto ? 'pause' : 'play'`  
Example: "← → browse  ·  Space replay  ·  P …  ·  T type filter  ·  Esc back to title"

- `src/ui/moveGallery.ts:196` · strip · when `in drawOverlay()`

**TF3AED7** · UI · *active*

> ⏎ .almia-opt { width: min(520px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }⏎ .almia-opt h3 { margin: 14px 0 6px; font-size: 15px; font-weight: normal; color: #c2611a; }⏎ .almia-opt .line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px dashed #d8c7a6; }⏎ .almia-opt .line:last-child { border-bottom: 0; }⏎ .almia-opt .hint { color: #8a6a4a; font-size: 13px; }⏎ .almia-opt input[type=range] { width: 180px; accent-color: #c2611a; }⏎ .almia-opt .key { min-width: 110px; text-align: center; }⏎ .almia-opt .key.listen { background: #4a3424; color: #f4ecdc; }⏎ .almia-opt .fixed { color: #8a6a4a; }⏎ 

- `src/ui/optionsMenu.ts:11` · CSS =

**T7D182B** · UI · *active*

> Saved in this browser as you change them.

- `src/ui/optionsMenu.ts:61` · el · when `in openOptions()`

**T0D49FC** · UI · *active*

> Music volume

- `src/ui/optionsMenu.ts:66` · el · when `in openOptions()`

**T599CDD** · UI · *active*

> Camera shake (legendary moments)

- `src/ui/optionsMenu.ts:92` · toggleLine · when `in openOptions()`

**T53D92D** · UI · *active*

> Simple graphics (fixes flickering in some browsers; applies on the next screen)

- `src/ui/optionsMenu.ts:97` · toggleLine · when `in openOptions()`

**T5DC882** · UI · *active*

> Click a key, then press the new one. Esc cancels.

- `src/ui/optionsMenu.ts:105` · el · when `in openOptions()`

**T8E909C** · UI · *active*

> Aim and use moves

- `src/ui/optionsMenu.ts:122` · fixed =

**TCC045E** · UI · *active*

> Left / right click

- `src/ui/optionsMenu.ts:122` · fixed =

**T312F3B** · UI · *active*

> Steer a Pokémon

- `src/ui/optionsMenu.ts:122` · fixed =

**T73A584** · UI · *active*

> Click it

- `src/ui/optionsMenu.ts:122` · fixed =

**T038898** · UI · *active*

> Back / close

- `src/ui/optionsMenu.ts:122` · fixed =

**TE65665** · UI · *active*

> Arrow keys

- `src/ui/optionsMenu.ts:122` · fixed =

**T782ABF** · UI · *active*

> Also move

- `src/ui/optionsMenu.ts:122` · fixed =

**T4998AA** · UI · *active*

> Reset controls

- `src/ui/optionsMenu.ts:130` · el

**T290428** · Screen text · *active*

> SHADOWS OF ALMIA

- `src/ui/titleScreen.ts:1034` · text · when `if (this.logo)`

**T32715F** · Screen text · *active*

> A Pokémon battle royale on the Ranger Union training grounds

- `src/ui/titleScreen.ts:1037` · text · when `in render()`

**T3F7ABA** · Button · *active*

> Roll Starter

- `src/ui/titleScreen.ts:1044` · button · when `if (this.onOnline)`

**T1AC8B1** · UI · *active*

> Move Gallery (M)

- `src/ui/titleScreen.ts:1046` · rows = · when `in render()`

**T408CAE** · UI · *active*

> My PC (P) · {this.pcCount}

Placeholders: `this.pcCount`  
Example: "My PC (P) · 3"

- `src/ui/titleScreen.ts:1047` · rows = · when `in render()`

**TBEE33A** · UI · *active*

> Trainer (C)

- `src/ui/titleScreen.ts:1048` · rows = · when `in render()`

**TE15084** · UI · *active*

> Version {__BUILD__}

Placeholders: `__BUILD__`  
Example: "Version 4cad177"

- `src/ui/titleScreen.ts:1053` · stamp = · when `in render()`

## 2. Starter selection

14 lines.

**T9078ED** · Screen text · *active*

> STARTER ROLL

- `src/ui/rollScreen.ts:186` · heading · when `in render()`

**T789CA8** · Screen text · *active*

> Pick your starter

- `src/ui/rollScreen.ts:186` · heading · when `this.done ?`

**T8AF1F3** · Screen text · *active*

> Rolling…

- `src/ui/rollScreen.ts:186` · heading · when `this.done ?`
- `src/ui/rollScreen.ts:209` · button · when `this.done ?`

**T7733BE** · Screen text · *active*

> Odds per reel:

- `src/ui/rollScreen.ts:213` · label: · when `in render()`

**T662D23** · Screen text · *active*

> Click a card or press 1-3 · {poolSize(this.unlocked)} starters in your pool: every Pokémon you keep in your PC adds its line ({all}+ to find)

Placeholders: `poolSize(this.unlocked)`, `all`  
Example: "Click a card or press 1-3 · … starters in your pool: every Pokémon you keep in your PC adds its line (…+ to find)"

- `src/ui/rollScreen.ts:225` · text · when `in render()`

**TD17D6E** · Button · *active*

> Reroll (R)

- `src/ui/rollScreen.ts:228` · button · when `if (this.onReroll)`

**TDE379B** · Screen text · *active*

> HP {st.hp}  ATK {st.atk}  DEF {st.def}

Placeholders: `st.hp`, `st.atk`, `st.def`  
Example: "HP 23/40  ATK …  DEF …"

- `src/ui/rollScreen.ts:310` · text · when `in drawCard()`

**T4AA9A9** · Screen text · *active*

> SPA {st.spa}  SPD {st.spd}  SPE {st.spe}

Placeholders: `st.spa`, `st.spd`, `st.spe`  
Example: "SPA …  SPD …  SPE …"

- `src/ui/rollScreen.ts:311` · text · when `in drawCard()`

**T397C98** · Screen text · *active*

> Moves: {moves.join(', ')}

Placeholders: `moves.join(', ')`  
Example: "Moves: 3"

- `src/ui/rollScreen.ts:313` · wrapText · when `in drawCard()`

**TA622E8** · UI · *active*

> stones and levels, {all.length} forms

Placeholders: `all.length`  
Example: "stones and levels, … forms"

- `src/ui/rollScreen.ts:332` · parts.push · when `if (stones.length)`

**TA01274** · UI · *active*

> Lv {first.level} one of {evo.length} forms

Placeholders: `first.level`, `evo.length`  
Example: "Lv 12 one of … forms"

- `src/ui/rollScreen.ts:338` · parts.push · when `if (evo.length > 1)`

**TE9C7E0** · UI · *active*

> Lv {first.level} {cur?.name ?? first.to}

Placeholders: `first.level`, `cur?.name ?? first.to`  
Example: "Lv 12 Pikachu"

- `src/ui/rollScreen.ts:342` · parts.push · when `in evolutionLine()`

**T6DC24E** · UI · *active*

> Evolves: {parts.join(', ')}

Placeholders: `parts.join(', ')`  
Example: "Evolves: 3"

- `src/ui/rollScreen.ts:344` · return · when `parts.length ?`

**T59B645** · UI · *active*

> Does not evolve

- `src/ui/rollScreen.ts:344` · return · when `parts.length ?`

## 3. Online hub, lobbies, parties, private matches, friends and trades

230 lines.

**TE583A6** · UI · *active*

> Backups are failing: {this.lastError}

Placeholders: `this.lastError`  
Example: "Backups are failing: (a reason)"

- `server/backup.ts:96` · onFail · when `if (this.failures >= 2)`

**T0F693C** · Screen text · *active*

> Sign in to chat (guests can read).

- `server/chat.ts:54` · text: · when `if (from.accountId === null)`

**T5E07A6** · Screen text · *active*

> You are muted from chat for now.

- `server/chat.ts:60` · text: · when `if (user.muted_until > Date.now())`

**TB1EAAD** · UI · *active*

> flooding the chat

- `server/chat.ts:69` · strike · when `if (now - (this.slowed.get(from.key) ?? 0) > WINDOW * 1000)`

**T57DD43** · UI · *active*

> Slow down a little.

- `server/chat.ts:71` · sys · when `if (times.length >= BURST)`

**T9D2380** · UI · *active*

> repeating messages

- `server/chat.ts:78` · strike · when `if (norm && mine.some((x) => x.text === norm))`

**T365AAC** · UI · *active*

> You just said that.

- `server/chat.ts:79` · sys · when `if (norm && mine.some((x) => x.text === norm))`

**T1A00BE** · UI · *active*

> Automatic: muted {before + 1} times this week (last for {why})

Placeholders: `before + 1`, `why`  
Example: "Automatic: muted … times this week (last for (a reason))"

- `server/chat.ts:114` · autoReport · when `if (before >= 1)`

**T74001A** · Screen text · *active*

> You are muted from chat for {minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '...} ({why}).

Placeholders: `minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '...`, `why`  
Example: "You are muted from chat for … ((a reason))."

- `server/chat.ts:115` · text: · when `in strike()`

**T6CFEA6** · UI · *active*

> Your Pokémon is asleep

- `server/commands.ts:75` · return · when `r === 'asleep' ?`

**T9C83B2** · UI · *active*

> tried to steer {mon.name}

Placeholders: `mon.name`  
Example: "tried to steer Pikachu"

- `server/commands.ts:86` · flag · when `if (mon && mon.owner !== p)`

**T58AC8B** · UI · *active*

> Pokémon mode: you steer {mon.name}. Esc or click your trainer to go back

Placeholders: `mon.name`  
Example: "Pokémon mode: you steer Pikachu. Esc or click your trainer to go back"

- `server/commands.ts:87` · return · when `mon && mon.owner === p && m.takeControl(mon) ?`

**TC18D24** · UI · *active*

> sold away from a shop

- `server/commands.ts:126` · flag · when `if (m.nearService()?.kind !== 'shop')`

**T316A3D** · UI · *active*

> Walk up to a shop first

- `server/commands.ts:127` · return · when `if (m.nearService()?.kind !== 'shop')`
- `server/commands.ts:135` · return · when `s?.kind === 'shop' ?`

**T391521** · UI · *active*

> bought away from a shop

- `server/commands.ts:134` · flag · when `if (s?.kind !== 'shop')`

**T588BB1** · UI · *active*

> Walk up to a storage chest first

- `server/commands.ts:142` · return · when `if (m.nearService()?.kind !== 'chest')`
- `server/commands.ts:148` · return · when `if (m.nearService()?.kind !== 'chest')`

**T627B09** · UI · *active*

> styler loop without a Capture Styler

- `server/commands.ts:165` · flag · when `if (!m.hasStyler(p))`

**TA85CCD** · UI · *active*

> Out of range

- `server/commands.ts:260` · return · when `if (Math.hypot(x - p.x, y - p.y) > CONFIG.catch.throwRange + 0.5)`

**T7C3519** · UI · *active*

> Pick a kind of event

- `server/events.ts:57` · return · when `if (!(kind in LIMITS))`

**T4236F3** · UI · *active*

> Give it a name

- `server/events.ts:59` · return · when `if (!name)`

**TA1BD18** · UI · *active*

> Between a few minutes and two weeks

- `server/events.ts:62` · return · when `if (kind !== 'message' && !(hours > 0 && hours <= 24 * 14))`

**T9CAFFB** · UI · *active*

> The amount must be between {lo} and {hi}

Placeholders: `lo`, `hi`  
Example: "The amount must be between … and …"

- `server/events.ts:65` · return · when `if (kind !== 'message' && !(value >= lo && value <= hi))`

**TC6B7AD** · UI · *active*

> An event just ended. Thanks for playing!

- `server/events.ts:99` · announce · when `if (!active.some((e) => e.id === id))`

**T88FEF7** · UI · *active*

> (KO)

- `server/headless.ts:45` · map · when `m.fainted ?`

**T9D74FB** · Screen text · *active*

> Your roll expired, roll again

- `server/hub.ts:259` · text: · when `if (c.rollSeed === null)`

**T4B44D8** · Screen text · *active*

> Pick one of the starters you rolled

- `server/hub.ts:263` · text: · when `if (!starter)`

**T2B7154** · Screen text · *active*

> Your party leader starts the matches

- `server/hub.ts:270` · text: · when `if (c.party && c.party.members.length > 1)`

**T134ADC** · Screen text · *active*

> Leave your private lobby to queue

- `server/hub.ts:271` · text: · when `if (c.private)`

**T9863D6** · Screen text · *active*

> Sign in to make a party

- `server/hub.ts:335` · text: · when `if (c.accountId === null)`

**T050D96** · Screen text · *active*

> You can invite friends to your party

- `server/hub.ts:337` · text: · when `if (!this.o.accounts.areFriends(c.accountId, target.accountId))`

**TDD78B1** · Screen text · *active*

> Only the party leader can invite

- `server/hub.ts:340` · text: · when `if (p && p.leader !== c)`

**T2E3972** · Screen text · *active*

> A party is at most {PARTY_MAX} trainers

Placeholders: `PARTY_MAX`  
Example: "A party is at most … trainers"

- `server/hub.ts:346` · text: · when `if (p.members.length + p.invited.size >= PARTY_MAX)`

**TEF9084** · Screen text · *active*

> That invite is gone

- `server/hub.ts:359` · text: · when `if (!p \|\| !p.invited.has(c))`

**TA2DDFD** · Screen text · *active*

> That party is full

- `server/hub.ts:365` · text: · when `if (p.members.length >= PARTY_MAX)`

**T9073BA** · Screen text · *active*

> You were removed from the party

- `server/hub.ts:393` · text: · when `case 'kick'`

**T44E47C** · Screen text · *active*

> Your party is just you: use Find a Match

- `server/hub.ts:401` · text: · when `if (p.members.length < 2)`

**TC50FEC** · Screen text · *active*

> Someone in your party is still in a match

- `server/hub.ts:402` · text: · when `if (p.members.some((m) => m.room \|\| m.pick))`

**T588944** · Screen text · *active*

> No lobby with the code {code \|\| '(none)'}

Placeholders: `code \|\| '(none)'`  
Example: "No lobby with the code K7Q2D"

- `server/hub.ts:484` · text: · when `if (!l)`

**T3C6B18** · Screen text · *active*

> (none)

- `server/hub.ts:484` · text: · when `if (!l)`

**TA8F1DE** · Screen text · *active*

> The host removed you from the lobby

- `server/hub.ts:523` · text: · when `if (tc && tc !== c)`

**T8BBC46** · Screen text · *active*

> Someone is still in a match

- `server/hub.ts:532` · text: · when `if (members.some((m) => m.room))`

**T83A3DB** · Screen text · *active*

> Two trainers at least, or turn computer trainers on

- `server/hub.ts:533` · text: · when `if (!lobby.rules.bots && members.length < 2)`

**T4624A7** · Screen text · *active*

> Everyone is on one team: split up, or add computer trainers

- `server/hub.ts:535` · text: · when `if (sides.size < 2 && !(lobby.rules.bots && members.length < lobby.rules.size))`

**T49C708** · Screen text · *active*

> You can watch your friends

- `server/hub.ts:729` · text: · when `if (!friends && !lobbyMates)`

**TC01D53** · Screen text · *active*

> No match to watch right now

- `server/hub.ts:738` · text: · when `if (!room)`

**T6AD332** · UI · *active*

> \b[^\s]*{bad.split('').join('[^a-z\\s]*')}[^\s]*\b

Placeholders: `bad.split('').join('[^a-z\\s]*')`  
Example: "\b[^\s]*3[^\s]*\b"

- `server/moderation.ts:45` · RegExp · when `if (words.some((w) => squash(w) === target))`

**T54F697** · Dashboard page · *active*

> &amp;

- `server/privacyPage.ts:5`
- `server/profilePage.ts:11`

**T5D2C1A** · Dashboard page · *active*

> &lt;

- `server/privacyPage.ts:5`
- `server/profilePage.ts:11`

**T03C7B3** · Dashboard page · *active*

> &gt;

- `server/privacyPage.ts:5`
- `server/profilePage.ts:11`

**TE2BBF2** · Dashboard page · *active*

> &quot;

- `server/privacyPage.ts:5`
- `server/profilePage.ts:11`

**T2D008A** · Dashboard page · *active*

> write to <a href="{esc(contact.includes('@') ? `mailto:${contact}` : contact)}">{esc(contact)}</a>

Placeholders: `esc(contact.includes('@') ? `mailto:${contact}` : contact)`, `esc(contact)`  
Example: "write to <a href="…">…</a>"

- `server/privacyPage.ts:8` · reach = · when `contact ?`

**TF5C586** · Dashboard page · *active*

> report yourself in the game chat with the word "delete" (a moderator will see it)

- `server/privacyPage.ts:8` · reach = · when `contact ?`

**T0F01C5** · UI · *active*

> That lobby is starting a match

- `server/privateLobby.ts:60` · return · when `if (this.state !== 'open')`

**T79D43B** · UI · *active*

> That lobby is full

- `server/privateLobby.ts:61` · return · when `if (!this.members.has(peer.key) && this.members.size >= this.rules.size)`

**T0F9C57** · Screen text · *active*

> The lobby got smaller, and you were last in

- `server/privateLobby.ts:86` · text: · when `in setRules()`

**TCCE49A** · Dashboard page · *active*

>  (title: {esc(a.title)})

Placeholders: `esc(a.title)`  
Example: " (title: Master Ranger)"

- `server/profilePage.ts:37` · return · when `a.title ?`

**T1A1BC6** · Dashboard page · *unused (switched off)*

> level {p.progress.level} 

Placeholders: `p.progress.level`  
Example: "level 12 "

- `server/profilePage.ts:52` · esc · when `LEVELS_ON ?`

**TE42DBF** · Dashboard page · *active*

> , {p.title}

Placeholders: `p.title`  
Example: ", Master Ranger"

- `server/profilePage.ts:52` · esc · when `p.title ?`

**T1EFC64** · Dashboard page · *active*

> Top level

- `server/profilePage.ts:92` · when `p.progress.next ?`

**T095141** · UI · *active*

> move keys {fr[1]},{fr[2]}

Placeholders: `fr[1]`, `fr[2]`  
Example: "move keys …,…"

- `server/room.ts:387` · flag · when `if (Math.hypot(Number(fr[1]) \|\| 0, Number(fr[2]) \|\| 0) > 1.01)`

**T1B3369** · UI · *active*

> AWS4-HMAC-SHA256 Credential={o.accessKey}/{scope}, SignedHeaders={signed}, Signature={signature}

Placeholders: `o.accessKey`, `scope`, `signed`, `signature`  
Example: "AWS4-HMAC-SHA256 Credential=…/…, SignedHeaders=…, Signature=…"

- `server/s3.ts:71` · authorization: · when `in signV4()`

**T77DABE** · UI · *active*

> # HELP almia_{name} {help}

Placeholders: `name`, `help`  
Example: "# HELP almia_Pikachu …"

- `server/telemetry.ts:174` · lines.push · when `in prometheus()`

**TE3CA0C** · UI · *active*

> # TYPE almia_{name} {type}

Placeholders: `name`, `type`  
Example: "# TYPE almia_Pikachu …"

- `server/telemetry.ts:174` · lines.push · when `in prometheus()`

**T7226CB** · UI · *active*

> almia_{name} {v}

Placeholders: `name`, `v`  
Example: "almia_Pikachu …"

- `server/telemetry.ts:174` · lines.push · when `in prometheus()`

**TACCA74** · UI · *active*

> Connected players

- `server/telemetry.ts:175` · g · when `in prometheus()`

**TEC7687** · UI · *active*

> Matches running

- `server/telemetry.ts:176` · g · when `in prometheus()`

**T39275E** · UI · *active*

> Players in the queues

- `server/telemetry.ts:177` · g · when `in prometheus()`

**T17AEA3** · UI · *active*

> Simulation ms per step (last 10 s)

- `server/telemetry.ts:179` · g · when `in prometheus()`

**TFC66B4** · UI · *active*

> Worst simulation step (last 10 s)

- `server/telemetry.ts:180` · g · when `in prometheus()`

**T97275E** · UI · *active*

> How late the clock ran (last 10 s)

- `server/telemetry.ts:181` · g · when `in prometheus()`

**T395400** · UI · *active*

> Event loop delay, 99th percentile

- `server/telemetry.ts:182` · g · when `in prometheus()`

**T587DE2** · UI · *active*

> Resident memory

- `server/telemetry.ts:183` · g · when `in prometheus()`

**T02B330** · UI · *active*

> Database size

- `server/telemetry.ts:184` · g · when `in prometheus()`

**T3DD514** · UI · *active*

> Matches started

- `server/telemetry.ts:186` · g · when `in prometheus()`

**T3A9B0D** · UI · *active*

> Matches finished

- `server/telemetry.ts:187` · g · when `in prometheus()`

**T2E00C8** · UI · *active*

> Matches called off

- `server/telemetry.ts:188` · g · when `in prometheus()`

**T5365BF** · UI · *active*

> WebSocket messages received

- `server/telemetry.ts:189` · g · when `in prometheus()`

**T0BC320** · UI · *active*

> WebSocket messages sent

- `server/telemetry.ts:190` · g · when `in prometheus()`

**TAD9DDA** · UI · *active*

> Bytes sent (before compression)

- `server/telemetry.ts:191` · g · when `in prometheus()`

**T9EBA61** · UI · *active*

> Connections opened

- `server/telemetry.ts:192` · g · when `in prometheus()`

**T427E84** · UI · *active*

> Errors recorded

- `server/telemetry.ts:193` · g · when `in prometheus()`

**T141F69** · UI · *active*

> Seconds since start

- `server/telemetry.ts:194` · g · when `in prometheus()`

**TEE807D** · UI · *active*

> You have {n} trade update{n === 1 ? '' : 's'} waiting

Placeholders: `n`, `n === 1 ? '' : 's'`  
Example: "You have 3 trade update3 waiting"

- `src/ui/onlineScreens.ts:125` · when `if (n > this.tradesWaiting)`

**T7CFA14** · Screen text · *active*

> Find a Match (Space)

- `src/ui/onlineScreens.ts:168` · label: · when `in findState()`

**T1B8337** · UI · *active*

> Signed out

- `src/ui/onlineScreens.ts:238` · when `in signOut()`

**T69C8DF** · Screen text · *active*

> Play Online

- `src/ui/onlineScreens.ts:264` · heading · when `if (hubLogo)`
- `src/ui/titleScreen.ts:1043` · button · when `if (this.onOnline)`

**T12EAF8** · Screen text · *active*

> ★ {ev.map((e) => `${e.name} · ${left(e.endsAt)}`).join(' ★ ')}

Placeholders: `ev.map((e) => `${e.name} · ${left(e.endsAt)}`).join(' ★ ')`  
Example: "★ Pikachu"

- `src/ui/onlineScreens.ts:271` · text · when `if (ev.length)`

**TF7FA84** · Screen text · *unused (switched off)*

>   ·  Lv {pr.level}

Placeholders: `pr.level`  
Example: "  ·  Lv 12"

- `src/ui/onlineScreens.ts:280` · text · when `pr && LEVELS_ON ?`

**TDC1649** · Button · *active*

> Sign out

- `src/ui/onlineScreens.ts:291` · button · when `if (me.signedIn && me.user)`

**T32B066** · Screen text · *active*

> Ten trainers, one island, one winner.

- `src/ui/onlineScreens.ts:301` · text · when `in render()`

**T5D17EE** · Button · *active*

> Trade ({this.tradesWaiting})

Placeholders: `this.tradesWaiting`  
Example: "Trade (…)"

- `src/ui/onlineScreens.ts:302` · button · when `this.tradesWaiting ?`

**T1F3A54** · Screen text · *active*

> Connected{this.net.ping ? ` · ${this.net.ping} ms` : ''}

Placeholders: `this.net.ping ? ` · ${this.net.ping} ms` : ''`  
Example: "Connected42"

- `src/ui/onlineScreens.ts:305` · text · when `this.net.connected ?`

**T808C28** · Screen text · *active*

>  · {this.net.ping} ms

Placeholders: `this.net.ping`  
Example: " · 42 ms"

- `src/ui/onlineScreens.ts:305` · text · when `this.net.ping ?`

**TB832CB** · Screen text · *active*

> DEMO SERVER: progress here is separate

- `src/ui/onlineScreens.ts:307` · text · when `if (this.net.hello?.server === 'demo')`

**T7CFD2C** · Button · *active*

> Back (Esc)

- `src/ui/onlineScreens.ts:308` · button · when `in render()`

**T25031B** · Button · *active*

> Admin dashboard

- `src/ui/onlineScreens.ts:309` · button · when `if (me.user?.role === 'admin')`

**TE9ACB8** · UI · *active*

> Everyone for themselves

- `src/ui/onlineScreens.ts:314` · solo:

**TC94CE3** · UI · *active*

> Teams of two

- `src/ui/onlineScreens.ts:314` · duos:

**T0E71BC** · UI · *active*

> Teams of four

- `src/ui/onlineScreens.ts:314` · squads:

**T5B5CE5** · UI · *active*

> Players pick a team

- `src/ui/onlineScreens.ts:314` · pick:

**T36E800** · UI · *active*

> Private lobby

- `src/ui/onlineScreens.ts:362` · el · when `in draw()`

**TCE0010** · UI · *active*

> You host: share the code, set the rules, start when ready.

- `src/ui/onlineScreens.ts:362` · el · when `host ?`

**T6C1069** · UI · *active*

> Copy code

- `src/ui/onlineScreens.ts:366` · el · when `in draw()`

**T413A2B** · UI · *active*

> Trainers · {l.members.length}/{l.rules.size}{l.rules.bots && l.members.length < l.rules.size ? ' (comp...}

Placeholders: `l.members.length`, `l.rules.size`, `l.rules.bots && l.members.length < l.rules.size ? ' (comp...`  
Example: "Trainers · …/…Wes"

- `src/ui/onlineScreens.ts:374` · el · when `in draw()`

**T84C2E1** · UI · *active*

>  (computer trainers fill the rest)

- `src/ui/onlineScreens.ts:374` · el · when `l.rules.bots && l.members.length < l.rules.size ?`

**T05F2DC** · UI · *active*

>  (you)

- `src/ui/onlineScreens.ts:377` · el · when `m.name === l.you ?`
- `src/ui/socialPanel.ts:104` · el · when `m.name === party.you ?`

**T81BB28** · UI · *active*

> Starter picked

- `src/ui/onlineScreens.ts:378` · el · when `m.picked ?`
- `src/ui/socialPanel.ts:105` · el · when `m.picked ?`

**T747B3D** · UI · *active*

> Picking a starter...

- `src/ui/onlineScreens.ts:378` · el · when `m.picked ?`
- `src/ui/socialPanel.ts:105` · el · when `m.picked ?`

**TDD33BA** · UI · *active*

> Team {t}

Placeholders: `t`  
Example: "Team …"

- `src/ui/onlineScreens.ts:383` · el · when `if (l.rules.teams === 'pick')`

**TA8BA54** · UI · *active*

> Computer trainers

- `src/ui/onlineScreens.ts:426` · check · when `in draw()`
- `src/ui/socialPanel.ts:299` · el

**TBA50F0** · UI · *active*

> Starter level

- `src/ui/onlineScreens.ts:428` · select · when `in draw()`

**T3B8ADD** · UI · *active*

> Level {n}

Placeholders: `n`  
Example: "Level 3"

- `src/ui/onlineScreens.ts:428` · map · when `in draw()`

**T4DB6DC** · UI · *active*

> Slow (half speed)

- `src/ui/onlineScreens.ts:429` · select · when `in draw()`

**T697ACF** · UI · *active*

> Very fast (double)

- `src/ui/onlineScreens.ts:429` · select · when `in draw()`

**T937C1A** · UI · *active*

> Rare-item chest

- `src/ui/onlineScreens.ts:430` · check · when `in draw()`

**T5C209E** · UI · *active*

> Start the match

- `src/ui/onlineScreens.ts:437` · el · when `l.state === 'picking' ?`

**T167AC9** · UI · *active*

> You left the queue (your party too)

- `src/ui/onlineScreens.ts:528` · onLeave · when `party(this.net) ?`

**T92303D** · UI · *active*

> Your party is picking starters ({picked}/{party.members.length})

Placeholders: `picked`, `party.members.length`  
Example: "Your party is picking starters (…/…)"

- `src/ui/onlineScreens.ts:542` · sub = · when `waitingParty ?`

**T982C6E** · UI · *active*

> Waiting for {this.need} more player{this.need === 1 ? '' : 's'} ({this.min} needed before bots fill in)

Placeholders: `this.need`, `this.need === 1 ? '' : 's'`, `this.min`  
Example: "Waiting for 3 more player3 (3 needed before bots fill in)"

- `src/ui/onlineScreens.ts:544` · sub = · when `this.need > 0 ?`

**T729C86** · UI · *active*

> Joining the queue

- `src/ui/onlineScreens.ts:546` · sub = · when `this.startsIn === null ?`

**T815393** · UI · *active*

> Starting in {Math.ceil(this.startsIn)}s

Placeholders: `Math.ceil(this.startsIn)`  
Example: "Starting in 3s"

- `src/ui/onlineScreens.ts:547` · sub = · when `this.startsIn === null ?`

**TE8041B** · Screen text · *active*

> Finding trainers{dots}

Placeholders: `dots`  
Example: "Finding trainers…"

- `src/ui/onlineScreens.ts:548` · heading · when `in render()`

**T2EA225** · Button · *active*

> Start now (admin)

- `src/ui/onlineScreens.ts:561` · button · when `this.admin && this.need > 0 ?`

**T6A6361** · Button · *active*

> Start now with bots

- `src/ui/onlineScreens.ts:561` · button · when `this.admin && this.need > 0 ?`

**T7E9DAA** · Button · *active*

> Leave queue

- `src/ui/onlineScreens.ts:562` · button · when `in render()`

**T36C3EA** · Screen text · *active*

> Your squad is the last standing!

- `src/ui/onlineScreens.ts:687` · text · when `this.place === 1 && this.net.social.party ?`

**TBCCDA0** · Screen text · *active*

> Last trainer standing!

- `src/ui/onlineScreens.ts:687` · text · when `this.place === 1 && this.net.social.party ?`

**TBF2DC7** · Screen text · *unused (switched off)*

> +{total} XP{up ? ` · Level ${prog.after.level}!` : ` · Level ${prog.a...}

Placeholders: `total`, `up ? ` · Level ${prog.after.level}!` : ` · Level ${prog.a...`  
Example: "+3 XP12"

- `src/ui/onlineScreens.ts:692` · text · when `if (prog && this.net.me.signedIn && LEVELS_ON)`

**T538164** · Screen text · *active*

>   ·  Level {prog.after.level}!

Placeholders: `prog.after.level`  
Example: "  ·  Level 12!"

- `src/ui/onlineScreens.ts:692` · text · when `up ?`

**T574F1F** · Screen text · *active*

>   ·  Level {prog.after.level}

Placeholders: `prog.after.level`  
Example: "  ·  Level 12"

- `src/ui/onlineScreens.ts:692` · text · when `up ?`

**T45A4DF** · Screen text · *unused (switched off)*

> ★ {a.name}{a.title ? ` · new title: ${a.title}` : ''}{a.look ? ' · new look' : ''}

Placeholders: `a.name`, `a.title ? ` · new title: ${a.title}` : ''`, `a.look ? ' · new look' : ''`  
Example: "★ PikachuMaster Ranger…"

- `src/ui/onlineScreens.ts:696` · text · when `if (prog && this.net.me.signedIn && LEVELS_ON)`

**T6A3EF7** · Screen text · *active*

>  · new title: {a.title}

Placeholders: `a.title`  
Example: " · new title: Master Ranger"

- `src/ui/onlineScreens.ts:696` · text · when `a.title ?`

**T26FC2F** · Screen text · *active*

>  · new look

- `src/ui/onlineScreens.ts:696` · text · when `a.look ?`

**TC47312** · Screen text · *active*

> up to {this.info.picks} Pokémon

Placeholders: `this.info.picks`  
Example: "up to 3 Pokémon"

- `src/ui/onlineScreens.ts:704` · text · when `this.info.picks > 1 ?`

**T7F8CD6** · Screen text · *active*

> one Pokémon

- `src/ui/onlineScreens.ts:704` · text · when `this.info.picks > 1 ?`

**TBA2A08** · UI · *active*

> ⏎ .almia-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: "BoldPixels", "Segoe UI", system-ui, sans-serif; }⏎ .almia-ui * { box-sizing: border-box; }⏎ .almia-panel { pointer-events: auto; background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset; image-rendering: pixelated; }⏎ .almia-chat { position: absolute; left: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px)); display: flex; flex-direction: column; font-size: 15px; }⏎ .almia-chat.side { left: auto; right: 16px; top: 16px; bottom: 16px; width: min(300px, calc(100vw - 32px)); }⏎ .almia-chat.side .almia-chat-log { flex: 1; height: auto; }⏎ .almia-chat.side.collapsed { bottom: auto; }⏎ .almia-chat.compact { opacity: 0.88; top: 96px; bottom: auto; width: min(300px, calc(100vw - 32px)); }⏎ .almia-chat.compact .almia-chat-log { height: 120px; }⏎ .almia-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: #4a3424; color: #f4ecdc; font-size: 14px; letter-spacing: 0.5px; cursor: pointer; }⏎ .almia-chat-log { height: 180px; overflow-y: auto; padding: 6px 10px; line-height: 1.35; overflow-wrap: anywhere; }⏎ .almia-chat.collapsed .almia-chat-log, .almia-chat.collapsed .almia-chat-row { display: none; }⏎ .almia-chat-log .who { color: #c2611a; cursor: pointer; }⏎ .almia-chat-log .sys { color: #8a6a4a; font-style: italic; }⏎ .almia-chat-log .announce { display: block; color: #c2611a; font-style: normal; border: 2px solid #c2611a; padding: 3px 6px; margin: 3px 0; }⏎ .almia-chat-log .modbadge { color: #fff; background: #1f6aa0; font-size: 11px; padding: 0 4px; margin-right: 4px; }⏎ .almia-chat-row { display: flex; border-top: 2px solid #4a3424; }⏎ .almia-chat-row input { flex: 1; min-width: 0; border: 0; padding: 7px 10px; font: inherit; background: #fffaf0; color: #4a3424; outline: none; }⏎ .almia-chat-row button, .almia-btn { font: inherit; border: 0; background: #c2611a; color: #fff; padding: 7px 12px; cursor: pointer; text-shadow: 0 1px 0 #8a3a0a; }⏎ .almia-btn.alt { background: #e9dcc2; color: #4a3424; text-shadow: none; }⏎ .almia-btn:disabled { background: #b8ad98; cursor: default; }⏎ .almia-menu { position: absolute; padding: 4px; display: flex; flex-direction: column; gap: 4px; }⏎ .almia-modal-wrap { position: absolute; inset: 0; background: rgba(8,4,20,0.55); display: flex; align-items: center; justify-content: center; pointer-events: auto; }⏎ .almia-modal { width: min(380px, calc(100vw - 32px)); padding: 18px 20px 20px; font-size: 16px; }⏎ .almia-modal h2 { margin: 0 0 4px; font-size: 26px; font-weight: normal; }⏎ .almia-modal p { margin: 4px 0 12px; color: #8a6a4a; font-size: 14px; line-height: 1.35; }⏎ .almia-modal label { display: block; margin: 10px 0 4px; font-size: 14px; }⏎ .almia-modal input { width: 100%; padding: 9px 10px; font: inherit; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; outline: none; }⏎ .almia-modal .row { display: flex; gap: 8px; margin-top: 14px; }⏎ .almia-modal .row .almia-btn { flex: 1; }⏎ .almia-modal .err { color: #b0302a; min-height: 18px; margin-top: 8px; font-size: 14px; }⏎ .almia-modal .google { display: block; text-align: center; margin-top: 10px; background: #fff; color: #4a3424; border: 2px solid #4a3424; padding: 8px; text-decoration: none; }⏎ .almia-modal .switch { margin-top: 12px; font-size: 14px; text-align: center; color: #8a6a4a; }⏎ .almia-modal .switch a { color: #c2611a; cursor: pointer; }⏎ .almia-side { position: absolute; right: 16px; top: 16px; bottom: 16px; width: min(300px, calc(100vw - 32px)); display: flex; flex-direction: column; font-size: 15px; }⏎ .almia-side.collapsed { bottom: auto; }⏎ .almia-side.collapsed .almia-side-body { display: none; }⏎ .almia-side-body { flex: 1; overflow-y: auto; padding: 8px 10px; }⏎ .almia-side h3 { margin: 10px 0 4px; font-size: 14px; font-weight: normal; color: #8a6a4a; letter-spacing: 0.5px; text-transform: uppercase; }⏎ .almia-side h3:first-child { margin-top: 2px; }⏎ .almia-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px dashed #d8c7a6; }⏎ .almia-row:last-child { border-bottom: 0; }⏎ .almia-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }⏎ .almia-row .sub { display: block; font-size: 12px; color: #8a6a4a; }⏎ .almia-row .dot { width: 9px; height: 9px; flex: none; border: 2px solid #4a3424; background: #b8ad98; }⏎ .almia-row .dot.on { background: #5bbf5b; } .almia-row .dot.busy { background: #e0a030; } .almia-row .dot.watch { background: #6aa8e8; }⏎ .almia-small { font: inherit; font-size: 12px; border: 0; background: #c2611a; color: #fff; padding: 4px 7px; cursor: pointer; }⏎ .almia-small.alt { background: #e9dcc2; color: #4a3424; }⏎ .almia-small:disabled { background: #b8ad98; cursor: default; }⏎ .almia-add { display: flex; gap: 6px; margin: 6px 0 2px; }⏎ .almia-add input { flex: 1; min-width: 0; padding: 5px 7px; font: inherit; font-size: 14px; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; outline: none; }⏎ .almia-note { font-size: 13px; color: #8a6a4a; line-height: 1.35; margin: 4px 0; }⏎ .almia-toasts { position: absolute; top: 92px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }⏎ .almia-toast { padding: 8px 14px; font-size: 15px; animation: almia-in 0.2s ease-out; }⏎ @keyframes almia-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }⏎ .almia-modal.wide { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; }⏎ .almia-modal .list { overflow-y: auto; margin-top: 8px; border-top: 2px solid #4a3424; }⏎ .almia-tabs { display: flex; gap: 6px; margin: 6px 0 2px; }⏎ .almia-tabs .almia-small { font-size: 14px; padding: 5px 10px; }⏎ .almia-board { width: 100%; border-collapse: collapse; font-size: 14px; }⏎ .almia-board td, .almia-board th { padding: 4px 6px; text-align: left; border-bottom: 1px dashed #d8c7a6; font-weight: normal; }⏎ .almia-board th { color: #8a6a4a; font-size: 12px; text-transform: uppercase; }⏎ .almia-board td.r, .almia-board th.r { text-align: right; }⏎ .almia-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 140px); overflow-y: auto; padding: 16px 18px; font-size: 15px; }⏎ .almia-center h2 { margin: 0; font-size: 24px; font-weight: normal; }⏎ .almia-code { font-size: 34px; letter-spacing: 6px; color: #c2611a; }⏎ .almia-rules { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; margin: 8px 0; font-size: 14px; }⏎ @media (min-width: 1000px) { .almia-center.beside-chat { left: max(50%, 700px); } }⏎ .almia-row select { font: inherit; font-size: 13px; padding: 2px 4px; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; }⏎ .almia-rules select, .almia-rules input[type=number] { font: inherit; font-size: 14px; padding: 3px 5px; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; }⏎ .almia-rules select:disabled, .almia-rules input:disabled { opacity: 0.75; }⏎ .almia-actions { display: flex; gap: 8px; margin-top: 12px; }⏎ .almia-actions .almia-btn { flex: 1; }⏎ 

- `src/ui/overlay.ts:8` · CSS =

**T2E1609** · UI · *active*

> Global chat

- `src/ui/overlay.ts:131` · el

**T99FE67** · UI · *active*

> Enter to talk

- `src/ui/overlay.ts:131` · el

**TD6379D** · UI · *active*

> Say something nice

- `src/ui/overlay.ts:137` · when `net.me.signedIn ?`

**TC61D15** · UI · *active*

> 📣 {m.text}

Placeholders: `m.text`  
Example: "📣 (a reason)"

- `src/ui/overlay.ts:175` · el · when `if (m.announce)`

**TF19ABA** · UI · *active*

> : {m.text}

Placeholders: `m.text`  
Example: ": (a reason)"

- `src/ui/overlay.ts:181` · document.createTextNode · when `if (m.system)`

**TA462F6** · UI · *active*

> View card

- `src/ui/overlay.ts:199` · el · when `if (this.onName)`

**T7F9A05** · UI · *active*

> Mute {m.from}

Placeholders: `m.from`  
Example: "Mute Wes"

- `src/ui/overlay.ts:206` · el · when `in openMenu()`

**TC1FCCC** · Screen text · *active*

> Thanks, {m.from} was reported to the moderators.

Placeholders: `m.from`  
Example: "Thanks, Wes was reported to the moderators."

- `src/ui/overlay.ts:222` · text: · when `r.ok ?`

**TA2C0B0** · Screen text · *active*

> Could not send the report

- `src/ui/overlay.ts:222` · text: · when `r.ok ?`

**TCF2FC6** · UI · *active*

> Your PC box, chest, look and stats are kept on the server.

- `src/ui/overlay.ts:269` · el · when `mode === 'signin' ?`

**T9E820E** · UI · *active*

> Pick a trainer name others will see. Don’t use your real name. We keep no email.

- `src/ui/overlay.ts:269` · el · when `mode === 'signin' ?`

**T8F9B72** · UI · *active*

> What we keep (privacy)

- `src/ui/overlay.ts:271` · el · when `if (mode === 'register')`

**T141B74** · UI · *active*

> Trainer name

- `src/ui/overlay.ts:283` · el
- `src/ui/socialPanel.ts:128` · when `in render()`
- `src/ui/socialPanel.ts:580` · el · when `in recoverDialog()`

**TCCC5B0** · UI · *active*

> Continue with Google

- `src/ui/overlay.ts:292` · el · when `if (net.me.google)`

**T7857F5** · UI · *active*

> New here? 

- `src/ui/overlay.ts:302` · document.createTextNode · when `mode === 'signin' ?`

**TDD9256** · UI · *active*

> That did not work

- `src/ui/overlay.ts:321` · when `if (!r.ok)`
- `src/ui/socialPanel.ts:538` · when `if (r.ok)`
- `src/ui/socialPanel.ts:568` · when `if (!r.ok)`

**T241DD2** · UI · *active*

> Finding a match

- `src/ui/socialPanel.ts:13` · queue:

**TAC98D1** · UI · *active*

> In a match

- `src/ui/socialPanel.ts:14` · match:

**T18B428** · UI · *active*

> In a private lobby

- `src/ui/socialPanel.ts:16` · private:

**T55BDC5** · UI · *active*

> Friends & party

- `src/ui/socialPanel.ts:59` · el

**T8ECB6E** · UI · *active*

> Sign in to add friends, make a party and watch your friends play.

- `src/ui/socialPanel.ts:84` · el · when `if (!net.me.signedIn)`

**TFFB006** · UI · *active*

> Party · {party.members.length}/4

Placeholders: `party.members.length`  
Example: "Party · …/4"

- `src/ui/socialPanel.ts:100` · el · when `if (party)`

**T957ABF** · UI · *active*

> Leave party

- `src/ui/socialPanel.ts:119` · el · when `if (party)`

**T1F753F** · UI · *active*

> You lead: Find a Match takes everyone, as one squad.

- `src/ui/socialPanel.ts:121` · el · when `lead ?`

**TF1D382** · UI · *active*

> Add a friend

- `src/ui/socialPanel.ts:125` · el · when `in render()`

**T4B4AC0** · UI · *active*

> Could not add

- `src/ui/socialPanel.ts:140` · when `r.ok ?`

**TCDFE80** · UI · *active*

> Friend requests

- `src/ui/socialPanel.ts:154` · el · when `if (incoming.length)`

**TA32FCF** · UI · *active*

> Friends · {mine.filter((f) => f.online).length} online

Placeholders: `mine.filter((f) => f.online).length`  
Example: "Friends · … online"

- `src/ui/socialPanel.ts:166` · el · when `in render()`

**TDF8EB6** · UI · *active*

> No friends yet. Add someone by their trainer name.

- `src/ui/socialPanel.ts:167` · el · when `if (!mine.length)`

**T7B6353** · UI · *active*

> dot {dot}

Placeholders: `dot`  
Example: "dot …"

- `src/ui/socialPanel.ts:173` · el · when `in render()`

**T98DC77** · UI · *active*

> No wins yet. Be the first!

- `src/ui/socialPanel.ts:262` · el · when `if (!r.players?.length)`

**T1D7811** · UI · *active*

> Your matches show up here once they finish.

- `src/ui/socialPanel.ts:294` · el · when `mine ?`

**T8A2BCA** · UI · *active*

> Private · 

- `src/ui/socialPanel.ts:299` · el · when `x.mode === 'private' ?`
- `src/ui/watchScreens.ts:51` · mode = · when `header.mode === 'private' ?`
- `src/ui/watchScreens.ts:203` · mode = · when `this.header.mode === 'private' ?`

**TBEF204** · UI · *active*

> No winner

- `src/ui/socialPanel.ts:300` · el · when `x.winner ?`

**TB1C60E** · UI · *active*

> Join a private lobby

- `src/ui/socialPanel.ts:330` · el · when `in joinCodeDialog()`

**TC3AE56** · UI · *active*

> Ask the host for the five-letter code.

- `src/ui/socialPanel.ts:330` · el · when `in joinCodeDialog()`

**T40B8A5** · UI · *active*

> Trainer level {pr.level}

Placeholders: `pr.level`  
Example: "Trainer level 12"

- `src/ui/socialPanel.ts:391` · el · when `if (p.error)`

**T3D88A3** · UI · *active*

> Online now · 

- `src/ui/socialPanel.ts:398` · el · when `p.online ?`

**TFD31D5** · UI · *active*

> Achievements · {have.size}/{ACHIEVEMENTS.length}

Placeholders: `have.size`, `ACHIEVEMENTS.length`  
Example: "Achievements · …/…"

- `src/ui/socialPanel.ts:408` · el · when `if (p.error)`

**TB03192** · UI · *active*

>  · title: {a.title}

Placeholders: `a.title`  
Example: " · title: Master Ranger"

- `src/ui/socialPanel.ts:414` · when `a.title ?`

**T0528AD** · UI · *active*

>  · unlocks a look

- `src/ui/socialPanel.ts:414` · when `a.look ?`

**T59FEAB** · UI · *active*

> Recent matches

- `src/ui/socialPanel.ts:422` · el · when `if (p.recent?.length)`

**T09D352** · UI · *active*

> +{m.xp} XP

Placeholders: `m.xp`  
Example: "+120 XP"

- `src/ui/socialPanel.ts:426` · filter · when `m.xp !== null ?`
- `server/profilePage.ts:43` · filter · when `m.xp !== null ?`

**TE97C3A** · UI · *active*

> Copy profile link

- `src/ui/socialPanel.ts:444` · el

**TC2E984** · UI · *active*

> Link copied

- `src/ui/socialPanel.ts:445` · then

**T4AB291** · UI · *active*

> Your account

- `src/ui/socialPanel.ts:457` · el · when `in accountTools()`

**T473F6D** · UI · *active*

> Title you wear

- `src/ui/socialPanel.ts:460` · el · when `in accountTools()`

**T878ED3** · UI · *active*

> Earn titles with achievements

- `src/ui/socialPanel.ts:463` · el · when `titles.length ?`

**T4CC482** · UI · *active*

> You now wear "{sel.value}"

Placeholders: `sel.value`  
Example: "You now wear "…""

- `src/ui/socialPanel.ts:472` · when `sel.value ?`

**TAC45FE** · UI · *active*

> No title

- `src/ui/socialPanel.ts:472` · when `sel.value ?`

**T91E691** · UI · *active*

> Could not change it

- `src/ui/socialPanel.ts:472` · when `r.ok ?`

**T8C6842** · UI · *active*

> Change password

- `src/ui/socialPanel.ts:479` · el · when `if (net.me.user?.password)`
- `src/ui/socialPanel.ts:519` · el · when `in changePasswordDialog()`

**T90B8AF** · UI · *active*

> New recovery codes

- `src/ui/socialPanel.ts:484` · el · when `if (net.me.user?.password)`

**T781E39** · UI · *active*

> Your recovery codes

- `src/ui/socialPanel.ts:501` · el · when `in recoveryCodesDialog()`

**TB053CE** · UI · *active*

> We keep no email, so these are how you get back in if you forget your password. Each works once. Save them somewhere safe now: they will not be shown again.{replaced ? ' Your old codes no longer work.' : ''}

Placeholders: `replaced ? ' Your old codes no longer work.' : ''`  
Example: "We keep no email, so these are how you get back in if you forget your password. Each works once. Save them somewhere safe now: they will not be shown again.2"

- `src/ui/socialPanel.ts:502` · el · when `in recoveryCodesDialog()`

**T2236A0** · UI · *active*

>  Your old codes no longer work.

- `src/ui/socialPanel.ts:502` · el · when `replaced ?`

**TD4C0B9** · UI · *active*

> I've saved them

- `src/ui/socialPanel.ts:510` · el · when `in recoveryCodesDialog()`

**T0B2CAD** · UI · *active*

> Change it

- `src/ui/socialPanel.ts:527` · el · when `in changePasswordDialog()`

**T2016FB** · UI · *active*

> Changed. Other browsers signed in as you were signed out.

- `src/ui/socialPanel.ts:536` · when `if (r.ok)`

**T19DFF4** · UI · *active*

> Current password

- `src/ui/socialPanel.ts:542` · el · when `in changePasswordDialog()`

**T7047B7** · UI · *active*

> New password (8+ characters)

- `src/ui/socialPanel.ts:542` · el · when `in changePasswordDialog()`
- `src/ui/socialPanel.ts:580` · el · when `in recoverDialog()`

**T5D5E81** · UI · *active*

> Use one of the recovery codes you saved when you made your account.

- `src/ui/socialPanel.ts:551` · el · when `in recoverDialog()`

**T25C6FC** · UI · *active*

> Set new password

- `src/ui/socialPanel.ts:560` · el · when `in recoverDialog()`

**T521D7B** · UI · *active*

> You're back in. {r.codesLeft ?? 0} recovery code{r.codesLeft === 1 ? '' : 's'} left{(r.codesLeft ?? 0) < 3 ? ': make new ones from your profi...}.

Placeholders: `r.codesLeft ?? 0`, `r.codesLeft === 1 ? '' : 's'`, `(r.codesLeft ?? 0) < 3 ? ': make new ones from your profi...`  
Example: "You're back in. 3 recovery code3 leftWes."

- `src/ui/socialPanel.ts:575` · when `in recoverDialog()`

**TD367EE** · UI · *active*

> : make new ones from your profile

- `src/ui/socialPanel.ts:575` · when `(r.codesLeft ?? 0) < 3 ?`

**T3CB5FD** · UI · *active*

> Recovery code

- `src/ui/socialPanel.ts:580` · el · when `in recoverDialog()`

**TE5FFB4** · UI · *active*

> ⏎ .almia-trade { width: min(560px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }⏎ .almia-trade h3 { margin: 14px 0 6px; font-size: 15px; font-weight: normal; color: #c2611a; }⏎ .almia-trade .line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px dashed #d8c7a6; }⏎ .almia-trade .line:last-child { border-bottom: 0; }⏎ .almia-trade .what { flex: 1; line-height: 1.35; }⏎ .almia-trade .hint { color: #8a6a4a; font-size: 13px; }⏎ .almia-trade select { width: 100%; padding: 8px; font: inherit; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; }⏎ .almia-trade .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }⏎ .almia-trade .pair label { margin: 0 0 4px; }⏎ .almia-trade .find { display: flex; gap: 8px; }⏎ .almia-trade .find input { flex: 1; }⏎ .almia-trade .msg { min-height: 18px; margin-top: 8px; font-size: 14px; color: #2f7a3a; }⏎ .almia-trade .msg.err { color: #b0302a; }⏎ .almia-trade .wonder { margin-top: 6px; padding: 10px 12px; border: 2px dashed #c2611a; background: #fff6e4; }⏎ .almia-trade .wonder .find select { flex: 1; }⏎ .almia-trade .news { color: #2f7a3a; padding: 4px 0; }⏎ .almia-card { width: min(380px, calc(100vw - 24px)) !important; text-align: center; }⏎ .almia-card .big { font-size: 22px; margin: 4px 0; }⏎ .almia-card .sub { color: #8a6a4a; font-size: 13px; margin-bottom: 10px; }⏎ .almia-card .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 12px 0; }⏎ .almia-card .stats div { border: 2px solid #d8c7a6; padding: 8px 4px; background: #fffaf0; }⏎ .almia-card .stats b { display: block; font-size: 18px; font-weight: normal; color: #c2611a; }⏎ .almia-card .row { justify-content: center; }⏎ 

- `src/ui/tradeMenu.ts:34` · CSS =

**T922B0B** · UI · *active*

> (gone)

- `src/ui/tradeMenu.ts:62` · return · when `if (!c)`

**T8AAE16** · UI · *active*

>  · Alpha

- `src/ui/tradeMenu.ts:63` · return · when `c.alpha ?`

**T2E5EE8** · UI · *active*

> Swap Pokémon from your PC with another trainer. They accept or decline when they next look.

- `src/ui/tradeMenu.ts:126` · el · when `in openTrades()`

**T0F7490** · UI · *active*

> Wonder Trade

- `src/ui/tradeMenu.ts:128` · el · when `in openTrades()`

**T249CBA** · UI · *active*

> Your {cardText(n.gave)} went to {n.partner}, who sent you {cardText(n.got)}!

Placeholders: `cardText(n.gave)`, `n.partner`, `cardText(n.got)`  
Example: "Your 3 went to 3, who sent you 3!"

- `src/ui/tradeMenu.ts:130` · el

**TC950D1** · UI · *active*

> Take back

- `src/ui/tradeMenu.ts:134` · el · when `if (wonder.waiting)`

**T152426** · UI · *active*

> Send one Pokémon off and get a surprise from another trainer.

- `src/ui/tradeMenu.ts:143` · el · when `if (wonder.waiting)`

**TBA169F** · UI · *active*

> Your PC is empty

- `src/ui/tradeMenu.ts:146` · Option · when `if (!tradable.length)`
- `src/ui/tradeMenu.ts:224` · Option · when `if (!tradable.length)`

**TD1F3B1** · UI · *active*

> Offers for you{incoming.length ? ` (${incoming.length})` : ''}

Placeholders: `incoming.length ? ` (${incoming.length})` : ''`  
Example: "Offers for you…"

- `src/ui/tradeMenu.ts:162` · el · when `in openTrades()`

**TB90BD6** · UI · *active*

>  ({incoming.length})

Placeholders: `incoming.length`  
Example: " (…)"

- `src/ui/tradeMenu.ts:162` · el · when `incoming.length ?`

**T4144FE** · UI · *active*

> None right now.

- `src/ui/tradeMenu.ts:163` · el · when `if (!incoming.length)`

**T96884D** · UI · *active*

> Your offers

- `src/ui/tradeMenu.ts:182` · el · when `in openTrades()`

**T790EEF** · UI · *active*

> None waiting.

- `src/ui/tradeMenu.ts:183` · el · when `if (!outgoing.length)`

**TBE5DF4** · UI · *active*

> To {o.to}: your {cardText(o.give)} for their {cardText(o.want)}

Placeholders: `o.to`, `cardText(o.give)`, `cardText(o.want)`  
Example: "To …: your (a reason) for their (a reason)"

- `src/ui/tradeMenu.ts:186` · el

**TDDE692** · UI · *active*

> New trade

- `src/ui/tradeMenu.ts:196` · el · when `in openTrades()`

**T464C1A** · UI · *active*

> Trainer's name

- `src/ui/tradeMenu.ts:199` · draw = · when `in openTrades()`

**T6D7049** · UI · *active, admin only*

> Look up

- `src/ui/tradeMenu.ts:206` · el
- `server/modPage.ts:93` · moderators page HTML

**T0F0C1F** · UI · *active*

> You give

- `src/ui/tradeMenu.ts:228` · el · when `if (theirs && theirs.pc.length)`

**T94253D** · UI · *active*

> You get from {theirs.name}

Placeholders: `theirs.name`  
Example: "You get from Pikachu"

- `src/ui/tradeMenu.ts:230` · el · when `if (theirs && theirs.pc.length)`

**TAF851D** · UI · *active*

> Send offer

- `src/ui/tradeMenu.ts:234` · el · when `if (theirs && theirs.pc.length)`

**TD02267** · On-screen notice · *active*

> Offer sent

- `src/ui/tradeMenu.ts:238` · say · when `if (theirs && theirs.pc.length)`

**TE08071** · UI · *unused (switched off)*

> Lv {p.progress.level} · 

Placeholders: `p.progress.level`  
Example: "Lv 12 · "

- `src/ui/tradeMenu.ts:318` · el · when `LEVELS_ON ?`

**TC93011** · UI · *active, admin only*

> Online now

- `src/ui/tradeMenu.ts:318` · el · when `p.online ?`
- `server/adminPage.ts:94` · admin page HTML

**TA0BA31** · UI · *active*

> Trainer since {since}

Placeholders: `since`  
Example: "Trainer since …"

- `src/ui/tradeMenu.ts:318` · el · when `p.online ?`

**T422601** · UI · *active*

> In PC

- `src/ui/tradeMenu.ts:320` · when `if (p.error)`

**T6CDAC8** · UI · *active*

> Sign in to trade

- `src/ui/tradeMenu.ts:333` · when `if (!net.me.signedIn)`

**T6818ED** · UI · *active*

> Sign in to trade.

- `src/ui/tradeMenu.ts:345` · el · when `if (!p.error && !isMe && !net.me.signedIn)`

## 4. Accounts: sign-in, registration, recovery, profiles

74 lines.

**T3C46AA** · Error message · *active*

> No player with that name

- `server/accounts.ts:281` · error: · when `if (!u \|\| u.banned)`

**T967A76** · Error message · *active*

> That's you!

- `server/accounts.ts:282` · error: · when `if (u.id === me.id)`
- `server/accounts.ts:810` · text: · when `if (u.id === userId)`

**T878406** · Screen text · *active*

> Taken back. It is in your PC as before

- `server/accounts.ts:298` · text: · when `r.changes ?`

**T692C32** · Error message · *active*

> Nothing is out on Wonder Trade

- `server/accounts.ts:298` · error: · when `r.changes ?`

**T475C84** · Error message · *active, admin only*

> Not found

- `server/accounts.ts:304` · error: · when `if (req.method !== 'POST')`
- `server/accounts.ts:369` · error: · when `in tradeApi()`
- `server/accounts.ts:1063` · error: · when `in handle()`
- `server/adminApi.ts:163` · error: · when `in handle()`
- `server/main.ts:288` · error: · when `in ops()`
- `server/modApi.ts:212` · error: · when `in handle()`

**TDE088F** · Error message · *active*

> Too many trade offers. Try again later

- `server/accounts.ts:307` · error: · when `if (this.limited(`trade:${me.id}`, 20, 3600_000))`

**T6A54F2** · Error message · *active*

> Pick one of your own Pokémon to give

- `server/accounts.ts:310` · error: · when `if (!give \|\| give.owner !== me.id)`

**TE300DF** · Error message · *active*

> Pick one of the other trainer's Pokémon

- `server/accounts.ts:311` · error: · when `if (!want \|\| want.owner === me.id)`

**TDD140B** · Error message · *active*

> That Pokémon is out on Wonder Trade

- `server/accounts.ts:312` · error: · when `if (this.isPooled(give.pcId as number) \|\| this.isPooled(want.pcId as number))`

**T3EF730** · Error message · *active*

> That trainer can not trade

- `server/accounts.ts:315` · error: · when `if (!target \|\| target.banned)`

**T5C90CA** · Error message · *active*

> You have 10 offers waiting already. Cancel one first

- `server/accounts.ts:317` · error: · when `if (open >= 10)`

**T3DA8E7** · Error message · *active*

> You already offered that trade

- `server/accounts.ts:319` · error: · when `if (dup)`

**TE4732C** · Screen text · *active*

> Offer sent to {nameOf(other)}: your {give.name} for their {want.name}

Placeholders: `nameOf(other)`, `give.name`, `want.name`  
Example: "Offer sent to …: your Pikachu for their Pikachu"

- `server/accounts.ts:323` · text: · when `if (path === '/api/trades/offer')`

**T466DDB** · Error message · *active*

> That offer is gone

- `server/accounts.ts:326` · error: · when `if (!t)`

**TD02298** · Error message · *active*

> Not your offer

- `server/accounts.ts:328` · error: · when `if (t.from_user !== me.id)`
- `server/accounts.ts:334` · error: · when `if (t.to_user !== me.id)`

**TD80E5F** · Error message · *active*

> One of those Pokémon is not there any more, so the offer was closed

- `server/accounts.ts:348` · error: · when `if (!g \|\| !w \|\| g.user_id !== t.from_user \|\| w.user_id !== t.to_user \|\| this.isPooled(t.give_pc) \|\| this.isPooled(t.want_pc))`

**T0A48F7** · Screen text · *active*

> Trade complete! {gName} is in your PC

Placeholders: `gName`  
Example: "Trade complete! Pikachu is in your PC"

- `server/accounts.ts:367` · text: · when `if (path === '/api/trades/respond')`

**TB0071A** · Error message · *active*

> Too many Wonder Trades. Try again later

- `server/accounts.ts:393` · error: · when `if (this.limited(`wonder:${me.id}`, 30, 3600_000))`

**TE5FEF6** · Error message · *active*

> Pick one of your own Pokémon

- `server/accounts.ts:395` · error: · when `if (!give \|\| give.owner !== me.id)`

**T7129A4** · Error message · *active*

> You already have one out on Wonder Trade

- `server/accounts.ts:396` · error: · when `if (this.db.prepare("SELECT 1 FROM wonder WHERE user_id = ? AND status = 'waiting'").get(me.id))`

**TC2522F** · Screen text · *active*

> Wonder Trade! {nameOf(partnerId)} sent you {got.name}

Placeholders: `nameOf(partnerId)`, `got.name`  
Example: "Wonder Trade! … sent you Pikachu"

- `server/accounts.ts:434` · text: · when `in wonderSend()`

**T442D4E** · Screen text · *active*

> No trainer by that name

- `server/accounts.ts:809` · text: · when `if (!u \|\| u.banned)`

**TC88DAF** · Screen text · *active*

> You can have up to {MAX_FRIENDS} friends and requests

Placeholders: `MAX_FRIENDS`  
Example: "You can have up to … friends and requests"

- `server/accounts.ts:813` · text: · when `if (count >= MAX_FRIENDS)`

**TCC0D01** · Screen text · *active*

> You and {u.username} are now friends

Placeholders: `u.username`  
Example: "You and Pikachu are now friends"

- `server/accounts.ts:819` · text: · when `if (theirs)`

**T16E25C** · Screen text · *active*

> Friend request sent to {u.username}

Placeholders: `u.username`  
Example: "Friend request sent to Pikachu"

- `server/accounts.ts:822` · text: · when `in addFriend()`

**T0B4341** · Error message · *active, admin only*

> Missing header

- `server/accounts.ts:907` · error: · when `if (req.headers['x-almia'] !== '1')`
- `server/modApi.ts:43` · error: · when `if (req.method === 'POST' && req.headers['x-almia'] !== '1')`

**TCF2D92** · Error message · *active*

> No such player

- `server/accounts.ts:939` · error: · when `if (!u \|\| u.banned)`

**T77A74F** · Error message · *active*

> Sign in first

- `server/accounts.ts:943` · error: · when `if (!me)`

**TF23272** · Error message · *active, admin only*

> This account is banned

- `server/accounts.ts:944` · error: · when `if (me.banned)`
- `server/accounts.ts:1117` · error: · when `if (u.banned)`
- `server/accounts.ts:1204` · back · when `if (u.banned)`
- `server/modApi.ts:115` · kick · when `case 'ban'`

**T797BFA** · Error message · *active*

> Too many friend requests. Try again later

- `server/accounts.ts:953` · error: · when `if (this.limited(`friend:${me.id}`, 30, 3600_000))`

**TAC7F5E** · Error message · *active*

> Nothing to extract from that match

- `server/accounts.ts:976` · error: · when `if (!row \|\| row.picks_left <= 0)`
- `server/accounts.ts:988` · error: · when `if (!left \|\| left.picks_left <= 0)`

**TD702FA** · Error message · *active*

> Pick one of your Pokémon from that match

- `server/accounts.ts:980` · error: · when `if (!pick \|\| pick.taken)`

**T745CEB** · Error message · *active*

> Earn that title first

- `server/accounts.ts:1003` · error: · when `if (t && !titlesFor(this.earned(me.id)).includes(t))`

**T11B08C** · Error message · *active*

> Your account signs in with Google: Google handles its recovery

- `server/accounts.ts:1008` · error: · when `if (!me.pass_hash)`

**TC22BDE** · Error message · *active*

> Your account signs in with Google

- `server/accounts.ts:1015` · error: · when `if (!me.pass_hash)`

**TC6B85C** · Error message · *active*

> Too many tries. Wait 15 minutes

- `server/accounts.ts:1016` · error: · when `if (this.limited(`pw:${me.id}`, 8, 900_000))`

**TF76FB0** · Error message · *active*

> Your current password is not right

- `server/accounts.ts:1019` · error: · when `if (!checkPassword(cur, me.pass_hash))`

**T4360C1** · UI · *active*

> Your password was changed, so please sign in again

- `server/accounts.ts:1027` · onSignedOut · when `if (req.method === 'POST' && path === '/api/password')`

**T62C00A** · Error message · *active*

> Pick a look

- `server/accounts.ts:1033` · error: · when `if (!look)`

**TB771D6** · Error message · *active*

> That look is not unlocked yet

- `server/accounts.ts:1034` · error: · when `if (!this.canWear(me.id, look))`

**T73760C** · Error message · *active*

> You can change your name three times a day

- `server/accounts.ts:1039` · error: · when `if (!this.allow(`rename:${me.id}`, 3, 24 * 3600_000))`

**TE2B7C3** · Error message · *active*

> That name is taken

- `server/accounts.ts:1047` · error: · when `if (req.method === 'POST' && path === '/api/rename')`
- `server/accounts.ts:1094` · error: · when `in register()`

**T4D206E** · UI · *active*

> was {me.username}

Placeholders: `me.username`  
Example: "was Pikachu"

- `server/accounts.ts:1050` · logMod · when `if (req.method === 'POST' && path === '/api/rename')`

**T36DE3C** · Error message · *active*

> That is a lot of reports. Try again later

- `server/accounts.ts:1055` · error: · when `if (!this.allow(`report:${me.id}`, 10, 3600_000))`

**T067BA0** · Error message · *active*

> Who are you reporting?

- `server/accounts.ts:1059` · error: · when `if (!target)`

**TB6C655** · Error message · *active*

> Too much data

- `server/accounts.ts:1065` · error: · when `if (e instanceof BodyTooLarge)`

**T8D886C** · Error message · *active, admin only*

> Something went wrong

- `server/accounts.ts:1069` · error: · when `in handle()`
- `server/adminApi.ts:166` · error: · when `in handle()`
- `server/modApi.ts:215` · error: · when `in handle()`

**T222328** · UI · *active*

> Names are 3-16 letters, numbers or _

- `server/accounts.ts:1074` · return · when `if (!USERNAME.test(name))`

**T11D071** · UI · *active*

> Pick a different name

- `server/accounts.ts:1075` · return · when `if (RESERVED.has(name.toLowerCase()) \|\| !isClean(name))`

**T25A7F1** · Error message · *active*

> New accounts can not be made from here

- `server/accounts.ts:1081` · error: · when `if (this.banFor(cleanDevice(String(req.headers['x-device'] ?? '')), ip))`

**TA71838** · Error message · *testing only*

> Too many new accounts from here. Try again later

- `server/accounts.ts:1082` · error: · when `if (this.limited(`reg:${ip}`, this.kind === 'dev' ? 100 : 5, 3600_000))`

**TC26151** · Error message · *active*

> Too many tries. Wait 15 minutes and try again

- `server/accounts.ts:1109` · error: · when `if (this.limited(`ip:${ip}`, 20, 900_000) \|\| this.limited(`user:${username.toLowerCase()}`, 8, 900_000))`

**TDD0CE1** · Error message · *active*

> Wrong name or password

- `server/accounts.ts:1115` · error: · when `if (!u \|\| !u.pass_hash \|\| !checkPassword(password, u.pass_hash))`

**TED0E0C** · Error message · *active*

> Signing in from here is blocked

- `server/accounts.ts:1118` · error: · when `if (this.banFor(cleanDevice(String(req.headers['x-device'] ?? '')), ip))`

**TB1465C** · Error message · *active*

> Too many tries. Try again in an hour

- `server/accounts.ts:1129` · error: · when `if (this.limited(`rec:${ip}`, 10, 3600_000) \|\| this.limited(`recuser:${username.toLowerCase()}`, 5, 3600_000))`

**TB95A97** · Error message · *active*

> That name and code do not match

- `server/accounts.ts:1134` · error: · when `if (!u \|\| !u.pass_hash \|\| u.banned \|\| !this.useRecoveryCode(u.id, code))`

**TAD2D37** · UI · *active*

> This account was recovered with a recovery code, so this connection was closed

- `server/accounts.ts:1144` · onSignedOut · when `in recover()`

**TF17ED3** · UI · *active*

> Google sign-in is not set up on this server

- `server/accounts.ts:1158` · end · when `if (!this.google)`

**TFAA988** · UI · *active*

> openid profile

- `server/accounts.ts:1165` · scope: · when `in googleStart()`

**T6B4D81** · UI · *active*

> Google sign-in is not set up

- `server/accounts.ts:1178` · back · when `if (!this.google)`

**T1C3DF4** · UI · *active*

> Sign-in expired, try again

- `server/accounts.ts:1180` · back · when `if (!state \|\| state !== url.searchParams.get('state') \|\| !verifier)`

**T1B2AA3** · UI · *active*

> Sign-in was cancelled

- `server/accounts.ts:1182` · back · when `if (!code)`

**T44C242** · UI · *active*

> Google sign-in failed

- `server/accounts.ts:1188` · back · when `if (!r.ok)`
- `server/accounts.ts:1193` · back · when `if (!claims.sub \|\| claims.aud !== this.google.id \|\| !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss ?? '') \|\| (claim)`

**T73C048** · UI · *active*

> ; Secure

- `server/accounts.ts:1219` · secure = · when `isHttps(req) ?`

**T250861** · UI · *active*

> Passwords need at least 8 characters

- `server/accounts.ts:1244` · return · when `if (password.length < 8 \|\| password.length > 200)`

**T4EEFF6** · UI · *active*

> Pick a harder password

- `server/accounts.ts:1245` · return · when `if (password.toLowerCase().includes(username.toLowerCase()) \|\| /^(password\|12345678\|qwertyui\|11111111)/i.test(password))`

**TAF62D9** · UI · *active*

> scrypt$16384$8$1${salt.toString('base64')}${hash.toString('base64')}

Placeholders: `salt.toString('base64')`, `hash.toString('base64')`  
Example: "scrypt$16384$8$1$…$…"

- `server/accounts.ts:1252` · return · when `in hashPassword()`

**T1CF8F7** · UI · *active*

> body too large

- `server/accounts.ts:1293` · call

**T0170B0** · UI · *active*

> Welcome, {this.net.me.user?.username}!

Placeholders: `this.net.me.user?.username`  
Example: "Welcome, Pikachu!"

- `src/ui/onlineScreens.ts:225` · when `if (ok)`

**TC19E2D** · UI · *active*

> Sign in to chat

- `src/ui/overlay.ts:137` · when `net.me.signedIn ?`

**T7C6FAB** · Screen text · *active*

> Sign in to report players.

- `src/ui/overlay.ts:220` · text: · when `if (!this.net.me.signedIn)`

**T9A691D** · UI · *active*

> Password (8+ characters)

- `src/ui/overlay.ts:284` · el · when `mode === 'signin' ?`

**T580010** · UI · *active*

> Have an account? 

- `src/ui/overlay.ts:302` · document.createTextNode · when `mode === 'signin' ?`

**TA2F060** · UI · *active*

> Forgot your password?

- `src/ui/overlay.ts:306` · el · when `if (mode === 'signin' && hooks.forgot)`
- `src/ui/socialPanel.ts:551` · el · when `in recoverDialog()`

## 5. In a match: HUD, prompts and controls

94 lines.

**TBCDC5E** · UI · *active*

> Storage Chest{chest.town ? ` · ${chest.town}` : ''}

Placeholders: `chest.town ? ` · ${chest.town}` : ''`  
Example: "Storage Chest3"

- `src/ui/hud.ts:217` · title = · when `in drawChestPanel()`

**T93FA75** · UI · *active*

>  · {chest.town}

Placeholders: `chest.town`  
Example: " · 3"

- `src/ui/hud.ts:217` · title = · when `chest.town ?`

**TDC54B8** · UI · *active*

> Click a bag slot (or 1-6) to store it · click a chest slot (or Shift+1-9) to take it

- `src/ui/hud.ts:220` · wrapLines · when `in drawChestPanel()`

**T1471D9** · UI · *active*

> Every town's chest holds the same things, kept between games and safe if you're wiped out · E to close

- `src/ui/hud.ts:221` · wrapLines · when `in drawChestPanel()`

**T4CB6C5** · UI · *active*

>  ×{it.count}

Placeholders: `it.count`  
Example: " ×3"

- `src/ui/hud.ts:472` · map · when `it.count > 1 ?`

**TFB7481** · UI · *active*

> Found {names.join(', ')}!

Placeholders: `names.join(', ')`  
Example: "Found 3!"

- `src/ui/hud.ts:473` · title = · when `if (st.popup)`

**T1B0473** · UI · *active*

> Your party is fully healed

- `src/ui/hud.ts:488` · hint = · when `st.popup.healed ?`

**T4811A2** · UI · *active*

> Teaches {def.name.replace('TM ', '')} · Held & TMs tab

Placeholders: `def.name.replace('TM ', '')`  
Example: "Teaches Pikachu · Held & TMs tab"

- `src/ui/hud.ts:489` · hint = · when `def?.kind === 'tm' ?`

**T1EFA00** · UI · *active*

> Mega Stone · give it to {def.megaFor ? (SPECIES.get(def.megaFor)?.name ?? 'its Pok...}, then press M

Placeholders: `def.megaFor ? (SPECIES.get(def.megaFor)?.name ?? 'its Pok...`  
Example: "Mega Stone · give it to Pikachu, then press M"

- `src/ui/hud.ts:490` · hint = · when `def?.effect === 'mega' ?`

**T81A6BB** · UI · *active*

> its Pokémon

- `src/ui/hud.ts:490` · when `def.megaFor ?`

**T320982** · UI · *active*

> Held item · {def.desc ? `${def.desc} · ` : ''}Held & TMs tab

Placeholders: `def.desc ? `${def.desc} · ` : ''`  
Example: "Held item · …Held & TMs tab"

- `src/ui/hud.ts:491` · hint = · when `def?.kind === 'hold' ?`

**T554133** · UI · *active*

> Works from your bag

- `src/ui/hud.ts:492` · when `def?.kind === 'charm' ?`

**TF0C7CA** · UI · *active*

> Hold F to throw

- `src/ui/hud.ts:493` · when `def?.kind === 'ball' ?`

**T3BD773** · UI · *active*

> Press its number key to use it

- `src/ui/hud.ts:495` · when `def?.kind === 'styler' ?`

**TC5BE22** · UI · *active*

> Teach {st.teach.moveName} to {st.teach.mon}?

Placeholders: `st.teach.moveName`, `st.teach.mon`  
Example: "Teach Pikachu to Pikachu?"

- `src/ui/hud.ts:499` · head = · when `if (st.teach)`

**TED93E8** · UI · *active*

> Press 1 or 2 to replace a move, Esc to keep them

- `src/ui/hud.ts:500` · fitWidth · when `if (st.teach)`
- `src/ui/hud.ts:506` · ink · when `if (st.teach)`

**T6D8D06** · UI · *active*

> Extraction Voucher

- `src/ui/hud.ts:513` · fitWidth · when `if (st.extract)`
- `src/ui/hud.ts:518` · ink · when `if (st.extract)`
- `src/ui/pcScreen.ts:274` · text · when `e.via === 'win' ?`
- `data/items/items.json` · item extraction-voucher: name

**T3042E9** · UI · *active*

> Press 1-6 (or click a card) to send that Pokémon to your PC, Esc to cancel

- `src/ui/hud.ts:513` · fitWidth · when `if (st.extract)`
- `src/ui/hud.ts:519` · ink · when `if (st.extract)`

**T359A3A** · UI · *active*

> You have ₽{st.money.toLocaleString()} · 1-9 to buy · E or Esc to leave

Placeholders: `st.money.toLocaleString()`  
Example: "You have ₽1,500 · 1-9 to buy · E or Esc to leave"

- `src/ui/hud.ts:527` · fitWidth · when `if (st.shop)`
- `src/ui/hud.ts:533` · ink · when `if (st.shop)`

**T64D213** · UI · *active*

> Sell: click a bag slot or Shift+1-6 (half price)

- `src/ui/hud.ts:527` · fitWidth · when `if (st.shop)`
- `src/ui/hud.ts:534` · ink · when `if (st.shop)`

**TA45DF7** · Screen text · *active*

> ₽{e.price.toLocaleString()}

Placeholders: `e.price.toLocaleString()`  
Example: "₽1,500"

- `src/ui/hud.ts:544` · ink · when `if (st.shop)`

**TFD6EBE** · UI · *active*

> Snag Machine · beat {st.snag.from}

Placeholders: `st.snag.from`  
Example: "Snag Machine · beat Wes"

- `src/ui/hud.ts:551` · fitWidth · when `if (st.snag)`
- `src/ui/hud.ts:556` · ink · when `if (st.snag)`

**TBE2591** · UI · *active*

> Take one of their Pokémon: 1-6 or click · Esc keeps the machine

- `src/ui/hud.ts:551` · fitWidth · when `if (st.snag)`
- `src/ui/hud.ts:557` · ink · when `if (st.snag)`

**T5860FA** · UI · *active*

> Trainer left

- `src/ui/hud.ts:595` · title = · when `remaining === 1 ?`

**T0A7010** · UI · *active*

> Trainers left

- `src/ui/hud.ts:595` · title = · when `remaining === 1 ?`

**TFDB5CD** · Screen text · *active*

> The darkness has closed in

- `src/ui/hud.ts:619` · creamStrip · when `if (st.nextPulseIn < 0)`

**TAE9E94** · UI · *active*

> The darkness closes in · 

- `src/ui/hud.ts:623` · head = · when `urgent ?`

**T26B56C** · UI · *active*

> Darkness pulse {Math.min(pulses, match.darkness.phase + 1)}/{pulses} in 

Placeholders: `Math.min(pulses, match.darkness.phase + 1)`, `pulses`  
Example: "Darkness pulse 3/… in "

- `src/ui/hud.ts:623` · head = · when `urgent ?`

**T0ED6CE** · UI · *active*

> Take {ITEMS[m.heldItem]?.name ?? 'item'}

Placeholders: `ITEMS[m.heldItem]?.name ?? 'item'`  
Example: "Take Pikachu"

- `src/ui/hud.ts:1027` · tip = · when `if (overHeld)`

**TAC05F7** · UI · *active*

> Hatching!

- `src/ui/hud.ts:1089` · info = · when `left <= 0 ?`

**T9DA706** · UI · *active*

> It moves!

- `src/ui/hud.ts:1089` · info = · when `left < 60 ?`

**T3E6988** · UI · *active*

> Auto off in battles

- `src/ui/hud.ts:1135` · chip · when `match.playerDuel ?`

**T4FA791** · UI · *active*

> Auto on · R

- `src/ui/hud.ts:1135` · chip · when `match.auto ?`

**T78E34A** · UI · *active*

> Auto off · R

- `src/ui/hud.ts:1135` · chip · when `match.auto ?`

**T5AA0BB** · UI · *active*

> Dodge {dcd.toFixed(1)}s

Placeholders: `dcd.toFixed(1)`  
Example: "Dodge …s"

- `src/ui/hud.ts:1138` · chip · when `dcd > 0 ?`

**T130854** · UI · *active*

> Dodge · Space

- `src/ui/hud.ts:1138` · chip · when `dcd > 0 ?`

**TB8C89D** · UI · *active*

> Steering {m.name} · Esc

Placeholders: `m.name`  
Example: "Steering Pikachu · Esc"

- `src/ui/hud.ts:1139` · chip · when `match.controlled ?`

**TCD487C** · UI · *active*

> Trainer · click a Pokémon

- `src/ui/hud.ts:1139` · chip · when `match.controlled ?`

**TFE0AB0** · UI · *active*

> Mega Evolve · M

- `src/ui/hud.ts:1140` · chip · when `if (canMega(match.player, m))`

**TC844F3** · UI · *active*

> Throw a ball · F ({balls})

Placeholders: `balls`  
Example: "Throw a ball · F (Great Ball)"

- `src/ui/hud.ts:1144` · chip · when `balls > 0 ?`

**T2A7D50** · UI · *active*

> No Poké Balls left

- `src/ui/hud.ts:1144` · chip · when `balls > 0 ?`

**T7ED1A9** · UI · *active*

> Held & TMs

- `src/ui/hud.ts:1217` · forEach · when `in drawItems()`

**T0D83B4** · Screen text · *active*

> Storm Mask: your team lasts {secs % 60 ? `${secs}s` : `${secs / 60} min`} in the storm

Placeholders: `secs % 60 ? `${secs}s` : `${secs / 60} min``  
Example: "Storm Mask: your team lasts 3 in the storm"

- `src/ui/hud.ts:1235` · text = · when `if (masked && p.party.some((m) => m.inDark && !m.fainted && !m.stowed))`

**TFFA2A2** · Screen text · *active*

> +{L.queued} more

Placeholders: `L.queued`  
Example: "+… more"

- `src/ui/hud.ts:1338` · ink · when `if (L.queued > 0)`

**TBCD616** · UI · *active*

> Physical, lunge

- `src/ui/hud.ts:1355` · when `isContact(def) ?`

**TB56F37** · UI · *active*

> Pow {def.power}

Placeholders: `def.power`  
Example: "Pow …"

- `src/ui/hud.ts:1357` · nums = · when `def.power > 0 ?`

**T3AE10F** · UI · *active*

> No damage

- `src/ui/hud.ts:1357` · nums = · when `def.power > 0 ?`
- `src/ui/moveGallery.ts:187` · facts = · when `mv.power > 0 ?`

**T5B81EA** · UI · *active*

> Signature: kept

- `src/ui/hud.ts:1359` · tag = · when `state === 'locked' ?`

**T0EAAB1** · UI · *active*

> Forget this

- `src/ui/hud.ts:1359` · tag = · when `state === 'hover' ?`

**T2E6285** · UI · *active*

> Click to forget

- `src/ui/hud.ts:1359` · tag = · when `state === 'hover' ?`

**T073C02** · Screen text · *active*

> Forget one of these for it:

- `src/ui/hud.ts:1367` · ink · when `in drawLearn()`

**TFB1EA8** · Screen text · *active*

> Don't learn {fresh.name}

Placeholders: `fresh.name`  
Example: "Don't learn Pikachu"

- `src/ui/hud.ts:1386` · ink · when `in drawLearn()`

**T40E6FA** · UI · *active*

> put the target to sleep

- `src/ui/hud.ts:1420` · sleep:

**TB9764C** · UI · *active*

> Power {def.power}

Placeholders: `def.power`  
Example: "Power …"

- `src/ui/hud.ts:1426` · filter · when `def.power > 0 ?`

**T69DA28** · UI · *active*

> Cooldown {def.cooldown}s

Placeholders: `def.cooldown`  
Example: "Cooldown 3s"

- `src/ui/hud.ts:1426` · filter · when `in describeMove()`

**T27C0D3** · UI · *active*

> Charge {def.cast}s

Placeholders: `def.cast`  
Example: "Charge …s"

- `src/ui/hud.ts:1426` · filter · when `def.cast ?`

**T0591E1** · UI · *active*

> Hits one target where you aim

- `src/ui/hud.ts:1429` · single: · when `in describeMove()`

**T0FA209** · UI · *active*

> Hits everything along a line

- `src/ui/hud.ts:1430` · line: · when `in describeMove()`

**T91F587** · UI · *active*

> Hits everything in a cone in front

- `src/ui/hud.ts:1431` · cone: · when `in describeMove()`

**T8882F4** · UI · *active*

> Hits everything in a ring around the user

- `src/ui/hud.ts:1432` · ring: · when `in describeMove()`

**TF324BE** · UI · *active*

> Affects the user

- `src/ui/hud.ts:1433` · self: · when `in describeMove()`

**TA61D49** · UI · *active*

> its own

- `src/ui/hud.ts:1439` · when `if (def.stages)`

**T200E43** · UI · *active*

> the target's

- `src/ui/hud.ts:1439` · when `if (def.stages)`

**TFA9C18** · UI · *active*

>  ({Math.round(def.stages.chance * 100)}%)

Placeholders: `Math.round(def.stages.chance * 100)`  
Example: " (…%)"

- `src/ui/hud.ts:1445` · out.push · when `def.stages.chance < 1 ?`

**T52FB60** · UI · *active*

> The user leaps and slams down on the target

- `src/ui/hud.ts:1447` · out.push · when `if (def.leap)`

**TBDA488** · UI · *active*

> The user lunges in and strikes, shoving the target back

- `src/ui/hud.ts:1448` · out.push · when `if (isContact(def))`

**T197C08** · UI · *active*

> Signature move

- `src/ui/hud.ts:1449` · out.push · when `if (def.signature)`

**TD76EE9** · On-screen notice · *testing only*

> Tester mode: Hoopa is on the island (?dev=0 turns it off)

- `src/ui/matchScreen.ts:147` · say · when `if (isDev())`

**T6ACC3A** · On-screen notice · *active*

> Music off (N)

- `src/ui/matchScreen.ts:232` · say · when `music.toggleMute() ?`

**TA2A88F** · On-screen notice · *active*

> Music on (N)

- `src/ui/matchScreen.ts:232` · say · when `music.toggleMute() ?`

**T090B0D** · On-screen notice · *active*

> Pokémon mode: you steer {own.name}. It attacks the way it faces. Esc or click your trainer to go back

Placeholders: `own.name`  
Example: "Pokémon mode: you steer Pikachu. It attacks the way it faces. Esc or click your trainer to go back"

- `src/ui/matchScreen.ts:312` · say · when `if (own && own !== this.match.controlled && this.match.takeControl(own))`

**TBB0299** · On-screen notice · *active*

> Trainer mode

- `src/ui/matchScreen.ts:318` · say · when `if (this.match.controlled && this.trainerNear(c.x, c.y))`
- `src/ui/matchScreen.ts:391` · say · when `if (input.pressed('Escape') && this.match.controlled)`

**T599FEB** · On-screen notice · *active*

> Ball target: {w.name}

Placeholders: `w.name`  
Example: "Ball target: Pikachu"

- `src/ui/matchScreen.ts:328` · say · when `if (this.match.lockTarget === w)`

**TBF6C95** · On-screen notice · *active*

> Click "Release?" again to let {m.name} go

Placeholders: `m.name`  
Example: "Click "Release?" again to let Pikachu go"

- `src/ui/matchScreen.ts:368` · say · when `if (m)`
- `src/ui/matchScreen.ts:1144` · say · when `if (m)`

**T97D6C1** · On-screen notice · *active*

> Ball target: {t.name}

Placeholders: `t.name`  
Example: "Ball target: Pikachu"

- `src/ui/matchScreen.ts:376` · say · when `t ?`
- `server/commands.ts:99` · return · when `t ?`

**T79C78E** · On-screen notice · *active*

> Auto-battle on: your lead picks its own moves

- `src/ui/matchScreen.ts:387` · say · when `this.match.auto ?`

**TE8B6C7** · On-screen notice · *active*

> Auto-battle off: you pick the moves

- `src/ui/matchScreen.ts:387` · say · when `this.match.auto ?`

**TD92402** · On-screen notice · *active*

> You need a Capture Styler (a rare find in item balls)

- `src/ui/matchScreen.ts:716` · say · when `if (input.pressed('KeyC') && !this.match.hasStyler(p))`

**TCBDD2C** · On-screen notice · *active*

>  · {cur.desc}

Placeholders: `cur.desc`  
Example: " · …"

- `src/ui/matchScreen.ts:1242` · say · when `cur.desc ?`

**TF519C9** · On-screen notice · *active*

> Couldn't reach your PC (this browser blocks saving)

- `src/ui/matchScreen.ts:1325` · say · when `if (!saved)`

**T771553** · UI · *active*

> New move: {move(ev.moveId).name}

Placeholders: `move(ev.moveId).name`  
Example: "New move: Pikachu"

- `src/ui/matchScreen.ts:1367` · add · when `if (ev.mon.owner === this.match.player)`

**TCBB78B** · UI · *active*

> Space · Reel it in!

- `src/ui/matchScreen.ts:2165` · return · when `f.stage === 'bite' ?`

**T959DA9** · UI · *active*

> Waiting for a bite... (move or Space to reel in)

- `src/ui/matchScreen.ts:2165` · return · when `f.stage === 'reel' ?`

**T5BF03B** · UI · *active*

> Space · Battle Ace Trainer Celeste (win a rare Pokémon)

- `src/ui/matchScreen.ts:2167` · return · when `if (who === 'ace')`

**T04FE70** · UI · *active*

> Space · Talk to Hoopa

- `src/ui/matchScreen.ts:2168` · return · when `if (who === 'hoopa')`

**T5FDBB4** · UI · *active*

> Space · Trade with {talker.name}

Placeholders: `talker.name`  
Example: "Space · Trade with Pikachu"

- `src/ui/matchScreen.ts:2170` · return · when `talker.role === 'breeder' ?`

**T31E6FA** · UI · *active*

> Space · Talk to {talker.name}

Placeholders: `talker.name`  
Example: "Space · Talk to Pikachu"

- `src/ui/matchScreen.ts:2170` · return · when `talker.role === 'breeder' ?`

**T36CA45** · UI · *active*

> Space · Pick up

- `src/ui/matchScreen.ts:2173` · return · when `if (this.match.nearestItem())`

**TAC6E24** · UI · *active*

> Space · Fish ({ITEMS[bestRod(this.match.player) ?? '']?.name ?? 'rod'})

Placeholders: `ITEMS[bestRod(this.match.player) ?? '']?.name ?? 'rod'`  
Example: "Space · Fish (Pikachu)"

- `src/ui/matchScreen.ts:2174` · return · when `if (canFish(this.match))`

**TA7D1FC** · UI · *active*

> Space · Shop at the {s.shop.name}

Placeholders: `s.shop.name`  
Example: "Space · Shop at the Pikachu"

- `src/ui/matchScreen.ts:2177` · return · when `if (s.kind === 'shop')`

**TBB31A8** · UI · *active*

> Space · Challenge the {SHOPS.challenger.name}

Placeholders: `SHOPS.challenger.name`  
Example: "Space · Challenge the Pikachu"

- `src/ui/matchScreen.ts:2178` · return · when `if (s.kind === 'challenge')`

**T6EC897** · UI · *active*

> Space · Open your storage chest

- `src/ui/matchScreen.ts:2179` · return · when `if (s.kind === 'chest')`

**T4F129C** · UI · *active*

> Space · Heal your party

- `src/ui/matchScreen.ts:2180` · return · when `in servicePrompt()`

**T84ACE1** · UI · *active*

> Hoopa (Space to talk)

- `src/ui/matchScreen.ts:2512` · drawInfoBar · when `if (m.npc === 'hoopa')`

## 6. NPC dialogue: townsfolk, the Breeder, visitors, healers, the challenger

105 lines.

**T0A8A5D** · Game data · *active*

> Player Ranger

- `data/characters.json` · role player: name

**TB2A943** · Game data · *active*

> Rook

- `data/characters.json` · role trainer_a: name

**T610068** · Game data · *active*

> Marlo

- `data/characters.json` · role trainer_b: name

**T16BCB6** · Game data · *active*

> Ranger Union host

- `data/characters.json` · role host: name

**TB04B1E** · Game data · *active*

> Team Dim Sun Grunt (placeholder)

- `data/characters.json` · role grunt: name

**TE32092** · Game data · *active*

> Wynne

- `data/characters.json` · role trainer_c: name

**TB54CB7** · Game data · *active*

> Brigg

- `data/characters.json` · role trainer_d: name

**T5AA898** · Game data · *active*

> Tamsin

- `data/characters.json` · role trainer_e: name

**TDB6A30** · Game data · *active*

> Dale

- `data/characters.json` · role trainer_f: name

**T7F5F3C** · Game data · *active*

> Nurse

- `data/characters.json` · role healer: name

**TD96159** · Game data · *active*

> Vendor

- `data/characters.json` · role vendor_a: name

**T8226D4** · Game data · *active*

> Juniper

- `data/characters.json` · role trainer_g: name

**T4319AE** · Game data · *active*

> Townsperson

- `data/characters.json` · role villager_a: name

**TCECF56** · Game data · *active*

> Ranger Instructor

- `data/characters.json` · role villager_h: name

**T87DCAE** · Game data · *active*

> Breeder

- `data/characters.json` · role breeder: name

**T1F882B** · Game data · *active*

> Wandering Girl

- `data/characters.json` · role disguise: name
- `data/spawns.json` · event zoroark: name

**TAAABAD** · Game data · *active*

> Castle Champion

- `data/shops.json` · challenger.name
- `data/characters.json` · role challenger: name

**T6244E3** · Townsfolk, the Breeder or the wandering stranger · *active*

> Youngster Cole

- `src/sim/townsfolk.ts:23` · name:

**T21E78D** · Townsfolk, the Breeder or the wandering stranger · *active*

> My Bidoof could beat your whole team! ...Okay, maybe not. But he tries really hard!

- `src/sim/townsfolk.ts:24` · lines:

**T40498A** · Townsfolk, the Breeder or the wandering stranger · *active*

> Keep two Pokémon out and the second one watches your back. I learned that the hard way.

- `src/sim/townsfolk.ts:25` · lines:

**TCDF21F** · Townsfolk, the Breeder or the wandering stranger · *active*

> Shorts are comfy and all, but nobody warns you about running from an Alpha in them.

- `src/sim/townsfolk.ts:26` · lines:

**T2A9C7A** · Townsfolk, the Breeder or the wandering stranger · *active*

> Old Fisherman Walt

- `src/sim/townsfolk.ts:30` · name:

**TAE5B79** · Townsfolk, the Breeder or the wandering stranger · *active*

> Sixty years I fished these waters. The lake out east still gives me the shivers.

- `src/sim/townsfolk.ts:31` · lines:

**T90B81E** · Townsfolk, the Breeder or the wandering stranger · *active*

> Some nights the black water goes still, like it's holding its breath. Don't ask me what for.

- `src/sim/townsfolk.ts:32` · lines:

**T25F9A3** · Townsfolk, the Breeder or the wandering stranger · *active*

> A Super Rod isn't about the fish you can catch. It's about the fish you shouldn't.

- `src/sim/townsfolk.ts:33` · lines:

**T07ABEE** · Townsfolk, the Breeder or the wandering stranger · *active*

> Hiker Bruno

- `src/sim/townsfolk.ts:37` · name:

**T4A3ADE** · Townsfolk, the Breeder or the wandering stranger · *active*

> I hiked all five lands in one day! My knees would like a word with whoever built those stairs.

- `src/sim/townsfolk.ts:38` · lines:

**T134504** · Townsfolk, the Breeder or the wandering stranger · *active*

> Snow, sand, leaves, grass: every Pokémon has its ground. Hunt where your target lives.

- `src/sim/townsfolk.ts:39` · lines:

**T8194BA** · Townsfolk, the Breeder or the wandering stranger · *active*

> Lass Marina

- `src/sim/townsfolk.ts:43` · name:

**T99A4F3** · Townsfolk, the Breeder or the wandering stranger · *active*

> I counted the ducks on the summit lake. It is never the same number twice. NEVER.

- `src/sim/townsfolk.ts:44` · lines:

**T741E27** · Townsfolk, the Breeder or the wandering stranger · *active*

> A boy told me golden rings open in the sky when nobody looks. He also eats sand, so who knows.

- `src/sim/townsfolk.ts:45` · lines:

**T9539DA** · Townsfolk, the Breeder or the wandering stranger · *active*

> Instructor Hale

- `src/sim/townsfolk.ts:49` · name:

**TE719C1** · Townsfolk, the Breeder or the wandering stranger · *active*

> A worn-down Pokémon goes calm sooner or later. That calm moment is when a ball truly counts.

- `src/sim/townsfolk.ts:50` · lines:

**TE830A8** · Townsfolk, the Breeder or the wandering stranger · *active*

> Auto-battle is fine for walking. For a real fight, take the controls yourself. R, trainer. R.

- `src/sim/townsfolk.ts:51` · lines:

**TD389B2** · Townsfolk, the Breeder or the wandering stranger · *active*

> Your party heals free at any outpost. Dying because you were too proud to walk there is a choice.

- `src/sim/townsfolk.ts:52` · lines:

**T1BA094** · Townsfolk, the Breeder or the wandering stranger · *active*

> Gravekeeper Morrow

- `src/sim/townsfolk.ts:56` · name:

**TA05DE9** · Townsfolk, the Breeder or the wandering stranger · *active*

> These graves are older than the Union. Older than the castle. Mind your step after dark.

- `src/sim/townsfolk.ts:57` · lines:

**TEE1A36** · Townsfolk, the Breeder or the wandering stranger · *active*

> When the storm swallows the island, I see shapes walking in it that have no owner.

- `src/sim/townsfolk.ts:58` · lines:

**T962755** · Townsfolk, the Breeder or the wandering stranger · *active*

> Scholar Imani

- `src/sim/townsfolk.ts:62` · name:

**TDB7CA6** · Townsfolk, the Breeder or the wandering stranger · *active*

> The Shadow Crystal holds the night at bay. One old text calls it 'the lid on a bad dream'.

- `src/sim/townsfolk.ts:63` · lines:

**TD0978B** · Townsfolk, the Breeder or the wandering stranger · *active*

> The crystal pulses and the dark creeps closer each time. Watch the ring on your map, not the sky.

- `src/sim/townsfolk.ts:64` · lines:

**T73EE9B** · Townsfolk, the Breeder or the wandering stranger · *active*

> Chef Porcini

- `src/sim/townsfolk.ts:68` · name:

**TB87F47** · Townsfolk, the Breeder or the wandering stranger · *active*

> I came here to open a restaurant. My only customers are Pidgey. They do not tip.

- `src/sim/townsfolk.ts:69` · lines:

**T4F67C5** · Townsfolk, the Breeder or the wandering stranger · *active*

> You'd think a battle royale would be good for business. Everyone is too busy to eat!

- `src/sim/townsfolk.ts:70` · lines:

**TD4D5DB** · Townsfolk, the Breeder or the wandering stranger · *active*

> Gambler Dice

- `src/sim/townsfolk.ts:74` · name:

**TD08BAF** · Townsfolk, the Breeder or the wandering stranger · *active*

> Every storage chest on this island remembers you between matches. I keep my winnings in one. And my losses.

- `src/sim/townsfolk.ts:75` · lines:

**T3BF7B7** · Townsfolk, the Breeder or the wandering stranger · *active*

> One in five hundred. Those are shiny odds. I've beaten worse, friend. I've also lost to better.

- `src/sim/townsfolk.ts:76` · lines:

**T8E1640** · Townsfolk, the Breeder or the wandering stranger · *active*

> Veteran Sarge

- `src/sim/townsfolk.ts:80` · name:

**TF2FD3E** · Townsfolk, the Breeder or the wandering stranger · *active*

> Snag Machine rule one: wear the dark ones down under ten percent, THEN fire. Rule two: see rule one.

- `src/sim/townsfolk.ts:81` · lines:

**T52D40C** · Townsfolk, the Breeder or the wandering stranger · *active*

> I was at the first showdown. Back then the storm was just weather. Now it hunts.

- `src/sim/townsfolk.ts:82` · lines:

**T6CABFF** · Townsfolk, the Breeder or the wandering stranger · *active*

> Poké Maniac Gus

- `src/sim/townsfolk.ts:86` · name:

**TE6846C** · Townsfolk, the Breeder or the wandering stranger · *active*

> I collect Pokémon shaped like balls. Voltorb, Jigglypuff, Marill... my collection ROLLS.

- `src/sim/townsfolk.ts:87` · lines:

**TF74D86** · Townsfolk, the Breeder or the wandering stranger · *active*

> An Electrode beat me at hide and seek once. Round object. Flat field. Explain THAT.

- `src/sim/townsfolk.ts:88` · lines:

**TAFEA1E** · Townsfolk, the Breeder or the wandering stranger · *active*

> Swimmer Lena

- `src/sim/townsfolk.ts:92` · name:

**T7E773E** · Townsfolk, the Breeder or the wandering stranger · *active*

> They say Latios will carry a trainer he trusts. The sky, the spray, the speed... imagine it.

- `src/sim/townsfolk.ts:93` · lines:

**T131F90** · Townsfolk, the Breeder or the wandering stranger · *active*

> I swim everywhere. Piers are for people who fear fun.

- `src/sim/townsfolk.ts:94` · lines:

**T491B42** · Townsfolk, the Breeder or the wandering stranger · *active*

> Blacksmith Orin

- `src/sim/townsfolk.ts:98` · name:

**T11426F** · Townsfolk, the Breeder or the wandering stranger · *active*

> I shape quarry ore into charms. The crystal ones hum at night. I stopped asking why.

- `src/sim/townsfolk.ts:99` · lines:

**T41AB1A** · Townsfolk, the Breeder or the wandering stranger · *active*

> Evolution stones turn up in the town stalls. Each town stocks its own, so check them all.

- `src/sim/townsfolk.ts:100` · lines:

**T8FC1E7** · Townsfolk, the Breeder or the wandering stranger · *active*

> Mystic Vela

- `src/sim/townsfolk.ts:104` · name:

**T137529** · Townsfolk, the Breeder or the wandering stranger · *active*

> I read fortunes. Yours says 'beware the final two'. That will be 200 Poké Dollars.

- `src/sim/townsfolk.ts:105` · lines:

**T593D4F** · Townsfolk, the Breeder or the wandering stranger · *active*

> The darkness does not close in to kill you, dear. It closes in to WAKE something.

- `src/sim/townsfolk.ts:106` · lines:

**T4772EB** · Townsfolk, the Breeder or the wandering stranger · *active*

> Tourist Chad

- `src/sim/townsfolk.ts:110` · name:

**T8A53E9** · Townsfolk, the Breeder or the wandering stranger · *active*

> Back home we don't have giant storms or ghost whales. We have a mall. This is better.

- `src/sim/townsfolk.ts:111` · lines:

**T61D551** · Townsfolk, the Breeder or the wandering stranger · *active*

> I asked a Ranger where the gift shop is. Still waiting on that answer.

- `src/sim/townsfolk.ts:112` · lines:

**TF739D7** · Townsfolk, the Breeder or the wandering stranger · *active*

> Picnicker June

- `src/sim/townsfolk.ts:116` · name:

**TAE3645** · Townsfolk, the Breeder or the wandering stranger · *active*

> I set out six sandwiches and turned my back for ONE second. Six Pidgey. Zero sandwiches.

- `src/sim/townsfolk.ts:117` · lines:

**TBD9E9D** · Townsfolk, the Breeder or the wandering stranger · *active*

> Stock potions before you pick fights. The healer cannot reach you mid-battle, friend.

- `src/sim/townsfolk.ts:118` · lines:

**TA077D6** · Townsfolk, the Breeder or the wandering stranger · *active*

> Breeder Maribel

- `src/sim/townsfolk.ts:193` · m.makeTrainer · when `if (s)`
- `src/sim/townsfolk.ts:195` · name: · when `if (s)`

**TC953F6** · Townsfolk, the Breeder or the wandering stranger · *active*

> The girl's outline flickers... It was {shiny ? 'a shiny ' : ''}Zoroark all along!

Placeholders: `shiny ? 'a shiny ' : ''`  
Example: "The girl's outline flickers... It was …Zoroark all along!"

- `src/sim/townsfolk.ts:276` · m.noticeFor · when `in revealZoroark()`

**T3456AE** · Townsfolk, the Breeder or the wandering stranger · *active*

> a shiny 

- `src/sim/townsfolk.ts:276` · m.noticeFor · when `shiny ?`

**T09893B** · Townsfolk, the Breeder or the wandering stranger · *active*

> Breeder Maribel: "Take good care of that Egg now. Keep walking with it and it'll hatch."

- `src/sim/townsfolk.ts:284` · return · when `if (this.traded.has(p.id))`

**T7DBEF8** · Townsfolk, the Breeder or the wandering stranger · *active*

> Breeder Maribel: "If you bring me a {wantName}, I'll trade you an Egg from my best stock. A real mystery, straight from the ranch!"

Placeholders: `wantName`  
Example: "Breeder Maribel: "If you bring me a Pikachu, I'll trade you an Egg from my best stock. A real mystery, straight from the ranch!""

- `src/sim/townsfolk.ts:287` · return · when `if (idx < 0)`

**TDB982B** · Townsfolk, the Breeder or the wandering stranger · *active*

> Breeder Maribel: "Finish your battle first, dear."

- `src/sim/townsfolk.ts:290` · return · when `if (p.duelId)`

**TD6FBC7** · Townsfolk, the Breeder or the wandering stranger · *active*

> Breeder Maribel: "A {wantName}! Marvelous! Here, one Egg. Keep walking with it and it'll hatch."

Placeholders: `wantName`  
Example: "Breeder Maribel: "A Pikachu! Marvelous! Here, one Egg. Keep walking with it and it'll hatch.""

- `src/sim/townsfolk.ts:304` · return · when `in talkBreeder()`

**T9E147A** · Townsfolk, the Breeder or the wandering stranger · *active*

> The Egg hatched into {baby.name}, but your party is full! It leaves you an Extraction Voucher

Placeholders: `baby.name`  
Example: "The Egg hatched into Pikachu, but your party is full! It leaves you an Extraction Voucher"

- `src/sim/townsfolk.ts:345` · m.noticeFor · when `if (partySize(t) >= m.partyCap)`

**TC08BFB** · Townsfolk, the Breeder or the wandering stranger · *active*

> Oh? The Egg is glowing... the Mythical {baby.name} hatched from it!

Placeholders: `baby.name`  
Example: "Oh? The Egg is glowing... the Mythical Pikachu hatched from it!"

- `src/sim/townsfolk.ts:351` · m.noticeFor · when `inside.mythical ?`

**T543B22** · Townsfolk, the Breeder or the wandering stranger · *active*

> Oh? The Egg is hatching... {baby.name} hatched from the Egg!

Placeholders: `baby.name`  
Example: "Oh? The Egg is hatching... Pikachu hatched from the Egg!"

- `src/sim/townsfolk.ts:351` · m.noticeFor · when `inside.mythical ?`

**TC36E67** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Wandering Merchant

- `src/sim/visitors.ts:126` · m.makeTrainer
- `src/sim/visitors.ts:132` · name:
- `src/ui/matchScreen.ts:2559` · name = · when `n.role === 'merchant' ?`
- `data/characters.json` · role merchant: name

**TAEBEB5** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Ace Trainer Celeste

- `src/sim/visitors.ts:136` · m.makeTrainer
- `src/sim/visitors.ts:308` · m.makeTrainer · when `in challengeAce()`
- `src/ui/matchScreen.ts:2559` · name = · when `n.role === 'merchant' ?`
- `data/characters.json` · role ace: name

**T1B15F9** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> A Wandering Merchant is nearby: rare items for sale (Space to shop)

- `src/sim/visitors.ts:190` · announce · when `if (this.merchant)`

**TEE72DF** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Ace Trainer Celeste is looking for a challenge (Space to battle)

- `src/sim/visitors.ts:191` · announce · when `if (this.ace && this.aceState === 'idle')`

**T4DD401** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa is floating nearby, giggling... (Space to talk)

- `src/sim/visitors.ts:192` · announce · when `if (this.hoopa && !this.hoopaUsed)`

**TF4CE5A** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> A Pokémon Breeder is wandering nearby, hoping to trade an Egg... (Space to talk)

- `src/sim/visitors.ts:197` · announce · when `if (this.folk.breeder)`

**TF80B7F** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste: "Catch your breath first. {Math.ceil(this.aceReadyAt - m.time)}s."

Placeholders: `Math.ceil(this.aceReadyAt - m.time)`  
Example: "Celeste: "Catch your breath first. 45s.""

- `src/sim/visitors.ts:304` · return · when `if (m.time < this.aceReadyAt)`

**TF97899** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste: "Come back with a Pokémon that can fight."

- `src/sim/visitors.ts:306` · return · when `if (!activeParty(m.player).length)`

**TBEEF7D** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste: "Let's see if you're worth my best!" (Lv {lvl})

Placeholders: `lvl`  
Example: "Celeste: "Let's see if you're worth my best!" (Lv …)"

- `src/sim/visitors.ts:323` · return · when `in challengeAce()`

**T9953F4** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa: "Out here in the storm? Let's see what the dark is hiding!" A black ring tears open...

- `src/sim/visitors.ts:351` · return · when `if (storm)`

**T7AA6AB** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa: "Ta-da! Want to see something AMAZING?" A ring portal opens!

- `src/sim/visitors.ts:352` · return · when `in askHoopa()`

**T40C203** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa: "Hey! Quit it!"

- `src/sim/visitors.ts:424` · text = · when `this.hoopaHits === 1 ?`

**T64AB5F** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa: "One more and you'll be sorry!"

- `src/sim/visitors.ts:424` · text = · when `this.hoopaHits === 1 ?`

**T6CEA33** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa: "That HURT! Fine... no more holding back!" Hoopa is unbound!

- `src/sim/visitors.ts:445` · text: · when `in unbind()`

**T665C28** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa Unbound (Lv 100) battles you! Wear it down or catch it

- `src/sim/visitors.ts:448` · text: · when `bout ?`

**T317F04** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Hoopa Unbound (Lv 100) is loose!

- `src/sim/visitors.ts:448` · text: · when `bout ?`

**T909695** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> You hooked it... the black lake heaves!

- `src/sim/visitors.ts:544` · text: · when `shadow ?`

**T0978D8** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Something huge took the bait... Tide Lake churns!

- `src/sim/visitors.ts:544` · text: · when `shadow ?`

**T7F9CE3** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> SHADOW LUGIA rises from the storm-black lake!

- `src/sim/visitors.ts:566` · text: · when `s.shadow ?`

**TCC8B2C** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Lugia bursts out of the lake!

- `src/sim/visitors.ts:566` · text: · when `s.shadow ?`

**T0E24BE** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Shadow Lugia circles over the shore, waiting for you...

- `src/sim/visitors.ts:583` · text: · when `if (s.shadow && !bout)`

**TCA6BD7** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Shadow Lugia sank back into the black water...

- `src/sim/visitors.ts:594` · text: · when `if (!m.player.alive \|\| m.finalStarted \|\| s.t > 30 \|\| L.fainted \|\| L.captured)`

**TC11496** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Balls will bounce off it. Wear it under 10% HP, then use your Snag Machine!

- `src/sim/visitors.ts:612` · text: · when `snag ?`

**TC73CB4** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Balls bounce off it, and you have no Snag Machine... survive if you can!

- `src/sim/visitors.ts:612` · text: · when `snag ?`

**T36C94F** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste: "Your team is full? Then take this." An Extraction Voucher and ₽2000!

- `src/sim/visitors.ts:681` · text: · when `if (partySize(pl) >= m.partyCap)`

**T12D14B** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste: "You earned this." She gives you a shiny {prize.name}!

Placeholders: `prize.name`  
Example: "Celeste: "You earned this." She gives you a shiny Pikachu!"

- `src/sim/visitors.ts:686` · text: · when `if (partySize(pl) >= m.partyCap)`

**T9CD13E** · A visitor (merchant, Celeste, Hoopa, the ace trainer) · *active*

> Celeste wins this one. She patched your Pokémon up. Try again in a minute

- `src/sim/visitors.ts:701` · text: · when `if (won)`

## 7. Shops, items, TMs and fishing

182 lines.

**T3D3739** · Screen text · *active*

> Ball

- `data/items/items.json` · item poke-ball: short label

**T280BC9** · Game data · *active*

> Catch rate x1

- `data/items/items.json` · item poke-ball: description

**T27A44A** · Game data · *active*

> Great Ball

- `data/items/items.json` · item great-ball: name

**TBD846A** · Screen text · *active*

> Great

- `data/items/items.json` · item great-ball: short label

**T4BD9AB** · Game data · *active*

> Catch rate x1.5

- `data/items/items.json` · item great-ball: description

**TF67FE6** · Game data · *active*

> Ultra Ball

- `data/items/items.json` · item ultra-ball: name

**T50050D** · Screen text · *active*

> Ultra

- `data/items/items.json` · item ultra-ball: short label

**T70A9C7** · Game data · *active*

> Catch rate x2

- `data/items/items.json` · item ultra-ball: description

**TE1CAD5** · Game data · *active*

> Master Ball

- `data/items/items.json` · item master-ball: name

**T78F384** · Screen text · *active*

> Master

- `data/items/items.json` · item master-ball: short label

**T783747** · Game data · *active*

> Never fails

- `data/items/items.json` · item master-ball: description

**T35554C** · Game data · *legacy*

> Net Ball

- `data/items/items.json` · item net-ball: name

**T9BB81C** · Screen text · *legacy*

> Net

- `data/items/items.json` · item net-ball: short label

**TC1D2F9** · Game data · *legacy*

> x3 on Bug and Water Pokémon

- `data/items/items.json` · item net-ball: description

**TD00556** · Game data · *legacy*

> Dusk Ball

- `data/items/items.json` · item dusk-ball: name

**T4DB13A** · Screen text · *legacy*

> Dusk

- `data/items/items.json` · item dusk-ball: short label

**T772545** · Game data · *legacy*

> x3 inside the darkness

- `data/items/items.json` · item dusk-ball: description

**T9D27D5** · Game data · *active*

> Quick Ball

- `data/items/items.json` · item quick-ball: name

**T7EF6F2** · Screen text · *active*

> Quick

- `data/items/items.json` · item quick-ball: short label

**TF389E9** · Game data · *active*

> x5 if thrown before it has been attacked

- `data/items/items.json` · item quick-ball: description

**T5F4632** · Game data · *active*

> Potion

- `data/items/items.json` · item potion: name

**T5480FB** · Game data · *active*

> Super Potion

- `data/items/items.json` · item super-potion: name

**TD0670D** · Screen text · *active*

> S.Potion

- `data/items/items.json` · item super-potion: short label

**T2E08BB** · Game data · *active*

> Revive

- `data/items/items.json` · item revive: name

**T36CFDB** · Game data · *active*

> Max Revive

- `data/items/items.json` · item max-revive: name

**TA25B46** · Screen text · *active*

> MaxRev

- `data/items/items.json` · item max-revive: short label

**T79DFEB** · Game data · *active*

> Leftovers

- `data/items/items.json` · item leftovers: name

**T042813** · Screen text · *active*

> Leftovrs

- `data/items/items.json` · item leftovers: short label

**T34EDDD** · Game data · *active*

> Holder heals 1/16 of its HP every 3 s (also while waiting in its ball)

- `data/items/items.json` · item leftovers: description

**T3039B0** · Game data · *active*

> Focus Sash

- `data/items/items.json` · item focus-sash: name

**T94D2D8** · Screen text · *active*

> Sash

- `data/items/items.json` · item focus-sash: short label

**TDEAA57** · Game data · *active*

> From full HP, holder survives one knockout blow with 1 HP (used up)

- `data/items/items.json` · item focus-sash: description

**T5863B9** · Game data · *active*

> Storm Mask

- `data/items/items.json` · item storm-mask: name

**T8AADF1** · Screen text · *active*

> Mask

- `data/items/items.json` · item storm-mask: short label

**TEE6974** · Game data · *active*

> Works from the bag: your Pokémon last 2 minutes in the storm before falling asleep

- `data/items/items.json` · item storm-mask: description

**T7A6290** · Game data · *active*

> Capture Styler

- `data/items/items.json` · item styler: name

**T3283A5** · Screen text · *active*

> Styler

- `data/items/items.json` · item styler: short label

**T6FF71E** · Game data · *active*

> Works from the bag: hold C and draw loops round a wild Pokémon to calm it (calmed ones stop fighting and are far easier to catch)

- `data/items/items.json` · item styler: description

**TD7D9D9** · Game data · *active*

> Snag Machine

- `data/items/items.json` · item capture-styler: name

**T908697** · Screen text · *active*

> Snag

- `data/items/items.json` · item capture-styler: short label

**T71C6CA** · Game data · *active*

> Beat a trainer to take one of their Pokémon (or use it by a rival's fainted Pokémon)

- `data/items/items.json` · item capture-styler: description

**TCED4C5** · Game data · *active*

> Hyper Potion

- `data/items/items.json` · item hyper-potion: name

**T0D6B0F** · Screen text · *active*

> H.Potion

- `data/items/items.json` · item hyper-potion: short label

**TB2889D** · Game data · *active*

> Choice Band

- `data/items/items.json` · item choice-band: name

**T352C8C** · Screen text · *active*

> Ch.Band

- `data/items/items.json` · item choice-band: short label

**T1D732D** · Game data · *active*

> Holder's physical moves deal 1.5x damage

- `data/items/items.json` · item choice-band: description

**T20FE07** · Game data · *active*

> Life Orb

- `data/items/items.json` · item life-orb: name

**T411654** · Game data · *active*

> Holder's attacks deal 1.3x damage; each move it uses costs it 10% of its HP

- `data/items/items.json` · item life-orb: description

**TC81E2A** · Game data · *active*

> Charcoal

- `data/items/items.json` · item charcoal: name

**TE4C856** · Game data · *active*

> Holder's Fire-type moves deal 1.2x damage

- `data/items/items.json` · item charcoal: description

**T477618** · Game data · *active*

> Mystic Water

- `data/items/items.json` · item mystic-water: name

**T270A81** · Screen text · *active*

> M.Water

- `data/items/items.json` · item mystic-water: short label

**TD5C266** · Game data · *active*

> Holder's Water-type moves deal 1.2x damage

- `data/items/items.json` · item mystic-water: description

**TD7F87F** · Game data · *active*

> Magnet

- `data/items/items.json` · item magnet: name

**T9D5093** · Game data · *active*

> Holder's Electric-type moves deal 1.2x damage

- `data/items/items.json` · item magnet: description

**T714997** · Game data · *active*

> Miracle Seed

- `data/items/items.json` · item miracle-seed: name

**TC35B71** · Screen text · *active*

> M.Seed

- `data/items/items.json` · item miracle-seed: short label

**TDB0868** · Game data · *active*

> Holder's Grass-type moves deal 1.2x damage

- `data/items/items.json` · item miracle-seed: description

**T5DBD66** · Game data · *active*

> NeverMeltIce

- `data/items/items.json` · item never-melt-ice: name

**TF8837B** · Screen text · *active*

> N.M.Ice

- `data/items/items.json` · item never-melt-ice: short label

**TA7F1AD** · Game data · *active*

> Holder's Ice-type moves deal 1.2x damage

- `data/items/items.json` · item never-melt-ice: description

**T5A2271** · Game data · *active*

> Black Belt

- `data/items/items.json` · item black-belt: name

**TA6FE35** · Screen text · *active*

> B.Belt

- `data/items/items.json` · item black-belt: short label

**TC225CB** · Game data · *active*

> Holder's Fighting-type moves deal 1.2x damage

- `data/items/items.json` · item black-belt: description

**T7EEF92** · Game data · *active*

> Soft Sand

- `data/items/items.json` · item soft-sand: name

**TE090B4** · Screen text · *active*

> S.Sand

- `data/items/items.json` · item soft-sand: short label

**T76DACC** · Game data · *active*

> Holder's Ground-type moves deal 1.2x damage

- `data/items/items.json` · item soft-sand: description

**TAC21A7** · Game data · *active*

> Sharp Beak

- `data/items/items.json` · item sharp-beak: name

**TDC37D6** · Screen text · *active*

> S.Beak

- `data/items/items.json` · item sharp-beak: short label

**T306751** · Game data · *active*

> Holder's Flying-type moves deal 1.2x damage

- `data/items/items.json` · item sharp-beak: description

**TF7A087** · Game data · *active*

> TwistedSpoon

- `data/items/items.json` · item twisted-spoon: name

**TD1E8D4** · Screen text · *active*

> T.Spoon

- `data/items/items.json` · item twisted-spoon: short label

**TCC23E5** · Game data · *active*

> Holder's Psychic-type moves deal 1.2x damage

- `data/items/items.json` · item twisted-spoon: description

**T761BE0** · Game data · *active*

> Poison Barb

- `data/items/items.json` · item poison-barb: name

**T2EEC6B** · Screen text · *active*

> P.Barb

- `data/items/items.json` · item poison-barb: short label

**T144CB1** · Game data · *active*

> Holder's Poison-type moves deal 1.2x damage

- `data/items/items.json` · item poison-barb: description

**T10A15F** · Game data · *active*

> Hard Stone

- `data/items/items.json` · item hard-stone: name

**TE7BFC6** · Screen text · *active*

> H.Stone

- `data/items/items.json` · item hard-stone: short label

**TEDEF0A** · Game data · *active*

> Holder's Rock-type moves deal 1.2x damage

- `data/items/items.json` · item hard-stone: description

**T903FA4** · Game data · *active*

> Spell Tag

- `data/items/items.json` · item spell-tag: name

**T715278** · Screen text · *active*

> S.Tag

- `data/items/items.json` · item spell-tag: short label

**TFC94F3** · Game data · *active*

> Holder's Ghost-type moves deal 1.2x damage

- `data/items/items.json` · item spell-tag: description

**TAB92C0** · Game data · *active*

> Dragon Fang

- `data/items/items.json` · item dragon-fang: name

**T28B81A** · Screen text · *active*

> D.Fang

- `data/items/items.json` · item dragon-fang: short label

**T73F76E** · Game data · *active*

> Holder's Dragon-type moves deal 1.2x damage

- `data/items/items.json` · item dragon-fang: description

**TD13166** · Game data · *active*

> BlackGlasses

- `data/items/items.json` · item black-glasses: name

**T03D2A7** · Screen text · *active*

> B.Glass

- `data/items/items.json` · item black-glasses: short label

**TE4E64B** · Game data · *active*

> Holder's Dark-type moves deal 1.2x damage

- `data/items/items.json` · item black-glasses: description

**T92B011** · Game data · *active*

> Metal Coat

- `data/items/items.json` · item metal-coat: name

**TECE791** · Screen text · *active*

> M.Coat

- `data/items/items.json` · item metal-coat: short label

**T55907B** · Game data · *active*

> Holder's Steel-type moves deal 1.2x damage

- `data/items/items.json` · item metal-coat: description

**T79B5FD** · Game data · *active*

> Silk Scarf

- `data/items/items.json` · item silk-scarf: name

**T6A161D** · Screen text · *active*

> S.Scarf

- `data/items/items.json` · item silk-scarf: short label

**T5A0DFF** · Game data · *active*

> Holder's Normal-type moves deal 1.2x damage

- `data/items/items.json` · item silk-scarf: description

**T785F61** · Game data · *active*

> Rare Candy

- `data/items/items.json` · item rare-candy: name

**TDBFFDF** · Screen text · *active*

> Candy

- `data/items/items.json` · item rare-candy: short label

**T58B105** · Game data · *active*

> Your lead gains a level

- `data/items/items.json` · item rare-candy: description

**TAB9E50** · Game data · *active*

> Exp. Share

- `data/items/items.json` · item exp-share: name

**T9E76DB** · Screen text · *active*

> Exp.Sh

- `data/items/items.json` · item exp-share: short label

**TB654ED** · Game data · *active*

> Holder gets full XP from its team's knockouts, even waiting in its ball

- `data/items/items.json` · item exp-share: description

**T623EC5** · Game data · *active*

> Lucky Egg

- `data/items/items.json` · item lucky-egg: name

**T57E37D** · Screen text · *active*

> L.Egg

- `data/items/items.json` · item lucky-egg: short label

**T1BC20A** · Game data · *active*

> Holder gains 1.5x XP

- `data/items/items.json` · item lucky-egg: description

**T9E90BE** · Game data · *active*

> Fire Stone

- `data/items/items.json` · item fire-stone: name

**TA293E4** · Screen text · *active*

> Fire St.

- `data/items/items.json` · item fire-stone: short label

**T3B791A** · Game data · *active*

> Evolves certain Pokémon

- `data/items/items.json` · item fire-stone: description

**TF1225A** · Game data · *active*

> Water Stone

- `data/items/items.json` · item water-stone: name

**TE4C2DE** · Screen text · *active*

> Water St.

- `data/items/items.json` · item water-stone: short label

**T941647** · Game data · *active*

> Thunder Stone

- `data/items/items.json` · item thunder-stone: name

**T41BAC6** · Screen text · *active*

> Thndr St.

- `data/items/items.json` · item thunder-stone: short label

**TF1FF0B** · Game data · *active*

> Leaf Stone

- `data/items/items.json` · item leaf-stone: name

**T067C5C** · Screen text · *active*

> Leaf St.

- `data/items/items.json` · item leaf-stone: short label

**T5388F2** · Game data · *active*

> Ice Stone

- `data/items/items.json` · item ice-stone: name

**T62178B** · Screen text · *active*

> Ice St.

- `data/items/items.json` · item ice-stone: short label

**T32D114** · Game data · *active*

> Moon Stone

- `data/items/items.json` · item moon-stone: name

**T61701F** · Screen text · *active*

> Moon St.

- `data/items/items.json` · item moon-stone: short label

**T6BB26E** · Game data · *active*

> Sun Stone

- `data/items/items.json` · item sun-stone: name

**TDB0837** · Screen text · *active*

> Sun St.

- `data/items/items.json` · item sun-stone: short label

**TDEA5EB** · Game data · *active*

> Shiny Stone

- `data/items/items.json` · item shiny-stone: name

**TB22D78** · Screen text · *active*

> Shiny St.

- `data/items/items.json` · item shiny-stone: short label

**TACA4DC** · Game data · *active*

> Dusk Stone

- `data/items/items.json` · item dusk-stone: name

**T8A9521** · Screen text · *active*

> Dusk St.

- `data/items/items.json` · item dusk-stone: short label

**T367264** · Game data · *active*

> Dawn Stone

- `data/items/items.json` · item dawn-stone: name

**T06F5F5** · Screen text · *active*

> Dawn St.

- `data/items/items.json` · item dawn-stone: short label

**T409CA9** · Screen text · *active*

> Voucher

- `data/items/items.json` · item extraction-voucher: short label

**TDBCC09** · Game data · *active*

> Sends one Pokémon from your party to your PC for keeps (it leaves the match)

- `data/items/items.json` · item extraction-voucher: description

**T71763F** · Game data · *active*

> Charizardite X

- `data/items/items.json` · item charizardite-x: name

**T6DA3F6** · Screen text · *active*

> Charizar

- `data/items/items.json` · item charizardite-x: short label

**TC49F5D** · Game data · *active*

> Held by Charizard: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item charizardite-x: description

**T207032** · Game data · *active*

> Gengarite

- `data/items/items.json` · item gengarite: name

**T9ABD42** · Screen text · *active*

> Gengarit

- `data/items/items.json` · item gengarite: short label

**TE511A9** · Game data · *active*

> Held by Gengar: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item gengarite: description

**T378210** · Game data · *active*

> Steelixite

- `data/items/items.json` · item steelixite: name

**T85B646** · Screen text · *active*

> Steelixi

- `data/items/items.json` · item steelixite: short label

**TBEE222** · Game data · *active*

> Held by Steelix: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item steelixite: description

**TB08DB1** · Game data · *active*

> Tyranitarite

- `data/items/items.json` · item tyranitarite: name

**T4C72CE** · Screen text · *active*

> Tyranita

- `data/items/items.json` · item tyranitarite: short label

**T31E9A7** · Game data · *active*

> Held by Tyranitar: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item tyranitarite: description

**TB40FA5** · Game data · *active*

> Gardevoirite

- `data/items/items.json` · item gardevoirite: name

**T4C8790** · Screen text · *active*

> Gardevoi

- `data/items/items.json` · item gardevoirite: short label

**T5DCE3C** · Game data · *active*

> Held by Gardevoir: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item gardevoirite: description

**T873169** · Game data · *active*

> Absolite

- `data/items/items.json` · item absolite: name

**T234A4D** · Game data · *active*

> Held by Absol: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item absolite: description

**T33BC59** · Game data · *active*

> Glalitite

- `data/items/items.json` · item glalitite: name

**T723B16** · Screen text · *active*

> Glalitit

- `data/items/items.json` · item glalitite: short label

**T80514B** · Game data · *active*

> Held by Glalie: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item glalitite: description

**T4B8942** · Game data · *active*

> Latiosite

- `data/items/items.json` · item latiosite: name

**T368807** · Screen text · *active*

> Latiosit

- `data/items/items.json` · item latiosite: short label

**T54E0DD** · Game data · *active*

> Held by Latios: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item latiosite: description

**TE30CE5** · Game data · *active*

> Lucarionite

- `data/items/items.json` · item lucarionite: name

**T23272F** · Screen text · *active*

> Lucarion

- `data/items/items.json` · item lucarionite: short label

**TD33904** · Game data · *active*

> Held by Lucario: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item lucarionite: description

**T153E10** · Game data · *active*

> Galladite

- `data/items/items.json` · item galladite: name

**T6EF6BB** · Screen text · *active*

> Galladit

- `data/items/items.json` · item galladite: short label

**TAF8549** · Game data · *active*

> Held by Gallade: press M to Mega Evolve it (once a match)

- `data/items/items.json` · item galladite: description

**T5A5362** · Game data · *active*

> Old Rod

- `data/items/items.json` · item old-rod: name

**T2ADACC** · Game data · *active*

> Fish at the water's edge (Space): mostly Magikarp and friends

- `data/items/items.json` · item old-rod: description

**T095E22** · Game data · *active*

> Good Rod

- `data/items/items.json` · item good-rod: name

**TD1A6D0** · Screen text · *active*

> GoodRod

- `data/items/items.json` · item good-rod: short label

**T623607** · Game data · *active*

> Fish at the water's edge (Space): better odds of rare bites

- `data/items/items.json` · item good-rod: description

**TA50E81** · Game data · *active*

> Super Rod

- `data/items/items.json` · item super-rod: name

**TB6CD4F** · Screen text · *active*

> SuperRod

- `data/items/items.json` · item super-rod: short label

**TD04880** · Game data · *active*

> Fish at the water's edge (Space): the best bites, items, and something big in Tide Lake

- `data/items/items.json` · item super-rod: description

**TB9D1B6** · Game data · *active*

> Poké Ball stall

- `data/shops.json` · stalls[0].name

**TC04880** · Game data · *active*

> Medicine stall

- `data/shops.json` · stalls[1].name

**T94FF33** · Game data · *active*

> Battle gear

- `data/shops.json` · stalls[2].name

**T6F481D** · UI · *active*

> it fights with physical attacks

- `src/sim/data.ts:143` · how = · when `role === 'physical' ?`

**T7CC768** · UI · *active*

> it fights with special attacks

- `src/sim/data.ts:143` · how = · when `role === 'physical' ?`

**T61ABEB** · UI · *active*

>  and {mv.name} is a {mv.category} move

Placeholders: `mv.name`, `mv.category`  
Example: " and Pikachu is a … move"

- `src/sim/data.ts:144` · return · when `mv.category === 'status' ?`

**TED1268** · UI · *active*

> You can't fish during a battle

- `src/sim/fishing.ts:106` · return · when `if (p.duelId)`

**T08D09A** · UI · *active*

> Go back to your trainer (Esc) to fish

- `src/sim/fishing.ts:107` · return · when `if (m.controlled)`

**T95B683** · UI · *active*

> Get off your mount (V) to fish

- `src/sim/fishing.ts:108` · return · when `if (p.mount)`

**TAA08E0** · UI · *active*

> You need a fishing rod

- `src/sim/fishing.ts:110` · return · when `if (!r)`

**T033C07** · UI · *active*

> Stand at the water's edge to fish

- `src/sim/fishing.ts:112` · return · when `if (!spot)`

**T1A82A6** · UI · *active*

> You reeled in. Nothing bit yet

- `src/sim/fishing.ts:134` · return · when `in hookOrReel()`

**T192B60** · Screen text · *active*

> It got away...

- `src/sim/fishing.ts:144` · text: · when `if (f.stage === 'bite')`

**TED83D3** · Screen text · *active*

> The black water goes still... something vast stirs below. Wait for it.

- `src/sim/fishing.ts:153` · text: · when `if (f.shadow)`

**T13C981** · Screen text · *active*

> The shadow sank back into the depths... (it bites only for half a second)

- `src/sim/fishing.ts:170` · text: · when `f.shadow ?`

**T3E263D** · Screen text · *active*

> It got away... (press Space when the "!" shows)

- `src/sim/fishing.ts:170` · text: · when `f.shadow ?`

**TB1078A** · Screen text · *active*

> You fished up a {ITEMS[`${ballOfTier(tier)}-ball`]?.name ?? 'ball'}! (Space to open it)

Placeholders: `ITEMS[`${ballOfTier(tier)}-ball`]?.name ?? 'ball'`  
Example: "You fished up a Pikachu! (Space to open it)"

- `src/sim/fishing.ts:201` · text: · when `if (kind === 'item')`

**TB5C6B9** · Screen text · *active*

> Rare catch! 

- `src/sim/fishing.ts:218` · label = · when `kind === 'rare' ?`

**T94676C** · UI · *active*

> TM {mv.name}

Placeholders: `mv.name`  
Example: "TM Pikachu"

- `src/sim/items.ts:50` · name:

## 8. Moves

175 lines.

**T13B10E** · Game data · *active*

> Tackle

- `data/moves.json` · move tackle: name

**T168BEB** · Game data · *active*

> Scratch

- `data/moves.json` · move scratch: name

**TCBE2F3** · Game data · *active*

> Quick Attack

- `data/moves.json` · move quick-attack: name

**T2A0BBD** · Game data · *active*

> Bite

- `data/moves.json` · move bite: name

**T96D39D** · Game data · *active*

> Rock Smash

- `data/moves.json` · move rock-smash: name

**T59E035** · Game data · *active*

> Wing Attack

- `data/moves.json` · move wing-attack: name

**T20632B** · Game data · *active*

> Ember

- `data/moves.json` · move ember: name

**T1FBAA8** · Game data · *active*

> Water Gun

- `data/moves.json` · move water-gun: name

**T32281F** · Game data · *active*

> Rock Throw

- `data/moves.json` · move rock-throw: name

**T38AAA9** · Game data · *active*

> Shadow Ball

- `data/moves.json` · move shadow-ball: name

**T89BE1D** · Game data · *active*

> Thunder Shock

- `data/moves.json` · move thunder-shock: name

**T8BB34C** · Game data · *active*

> Razor Leaf

- `data/moves.json` · move razor-leaf: name

**T5A1946** · Game data · *active*

> Psybeam

- `data/moves.json` · move psybeam: name

**T22DAB8** · Game data · *active*

> Ice Beam

- `data/moves.json` · move ice-beam: name

**T48BDD0** · Game data · *active*

> Dark Pulse

- `data/moves.json` · move dark-pulse: name

**TF0F2C4** · Game data · *active*

> Discharge

- `data/moves.json` · move discharge: name

**T5CB820** · Game data · *active*

> Bulldoze

- `data/moves.json` · move bulldoze: name

**T0BC738** · Game data · *active*

> Dark Void

- `data/moves.json` · move dark-void: name

**T3173B1** · Game data · *active*

> Sleep Powder

- `data/moves.json` · move sleep-powder: name

**T439F6C** · Game data · *active*

> Thunder Wave

- `data/moves.json` · move thunder-wave: name

**T432551** · Game data · *active*

> Will-O-Wisp

- `data/moves.json` · move will-o-wisp: name

**T9B979B** · Game data · *active*

> Howl

- `data/moves.json` · move howl: name

**T1014EF** · Game data · *active*

> Flamethrower

- `data/moves.json` · move flamethrower: name

**T389589** · Game data · *active*

> Surf

- `data/moves.json` · move surf: name

**TADDDEE** · Game data · *active*

> Thunderbolt

- `data/moves.json` · move thunderbolt: name

**T89ACD8** · Game data · *active*

> Energy Ball

- `data/moves.json` · move energy-ball: name

**T814D37** · Game data · *active*

> Crunch

- `data/moves.json` · move crunch: name

**T1E1060** · Game data · *active*

> Brick Break

- `data/moves.json` · move brick-break: name

**T6B8508** · Game data · *active*

> Earthquake

- `data/moves.json` · move earthquake: name

**T84C4AB** · Game data · *active*

> Aerial Ace

- `data/moves.json` · move aerial-ace: name

**T7EFC9C** · Game data · *active*

> Poison Jab

- `data/moves.json` · move poison-jab: name

**T95737D** · Game data · *active*

> Sludge Bomb

- `data/moves.json` · move sludge-bomb: name

**T1AA252** · Game data · *active*

> Rock Slide

- `data/moves.json` · move rock-slide: name

**T7B426E** · Game data · *active*

> Dragon Pulse

- `data/moves.json` · move dragon-pulse: name

**TEA929E** · Game data · *active*

> Stone Edge

- `data/moves.json` · move stone-edge: name

**T796938** · Game data · *active*

> Wild Charge

- `data/moves.json` · move wild-charge: name

**T97BCB9** · Game data · *active*

> X-Scissor

- `data/moves.json` · move x-scissor: name

**T24F096** · Game data · *active*

> Return

- `data/moves.json` · move return: name

**TB44F44** · Game data · *active*

> Poison Sting

- `data/moves.json` · move poison-sting: name

**T2AED3F** · Game data · *active*

> Bug Bite

- `data/moves.json` · move bug-bite: name

**TB2756B** · Game data · *active*

> Leafage

- `data/moves.json` · move leafage: name

**T0EA353** · Game data · *active*

> Powder Snow

- `data/moves.json` · move powder-snow: name

**TEEBA0B** · Game data · *active*

> Ice Shard

- `data/moves.json` · move ice-shard: name

**TD6A17F** · Game data · *active*

> Icicle Crash

- `data/moves.json` · move icicle-crash: name

**T2B85F7** · Game data · *active*

> Fairy Wind

- `data/moves.json` · move fairy-wind: name

**T531A23** · Game data · *active*

> Dazzling Gleam

- `data/moves.json` · move dazzling-gleam: name

**T68B8D4** · Game data · *active*

> Confusion

- `data/moves.json` · move confusion: name

**T1A9EE3** · Game data · *active*

> Psycho Cut

- `data/moves.json` · move psycho-cut: name

**T97CD2C** · Game data · *active*

> Hypnosis

- `data/moves.json` · move hypnosis: name

**TF056C7** · Game data · *active*

> Iron Head

- `data/moves.json` · move iron-head: name

**T087896** · Game data · *active*

> Mud Shot

- `data/moves.json` · move mud-shot: name

**T023D80** · Game data · *active*

> Dragon Breath

- `data/moves.json` · move dragon-breath: name

**T03032B** · Game data · *active*

> Growl

- `data/moves.json` · move growl: name

**TEAF7D9** · Game data · *active*

> Leer

- `data/moves.json` · move leer: name

**TF459F2** · Game data · *active*

> Scary Face

- `data/moves.json` · move scary-face: name

**T90BB4E** · Game data · *active*

> Headbutt

- `data/moves.json` · move headbutt: name

**T6FEE68** · Game data · *active*

> Body Slam

- `data/moves.json` · move body-slam: name

**TED2C33** · Game data · *active*

> Double-Edge

- `data/moves.json` · move double-edge: name

**TFA3292** · Game data · *active*

> Hyper Voice

- `data/moves.json` · move hyper-voice: name

**T112AB0** · Game data · *active*

> Swift

- `data/moves.json` · move swift: name

**TA2C169** · Game data · *active*

> Slash

- `data/moves.json` · move slash: name

**TAD6C57** · Game data · *active*

> Sing

- `data/moves.json` · move sing: name

**T5EA17A** · Game data · *active*

> Harden

- `data/moves.json` · move harden: name

**T2E9F1F** · Game data · *active*

> Swords Dance

- `data/moves.json` · move swords-dance: name

**T0FC9A6** · Game data · *active*

> Agility

- `data/moves.json` · move agility: name

**TDCE012** · Game data · *active*

> Karate Chop

- `data/moves.json` · move karate-chop: name

**T3C9CF3** · Game data · *active*

> Low Kick

- `data/moves.json` · move low-kick: name

**T0FA6B9** · Game data · *active*

> Double Kick

- `data/moves.json` · move double-kick: name

**T0748C5** · Game data · *active*

> Force Palm

- `data/moves.json` · move force-palm: name

**T3ED31F** · Game data · *active*

> Aura Sphere

- `data/moves.json` · move aura-sphere: name

**TFCA5B8** · Game data · *active*

> Close Combat

- `data/moves.json` · move close-combat: name

**T73BA66** · Game data · *active*

> Bulk Up

- `data/moves.json` · move bulk-up: name

**T71A930** · Game data · *active*

> Gust

- `data/moves.json` · move gust: name

**T0E99B5** · Game data · *active*

> Peck

- `data/moves.json` · move peck: name

**TBFFD69** · Game data · *active*

> Air Slash

- `data/moves.json` · move air-slash: name

**T41FAB8** · Game data · *active*

> Brave Bird

- `data/moves.json` · move brave-bird: name

**TE1A433** · Game data · *active*

> Flame Wheel

- `data/moves.json` · move flame-wheel: name

**TFAE941** · Game data · *active*

> Fire Fang

- `data/moves.json` · move fire-fang: name

**T669C61** · Game data · *active*

> Fire Punch

- `data/moves.json` · move fire-punch: name

**T6B4A92** · Game data · *active*

> Fire Spin

- `data/moves.json` · move fire-spin: name

**TACD7FF** · Game data · *active*

> Heat Wave

- `data/moves.json` · move heat-wave: name

**T8DAA04** · Game data · *active*

> Fire Blast

- `data/moves.json` · move fire-blast: name

**TC763B2** · Game data · *active*

> Bubble

- `data/moves.json` · move bubble: name

**T885156** · Game data · *active*

> Bubble Beam

- `data/moves.json` · move bubble-beam: name

**T91EDFE** · Game data · *active*

> Water Pulse

- `data/moves.json` · move water-pulse: name

**TA5AA0C** · Game data · *active*

> Aqua Tail

- `data/moves.json` · move aqua-tail: name

**T2D941F** · Game data · *active*

> Hydro Pump

- `data/moves.json` · move hydro-pump: name

**T85F595** · Game data · *active*

> Spark

- `data/moves.json` · move spark: name

**T93EBAE** · Game data · *active*

> Thunder Fang

- `data/moves.json` · move thunder-fang: name

**T397675** · Game data · *active*

> Thunder Punch

- `data/moves.json` · move thunder-punch: name

**T2972F5** · Game data · *active*

> Charge Beam

- `data/moves.json` · move charge-beam: name

**T134E93** · Game data · *active*

> Thunder

- `data/moves.json` · move thunder: name

**T434FD4** · Game data · *active*

> Stun Spore

- `data/moves.json` · move stun-spore: name

**T0E1275** · Game data · *active*

> Vine Whip

- `data/moves.json` · move vine-whip: name

**TAE56F1** · Game data · *active*

> Absorb

- `data/moves.json` · move absorb: name

**T88E1D1** · Game data · *active*

> Mega Drain

- `data/moves.json` · move mega-drain: name

**T54F3E0** · Game data · *active*

> Giga Drain

- `data/moves.json` · move giga-drain: name

**T81724E** · Game data · *active*

> Magical Leaf

- `data/moves.json` · move magical-leaf: name

**T2CFABC** · Game data · *active*

> Seed Bomb

- `data/moves.json` · move seed-bomb: name

**TB1FEA1** · Game data · *active*

> Leaf Blade

- `data/moves.json` · move leaf-blade: name

**T8CD6D6** · Game data · *active*

> Solar Beam

- `data/moves.json` · move solar-beam: name

**T764568** · Game data · *active*

> Ice Fang

- `data/moves.json` · move ice-fang: name

**TC3085C** · Game data · *active*

> Ice Punch

- `data/moves.json` · move ice-punch: name

**TE1EB5A** · Game data · *active*

> Aurora Beam

- `data/moves.json` · move aurora-beam: name

**T3A5537** · Game data · *active*

> Icy Wind

- `data/moves.json` · move icy-wind: name

**TB7B33D** · Game data · *active*

> Avalanche

- `data/moves.json` · move avalanche: name

**TF6221A** · Game data · *active*

> Blizzard

- `data/moves.json` · move blizzard: name

**T32608E** · Game data · *active*

> Acid

- `data/moves.json` · move acid: name

**T0D4BC4** · Game data · *active*

> Smog

- `data/moves.json` · move smog: name

**TBF8E26** · Game data · *active*

> Poison Fang

- `data/moves.json` · move poison-fang: name

**T1E8722** · Game data · *active*

> Sludge

- `data/moves.json` · move sludge: name

**TE592E9** · Game data · *active*

> Mud-Slap

- `data/moves.json` · move mud-slap: name

**T21F497** · Game data · *active*

> Sand Attack

- `data/moves.json` · move sand-attack: name

**T3CA03A** · Game data · *active*

> Sand Tomb

- `data/moves.json` · move sand-tomb: name

**T96BC13** · Game data · *active*

> Drill Run

- `data/moves.json` · move drill-run: name

**T4FE8B7** · Game data · *active*

> Earth Power

- `data/moves.json` · move earth-power: name

**T8BE952** · Game data · *active*

> String Shot

- `data/moves.json` · move string-shot: name

**T652584** · Game data · *active*

> Struggle Bug

- `data/moves.json` · move struggle-bug: name

**T488B26** · Game data · *active*

> Fury Cutter

- `data/moves.json` · move fury-cutter: name

**T32968C** · Game data · *active*

> Signal Beam

- `data/moves.json` · move signal-beam: name

**T3EBA78** · Game data · *active*

> Bug Buzz

- `data/moves.json` · move bug-buzz: name

**TA18AD0** · Game data · *active*

> Rock Tomb

- `data/moves.json` · move rock-tomb: name

**TCE1BFF** · Game data · *active*

> Ancient Power

- `data/moves.json` · move ancient-power: name

**T8FC94E** · Game data · *active*

> Smack Down

- `data/moves.json` · move smack-down: name

**T9D2C5F** · Game data · *active*

> Power Gem

- `data/moves.json` · move power-gem: name

**T0F1390** · Game data · *active*

> Lick

- `data/moves.json` · move lick: name

**TECAB81** · Game data · *active*

> Astonish

- `data/moves.json` · move astonish: name

**T1AD6B6** · Game data · *active*

> Shadow Claw

- `data/moves.json` · move shadow-claw: name

**T2EB18B** · Game data · *active*

> Hex

- `data/moves.json` · move hex: name

**T595395** · Game data · *active*

> Night Shade

- `data/moves.json` · move night-shade: name

**T081D7B** · Game data · *active*

> Shadow Sneak

- `data/moves.json` · move shadow-sneak: name

**T9B6680** · Game data · *active*

> Dragon Claw

- `data/moves.json` · move dragon-claw: name

**T868BBF** · Game data · *active*

> Twister

- `data/moves.json` · move twister: name

**T18E54A** · Game data · *active*

> Outrage

- `data/moves.json` · move outrage: name

**TCB248B** · Game data · *active*

> Draco Meteor

- `data/moves.json` · move draco-meteor: name

**TF54419** · Game data · *active*

> Dragon Dance

- `data/moves.json` · move dragon-dance: name

**T810066** · Game data · *active*

> Feint Attack

- `data/moves.json` · move feint-attack: name

**TF29913** · Game data · *active*

> Night Slash

- `data/moves.json` · move night-slash: name

**T3E54B5** · Game data · *active*

> Snarl

- `data/moves.json` · move snarl: name

**T301400** · Game data · *active*

> Sucker Punch

- `data/moves.json` · move sucker-punch: name

**TB0C6B5** · Game data · *active*

> Nasty Plot

- `data/moves.json` · move nasty-plot: name

**T5B619F** · Game data · *active*

> Metal Claw

- `data/moves.json` · move metal-claw: name

**TFB67FC** · Game data · *active*

> Iron Tail

- `data/moves.json` · move iron-tail: name

**T45C798** · Game data · *active*

> Flash Cannon

- `data/moves.json` · move flash-cannon: name

**T26F3B0** · Game data · *active*

> Bullet Punch

- `data/moves.json` · move bullet-punch: name

**T49FFC4** · Game data · *active*

> Steel Wing

- `data/moves.json` · move steel-wing: name

**TC947AB** · Game data · *active*

> Iron Defense

- `data/moves.json` · move iron-defense: name

**T24561F** · Game data · *active*

> Heavy Slam

- `data/moves.json` · move heavy-slam: name

**T0D32F6** · Game data · *active*

> Psychic

- `data/moves.json` · move psychic: name

**TA4D478** · Game data · *active*

> Zen Headbutt

- `data/moves.json` · move zen-headbutt: name

**T1AD2A4** · Game data · *active*

> Calm Mind

- `data/moves.json` · move calm-mind: name

**TC41252** · Game data · *active*

> Disarming Voice

- `data/moves.json` · move disarming-voice: name

**T80F253** · Game data · *active*

> Draining Kiss

- `data/moves.json` · move draining-kiss: name

**T36266B** · Game data · *active*

> Moonblast

- `data/moves.json` · move moonblast: name

**TF671D3** · Game data · *active*

> Play Rough

- `data/moves.json` · move play-rough: name

**TE124E7** · Game data · *active*

> Charm

- `data/moves.json` · move charm: name

**T9A880D** · Game data · *active*

> Aeroblast

- `data/moves.json` · move aeroblast: name

**T401FFB** · Game data · *active*

> Sacred Fire

- `data/moves.json` · move sacred-fire: name

**TB35FDA** · Game data · *active*

> Dragon Ascent

- `data/moves.json` · move dragon-ascent: name

**T70F3B1** · Game data · *active*

> Luster Purge

- `data/moves.json` · move luster-purge: name

**TD4A2B6** · Game data · *active*

> Doom Desire

- `data/moves.json` · move doom-desire: name

**T83178C** · Game data · *active*

> Hyperspace Hole

- `data/moves.json` · move hyperspace-hole: name

**T242C26** · Game data · *active*

> Spectral Thief

- `data/moves.json` · move spectral-thief: name

**T6A1798** · Game data · *active*

> V-create

- `data/moves.json` · move v-create: name

**TEF322F** · Game data · *active*

> Shadow Storm

- `data/moves.json` · move shadow-storm: name

**T15F019** · Game data · *active*

> Flame Charge

- `data/moves.json` · move flame-charge: name

**TADDD66** · Game data · *active*

> Flare Blitz

- `data/moves.json` · move flare-blitz: name

**T514935** · Game data · *active*

> Aqua Jet

- `data/moves.json` · move aqua-jet: name

**T5EFB6E** · Game data · *active*

> Razor Shell

- `data/moves.json` · move razor-shell: name

**TF26557** · Game data · *active*

> Waterfall

- `data/moves.json` · move waterfall: name

**T70DB32** · Game data · *active*

> Wave Crash

- `data/moves.json` · move wave-crash: name

**T378F5F** · Game data · *active*

> Mach Punch

- `data/moves.json` · move mach-punch: name

**T4B38FC** · Game data · *active*

> Dragon Tail

- `data/moves.json` · move dragon-tail: name

**T30CB5F** · Game data · *active*

> Mirror Shot

- `data/moves.json` · move mirror-shot: name

**TA05621** · Game data · *active*

> Nuzzle

- `data/moves.json` · move nuzzle: name

## 9. Battle and match messages (catching, evolving, the storm, legends)

136 lines.

**TCC7AED** · Screen text · *active*

> paralyzed!

- `src/sim/battle.ts:366` · text: · when `if (attacker.status === 'paralysis' && this.rng.chance(CONFIG.battle.paralysisSkipChance))`

**T3BD21C** · Screen text · *active*

> Missed!

- `src/sim/battle.ts:649` · text: · when `if (Math.hypot(f.target.x - f.x, f.target.y - f.y) > 0.8 * R() + hitPad(f.target.species))`

**T52BF7B** · Screen text · *active*

> Hung on with Focus Sash!

- `src/sim/battle.ts:781` · text: · when `if (target.heldItem === 'focus-sash' && target.hp === target.maxHp && damage >= target.hp)`

**T968407** · UI · *active*

> SHOWDOWN: Darkrai is here

- `src/sim/darkness.ts:51` · return · when `if (d.finale)`

**T64CEA5** · UI · *active*

> darkness phase {d.phase}

Placeholders: `d.phase`  
Example: "darkness phase …"

- `src/sim/darkness.ts:53` · return · when `in phaseLabel()`

**T1CD326** · UI · *active*

> Crystal Healer

- `src/sim/match.ts:319` · makeTrainer · when `in placeCrystalHealer()`

**T0EC420** · UI · *active*

> That stack in the chest is full

- `src/sim/match.ts:452` · return · when `if (same && same.count + entry.count > CHEST_STACK_MAX)`

**TD6C04E** · UI · *active*

> The chest is full

- `src/sim/match.ts:456` · return · when `if (free < 0)`

**T6E8F27** · UI · *active*

> Stored {name}{entry.count > 1 ? ` x${entry.count}` : ''}{this.chestKept(t) ? '' : ' (not kept after this match)'}

Placeholders: `name`, `entry.count > 1 ? ` x${entry.count}` : ''`, `this.chestKept(t) ? '' : ' (not kept after this match)'`  
Example: "Stored Pikachu3…"

- `src/sim/match.ts:463` · return · when `in deposit()`

**TBEDC4A** · UI · *active*

>  (not kept after this match)

- `src/sim/match.ts:463` · return · when `this.chestKept(t) ?`

**T982DB7** · UI · *active*

> No room in your Held & TMs tab

- `src/sim/match.ts:471` · return · when `isGear(entry.id) ?`
- `src/sim/match.ts:735` · return · when `if (!this.giveItem(t, id))`

**T4595F3** · UI · *active*

> No room in your bag

- `src/sim/match.ts:471` · return · when `isGear(entry.id) ?`

**TC939DB** · UI · *active*

> Took {name}{entry.count > 1 ? ` x${entry.count}` : ''}

Placeholders: `name`, `entry.count > 1 ? ` x${entry.count}` : ''`  
Example: "Took Pikachu3"

- `src/sim/match.ts:476` · return · when `in withdraw()`

**T12FC61** · UI · *active*

> Sold {name} for ₽{price.toLocaleString()}

Placeholders: `name`, `price.toLocaleString()`  
Example: "Sold Pikachu for ₽1,500"

- `src/sim/match.ts:522` · return · when `in sell()`

**T6E09E9** · UI · *active*

> Not enough money for {name} (₽{e.price})

Placeholders: `name`, `e.price`  
Example: "Not enough money for Pikachu (₽1,500)"

- `src/sim/match.ts:530` · return · when `if (p.money < e.price)`

**T9DCE6C** · UI · *active*

> Your bag is full

- `src/sim/match.ts:531` · return · when `if (!this.giveItem(p, e.id, 1))`

**TA70D9B** · UI · *active*

> Bought {name} for ₽{e.price}

Placeholders: `name`, `e.price`  
Example: "Bought Pikachu for ₽1,500"

- `src/sim/match.ts:533` · return · when `in buy()`

**T73500C** · UI · *active*

> Outpost staff

- `src/sim/match.ts:584` · makeTrainer · when `i === 0 ?`
- `data/characters.json` · role staff_a: name

**TC3BF99** · Screen text · *active*

> Alpha prize dropped: {names}

Placeholders: `names`  
Example: "Alpha prize dropped: …"

- `src/sim/match.ts:650` · text: · when `if (by?.isPlayer)`

**TE7B8BA** · UI · *active*

> You already Mega Evolved this match

- `src/sim/match.ts:688` · return · when `if (t.megaUsed)`

**T09C4C0** · UI · *active*

> No Pokémon out

- `src/sim/match.ts:689` · return · when `if (!m)`

**TFA6354** · UI · *active*

> Mega Stone

- `src/sim/match.ts:692` · return · when `if (m.heldItem !== form.stone)`
- `src/sim/match.ts:713` · return · when `if (previous && ITEMS[previous]?.effect === 'mega' && (m.mega \|\| m.evolving?.mega))`
- `src/ui/matchScreen.ts:1433` · say · when `if (ev.mon.owner?.isPlayer)`

**TAE5BAD** · UI · *active*

> No Pokémon to hold it

- `src/sim/match.ts:710` · return · when `if (!m)`

**TD28063** · UI · *active*

> No room in your Held & TMs tab for its {ITEMS[previous]?.name ?? 'item'}

Placeholders: `ITEMS[previous]?.name ?? 'item'`  
Example: "No room in your Held & TMs tab for its Pikachu"

- `src/sim/match.ts:723` · return · when `if (previous && !this.giveItem(t, previous))`

**T561BD1** · UI · *active*

> Took the {def?.name ?? 'item'} from {m.name}

Placeholders: `def?.name ?? 'item'`, `m.name`  
Example: "Took the Pikachu from Pikachu"

- `src/sim/match.ts:737` · return · when `in unequip()`

**TA39A59** · UI · *active*

> No Pokémon to teach

- `src/sim/match.ts:746` · return · when `if (!m)`
- `src/ui/matchScreen.ts:1221` · say · when `if (!m)`

**T789FAE** · UI · *active*

> Hold F to aim, release to throw

- `src/sim/match.ts:854` · return · when `case 'ball'`

**TC36877** · UI · *active*

> No Pokémon to heal

- `src/sim/match.ts:856` · return · when `if (!m)`

**T225F9C** · UI · *active*

> Nobody has fainted

- `src/sim/match.ts:865` · return · when `if (!down)`

**T9D5080** · UI · *active*

> No status to cure

- `src/sim/match.ts:877` · return · when `if (!target \|\| !target.status)`

**T989E06** · UI · *active*

> No Pokémon

- `src/sim/match.ts:884` · return · when `if (!m)`

**T0203D8** · UI · *active*

> No Pokémon to use it on

- `src/sim/match.ts:893` · return · when `if (!m)`
- `src/sim/match.ts:903` · return · when `if (!m)`

**T8985B1** · UI · *active*

> The {def.name} had no effect on {m.name}

Placeholders: `def.name`, `m.name`  
Example: "The Pikachu had no effect on Pikachu"

- `src/sim/match.ts:905` · return · when `if (!to \|\| m.evolving)`

**T28CAEA** · UI · *active*

> Pick a move slot to replace

- `src/sim/match.ts:912` · return · when `case 'tm'`

**T99B308** · UI · *active*

> Pick a Pokémon to extract

- `src/sim/match.ts:914` · return · when `case 'voucher'`

**TD0DD37** · UI · *active*

> The Capture Styler works from your bag: hold C and draw loops round a wild Pokémon

- `src/sim/match.ts:918` · return · when `if (def.id === 'styler')`

**T9875C3** · UI · *active*

> The {def.name} works from your bag: your Pokémon last {maskTime(secs)} in the storm before falling asleep

Placeholders: `def.name`, `maskTime(secs)`  
Example: "The Pikachu works from your bag: your Pokémon last 45 in the storm before falling asleep"

- `src/sim/match.ts:920` · return · when `case 'charm'`

**TD79D86** · UI · *active*

> Your party is full ({this.partyCap}). Release one from its card to make room

Placeholders: `this.partyCap`  
Example: "Your party is full (…). Release one from its card to make room"

- `src/sim/match.ts:924` · return · when `if (partySize(t) >= this.partyCap)`
- `src/sim/match.ts:1022` · text: · when `if (partySize(t) >= this.partyCap)`

**TED66AE** · UI · *active*

> No fainted enemy Pokémon nearby to claim

- `src/sim/match.ts:938` · return · when `if (!best)`

**TF65FA9** · UI · *active*

> Captured {best.name} with the Styler!

Placeholders: `best.name`  
Example: "Captured Pikachu with the Styler!"

- `src/sim/match.ts:951` · return · when `case 'styler'`

**T51C252** · UI · *active*

> Your party is full ({this.partyCap}): hover a party card and click its X to release one, then pick again

Placeholders: `this.partyCap`  
Example: "Your party is full (…): hover a party card and click its X to release one, then pick again"

- `src/sim/match.ts:980` · return · when `if (partySize(p) >= this.partyCap)`

**TF668AC** · UI · *active*

> Snagged {from.name}'s {m.name}!

Placeholders: `from.name`, `m.name`  
Example: "Snagged Pikachu's Pikachu!"

- `src/sim/match.ts:1004` · return · when `in snag()`

**TB7EC53** · Screen text · *active*

> The ball bounced off!

- `src/sim/match.ts:1062` · text: · when `if (sh && Math.hypot(sh.x - th.x, sh.y - th.y) < 2)`

**TA34BC3** · Screen text · *active*

> Balls bounce off its dark aura. Wear it under 10% HP and use a Snag Machine

- `src/sim/match.ts:1063` · text: · when `if (sh && Math.hypot(sh.x - th.x, sh.y - th.y) < 2)`

**TB742C2** · Screen text · *active*

> The ball missed

- `src/sim/match.ts:1080` · text: · when `if (!best)`

**TEDE2C1** · Screen text · *active*

> The darkness repels the ball!

- `src/sim/match.ts:1085` · text: · when `if (best.aura)`

**T27FB7B** · Screen text · *active*

> The Held & TMs tab is full (G to look, the red X throws one away)

- `src/sim/match.ts:1183` · text: · when `gear ?`

**TA53F33** · Screen text · *active*

> The bag is full (the red X on a slot throws it away)

- `src/sim/match.ts:1183` · text: · when `gear ?`

**T22E40D** · Screen text · *active*

> Some of it did not fit; the rest is still in the ball

- `src/sim/match.ts:1185` · text: · when `if (it.contents?.length && this.items.includes(it))`

**T5FAFCB** · UI · *active*

> The healer can't help mid-battle

- `src/sim/match.ts:1219` · return · when `if (t.duelId)`

**T3C8301** · UI · *active*

> The healer needs a moment ({Math.ceil(t.outpostReady - this.time)}s)

Placeholders: `Math.ceil(t.outpostReady - this.time)`  
Example: "The healer needs a moment (45s)"

- `src/sim/match.ts:1220` · return · when `if (this.time < t.outpostReady)`

**T78E53C** · UI · *active*

> Your party is already in top shape

- `src/sim/match.ts:1222` · return · when `if (!needs)`

**T41B160** · UI · *active*

> Crystal Healer: "Not during the final showdown!"

- `src/sim/match.ts:1223` · return · when `if (cost > 0 && this.finalStarted)`

**TB664AE** · UI · *active*

> Crystal Healer: "A full heal is ₽{cost}." You have ₽{t.money}

Placeholders: `cost`, `t.money`  
Example: "Crystal Healer: "A full heal is ₽1,500." You have ₽1,500"

- `src/sim/match.ts:1224` · return · when `if (cost > 0 && t.money < cost)`

**T00241A** · UI · *active*

> Paid ₽{cost}. Your Pokémon are fully healed!

Placeholders: `cost`  
Example: "Paid ₽1,500. Your Pokémon are fully healed!"

- `src/sim/match.ts:1237` · return · when `cost > 0 ?`

**T46EF9A** · UI · *active*

> Your Pokémon are fully healed!

- `src/sim/match.ts:1237` · return · when `cost > 0 ?`

**T3F68B1** · On-screen notice · *active*

> Party fully healed!

- `src/sim/match.ts:1306` · noticeFor · when `if (t.isPlayer)`

**TCCFE85** · Screen text · *active*

> You pass out in the storm... Darkrai takes you into the shadows

- `src/sim/match.ts:1606` · text: · when `t.isPlayer ?`

**T2DA9CE** · UI · *active*

> You can't ride during a battle

- `src/sim/match.ts:2454` · return · when `if (p.duelId)`

**TEA3E29** · UI · *active*

> You take off on {mon.name}! It can fly over water (V to land)

Placeholders: `mon.name`  
Example: "You take off on Pikachu! It can fly over water (V to land)"

- `src/sim/match.ts:2468` · return · when `fly ?`

**TF292EF** · UI · *active*

> You ride {mon.name}! (V to get off)

Placeholders: `mon.name`  
Example: "You ride Pikachu! (V to get off)"

- `src/sim/match.ts:2468` · return · when `fly ?`

**TFBED62** · UI · *active*

> You can't land here

- `src/sim/match.ts:2475` · return · when `if (!force && !canStand(this.ground, t.x, t.y, CONFIG.player.radius))`

**T2E7FD8** · UI · *active*

> You can't release a Pokémon during a battle

- `src/sim/match.ts:2521` · return · when `if (p.duelId)`

**TFF4277** · UI · *active*

> You can't release your last Pokémon

- `src/sim/match.ts:2522` · return · when `if (p.party.length <= 1)`

**TCBC8EC** · UI · *active*

> Bye, {m.name}! It heads off into the wild

Placeholders: `m.name`  
Example: "Bye, Pikachu! It heads off into the wild"

- `src/sim/match.ts:2541` · return · when `m.fainted ?`

**TDB60DC** · UI · *active*

> Nothing leaves a private match: vouchers do nothing here

- `src/sim/match.ts:2554` · return · when `if (!this.keepsResults)`

**TE30BEA** · UI · *active*

> You can't extract a Pokémon during a battle

- `src/sim/match.ts:2555` · return · when `if (p.duelId)`
- `src/ui/matchScreen.ts:1246` · say · when `if (p.duelId)`

**TBE9E9D** · UI · *active*

> You can't extract your last Pokémon that can fight

- `src/sim/match.ts:2556` · return · when `if (!p.party.some((o) => o !== m && !o.fainted && !o.captured))`

**T74EE9B** · Screen text · *active*

> Go, {next.name}! You're steering it now (Esc for trainer mode)

Placeholders: `next.name`  
Example: "Go, Pikachu! You're steering it now (Esc for trainer mode)"

- `src/sim/match.ts:2782` · text: · when `if (next && Math.hypot(next.x - p.x, next.y - p.y) < 10 && this.takeControl(next))`

**T5ABC34** · Screen text · *active*

> Darkrai is down! It left a Cherish Ball behind

- `src/sim/match.ts:3108` · text: · when `if (ev.type === 'faint' && ev.mon.boss)`

**TBD8004** · UI · *active*

>  and a shiny {mon.name}

Placeholders: `mon.name`  
Example: " and a shiny Pikachu"

- `src/sim/match.ts:3207` · when `if (pool.length && partySize(this.player) < this.partyCap)`

**T8AE003** · UI · *active*

>  (no room in your party for his shiny Pokémon)

- `src/sim/match.ts:3208` · when `if (pool.length)`

**TA763C9** · Screen text · *active*

> You beat the {SHOPS.challenger.name}! +₽{r.money}, his items{prize}

Placeholders: `SHOPS.challenger.name`, `r.money`, `prize`  
Example: "You beat the Pikachu! +₽1,500, his items…"

- `src/sim/match.ts:3209` · text: · when `in winChallenge()`

**T71AD42** · Screen text · *active*

> The crystal shatters. Darkrai awakens!

- `src/sim/match.ts:3235` · text: · when `d.finale ?`

**T31C935** · Screen text · *active*

> Darkness pulse {d.phase}: the night closes in

Placeholders: `d.phase`  
Example: "Darkness pulse …: the night closes in"

- `src/sim/match.ts:3235` · text: · when `d.finale ?`

**T14A370** · Screen text · *active*

> A Master Ball glints beside the crystal

- `src/sim/match.ts:3240` · text: · when `if (d.finale && !this.darkrai)`

**T78DC4E** · Screen text · *active*

> The darkness lulls it to sleep…

- `src/sim/match.ts:3260` · text: · when `if (m.drowsy >= this.drowsySeconds(m))`

**TC4ECB8** · Screen text · *active*

> You caught {L.name}!

Placeholders: `L.name`  
Example: "You caught Pikachu!"

- `src/sim/match.ts:3533` · text: · when `in catchBoutLegend()`

**T4A4FF3** · UI · *active*

> Your party is full ({this.partyCap}). Release one from its card first

Placeholders: `this.partyCap`  
Example: "Your party is full (…). Release one from its card first"

- `src/sim/match.ts:3554` · return · when `if (partySize(p) >= this.partyCap)`

**T7E80C5** · UI · *active*

> You snagged {L.name}! It joins your team, still wrapped in darkness

Placeholders: `L.name`  
Example: "You snagged Pikachu! It joins your team, still wrapped in darkness"

- `src/sim/match.ts:3583` · return · when `in snagShadow()`

**T73A375** · UI · *active*

> Go, {m.name}!

Placeholders: `m.name`  
Example: "Go, Pikachu!"

- `src/sim/match.ts:3724` · return · when `in duelPick()`

**TD58DE6** · Screen text · *active*

> Final two! The Shadow Crystal calls you both to its arena

- `src/sim/match.ts:3987` · text: · when `if (this.finalCountdown === null)`

**T10D575** · Screen text · *active*

> Final showdown: {a.name} vs {b.name}! Both teams are restored

Placeholders: `a.name`, `b.name`  
Example: "Final showdown: Pikachu vs Pikachu! Both teams are restored"

- `src/sim/match.ts:4043` · text: · when `in stepFinalShowdown()`

**TB4762B** · Screen text · *active*

> Snag Machine ready: take one of {loser.name}'s Pokémon (1-6), Esc to keep it

Placeholders: `loser.name`  
Example: "Snag Machine ready: take one of Pikachu's Pokémon (1-6), Esc to keep it"

- `src/sim/match.ts:4079` · text: · when `if (winner.isPlayer && !loser.legendBout && !loser.visitor && this.snagSlot(winner) >= 0 && loser.party.some((m) => !m.captured))`

**TC7F252** · UI · *active*

> Roam (Aggr.)

- `src/sim/party.ts:44` · BEHAVIOR_LABEL =

**T9C69AD** · On-screen notice · *testing only*

> Every rare item is waiting in the storage chests in each town

- `src/ui/matchScreen.ts:150` · say · when `if (rareChest())`

**TB602A3** · On-screen notice · *active*

> No wild Pokémon in range

- `src/ui/matchScreen.ts:376` · say · when `t ?`
- `server/commands.ts:99` · return · when `t ?`

**T8FD194** · On-screen notice · *active*

> Dodge not ready

- `src/ui/matchScreen.ts:382` · say · when `if (r === 'cooldown')`
- `server/commands.ts:79` · return · when `r === 'cooldown' ?`

**T611B24** · On-screen notice · *active*

> No Poké Balls in the bag

- `src/ui/matchScreen.ts:642` · say · when `if (slot < 0)`
- `src/ui/matchScreen.ts:654` · say · when `if (slot < 0)`
- `src/ui/matchScreen.ts:669` · say · when `if (slot < 0)`

**TD76CA2** · On-screen notice · *active*

> Wait for the ball to settle

- `src/ui/matchScreen.ts:652` · say · when `if (m.throws.some((th) => th.thrower === p && th.phase !== 'done'))`
- `server/commands.ts:253` · return · when `if (m.throws.some((th) => th.thrower === p && th.phase !== 'done'))`

**TDBD6D6** · On-screen notice · *active*

> Go, {ITEMS[p.items[slot]?.id ?? '']?.name ?? 'Poké Ball'}!

Placeholders: `ITEMS[p.items[slot]?.id ?? '']?.name ?? 'Poké Ball'`  
Example: "Go, Pikachu!"

- `src/ui/matchScreen.ts:658` · say · when `if (m.throwBall(p, slot, { x: legend.x, y: legend.y }, legend))`

**T62915D** · On-screen notice · *active*

> Poké Ball

- `src/ui/matchScreen.ts:658` · say · when `if (m.throwBall(p, slot, { x: legend.x, y: legend.y }, legend))`
- `src/ui/matchScreen.ts:671` · ballName = · when `in throwAtTarget()`
- `data/items/items.json` · item poke-ball: name

**TBEC06B** · On-screen notice · *active*

> You can't catch another trainer's Pokémon

- `src/ui/matchScreen.ts:662` · say · when `if (p.duelId)`
- `server/commands.ts:257` · return · when `if (p.duelId)`

**T7A3FE8** · On-screen notice · *active*

> No wild Pokémon in range to throw at

- `src/ui/matchScreen.ts:665` · say · when `if (!t \|\| t.fainted \|\| t.captured \|\| !m.wilds.includes(t))`

**TC98108** · On-screen notice · *active*

> Go, {ballName}!

Placeholders: `ballName`  
Example: "Go, Pikachu!"

- `src/ui/matchScreen.ts:673` · say · when `if (m.throwBall(p, slot, { x: t.x, y: t.y }))`

**TD07F1C** · On-screen notice · *active*

> You kept your Snag Machine

- `src/ui/matchScreen.ts:1128` · say · when `if (input.pressed('Escape'))`

**T9D70BE** · On-screen notice · *active*

> Could not teach that move

- `src/ui/matchScreen.ts:1182` · say · when `if (input.pressed(`Digit${i + 1}`))`

**T9427FA** · On-screen notice · *active*

> Threw away {ITEMS[e.id]?.name ?? e.id}{e.count > 1 ? ` ×${e.count}` : ''}

Placeholders: `ITEMS[e.id]?.name ?? e.id`, `e.count > 1 ? ` ×${e.count}` : ''`  
Example: "Threw away Pikachu3"

- `src/ui/matchScreen.ts:1210` · say · when `in discardSlot()`

**T034D4C** · On-screen notice · *active*

>  ×{e.count}

Placeholders: `e.count`  
Example: " ×3"

- `src/ui/matchScreen.ts:1210` · say · when `e.count > 1 ?`

**T2B50FF** · On-screen notice · *active*

> Not ready

- `src/ui/matchScreen.ts:1255` · say · when `if (r === 'cooldown')`

**TD4A176** · On-screen notice · *active*

> Frozen solid!

- `src/ui/matchScreen.ts:1256` · say · when `lead(this.match.player)?.status === 'freeze' ?`
- `src/ui/matchScreen.ts:1289` · freeze: · when `case 'status'`

**T93D359** · On-screen notice · *active*

> Fast asleep…

- `src/ui/matchScreen.ts:1256` · say · when `lead(this.match.player)?.status === 'freeze' ?`

**TA4888C** · On-screen notice · *active*

> No Pokémon able to fight

- `src/ui/matchScreen.ts:1257` · say · when `if (r === 'no-lead')`

**TFE6681** · UI · *active*

> Fell asleep!

- `src/ui/matchScreen.ts:1288` · sleep: · when `case 'status'`

**T21BA5D** · UI · *active*

> Burned!

- `src/ui/matchScreen.ts:1288` · burn: · when `case 'status'`

**T49B53D** · UI · *active*

> Paralyzed!

- `src/ui/matchScreen.ts:1288` · paralysis: · when `case 'status'`

**TFA3749** · UI · *active*

> Poisoned!

- `src/ui/matchScreen.ts:1289` · poison: · when `case 'status'`

**TA09AFC** · UI · *active*

> Confused!

- `src/ui/matchScreen.ts:1289` · confusion: · when `case 'status'`

**T3651FC** · UI · *active*

> PC unavailable

- `src/ui/matchScreen.ts:1324` · add · when `saved ?`

**T6B16BB** · UI · *active*

> Loop {ev.loops}/{ev.needed}

Placeholders: `ev.loops`, `ev.needed`  
Example: "Loop …/3"

- `src/ui/matchScreen.ts:1332` · add · when `case 'styler-loop'`

**T40BDEF** · UI · *active*

> The line broke!

- `src/ui/matchScreen.ts:1336` · add · when `case 'styler-break'`

**T2567D5** · UI · *active*

> Dodged!

- `src/ui/matchScreen.ts:1347` · add · when `case 'dodged'`

**TDABB45** · UI · *active*

> Thawed out

- `src/ui/matchScreen.ts:1350` · add · when `case 'thaw'`

**TA82D64** · UI · *active*

> Hit the wrong way!

- `src/ui/matchScreen.ts:1353` · add · when `case 'confused'`

**T44C425** · UI · *active*

> Woke up

- `src/ui/matchScreen.ts:1356` · add · when `case 'wake'`

**TC61033** · On-screen notice · *active*

> Go, {ev.mon.name}!

Placeholders: `ev.mon.name`  
Example: "Go, Pikachu!"

- `src/ui/matchScreen.ts:1375` · say · when `mine ?`

**TBF0830** · On-screen notice · *active*

> You defeated {foe.name}!

Placeholders: `foe.name`  
Example: "You defeated Pikachu!"

- `src/ui/matchScreen.ts:1383` · say · when `ev.winner === p ?`

**TEF9A5A** · On-screen notice · *active*

> Gotcha! {ev.mon.name} joined the party!

Placeholders: `ev.mon.name`  
Example: "Gotcha! Pikachu joined the party!"

- `src/ui/matchScreen.ts:1405` · say · when `if (ev.by.isPlayer)`

**TA0D8D2** · UI · *active*

> Broke free!

- `src/ui/matchScreen.ts:1408` · add · when `case 'broke-free'`

**T283DA4** · On-screen notice · *active*

> The Cherish Ball restores your whole party!

- `src/ui/matchScreen.ts:1414` · say · when `if (ev.healed)`

**TC5261E** · UI · *active*

> +{ev.xp} XP

Placeholders: `ev.xp`  
Example: "+120 XP"

- `src/ui/matchScreen.ts:1420` · add · when `if (ev.xp > 0)`

**T72D3C3** · UI · *active*

> Level {ev.mon.level}!

Placeholders: `ev.mon.level`  
Example: "Level Pikachu!"

- `src/ui/matchScreen.ts:1421` · add · when `if (ev.levels > 0)`

**TB5F272** · On-screen notice · *active*

> What? {ev.mon.name} is evolving!

Placeholders: `ev.mon.name`  
Example: "What? Pikachu is evolving!"

- `src/ui/matchScreen.ts:1425` · say · when `if (ev.mon.owner?.isPlayer)`

**T340BB2** · UI · *active*

> +₽{ev.amount}

Placeholders: `ev.amount`  
Example: "+₽…"

- `src/ui/matchScreen.ts:1447` · add · when `if (ev.trainer.isPlayer)`

**T258C49** · On-screen notice · *active*

> Back in the fight! Your party is healed, but your items are gone

- `src/ui/matchScreen.ts:1453` · say · when `if (ev.trainer.isPlayer)`

**T0EA875** · On-screen notice · *active*

> Your whole party fainted…

- `src/ui/matchScreen.ts:1459` · say · when `ev.trainer.isPlayer ?`

**T7ED12C** · UI · *active*

> No effect

- `src/ui/matchScreen.ts:1482` · add · when `if (ev.effectiveness === 0)`

**T8645F6** · UI · *active*

> Super effective!

- `src/ui/matchScreen.ts:1488` · add · when `if (ev.effectiveness > 1)`

**T2A0839** · UI · *active*

> Not very effective

- `src/ui/matchScreen.ts:1489` · add · when `if (ev.effectiveness < 1)`

**T9A3869** · Screen text · *active*

> WIPED OUT

- `src/ui/matchScreen.ts:2367` · text · when `in drawDowned()`

**T18C978** · Screen text · *active*

> Respawning in {left}s

Placeholders: `left`  
Example: "Respawning in 3s"

- `src/ui/matchScreen.ts:2368` · text · when `in drawDowned()`

**T3314E6** · Screen text · *active*

> Wild Pokémon took your whole party. You come back at an outpost with them healed; your items stayed where you fell.

- `src/ui/matchScreen.ts:2369` · wrapText · when `in drawDowned()`

**T6E7E81** · Screen text · *active*

> Choose your next Pokémon

- `src/ui/matchScreen.ts:2415` · text · when `in drawDuelHud()`

**T0E0541** · UI · *active*

> Legendary {m.name}

Placeholders: `m.name`  
Example: "Legendary Pikachu"

- `src/ui/matchScreen.ts:2516` · base = · when `m.legend ?`

**T753ADD** · UI · *active*

> Alpha {m.name}

Placeholders: `m.name`  
Example: "Alpha Pikachu"

- `src/ui/matchScreen.ts:2516` · base = · when `m.alpha ?`

**TB4C76C** · Screen text · *active*

> Shiny {base}

Placeholders: `base`  
Example: "Shiny …"

- `src/ui/matchScreen.ts:2517` · label = · when `m.shiny ?`

## 10. Results screens

18 lines.

**T3AB9ED** · Screen text · *active*

> Last trainer standing on the training grounds.

- `src/ui/endScreen.ts:118` · text · when `win ?`

**T39A531** · Screen text · *active*

> Your whole party fainted in the night.

- `src/ui/endScreen.ts:118` · text · when `win ?`

**T104240** · UI · *active*

> Time survived

- `src/ui/endScreen.ts:126` · rows = · when `in render()`

**TDA8D65** · UI · *active*

> Extract up to {this.picks} Pokémon to your PC: 1 free + {this.picks - 1} Extraction Voucher{this.picks > 2 ? 's' : ''} (1-6 or click)

Placeholders: `this.picks`, `this.picks - 1`, `this.picks > 2 ? 's' : ''`  
Example: "Extract up to 3 Pokémon to your PC: 1 free + 3 Extraction Voucher3 (1-6 or click)"

- `src/ui/endScreen.ts:144` · head = · when `this.picks > 1 ?`

**T461251** · UI · *active*

> Extract one Pokémon to your PC (1-6 or click)

- `src/ui/endScreen.ts:144` · head = · when `this.picks > 1 ?`

**TF83EC2** · Screen text · *active*

>   ✓ in PC

- `src/ui/endScreen.ts:150` · label = · when `done ?`

**TE1615A** · UI · *active*

>  (fainted)

- `src/ui/endScreen.ts:156` · map · when `m.fainted ?`
- `src/ui/matchScreen.ts:2146` · map · when `m.fainted ?`
- `src/ui/matchScreen.ts:2148` · map · when `m.fainted ?`

**T6E77A2** · UI · *active*

> Couldn't save to your PC (this browser blocks saving)

- `src/ui/endScreen.ts:162` · msg = · when `this.saveFailed ?`

**T576766** · Button · *active*

> Play again

- `src/ui/endScreen.ts:166` · button · when `in render()`

**T3BC470** · Screen text · *active*

> Playing as a guest: sign in to keep the Pokémon you win.

- `src/ui/onlineScreens.ts:294` · wrapText · when `if (me.signedIn && me.user)`

**TA7F434** · UI · *active*

> Private matches are for fun: wins, stats and Pokémon from them are not kept.

- `src/ui/onlineScreens.ts:431` · el · when `in draw()`

**TE4C270** · UI · *active*

> Could not extract

- `src/ui/onlineScreens.ts:670` · when `r.ok ?`

**TE08B86** · Screen text · *active*

> You placed #{this.place}

Placeholders: `this.place`  
Example: "You placed #2"

- `src/ui/onlineScreens.ts:687` · text · when `win ?`

**T490039** · Screen text · *active*

> You won as a guest, so nothing could be kept. Sign in next time to keep a Pokémon from every win.

- `src/ui/onlineScreens.ts:702` · wrapText · when `win ?`

**TD16E0C** · Screen text · *active*

> Sign in to keep your stats and the Pokémon you win.

- `src/ui/onlineScreens.ts:702` · wrapText · when `win ?`

**T26551A** · Screen text · *active*

> Keep {this.info.picks > 1 ? `up to ${this.info.picks} Pokémon` ...}: it goes to your PC on the server

Placeholders: `this.info.picks > 1 ? `up to ${this.info.picks} Pokémon` ...`  
Example: "Keep Pikachu: it goes to your PC on the server"

- `src/ui/onlineScreens.ts:704` · text · when `if (this.info?.picks)`

**T8E1910** · Button · *active*

> Back to the lobby

- `src/ui/onlineScreens.ts:713` · button · when `this.net.privateLobby ?`

**TC52BFB** · Button · *active*

> Watch the rest

- `src/ui/onlineScreens.ts:716` · button · when `if (this.onWatch)`

## 10b. Achievements, titles and XP

44 lines.

**T55E121** · UI · *active*

> Played a match

- `src/net/progression.ts:47` · what: · when `in matchXp()`

**TE2165C** · UI · *active*

> Outlasted {beaten} trainer{beaten === 1 ? '' : 's'}

Placeholders: `beaten`, `beaten === 1 ? '' : 's'`  
Example: "Outlasted 3 trainer3"

- `src/net/progression.ts:49` · what: · when `if (beaten)`

**T31CA62** · UI · *active*

> Squad victory

- `src/net/progression.ts:50` · what: · when `f.squad ?`

**TBB3CEE** · UI · *active*

> Damage dealt

- `src/net/progression.ts:55` · what: · when `if (dmg)`
- `src/ui/endScreen.ts:125` · rows = · when `in render()`

**T5E4915** · UI · *active*

> Survived {minutes} min

Placeholders: `minutes`  
Example: "Survived … min"

- `src/net/progression.ts:57` · what: · when `if (minutes)`

**T058BFD** · UI · *active*

> First Steps

- `src/net/progression.ts:83` · name:

**T3F31A4** · UI · *active*

> Finish an online match

- `src/net/progression.ts:83` · desc:

**T65722D** · UI · *active*

> Last One Standing

- `src/net/progression.ts:84` · name:

**T023204** · UI · *active*

> Win a match

- `src/net/progression.ts:84` · desc:

**T1B588B** · UI · *active*

> Win 10 matches

- `src/net/progression.ts:85` · desc:

**TAA0E51** · UI · *active*

> Island Legend

- `src/net/progression.ts:86` · name:

**TD8183A** · UI · *active*

> Win 50 matches

- `src/net/progression.ts:86` · desc:

**T273F12** · UI · *active*

> Legend of Almia

- `src/net/progression.ts:86` · title:

**TBB3DF8** · UI · *active*

> Stronger Together

- `src/net/progression.ts:87` · name:

**TAE850B** · UI · *active*

> Win as a squad

- `src/net/progression.ts:87` · desc:

**T5D4382** · UI · *active*

> Squad Leader

- `src/net/progression.ts:87` · title:

**T08F2D9** · UI · *active*

> Finish in the top three

- `src/net/progression.ts:88` · desc:

**T08685A** · UI · *active*

> 10 knockouts in one match

- `src/net/progression.ts:89` · desc:

**T10DB4D** · UI · *active*

> Gotta Catch Them

- `src/net/progression.ts:90` · name:

**T10FEE1** · UI · *active*

> Catch 5 Pokémon in one match

- `src/net/progression.ts:90` · desc:

**T1E93D1** · UI · *active*

> Catch 100 Pokémon

- `src/net/progression.ts:91` · desc:

**TA67D69** · UI · *active*

> Heavy Hitter

- `src/net/progression.ts:92` · name:

**TD562EF** · UI · *active*

> Deal 5,000 damage in one match

- `src/net/progression.ts:92` · desc:

**TB90755** · UI · *active*

> Storm Chaser

- `src/net/progression.ts:93` · name:

**T8B0835** · UI · *active*

> Survive 10 minutes in one match

- `src/net/progression.ts:93` · desc:

**T831B53** · UI · *active*

> Full House

- `src/net/progression.ts:94` · name:

**TD73E31** · UI · *active*

> Finish a match with six Pokémon

- `src/net/progression.ts:94` · desc:

**T3F762A** · UI · *active*

> Something Sparkly

- `src/net/progression.ts:95` · name:

**TFEEE46** · UI · *active*

> Finish a match with a shiny Pokémon

- `src/net/progression.ts:95` · desc:

**T15D727** · UI · *active*

> Shiny Hunter

- `src/net/progression.ts:95` · title:

**TFB0C25** · UI · *active*

> Alpha Wrangler

- `src/net/progression.ts:96` · name:

**T05FCFF** · UI · *active*

> Finish a match with an alpha Pokémon

- `src/net/progression.ts:96` · desc:

**T4BCE2A** · UI · *active*

> Legend Tamer

- `src/net/progression.ts:97` · name:

**T608E69** · UI · *active*

> Finish a match with a legendary Pokémon

- `src/net/progression.ts:97` · desc:

**TB1FADC** · UI · *active*

> Raised Right

- `src/net/progression.ts:98` · name:

**TC86110** · UI · *active*

> Finish a match with a Pokémon at level 50 or higher

- `src/net/progression.ts:98` · desc:

**T0F7603** · UI · *active*

> Starting a Collection

- `src/net/progression.ts:101` · name:

**TD985B4** · UI · *active*

> Keep 10 Pokémon in your PC

- `src/net/progression.ts:101` · desc:

**T81AA18** · UI · *active*

> Keep 50 Pokémon in your PC

- `src/net/progression.ts:102` · desc:

**TBB3F6F** · UI · *active*

> Ace Trainer

- `src/net/progression.ts:103` · name:

**T6694C2** · UI · *active*

> Reach trainer level 10

- `src/net/progression.ts:103` · desc:

**TCFA600** · UI · *active*

> Reach trainer level 25

- `src/net/progression.ts:104` · desc:

**T9A55DE** · UI · *active*

> Almia's Finest

- `src/net/progression.ts:105` · name:

**T86E23B** · UI · *active*

> Reach trainer level 50

- `src/net/progression.ts:105` · desc:

## 10c. The PC and storage

9 lines.

**T38B13B** · UI · *active*

> kept in this browser

- `src/ui/pcScreen.ts:33`

**TA9DB21** · Screen text · *active*

> MY PC

- `src/ui/pcScreen.ts:118` · heading · when `in render()`

**TCF6852** · Screen text · *active*

> Nothing here yet. Win a match (you pick one Pokémon to extract) or use an Extraction Voucher.

- `src/ui/pcScreen.ts:120` · heading · when `this.list.length ?`

**T374BB4** · Screen text · *active*

> BOX {this.box + 1}

Placeholders: `this.box + 1`  
Example: "BOX …"

- `src/ui/pcScreen.ts:129` · text · when `in render()`

**T6C0C58** · Screen text · *active*

> Point at a Pokémon

- `src/ui/pcScreen.ts:250` · text · when `this.list.length ?`

**T3DFE6C** · Screen text · *active*

> Your box is empty

- `src/ui/pcScreen.ts:250` · text · when `this.list.length ?`

**T40E3DF** · Screen text · *active*

> Lv {e.level}

Placeholders: `e.level`  
Example: "Lv 12"

- `src/ui/pcScreen.ts:271` · text · when `in drawSide()`

**T8D2638** · UI · *active*

> On Wonder Trade

- `src/ui/pcScreen.ts:272` · filter · when `(e as PcEntry & { wonder?: boolean }).wonder ?`

**TE736AB** · Screen text · *active*

> Victory prize

- `src/ui/pcScreen.ts:274` · text · when `e.via === 'win' ?`

## 11. Spectating and replays

11 lines.

**T5AF822** · Error message · *active*

> No such replay

- `server/main.ts:399` · error: · when `if (!file)`

**T293787** · UI · *active*

> Replays on disk

- `server/telemetry.ts:185` · g · when `in prometheus()`

**TC3BCA8** · UI · *active*

> Loading the replay

- `src/main.ts:465` · loadingScreen · when `in boot()`

**T91085F** · UI · *active*

> That replay could not be loaded

- `src/main.ts:472` · showOnline · when `in boot()`

**T49E7DD** · UI · *active*

> That replay is empty

- `src/main.ts:475` · showOnline · when `if (!lines.length)`

**T0748F1** · UI · *active*

> Watching a match

- `src/ui/socialPanel.ts:15` · watching:

**TED7015** · UI · *active*

> No replays yet.

- `src/ui/socialPanel.ts:294` · el · when `mine ?`

**TF2109A** · UI · *active*

> a trainer

- `src/ui/watchScreens.ts:30` · nameOf =

**TCFA8FB** · UI · *active*

> ← → switch trainer   ·   Esc leave

- `src/ui/watchScreens.ts:52` · bar · when `in draw()`

**T94CC46** · UI · *active*

> Replay · {mode}{nameOf(this.header.roster, this.follow)} · {fmt(this.clock - this.start)} / {fmt(this.end - this.start)} · {this.paused ? 'paused' : `${this.speed}x`}

Placeholders: `mode`, `nameOf(this.header.roster, this.follow)`, `fmt(this.clock - this.start)`, `fmt(this.end - this.start)`, `this.paused ? 'paused' : `${this.speed}x``  
Example: "Replay · …… · … / … · …"

- `src/ui/watchScreens.ts:209` · title = · when `in draw()`

**T772975** · Screen text · *active*

> Space pause · ← → 10 s · ↑ ↓ speed · Q E switch trainer · Esc leave

- `src/ui/watchScreens.ts:211` · text · when `in draw()`

## 12. Connection, server and error messages

18 lines.

**T8F8EDC** · UI · *active*

> The server is updating in a few minutes. Matches already running will finish; new ones start right after

- `server/hub.ts:29` · DRAIN_TEXT =

**T53323A** · UI · *active*

> Automatic: impossible actions in match {matchId} ({summary})

Placeholders: `matchId`, `summary`  
Example: "Automatic: impossible actions in match … (…)"

- `server/main.ts:135` · accounts.autoReport · when `in flagged`

**TE03151** · Error message · *active*

> Not allowed

- `server/main.ts:279` · error: · when `if (!OPS_TOKEN \|\| given.length !== want.length \|\| !timingSafeEqual(given, want))`

**TC068ED** · UI · *active*

> The server is updating in a few minutes. Matches running now will finish; new ones start right after.

- `server/main.ts:283` · chat.announce · when `if (on)`

**TB24149** · UI · *active*

> Error: {e.message}⏎ {String(b.stack ?? '').slice(0, 1500)}

Placeholders: `e.message`, `String(b.stack ?? '').slice(0, 1500)`  
Example: "Error: …⏎ …"

- `server/main.ts:307` · when `if (n <= 20)`

**T094B76** · UI · *active*

> not found

- `server/main.ts:334` · end · when `if (rel.startsWith('assets/'))`

**TB7D9B7** · Screen text · *active*

> You can not play from here ({who.banned})

Placeholders: `who.banned`  
Example: "You can not play from here (Pikachu)"

- `server/main.ts:473` · text: · when `if (who.banned)`

**T82DA56** · UI · *active*

> Opened in another tab

- `server/main.ts:482` · closeNow · when `if (old)`

**TE922FB** · UI · *active*

> Too many messages

- `server/main.ts:517` · closeNow · when `if (++c.msgs > MSG_RATE)`

**T5CD935** · UI · *active*

> Something went wrong in this match, so it was called off. It does not count as a loss, and anything you took out of your storage chest is back in it. Sorry!

- `server/main.ts:554` · r.abort
- `server/roomWorker.ts:120` · r.abort

**TBF2C04** · UI · *active*

> The server is restarting soon. Matches running now have a few minutes to finish.

- `server/main.ts:619` · chat.announce · when `if (hub.rooms.size)`

**T749C33** · UI · *active*

> The server is restarting for an update, so this match was called off. It does not count as a loss, and anything you took out of your storage chest is back in it.

- `server/main.ts:624` · hub.shutdown · when `if (hub.rooms.size)`

**TC526F4** · UI · *active*

> Server restarting

- `server/main.ts:630` · close · when `in shutdown()`

**T1CB4A7** · UI · *active*

> Match worker {n} failed: {e.message}

Placeholders: `n`, `e.message`  
Example: "Match worker 3 failed: …"

- `server/remoteRoom.ts:244` · onError · when `in spawn()`

**T8C41F1** · Screen text · *active*

> Something went wrong on the server, so this match was called off. It does not count as a loss, but items taken out of your storage chest during it could not be put back. Sorry!

- `server/remoteRoom.ts:251` · text: · when `in spawn()`

**T3D7D2C** · UI · *active*

> worker stopped

- `server/remoteRoom.ts:252` · aborted: · when `in spawn()`

**T43CED5** · UI · *active*

> The match is over: {winner} won

Placeholders: `winner`  
Example: "The match is over: Wes won"

- `server/room.ts:549` · releaseWatchers · when `in close()`

**T88B0C6** · Error message · *active*

> Can't reach the game server

- `src/net/connection.ts:243` · error: · when `in api()`

## 13. Moderators and the admin dashboard

155 lines.

**T38CC9F** · UI · *admin only*

> admin CLI

- `server/admin.ts:94` · run
- `server/admin.ts:166` · archiveAccount · when `case 'delete'`

**T80E029** · UI · *admin only*

> report #{a}

Placeholders: `a`  
Example: "report #…"

- `server/admin.ts:128` · logAdmin · when `case 'resolve'`

**T0C3C90** · Error message · *admin only*

> Administrators only

- `server/adminApi.ts:68` · error: · when `if (!me)`

**T9ECFCD** · Error message · *admin only*

> The admin dashboard is read-only

- `server/adminApi.ts:70` · error: · when `if (req.method !== 'GET')`

**TEC0323** · UI · *admin only*

> WHERE u.username LIKE ? ESCAPE '\'

- `server/adminApi.ts:97` · where = · when `q ?`

**T0E32DE** · Error message · *admin only*

> No such account

- `server/adminApi.ts:109` · error: · when `if (!u)`
- `server/modApi.ts:80` · error: · when `if (!u)`
- `server/modApi.ts:103` · error: · when `if (!u)`

**TEB1D44** · UI · *admin only*

> mode = ?

- `server/adminApi.ts:139` · cond.push · when `if (mode)`

**T15CE64** · UI · *admin only*

> aborted IS NULL

- `server/adminApi.ts:142` · cond.push · when `if (!withAborted)`

**TECE93A** · UI · *admin only*

> trainers LIKE ? ESCAPE '\'

- `server/adminApi.ts:144` · cond.push · when `if (player)`

**TBEDA01** · UI · *admin only*

> %"name":{likeEscape(JSON.stringify(player).slice(0, -1))}%

Placeholders: `likeEscape(JSON.stringify(player).slice(0, -1))`  
Example: "%"name":Wes%"

- `server/adminApi.ts:145` · args.push · when `if (player)`

**T1371C4** · UI · *admin only*

> WHERE {cond.join(' AND ')}

Placeholders: `cond.join(' AND ')`  
Example: "WHERE 3"

- `server/adminApi.ts:147` · where = · when `cond.length ?`

**T13BE9B** · Error message · *admin only*

> No such match

- `server/adminApi.ts:159` · error: · when `if (!old)`

**TFD1D7C** · Dashboard page · *admin only*

> Admin · Shadows of Almia Showdown

- `server/adminPage.ts:8` · admin page HTML

**TB65B77** · Dashboard page · *admin only*

> Match history

- `server/adminPage.ts:48` · admin page script
- `server/adminPage.ts:133` · admin page HTML

**TE1FD9F** · Dashboard page · *admin only*

> Could not reach the server

- `server/adminPage.ts:57` · admin page script

**T2C20F3** · Dashboard page · *admin only*

> Bad reply (HTTP

- `server/adminPage.ts:58` · admin page script

**TAC40B6** · Dashboard page · *admin only*

> Can not show this

- `server/adminPage.ts:76` · admin page HTML

**TA00351** · Dashboard page · *admin only*

> Sign in to the game in this browser with an administrator account, then reload this page.

- `server/adminPage.ts:77` · admin page HTML

**TA02107** · Dashboard page · *admin only*

> Signed in as

- `server/adminPage.ts:91` · admin page script

**TBDCAA7** · Dashboard page · *admin only*

> Players connected

- `server/adminPage.ts:95` · admin page script

**T1B6C52** · Dashboard page · *admin only*

> Signed in

- `server/adminPage.ts:95` · admin page script

**T329B4F** · Dashboard page · *admin only*

> Computer trainers in matches

- `server/adminPage.ts:95` · admin page script

**TA54FB3** · Dashboard page · *admin only*

> On the online menu

- `server/adminPage.ts:96` · admin page script

**T35E6B5** · Dashboard page · *admin only*

> In a lobby, queue or party

- `server/adminPage.ts:96` · admin page script

**T57E279** · Dashboard page · *admin only*

> Playing a match

- `server/adminPage.ts:96` · admin page script

**T84477D** · Dashboard page · *admin only*

> Disconnected, seat held

- `server/adminPage.ts:96` · admin page script

**TB7763C** · Dashboard page · *admin only*

> · refreshes every 10 s while this tab is open.

- `server/adminPage.ts:97` · admin page script

**T598C3E** · Dashboard page · *admin only*

> Name Kind Where Match Connected

- `server/adminPage.ts:99` · admin page script

**T16A692** · Dashboard page · *admin only*

> Nobody is connected.

- `server/adminPage.ts:100` · admin page HTML

**TBB9F28** · Dashboard page · *admin only*

> Disconnected from a running match (seat held for a reconnect) Name Kind Match

- `server/adminPage.ts:101` · admin page script

**T32AA9B** · Dashboard page · *admin only*

> No match is running.

- `server/adminPage.ts:115` · admin page HTML

**T5FA2F1** · Dashboard page · *admin only*

> Trainer Kind Status

- `server/adminPage.ts:115` · admin page script

**T6F4520** · Dashboard page · *admin only*

> disconnected (seat held)

- `server/adminPage.ts:115` · admin page script

**T7AE94F** · Dashboard page · *admin only*

> Refreshes every 10 s while this tab is open. Finished matches move to Match history.

- `server/adminPage.ts:116` · admin page HTML

**T52C897** · Dashboard page · *admin only*

> Loading matches...

- `server/adminPage.ts:125` · admin page HTML

**TC9117F** · Dashboard page · *admin only*

> Full match records (duration, every trainer with bots marked, places, stats) start

- `server/adminPage.ts:134` · admin page script

**TEF6037** · Dashboard page · *admin only*

> . Matches before that were recorded only for signed-in players (their place, outcome and stats):

- `server/adminPage.ts:134` · admin page script

**T2874A8** · Dashboard page · *admin only*

> such match

- `server/adminPage.ts:134` · admin page script

**TE0002E** · Dashboard page · *admin only*

> s page.

- `server/adminPage.ts:134` · admin page script

**TCAB5CF** · Dashboard page · *admin only*

> Any mode

- `server/adminPage.ts:135` · admin page HTML

**T1AD2F1** · Dashboard page · *admin only*

> Any mode Public Private

- `server/adminPage.ts:135` · admin page script

**T8DE3DF** · Dashboard page · *admin only*

> include called-off matches

- `server/adminPage.ts:136` · admin page HTML

**TD4D073** · Dashboard page · *admin only*

> Ended Mode Duration Winner Trainers Humans Bots

- `server/adminPage.ts:137` · admin page script

**TE59B21** · Dashboard page · *admin only*

> called off

- `server/adminPage.ts:138` · admin page HTML

**TA5EA87** · Dashboard page · *admin only*

> No completed matches recorded

- `server/adminPage.ts:139` · admin page script

**T35012B** · Dashboard page · *admin only*

> for this filter

- `server/adminPage.ts:139` · admin page script

**T6CE190** · Dashboard page · *admin only*

> Loading the match...

- `server/adminPage.ts:148` · admin page HTML

**T1F2A3A** · Dashboard page · *admin only*

> Recorded before full match logging began: only the signed-in players\\

- `server/adminPage.ts:154` · admin page script

**TBB4309** · Dashboard page · *admin only*

> Place Trainer Outcome Catches KOs Eliminations Damage Survived

- `server/adminPage.ts:155` · admin page script

**TB70CE3** · Dashboard page · *admin only*

> Back to the list

- `server/adminPage.ts:157` · admin page HTML
- `server/adminPage.ts:166` · admin page HTML

**TAED2DF** · Dashboard page · *admin only*

> of play · winner:

- `server/adminPage.ts:162` · admin page script

**T82B5DC** · Dashboard page · *admin only*

> Place Trainer Kind Outcome Catches KOs Eliminations Damage Survived

- `server/adminPage.ts:163` · admin page script

**T9925EE** · Dashboard page · *admin only*

> not recorded

- `server/adminPage.ts:165` · admin page HTML

**T56462F** · Dashboard page · *admin only*

> Last seen

- `server/adminPage.ts:177` · admin page HTML
- `server/adminPage.ts:200` · admin page script

**TD715CC** · Dashboard page · *admin only*

> Username Role Created Last seen PC

- `server/adminPage.ts:177` · admin page script

**T4D289B** · Dashboard page · *admin only*

> No account matches "

- `server/adminPage.ts:180` · admin page script

**TFC2341** · Dashboard page · *admin only*

> Loading the account...

- `server/adminPage.ts:191` · admin page HTML

**T662F38** · Dashboard page · *admin only*

> Saved account

- `server/adminPage.ts:198` · admin page HTML

**T1A3610** · Dashboard page · *admin only*

> Account id

- `server/adminPage.ts:199` · admin page script

**TCCA0ED** · Dashboard page · *admin only*

> online now

- `server/adminPage.ts:200` · admin page HTML

**T7396A2** · Dashboard page · *admin only*

> online now (

- `server/adminPage.ts:200` · admin page script

**TD2B803** · Dashboard page · *admin only*

> online menu

- `server/adminPage.ts:200` · admin page script

**T446C08** · Dashboard page · *admin only*

> playing match

- `server/adminPage.ts:200` · admin page script

**TED041C** · Dashboard page · *admin only*

> muted until

- `server/adminPage.ts:202` · admin page script

**TFDD825** · Dashboard page · *admin only*

> in good standing

- `server/adminPage.ts:202` · admin page script

**T3CD483** · Dashboard page · *admin only*

> , trainer levels are hidden in the game)

- `server/adminPage.ts:203` · admin page script

**T56781B** · Dashboard page · *admin only*

> Career stats

- `server/adminPage.ts:205` · admin page script

**TB7C2BA** · Dashboard page · *admin only*

> damage · best place

- `server/adminPage.ts:205` · admin page script

**T5560E1** · Dashboard page · *admin only*

> None saved: Poké Dollars start fresh every match.

- `server/adminPage.ts:206` · admin page HTML

**TBC81E0** · Dashboard page · *admin only*

> Storage chest

- `server/adminPage.ts:207` · admin page script

**TB830AD** · Dashboard page · *admin only*

> Pokémon

- `server/adminPage.ts:209` · admin page HTML

**TAADF37** · Dashboard page · *admin only*

> saved Pokémon) Saved account data: what this account keeps between matches. A match\\

- `server/adminPage.ts:209` · admin page script

**T3EC512** · Dashboard page · *admin only*

> The PC is empty.

- `server/adminPage.ts:210` · admin page HTML

**TB8EF4E** · Dashboard page · *admin only*

> Back to accounts

- `server/adminPage.ts:211` · admin page HTML

**T5256C4** · Dashboard page · *admin only*

> Matches Back to accounts

- `server/adminPage.ts:211` · admin page script

**TF43444** · Dashboard page · *admin only*

> Ended Mode Place Outcome

- `server/adminPage.ts:214` · admin page script

**T795DCF** · Dashboard page · *admin only*

> No recorded matches.

- `server/adminPage.ts:216` · admin page HTML

**T18CE54** · Dashboard page · *admin only*

> #am tr.click

- `server/adminPage.ts:217` · admin page script

**T230B78** · Error message · *admin only*

> Moderators only

- `server/modApi.ts:45` · error: · when `if (!me \|\| me.banned \|\| (me.role !== 'mod' && me.role !== 'admin'))`

**T28BB54** · UI · *admin only*

> WHERE r.resolved = 0

- `server/modApi.ts:65` · open = · when `url.searchParams.get('all') ?`

**T57FA07** · UI · *admin only*

> report #{Number(b.id)}

Placeholders: `Number(b.id)`  
Example: "report #…"

- `server/modApi.ts:73` · logMod · when `if (req.method === 'POST' && path === '/api/mod/resolve')`

**TB125EB** · Error message · *admin only*

> Only an admin can act on a moderator

- `server/modApi.ts:104` · error: · when `if ((u.role === 'admin' \|\| (u.role === 'mod' && !admin)) && u.id !== me.id)`

**T35E691** · UI · *admin only*

> No reason given

- `server/modApi.ts:105` · reason = · when `if (req.method === 'POST' && path === '/api/mod/action')`

**T62FD01** · UI · *admin only*

>  (+{r.devices} device{r.devices === 1 ? '' : 's'}, {r.ips} address{r.ips === 1 ? '' : 'es'} for a week)

Placeholders: `r.devices`, `r.devices === 1 ? '' : 's'`, `r.ips`, `r.ips === 1 ? '' : 'es'`  
Example: " (+… device…, … address… for a week)"

- `server/modApi.ts:116` · logMod · when `b.devices ?`

**TFF1326** · UI · *admin only*

> A moderator disconnected you

- `server/modApi.ts:124` · kick · when `case 'kick'`

**TA7B6D2** · Error message · *admin only*

> Admins only

- `server/modApi.ts:128` · error: · when `if (!admin)`
- `server/modApi.ts:135` · error: · when `if (!admin)`
- `server/modApi.ts:178` · error: · when `if (!admin)`
- `server/modApi.ts:185` · error: · when `if (!admin)`

**T1A7C8E** · UI · *admin only*

> This account was deleted

- `server/modApi.ts:136` · kick · when `case 'delete'`

**T07D106** · Error message · *admin only*

> Unknown action

- `server/modApi.ts:144` · error: · when `if (req.method === 'POST' && path === '/api/mod/action')`

**TB8610F** · Error message · *admin only*

> No such message

- `server/modApi.ts:157` · error: · when `if (!row)`

**T9B19E8** · Error message · *admin only*

> Say something

- `server/modApi.ts:171` · error: · when `if (!text)`

**TCAC977** · Dashboard page · *admin only*

> Moderators · Shadows of Almia Showdown

- `server/modPage.ts:7` · moderators page HTML

**T2ACA3F** · Dashboard page · *admin only*

> Bad reply

- `server/modPage.ts:57` · moderators page script

**T1D4BDE** · Dashboard page · *admin only*

> #tabs button

- `server/modPage.ts:64` · moderators page script
- `server/adminPage.ts:66` · admin page script

**T2314CD** · Dashboard page · *admin only*

> Open the game

- `server/modPage.ts:75` · moderators page HTML

**TDA7D49** · Dashboard page · *admin only*

> . Sign in to the game with a moderator account, then come back. Open the game

- `server/modPage.ts:75` · moderators page script

**TAFC65D** · Dashboard page · *admin only*

> Right now

- `server/modPage.ts:77` · moderators page HTML

**T1BD10D** · Dashboard page · *admin only*

> Live matches

- `server/modPage.ts:78` · moderators page script
- `server/modPage.ts:143` · moderators page HTML
- `server/adminPage.ts:48` · admin page script
- `server/adminPage.ts:113` · admin page HTML

**T3B1BB4** · Dashboard page · *admin only*

> Open reports

- `server/modPage.ts:78` · moderators page script

**TBA7936** · Dashboard page · *admin only*

> Flagged today

- `server/modPage.ts:78` · moderators page script

**TFFADD0** · Dashboard page · *admin only*

> New today

- `server/modPage.ts:78` · moderators page script

**T1FE1ED** · Dashboard page · *admin only*

> Chat today

- `server/modPage.ts:78` · moderators page script

**TF3B6E0** · Dashboard page · *admin only*

> Matches today

- `server/modPage.ts:78` · moderators page script

**T3E6BEB** · Dashboard page · *admin only*

> Announce Send

- `server/modPage.ts:80` · moderators page script

**TA9F7A3** · Dashboard page · *admin only*

> All recent

- `server/modPage.ts:86` · moderators page HTML

**TA640D9** · Dashboard page · *admin only*

> Reports Open · All recent # When Against By What

- `server/modPage.ts:86` · moderators page script

**TEB7CB0** · Dashboard page · *admin only*

> Nothing open. Good.

- `server/modPage.ts:88` · moderators page HTML

**T0C979B** · Dashboard page · *admin only*

> Find a player

- `server/modPage.ts:93` · moderators page HTML

**T7F1AA7** · Dashboard page · *admin only*

> Did you mean:

- `server/modPage.ts:97` · moderators page script

**T09FD28** · Dashboard page · *admin only*

> public profile

- `server/modPage.ts:102` · moderators page HTML

**TA6F151** · Dashboard page · *admin only*

> 10 minutes

- `server/modPage.ts:104` · moderators page HTML

**TF030C3** · Dashboard page · *admin only*

> 1 hour

- `server/modPage.ts:104` · moderators page HTML

**T2D8A6F** · Dashboard page · *admin only*

> 1 day

- `server/modPage.ts:104` · moderators page HTML

**TFDB8D5** · Dashboard page · *admin only*

> 1 week

- `server/modPage.ts:104` · moderators page HTML

**T0B76DA** · Dashboard page · *admin only*

> and their devices

- `server/modPage.ts:105` · moderators page HTML

**T56070C** · Dashboard page · *admin only*

> Ban and their devices

- `server/modPage.ts:105` · moderators page script

**T7E48E1** · Dashboard page · *admin only*

> player mod admin Set role (admin) Delete account (admin)

- `server/modPage.ts:106` · moderators page script

**T7BFEA9** · Dashboard page · *admin only*

> Reports against

- `server/modPage.ts:107` · moderators page HTML

**TD1563D** · Dashboard page · *admin only*

> Anti-cheat flags

- `server/modPage.ts:108` · moderators page HTML

**T7626A9** · Dashboard page · *admin only*

> Nothing said

- `server/modPage.ts:109` · moderators page HTML

**TF43B9A** · Dashboard page · *admin only*

> Devices Device Address Seen Accounts

- `server/modPage.ts:110` · moderators page script

**T3C4F36** · Dashboard page · *admin only*

> No other accounts on these devices.

- `server/modPage.ts:111` · moderators page HTML

**T198C44** · Dashboard page · *admin only*

> Also used by:

- `server/modPage.ts:111` · moderators page script

**TCE4B2E** · Dashboard page · *admin only*

> Collection log

- `server/modPage.ts:112` · moderators page HTML

**TDC65FA** · Dashboard page · *admin only*

> Every change to their PC and storage chest: Pokémon kept from matches, trades and Wonder Trades both ways, chest changes.

- `server/modPage.ts:112` · moderators page HTML

**T76EB72** · Dashboard page · *admin only*

> Nothing yet

- `server/modPage.ts:112` · moderators page HTML
- `server/modPage.ts:113` · moderators page HTML

**TA9CB8E** · Dashboard page · *admin only*

> Collection log Every change to their PC and storage chest: Pokémon kept from matches, trades and Wonder Trades both ways, chest changes.

- `server/modPage.ts:112` · moderators page script

**T381C65** · Dashboard page · *admin only*

> Flagged players · last two weeks

- `server/modPage.ts:137` · moderators page HTML

**TEA8133** · Dashboard page · *admin only*

> Flagged players · last two weeks Flags are impossible actions the server refused (a ball thrown past its range, someone else\\

- `server/modPage.ts:137` · moderators page script

**TF55110** · Dashboard page · *admin only*

> Nobody flagged.

- `server/modPage.ts:138` · moderators page HTML

**T929A55** · Dashboard page · *admin only*

> Live matches Match Mode Time Players Watching

- `server/modPage.ts:143` · moderators page script

**T683526** · Dashboard page · *admin only*

> No matches running.

- `server/modPage.ts:144` · moderators page HTML

**T66C0ED** · Dashboard page · *admin only*

> Server ·

- `server/modPage.ts:152` · moderators page script

**T6C11CB** · Dashboard page · *admin only*

> DRAINING: no new matches

- `server/modPage.ts:153` · moderators page HTML

**T7CC71E** · Dashboard page · *admin only*

> Let matches start

- `server/modPage.ts:153` · moderators page HTML

**T34A118** · Dashboard page · *admin only*

> DRAINING: no new matches Let matches start

- `server/modPage.ts:153` · moderators page script

**TF97FDB** · Dashboard page · *admin only*

> Drain (no new matches)

- `server/modPage.ts:153` · moderators page script

**TA8322D** · Dashboard page · *admin only*

> The last hour

- `server/modPage.ts:154` · moderators page HTML

**T3D510E** · Dashboard page · *admin only*

> Players online

- `server/modPage.ts:154` · moderators page script

**TBEFCFF** · Dashboard page · *admin only*

> Simulation per step

- `server/modPage.ts:154` · moderators page script

**T2BB749** · Dashboard page · *admin only*

> Worst step

- `server/modPage.ts:154` · moderators page script

**TDA0C26** · Dashboard page · *admin only*

> Clock late by

- `server/modPage.ts:154` · moderators page script

**TB398AC** · Dashboard page · *admin only*

> Messages in

- `server/modPage.ts:154` · moderators page script

**T527BF1** · Dashboard page · *admin only*

> Back up now

- `server/modPage.ts:157` · moderators page HTML

**TEC950D** · Dashboard page · *admin only*

> No errors. Nice.

- `server/modPage.ts:159` · moderators page HTML

**T403138** · Dashboard page · *admin only*

> Errors Last Where Count What

- `server/modPage.ts:159` · moderators page script

**T349985** · Dashboard page · *admin only*

> Backing up...

- `server/modPage.ts:162` · moderators page script

**T2137F6** · Dashboard page · *admin only*

> Shiny boost

- `server/modPage.ts:168` · moderators page script

**TCF96A9** · Dashboard page · *admin only*

> Storm speed

- `server/modPage.ts:168` · moderators page script

**T3936CC** · Dashboard page · *admin only*

> said in chat at the start time

- `server/modPage.ts:168` · moderators page script

**TA9B869** · Dashboard page · *admin only*

> on now

- `server/modPage.ts:169` · moderators page HTML

**T11AFA1** · Dashboard page · *admin only*

> No events.

- `server/modPage.ts:171` · moderators page HTML

**T2EF379** · Dashboard page · *admin only*

> New event

- `server/modPage.ts:172` · moderators page HTML

**TF9DC7A** · Dashboard page · *admin only*

> hours · amount

- `server/modPage.ts:173` · moderators page HTML

**T9DC69C** · Dashboard page · *admin only*

> Starts for hours · amount Create

- `server/modPage.ts:173` · moderators page script

**T482B35** · Dashboard page · *admin only*

> Moderators\\

- `server/modPage.ts:188` · moderators page script

## 14. Other

1 lines.

**T70BCF5** · UI · *active*

> The Fan-tasy Tileset

- `src/ground/fanGround.ts:119`

## Review: contradictions, stale references and confusing wording

Collected automatically by the checks listed beside each, plus the notes below. Nothing has been changed.

| id | text | why it is listed |
|---|---|---|
| T6694C2 | Reach trainer level 10 | trainer levels and XP are hidden in the game (LEVELS_ON is off) |
| TCFA600 | Reach trainer level 25 | trainer levels and XP are hidden in the game (LEVELS_ON is off) |
| T86E23B | Reach trainer level 50 | trainer levels and XP are hidden in the game (LEVELS_ON is off) |
| T07499C | The first Ranger is free; more Rangers unlock with your trainer level online, and more trainers are coming soon | trainer levels and XP are hidden in the game (LEVELS_ON is off) |
| T4AA9A9 | SPA {st.spa}  SPD {st.spd}  SPE {st.spe} | two spaces in a row |
| T40B8A5 | Trainer level {pr.level} | trainer levels and XP are hidden in the game (LEVELS_ON is off) |
| TCC7AED, T49B53D | paralyzed! / Paralyzed! | the same words with different capitals or punctuation |
| T538164, T574F1F |   ·  Level {prog.after.level}! /   ·  Level {prog.after.level} | the same words with different capitals or punctuation |
| T3D88A3, TC93011, TCCA0ED, T7396A2 | Online now ·  / Online now / online now / online now ( | the same words with different capitals or punctuation |
| T6CDAC8, T6818ED | Sign in to trade / Sign in to trade. | the same words with different capitals or punctuation |
| T475C84, T094B76 | Not found / not found | the same words with different capitals or punctuation |
| T84477D, T6F4520 | Disconnected, seat held / disconnected (seat held) | the same words with different capitals or punctuation |

### Notes from reading through

| id | text | note |
|---|---|---|
| TB04B1E | Team Dim Sun Grunt (placeholder) | a character name that says "(placeholder)"; shown wherever that character is named |
| T4C8790 | Gardevoi | Mega Stone short labels are cut to 8 letters (Gardevoi, Tyranita, Steelixi, Latiosit...); fine as a slot label, reads as a typo if it appears anywhere wider |
| TEE6974 | Works from the bag: your Pokémon last 2 minutes in the storm before falling asleep | the Storm Mask describes Pokémon falling asleep in the storm; the trainer now passes out and is taken by Darkrai, so check the two read as one rule |
| TA34BC3 | Balls bounce off its dark aura. Wear it under 10% HP and use a Snag Machine | Shadow Pokémon catching is given as "under 10% HP" here and "under ten percent" by Veteran Sarge; same rule, two spellings |
| TE830A8 | Auto-battle is fine for walking. For a real fight, take the controls yourself. R, trainer. R. | refers to the R key for auto-battle; R is still the key, keep in mind if controls are remapped |
