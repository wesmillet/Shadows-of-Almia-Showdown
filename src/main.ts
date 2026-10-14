import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { hashSeed, Rng } from './core/rng';
import { createGround } from './ground';
import { Sunnyside } from './ground/sunnyside';
import { View } from './render/view';
import { CONFIG, SPECIES } from './sim/data';
import { Match } from './sim/match';
import { Assets } from './sprites/assets';
import { SpriteRegistry } from './sprites/pokemonSprite';
import { RangerSprites } from './sprites/rangerSprite';
import { EndScreen } from './ui/endScreen';
import { MatchScreen } from './ui/matchScreen';
import { RollScreen } from './ui/rollScreen';
import { text, type GameContext, type Screen } from './ui/screens';
import { TitleScreen } from './ui/titleScreen';
import { PixelUi } from './ui/pixelUi';
import type { GroundRenderer } from './ground/types';

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

  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ? hashSeed(params.get('seed')!) : (Math.random() * 0xffffffff) >>> 0;

  const t0 = performance.now();
  const sprites = new SpriteRegistry(assets);
  const rangersP = RangerSprites.load(assets);
  await sprites.preload(SPECIES.keys(), (done, total) => {
    status = `Loading sprites ${done}/${total}`;
    drawLoading();
  });
  const rangers = await rangersP;
  const ui = new PixelUi(assets);
  await ui.load();
  const t1 = performance.now();
  if (params.has('verify')) {
    await verifyDemoRoom(assets, view);
    return;
  }
  const ground = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, seed, (p) => {
    status = `Painting terrain ${Math.round(p * 100)}%`;
    drawLoading();
  });

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

  const debug = window as unknown as { showdown: Record<string, unknown> };
  debug.showdown = { view, seed };

  let currentGround: GroundRenderer = ground;
  let currentSeed = seed;

  const startMatch = (starters: string[]): void => {
    const match = new Match({ ground: currentGround, rng: new Rng(currentSeed), sprites }, starters);
    debug.showdown.match = match;
    const screen: MatchScreen = new MatchScreen(game, match, rangers, assets, ui, () => {
      game.setScreen(new EndScreen(game, match, screen, () => void showTitle(true)));
    });
    game.setScreen(screen);
    console.info(`[showdown] match started with ${starters.join(', ')}`);
  };

  const showRoll = (): void => {
    game.setScreen(new RollScreen(game, sprites, currentSeed, (dex) => startMatch([dex])));
  };

  const showTitle = async (regenerate: boolean): Promise<void> => {
    if (regenerate) {
      currentSeed = (Math.random() * 0xffffffff) >>> 0;
      status = 'Painting a new island…';
      drawLoading();
      currentGround = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, currentSeed, (p) => {
        status = `Painting terrain ${Math.round(p * 100)}%`;
        drawLoading();
      });
    }
    game.setScreen(new TitleScreen(game, currentGround, rangers, showRoll));
  };

  // ?party=0025,0387 skips the title and roll with that party (debugging).
  const party = params.get('party');
  if (party) {
    const starters = party.split(',').filter((d) => SPECIES.has(d));
    startMatch(starters.length ? starters : ['0025']);
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
