import { describe, expect, it } from 'vitest';
import { inDarkness, newDarkness, stepDarkness } from './darkness';
import { CONFIG } from './data';

describe('darkness schedule', () => {
  it('pulses every 90 seconds, sweeps inward and ends in the finale', () => {
    const d = newDarkness();
    expect(inDarkness(d, 0, 0, 24, 24)).toBe(false);
    stepDarkness(d, CONFIG.darkness.pulseSeconds - 0.01, 34);
    expect(d.phase).toBe(0);
    stepDarkness(d, 0.02, 34);
    expect(d.phase).toBe(1);
    expect(d.pulsed).toBe(true);
    expect(d.targetRadius).toBe(CONFIG.darkness.radiiTiles[0]);
    for (let i = 0; i < 60 * 20; i++) stepDarkness(d, 1 / 60, 34);
    expect(d.radius).toBeCloseTo(d.targetRadius, 1);
    expect(inDarkness(d, 0, 0, 24, 24)).toBe(true);
    expect(inDarkness(d, 24, 24, 24, 24)).toBe(false);
    for (let p = 1; p < CONFIG.darkness.radiiTiles.length; p++) stepDarkness(d, CONFIG.darkness.pulseSeconds + 0.01, 34);
    expect(d.finale).toBe(true);
    expect(d.nextPulseIn).toBe(-1);
  });
});
