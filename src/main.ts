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
import { loadLook } from './look';
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

  const showRoll = (): void => {
    // A fresh roll every time, even on a fixed ?seed island.
    game.setScreen(new RollScreen(game, sprites, (Math.random() * 0xffffffff) >>> 0, (dex) => void startMatch([dex]), showRoll));
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
    const title = new TitleScreen(game, currentGround, sprites, assets, showRoll, startDemo, () => void startGallery(), () => game.setScreen(new PcScreen(game, sprites, () => void showTitle(false))), () => game.setScreen(new CharacterScreen(game, rangers, () => void showTitle(false))));
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
