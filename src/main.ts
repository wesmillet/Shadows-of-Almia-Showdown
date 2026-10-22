import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { hashSeed, Rng } from './core/rng';
import { createGround } from './ground';
import { Sunnyside } from './ground/sunnyside';
import { View } from './render/view';
import { CONFIG, SPAWNS, SPECIES } from './sim/data';
import { SHOPS } from './sim/town';
import { Match } from './sim/match';
import { Assets } from './sprites/assets';
import { SpriteRegistry } from './sprites/pokemonSprite';
import { RangerSprites } from './sprites/rangerSprite';
import { EndScreen } from './ui/endScreen';
import { MatchScreen } from './ui/matchScreen';
import { RollScreen } from './ui/rollScreen';
import { setUiSkin, text, type GameContext, type Screen } from './ui/screens';
import { TitleScreen } from './ui/titleScreen';
import { PcScreen } from './ui/pcScreen';
import { CharacterScreen } from './ui/characterScreen';
import { loadLook, lookHooks, saveLook } from './look';
import { Connection, serverBase } from './net/connection';
import { MirrorMatch } from './net/mirror';
import type { ServerMsg } from './net/protocol';
import { starterChoices, unlockedFromPc } from './sim/starters';
import { loadPc } from './pc';
import { LobbyScreen, OnlineEndScreen, OnlineScreen, PrivateLobbyScreen, type HubActions } from './ui/onlineScreens';
import { joinCodeDialog, leaderboardDialog, profileDialog, replaysDialog, Toaster } from './ui/socialPanel';
import { parseReplay, ReplayFeed, ReplayPlayer, setupSpectate } from './ui/watchScreens';
import { canWear, lookRequirement } from './net/progression';
import { ChatPanel } from './ui/overlay';
import type { PcEntry } from './pc';
import { MoveGallery } from './ui/moveGallery';
import { PixelUi } from './ui/pixelUi';
import type { GroundRenderer } from './ground/types';
import { VISITOR_DEXES } from './sim/visitors';

/** The title screen's demo team: Infernape, shiny Rayquaza, Latios, shiny Jirachi, Tinkaton at level 100. */
const DEMO_PARTY = ['0392', '0384-shiny', '0381', '0385-shiny', '0959'];
const DEMO_LEVEL = 100;

/** Pokémon on the title screen: Darkrai, Cresselia, and the small ones that wander in. */
export const TITLE_CAST = ['0491', '0488', '0025', '0387', '0133', '0393', '0390', '0447'];

/** A set of species plus everything they can evolve into. */
function withEvolutions(dexes: Iterable<string>): Set<string> {
  const out = new Set<string>(dexes);
  const queue = [...out];
  while (queue.length) {
    const d = queue.pop() as string;
    for (const e of SPECIES.get(d)?.evolves ?? []) if (!out.has(e.to)) {
      out.add(e.to);
      queue.push(e.to);
    }
  }
  return new Set([...out].filter((d) => SPECIES.has(d)));
}

/**
 * Every species a match can show: wild tables, land bosses, rivals, the champion, the demo team, and their evolutions.
 * The starter roll's pool is not in here (it is large): the roll loads its own reel, and a match loads its starter's line.
 */
