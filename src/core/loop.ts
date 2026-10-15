/**
 * Fixed-timestep game loop with render interpolation.
 * The simulation advances in exact STEP increments; rendering receives the
 * fraction of the next step that has elapsed so moving things can be drawn
 * between their previous and current positions.
 */
export const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 6;

export interface LoopClient {
  step(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  /** Slow motion for inspecting effects (1 = real time); set from the console as showdown.loop.timeScale. */
  timeScale = 1;
  private accumulator = 0;
  private last = 0;
  private running = false;

  constructor(private readonly client: LoopClient) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25; // tab was hidden: don't spiral
    frameDt *= this.timeScale;
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.client.step(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.client.render(this.accumulator / STEP, frameDt);
    requestAnimationFrame(this.frame);
  };
}
