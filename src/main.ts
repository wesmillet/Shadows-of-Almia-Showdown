import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { hashSeed, Rng } from './core/rng';
import { createGround } from './ground';
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
  const t1 = performance.now();
  const ground = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, CONFIG.map.tileSize, seed, (p) => {
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
    const screen: MatchScreen = new MatchScreen(game, match, rangers, assets, () => {
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
      currentGround = await createGround(assets, CONFIG.map.cols, CONFIG.map.rows, CONFIG.map.tileSize, currentSeed, (p) => {
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

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:2em">Shadows of Almia Showdown failed to start:\n${String(e?.stack ?? e)}</pre>`;
});