function matchCast(): Set<string> {
  const out = new Set<string>(['0491', ...DEMO_PARTY, ...SPAWNS.trainerPool, ...SHOPS.challenger.party, ...VISITOR_DEXES]);
  for (const b of Object.values(SPAWNS.biomes) as Array<{ table?: Array<{ dex: string }> }>) for (const r of b.table ?? []) out.add(r.dex);
  for (const b of (SPAWNS as unknown as { bosses?: Array<{ dex: string }> }).bosses ?? []) out.add(b.dex);
  return withEvolutions(out);
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const view = new View(stage, CONFIG.map.tileSize);
  const input = new Input(view.hudCanvas);
  const assets = new Assets();

  let status = 'Loading…';
  const drawLoading = (): void => {
    const ctx = view.hud;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(0, 0, view.width, view.height);
    text(view, 'SHADOWS OF ALMIA SHOWDOWN', view.width / 2, view.height / 2 - 20 * view.baseScale, 42, { align: 'center', weight: '800', color: '#cdbfff', ctx });
    text(view, status, view.width / 2, view.height / 2 + 24 * view.baseScale, 16, { align: 'center', color: '#b9b4cc', ctx });
  };
  drawLoading();
  // The UI's pixel font (BoldPixels by YukiPixels, CC BY-SA 4.0); the system font stands in if it fails.
  try {
    const face = new FontFace('BoldPixels', `url(${import.meta.env.BASE_URL}assets/fonts/BoldPixels.ttf)`);
    document.fonts.add(await face.load());
  } catch (e) {
    console.warn('[showdown] BoldPixels font failed to load', e);
  }
  drawLoading();

  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ? hashSeed(params.get('seed')!) : (Math.random() * 0xffffffff) >>> 0;

  const t0 = performance.now();
  const sprites = new SpriteRegistry(assets);
  const rangersP = RangerSprites.load(assets);
  // The title scene and the starter roll load first; every other Pokémon the match can meet
  // (wild tables, bosses, rivals, the champion, and all their evolutions) loads behind the title screen.
  const first = new Set(TITLE_CAST);
  await sprites.preload(first, (done, total) => {
    status = `Loading sprites ${done}/${total}`;
    drawLoading();
  }, true);
  // Everything else trickles in behind the title at low priority; anything needed sooner jumps the queue.
  void sprites.preload([...matchCast()].filter((d) => !first.has(d)));
  const rangers = await rangersP;
  // The trainer look picked on the title screen (Trainer, C), kept in this browser.
  const look = loadLook();
  if (look) await rangers.setRole('player', look);
  const ui = new PixelUi(assets);
  await ui.load();
  setUiSkin(ui);
  const t1 = performance.now();
  if (params.has('verify')) {
    await verifyDemoRoom(assets, view);
    return;
  }
  // ?map=<name> loads assets/maps/<name>.json instead of the configured map (testing).
  const mapName = params.get('map') ?? CONFIG.map.name;
  const ground = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, seed, (p) => {
    status = `Painting terrain ${Math.round(p * 100)}%`;
    drawLoading();
  }, mapName);

  let screen: Screen | null = null;
  const game: GameContext = {
    view,
    input,
    setScreen(s: Screen) {
      screen?.exit?.();
      screen = s;
      // For tests and the console: whatever is up now.
      const d = (window as unknown as { showdown?: Record<string, unknown> }).showdown;
      if (d) d.screen = s;
      s.enter?.();
    },
  };

  console.info(`Shadows of Almia Showdown, build ${__BUILD__}`);
  const debug = window as unknown as { showdown: Record<string, unknown> };
  debug.showdown = { view, seed };

  let currentGround: GroundRenderer = ground;
  let currentSeed = seed;
  // Each match on the same island rolls its own starts, spawns and loot.
  let matchNo = 0;
  const matchRng = (): Rng => new Rng((currentSeed + Math.imul(0x9e3779b9, ++matchNo)) >>> 0);

  /** A plain "getting ready" screen while a match's first sprites load. */
  const loadingScreen = (label: () => string): Screen => ({
    step() {},
    render() {
      status = label();
      drawLoading();
    },
  });

  const startMatch = async (starters: string[], opts: { level?: number; partyCap?: number } = {}): Promise<void> => {
    let progress = '';
    game.setScreen(loadingScreen(() => `Heading out${progress}`));
    const match = new Match({ ground: currentGround, rng: matchRng(), sprites }, starters, opts);
    // Only what is on the island at the start has to be here before play: every party and every wild.
    const present = new Set<string>();
    for (const t of match.trainers) for (const m of t.party) present.add(m.dex);
    for (const w of match.wilds) present.add(w.dex);
    await sprites.preload(present, (done, total) => (progress = ` ${done}/${total}`), true);
    void sprites.preload(withEvolutions(starters), undefined, true);
    debug.showdown.match = match;
    const screen: MatchScreen = new MatchScreen(game, match, rangers, assets, ui, () => {
      game.setScreen(new EndScreen(game, match, screen, () => void showTitle(true)));
    });
    debug.showdown.screen = screen;
    game.setScreen(screen);
    console.info(`[showdown] match started with ${starters.join(', ')}`);
  };

  /** Demo mode: a max-level showcase team, no starter roll (title button, D, or ?demo=1). */
  const startDemo = (): void => {
    const team = DEMO_PARTY.filter((d) => SPECIES.has(d));
    void startMatch(team.length ? team : ['0025'], { level: DEMO_LEVEL, partyCap: team.length });
  };

  /** Move Gallery (title button, M, or ?moves=1): every move played on a practice dummy. */
  const startGallery = async (): Promise<void> => {
    const match = new Match({ ground: currentGround, rng: new Rng(currentSeed), sprites }, ['0026'], { level: 50 });
    debug.showdown.match = match;
    const screen = new MoveGallery(game, match, rangers, assets, ui, sprites, () => void showTitle(false));
    debug.showdown.screen = screen;
    game.setScreen(screen);
  };

  // ---------------------------------------------------------------- online

  /** The game server, when this build has one (not on GitHub Pages). */
  const base = serverBase();
  const net = base ? new Connection(base) : null;
  if (net) {
    net.look = loadLook();
    void net.open().then(async () => {
      const me = await net.refreshMe();
      // Signed in: the account's look is the one to wear.
      if (me.signedIn && typeof me.look === 'string' && me.look !== loadLook()) {
        lookHooks.saved = null;
        saveLook(me.look);
        void rangers.setRole('player', me.look);
      }
      lookHooks.saved = (c) => {
        net.look = c;
        if (net.me.signedIn) void net.api('/api/look', { look: c });
      };
      // A shared link: ?replay=<match> plays a replay, ?profile=<name> opens a trainer's profile.
      const rp = params.get('replay');
      const pf = params.get('profile');
      const watch = params.get('watch');
      if (rp && /^m[a-z0-9]{1,16}$/.test(rp)) void startReplay(rp);
      else if (watch && /^m[a-z0-9]{1,16}$/.test(watch)) {
        showOnline();
        net.send({ t: 'spectate', matchId: watch });
      }
      else if (pf) {
        showOnline();
        void profileDialog(net, pf.slice(0, 32), (id) => void startReplay(id));
      }
      // A look worn before looks were earned (or on another account): back to a free one.
      const worn = loadLook();
      if (worn && lookLock(worn)) {
        saveLook('civ_00');
        void rangers.setRole('player', 'civ_00');
      }
    });
  }

  /** The online match this browser is playing, and the one it is watching (by id). */
  let playingId: string | null = null;
  let watchingId: string | null = null;
  const toaster = net ? new Toaster(net) : null;
  if (net) debug.showdown.net = net;

  /** With a game server, looks are earned (src/net/progression.ts); why one is locked, or null. */
  const lookLock = (look: string): string | null => {
    if (!net) return null;
    const req = lookRequirement(look);
    if (!req) return null;
    const me = net.me;
    if (canWear(look, me.signedIn ? (me.progress?.level ?? 1) : 0, me.achievements ?? [])) return null;
    if (!me.signedIn) return 'Sign in';
    return req.level !== undefined ? `Level ${req.level}` : (req.achievement?.name ?? 'Locked');
  };

  const showOnline = (message = ''): void => {
    if (!net) return;
    playingId = null;
    watchingId = null;
    // Still in a private lobby (after its match): back there.
    if (net.privateLobby) return showPrivate();
    game.setScreen(new OnlineScreen(game, net, hubActions, message));
  };

  const showPrivate = (): void => {
    if (!net) return;
    game.setScreen(new PrivateLobbyScreen(game, net, () => showOnline()));
  };

  /** The server rolls the starters (it must know what was offered); this browser spins the reels. */
  const rollStarter = (onPicked: (index: number) => void): void => {
    if (!net) return;
    const off = net.on((m) => {
      if (m.t !== 'roll') return;
      off();
      const rollSeed = m.seed;
      const pool = m.pool ?? [];
      game.setScreen(new RollScreen(game, sprites, rollSeed, (dex) => onPicked(starterChoices(rollSeed, pool).indexOf(dex)), null, pool));
    });
    net.send({ t: 'roll' });
  };

  const hubActions: HubActions = {
    find: (mode) => {
      if (!net) return;
      const party = net.social.party;
      // A party's leader queues everyone (each of them is then asked to pick a starter).
      if (party && party.members.length > 1) return net.send({ t: 'party', a: 'queue', mode: 'casual' });
      rollStarter((pick) => {
        net.send({ t: 'queue', pick, mode });
        game.setScreen(new LobbyScreen(game, net, (why) => showOnline(why ?? '')));
      });
    },
    back: () => void showTitle(false),
    createPrivate: () => net?.send({ t: 'private', a: 'create' }),
    joinPrivate: () => {
      void joinCodeDialog().then((code) => {
        if (code) net?.send({ t: 'private', a: 'join', code });
      });
    },
    watchFeatured: () => net?.send({ t: 'spectate', featured: true }),
    replays: () => {
      if (net) void replaysDialog(net, (r) => void startReplay(r.id));
    },
    leaderboards: () => {
      if (net) void leaderboardDialog(net, (name) => void profileDialog(net, name, (id) => void startReplay(id)));
    },
    watchFriend: (name) => net?.send({ t: 'spectate', name }),
    profile: (name) => {
      if (net) void profileDialog(net, name, (id) => void startReplay(id));
    },
  };

  // What the server can start from any screen: a party or private lobby's pick, a match, a lobby, watching.
  net?.on((m) => {
    if (m.t === 'pick') {
      rollStarter((pick) => {
        net.send({ t: 'queue', pick });
        if (m.reason === 'party') game.setScreen(new LobbyScreen(game, net, (why) => showOnline(why ?? '')));
        else showPrivate();
      });
    } else if (m.t === 'start') {
      if (playingId !== m.matchId) void startOnline(m);
    } else if (m.t === 'private') {
      if (m.lobby && screen instanceof OnlineScreen) showPrivate();
    } else if (m.t === 'spectate') {
      if (watchingId !== m.matchId && !playingId) void startSpectate(m);
    } else if (m.t === 'spectateEnd') {
      toaster?.show(m.text, 4);
      if (watchingId) showOnline();
    } else if (m.t === 'unqueued') {
      // Picking a starter for a party that broke up: back to the hub.
      if (screen instanceof RollScreen) showOnline(m.text);
    }
  });

  const startOnline = async (start: Extract<ServerMsg, { t: 'start' }>): Promise<void> => {
    if (!net) return;
    playingId = start.matchId;
    watchingId = null;
    net.rated = null;
    net.progress = null;
    game.setScreen(loadingScreen(() => 'Heading out'));
    const mirror = new MirrorMatch({ ground: currentGround, rng: new Rng(start.seed), sprites }, net, start.you, start.roster, rangers);
    await mirror.ready;
    const chat = new ChatPanel(net, { compact: true, collapsed: true });
    debug.showdown.match = mirror.match;
    debug.showdown.mirror = mirror;
    const screen: MatchScreen = new MatchScreen(game, mirror.match, rangers, assets, ui, () => {
      const end = mirror.ended ?? { outcome: mirror.match.outcome ?? 'loss', place: 0 };
      chat.dispose();
      const leave = () => {
        mirror.dispose();
        net.send({ t: 'leave' });
        playingId = null;
      };
      // Knocked out while the match goes on: the rest of it can be watched.
      const watch = end.outcome === 'loss' ? () => {
        leave();
        net.send({ t: 'spectate', matchId: start.matchId });
      } : null;
      game.setScreen(new OnlineEndScreen(game, net, screen, end.outcome, end.place, () => {
        leave();
        showOnline();
      }, watch));
    });
    screen.online = { cmd: net.cmd.bind(net) };
    mirror.onReply = (text, seconds) => screen.say(text, seconds);
    debug.showdown.screen = screen;
    game.setScreen(screen);
  };

  /** Watching a live match (a few seconds behind). */
  const startSpectate = async (h: Extract<ServerMsg, { t: 'spectate' }>): Promise<void> => {
    if (!net) return;
    watchingId = h.matchId;
    game.setScreen(loadingScreen(() => `Joining the match (${h.delay} s behind)`));
    const mirror = new MirrorMatch({ ground: currentGround, rng: new Rng(h.seed), sprites }, net, h.follow, h.roster, rangers, { observe: true });
    await mirror.ready;
    if (watchingId !== h.matchId) return mirror.dispose();
    const chat = new ChatPanel(net, { compact: true, collapsed: true });
    const screen = new MatchScreen(game, mirror.match, rangers, assets, ui);
    const leave = () => {
      chat.dispose();
      mirror.dispose();
      showOnline();
    };
    setupSpectate(screen, mirror, net, h, leave);
    const off = net.on((m) => {
      if (m.t === 'spectateEnd' || (m.t === 'spectate' && m.matchId !== h.matchId)) {
        off();
        chat.dispose();
        mirror.dispose();
      }
    });
    debug.showdown.match = mirror.match;
    debug.showdown.mirror = mirror;
    debug.showdown.screen = screen;
    game.setScreen(screen);
  };

  /** A finished match, played back from its recording. */
  const startReplay = async (id: string): Promise<void> => {
    if (!net) return;
    game.setScreen(loadingScreen(() => 'Loading the replay'));
    let body = '';
    try {
      const r = await fetch(`${net.base}/api/replay/${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      body = await r.text();
    } catch {
      return showOnline('That replay could not be loaded');
    }
    const { header, lines } = parseReplay(body);
    if (!lines.length) return showOnline('That replay is empty');
    const feed = new ReplayFeed();
    const first = (header.roster.find((r) => r.human) ?? header.roster[0])?.trainerId ?? 0;
    const mirror = new MirrorMatch({ ground: currentGround, rng: new Rng(header.seed), sprites }, feed, first, header.roster, rangers, { observe: true });
    const player = new ReplayPlayer(feed, mirror, header, lines, () => {
      mirror.dispose();
      showOnline();
    });
    const screen = new MatchScreen(game, mirror.match, rangers, assets, ui);
    player.attach(screen);
    debug.showdown.match = mirror.match;
    debug.showdown.mirror = mirror;
    debug.showdown.screen = screen;
    debug.showdown.replay = player;
    game.setScreen(screen);
  };

  const showPc = async (): Promise<void> => {
    if (net?.me.signedIn) {
      const r = await net.api<{ pc: PcEntry[] }>('/api/pc');
      if (r.pc) return game.setScreen(new PcScreen(game, sprites, assets, () => void showTitle(false), r.pc, 'kept on the server'));
    }
    game.setScreen(new PcScreen(game, sprites, assets, () => void showTitle(false)));
  };

  const showRoll = (): void => {
    // A fresh roll every time, even on a fixed ?seed island.
    // The pool grows with this browser's PC (offline) like an account's does online.
    const pool = unlockedFromPc(loadPc().map((e) => e.dex));
    game.setScreen(new RollScreen(game, sprites, (Math.random() * 0xffffffff) >>> 0, (dex) => void startMatch([dex]), showRoll, pool));
  };

  const showTitle = async (regenerate: boolean): Promise<void> => {
    if (regenerate) {
      currentSeed = (Math.random() * 0xffffffff) >>> 0;
      status = 'Painting a new island…';
      drawLoading();
      currentGround = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, currentSeed, (p) => {
        status = `Painting terrain ${Math.round(p * 100)}%`;
        drawLoading();
      }, mapName);
    }
    const title = new TitleScreen(game, currentGround, sprites, assets, showRoll, startDemo, () => void startGallery(), () => void showPc(), () => game.setScreen(new CharacterScreen(game, rangers, () => void showTitle(false), lookLock)), net ? () => showOnline() : null);
    debug.showdown.screen = title;
    game.setScreen(title);
  };

  // ?demo=1 starts the demo team; ?party=0025,0387 skips the title and roll with that party (debugging).
  const party = params.get('party');
  if (params.get('moves')) {
    void startGallery();
  } else if (params.get('demo')) {
    startDemo();
  } else if (party) {
    const starters = party.split(',').filter((d) => SPECIES.has(d));
    void startMatch(starters.length ? starters : ['0025']);
  } else {
    void showTitle(false);
  }

  const loop = new GameLoop({
    step(dt) {
      screen?.step(dt, input);
      input.endStep();
    },
    render(alpha, frameDt) {
      screen?.render(alpha, frameDt);
    },
  });
  loop.start();
  debug.showdown.loop = loop;
  console.info(`[showdown] seed ${seed}; ground: ${ground.label}; sprites ${Math.round(t1 - t0)} ms, terrain ${Math.round(performance.now() - t1)} ms`);
}

/**
 * ?verify=demo: re-render the Sunnyside demo room from sunnyside.json with the
 * autotile/tile code and compare it pixel-for-pixel against
 * demo_room_render.png. Logs the mismatch count and shows both side by side.
 */
async function verifyDemoRoom(assets: Assets, view: View): Promise<void> {
  const sunny = await Sunnyside.load(assets);
  const ref = await assets.loadImage('tiles/sunnyside/demo_room_render.png');
  if (!sunny || !ref) {
    console.error('[showdown] verify: tileset or reference render missing');
    return;
  }
  const mine = sunny.renderDemoRoom();
  const refC = document.createElement('canvas');
  refC.width = ref.naturalWidth;
  refC.height = ref.naturalHeight;
  refC.getContext('2d')!.drawImage(ref, 0, 0);
  const a = mine.getContext('2d')!.getImageData(0, 0, mine.width, mine.height).data;
  const b = refC.getContext('2d')!.getImageData(0, 0, refC.width, refC.height).data;
  // Canvas stores premultiplied alpha, so semi-transparent layers (shadows,
  // clouds) can round a channel by a step or two; opaque pixels must be exact.
  let mismatch = 0;
  let beyondRounding = 0;
  let opaqueMismatch = 0;
  let maxDiff = 0;
  const total = Math.min(a.length, b.length) / 4;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    const ta = a[i + 3] ?? 0;
    const tb = b[i + 3] ?? 0;
    if (ta === 0 && tb === 0) continue;
    const d = Math.max(Math.abs((a[i] ?? 0) - (b[i] ?? 0)), Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)), Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)), Math.abs(ta - tb));
    if (d === 0) continue;
    mismatch++;
    if (d > maxDiff) maxDiff = d;
    if (d > 3) beyondRounding++;
    if (ta === 255 && tb === 255 && d > 0) opaqueMismatch++;
  }
  const result = { width: mine.width, height: mine.height, pixels: total, mismatch, beyondRounding, opaqueMismatch, maxDiff, ok: beyondRounding === 0 };
  console.info(`[showdown] demo_room re-render: ${mismatch} of ${total} pixels differ, ${beyondRounding} by more than rounding (max channel diff ${maxDiff}) (${result.ok ? 'MATCH' : 'MISMATCH'})`);
  (window as unknown as { showdown: Record<string, unknown> }).showdown = { verify: result };
  const ctx = view.hud;
  ctx.fillStyle = '#0b0a12';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.imageSmoothingEnabled = false;
  const s = Math.min(view.width / 2 / mine.width, view.height / mine.height);
  ctx.drawImage(mine, 0, 0, mine.width * s, mine.height * s);
  ctx.drawImage(refC, view.width / 2, 0, refC.width * s, refC.height * s);
  text(view, `re-render (left) vs demo_room_render.png (right): ${mismatch} px differ`, view.width / 2, view.height - 12, 14, { align: 'center' });
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:2em">Shadows of Almia Showdown failed to start:\n${String(e?.stack ?? e)}</pre>`;
});
