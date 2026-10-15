import { describe, expect, it } from 'vitest';
import { inDarkness, newDarkness, stepDarkness } from './darkness';
import { CONFIG } from './data';

describe('darkness schedule', () => {
  // A map radius of 195 tiles matches the 320x224 map (centre 160, 112).
  it('pulses on its schedule, creeps inward and ends in the finale', () => {
    const d = newDarkness();
    expect(inDarkness(d, 0, 0, 160, 112)).toBe(false);
    stepDarkness(d, CONFIG.darkness.pulseSeconds - 0.01, 195);
    expect(d.phase).toBe(0);
    stepDarkness(d, 0.02, 195);
    expect(d.phase).toBe(1);
    expect(d.pulsed).toBe(true);
    expect(d.targetRadius).toBe(CONFIG.darkness.radiiTiles[0]);
    for (let i = 0; i < 60 * 30; i++) stepDarkness(d, 1 / 60, 195);
    expect(d.radius).toBeGreaterThan(d.targetRadius);
    for (let i = 0; i < 60 * 60; i++) stepDarkness(d, 1 / 60, 195);
    expect(d.radius).toBeCloseTo(d.targetRadius, 1);
    expect(inDarkness(d, 0, 0, 160, 112)).toBe(true);
    expect(inDarkness(d, 160, 112, 160, 112)).toBe(false);
    for (let p = 1; p < CONFIG.darkness.radiiTiles.length; p++) stepDarkness(d, CONFIG.darkness.pulseSeconds + 0.01, 195);
    expect(d.finale).toBe(true);
    expect(d.nextPulseIn).toBe(-1);
  });
});
