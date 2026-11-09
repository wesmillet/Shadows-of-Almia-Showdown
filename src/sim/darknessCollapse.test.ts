import { describe, expect, it } from 'vitest';
import { newDarkness, stepDarkness, inDarkness } from './darkness';
import { CONFIG } from './data';

describe('the last light goes out', () => {
  it('closes the safe circle to nothing 180 s after the final pulse', () => {
    const d = newDarkness();
    const radii = CONFIG.darkness.radiiTiles;
    let t = 0;
    while (!d.finale && t < 5000) { stepDarkness(d, 1, 200); t++; }
    expect(d.finale).toBe(true);
    for (let i = 0; i < 100; i++) stepDarkness(d, 1, 200);
    expect(d.targetRadius).toBe(radii[radii.length - 1]);
    let collapsedOnce = 0;
    for (let i = 0; i < 200; i++) { stepDarkness(d, 1, 200); if (d.collapsed) collapsedOnce++; }
    expect(collapsedOnce).toBe(1);
    expect(d.targetRadius).toBe(0);
    expect(d.radius).toBe(0);
    expect(inDarkness(d, 50.5, 50.2, 50, 50)).toBe(true);
  });
});
