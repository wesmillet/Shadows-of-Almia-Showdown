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
import { MatchScreen } from './ui/matchScreen';
import { text, type GameContext, type Screen } from './ui/screens';

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const view = new View(canvas, CONFIG.map.tileSize);
  const input = new Input(canvas);
  const assets = new Assets();

  let status = 'Loading…';
  const drawLoading = (): void => {
    const ctx = view.ctx;
    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(0, 0, view.width, view.height);
    text(view, 'NIGHTFALL ROYALE', view.width / 2, view.height / 2 - 20 * view.baseScale, 42, { align: 'center', weight: '800', color: '#cdbfff' });
    text(view, status, view.width / 2, view.height / 2 + 24 * view.baseScale, 16, { align: 'center', color: '#b9b4cc' });
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

  const starters = (params.get('party') ?? '0025,0387,0133').split(',').filter((d) => SPECIES.has(d));
  const match = new Match({ ground, rng: new Rng(seed), sprites }, starters.length ? starters : ['0025']);
  game.setScreen(new MatchScreen(game, match, rangers));
  (window as unknown as { nightfall: unknown }).nightfall = { match, view, seed };

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
  console.info(`[nightfall] seed ${seed}; ground: ${ground.label}; sprites ${Math.round(t1 - t0)} ms, terrain ${Math.round(performance.now() - t1)} ms`);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:2em">Nightfall Royale failed to start:\n${String(e?.stack ?? e)}</pre>`;
});
