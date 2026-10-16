/**
 * The darkness: every pulse the safe radius around the Shadow Crystal
 * shrinks and darkness sweeps inward from the edges. Pokémon left in it
 * grow drowsy, fall asleep, and take Bad Dreams damage; wild Pokémon gain
 * a purple aura and cannot be caught. Three seconds back in the light
 * wakes a sleeper. In the final phase Darkrai appears.
 */
import { CONFIG } from './data';

export interface DarknessState {
  /** Index of the current phase (0 = before the first pulse). */
  phase: number;
  /** Radius the darkness is sweeping toward, and the radius it is at now. */
  targetRadius: number;
  radius: number;
  /** Seconds until the next pulse, or -1 after the last. */
  nextPulseIn: number;
  /** Set on the step a pulse fires. */
  pulsed: boolean;
  /** Final phase: Darkrai is loose. */
  finale: boolean;
}

export function newDarkness(): DarknessState {
  return { phase: 0, targetRadius: Infinity, radius: Infinity, nextPulseIn: CONFIG.darkness.pulseSeconds, pulsed: false, finale: false };
}

/** Advances the schedule and the sweep. `mapRadius` is the distance from the centre to the farthest corner. */
export function stepDarkness(d: DarknessState, dt: number, mapRadius: number): void {
  d.pulsed = false;
  const radii = CONFIG.darkness.radiiTiles;
  if (d.nextPulseIn >= 0) {
    d.nextPulseIn -= dt;
    if (d.nextPulseIn <= 0) {
      d.phase++;
      d.pulsed = true;
      d.targetRadius = radii[Math.min(d.phase, radii.length) - 1] ?? radii[radii.length - 1] ?? 3;
      if (!Number.isFinite(d.radius)) d.radius = mapRadius;
      d.finale = d.phase >= radii.length;
      d.nextPulseIn = d.phase >= radii.length ? -1 : CONFIG.darkness.pulseSeconds;
    }
  }
  if (Number.isFinite(d.targetRadius) && d.radius > d.targetRadius) {
    // A slow creep you can walk ahead of, not a wave.
    const speed = CONFIG.darkness.sweepTilesPerSecond;
    d.radius = Math.max(d.targetRadius, d.radius - speed * dt);
  }
}

export function phaseLabel(d: DarknessState): string {
  if (d.finale) return 'SHOWDOWN: Darkrai is here';
  if (d.phase === 0) return 'daylight';
  return `darkness phase ${d.phase}`;
}

export function inDarkness(d: DarknessState, x: number, y: number, cx: number, cy: number): boolean {
  if (!Number.isFinite(d.radius)) return false;
  return Math.hypot(x - cx, y - cy) > d.radius;
}
