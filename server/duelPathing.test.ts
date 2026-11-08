/** A battling Pokémon with an obstacle between it and its foe goes round it instead of pushing into it. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { canStand, moveAround } from '../src/sim/movement';

describe('battlers path round obstacles', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('closes in on foes behind walls that walking straight at them never gets past', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(11), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const g = m.ground;
    const reach = 2.5;
    // How battlers used to close in: straight at the foe, stepping round only what is right in front.
    const straight = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
      const p = { x: a.x, y: a.y, detourSide: 0, detourT: 0 };
      for (let i = 0; i < 60 * 12; i++) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d <= reach) return true;
        moveAround(g, p, ((b.x - p.x) / d) * 0.05, ((b.y - p.y) / d) * 0.05, 0.22, 1 / 60);
      }
      return false;
    };
    // Tiles to walk from a to b (8 ways, no cutting corners), or Infinity beyond `cap`.
    const walk = (a: { x: number; y: number }, b: { x: number; y: number }, cap: number): number => {
      const key = (x: number, y: number) => y * g.cols + x;
      const goal = key(Math.floor(b.x), Math.floor(b.y));
      let front = [[Math.floor(a.x), Math.floor(a.y)] as [number, number]];
      const seen = new Set([key(front[0]![0], front[0]![1])]);
      for (let steps = 0; steps <= cap; steps++) {
        const next: Array<[number, number]> = [];
        for (const [x, y] of front) {
          if (key(x, y) === goal) return steps;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!g.walkable(nx, ny) || seen.has(key(nx, ny))) continue;
            if (dx && dy && (!g.walkable(x + dx, y) || !g.walkable(x, y + dy))) continue;
            seen.add(key(nx, ny));
            next.push([nx, ny]);
          }
        }
        front = next;
      }
      return Infinity;
    };
    const cases: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];
    for (let y = 20; y < g.rows - 20 && cases.length < 8; y += 2) {
      for (let x = 20; x < g.cols - 20 && cases.length < 8; x += 2) {
        const a = { x: x + 0.5, y: y + 0.5 };
        const b = { x: x + 0.5, y: y + 8.5 };
        if (!canStand(g, a.x, a.y, 0.35) || !canStand(g, b.x, b.y, 0.35) || m.nav.clearLine(a.x, a.y, b.x, b.y)) continue;
        if (walk(a, b, 20) > 20 || straight(a, b)) continue;
        cases.push({ a, b });
      }
    }
    expect(cases.length).toBeGreaterThan(3);
    const hold = (m as unknown as { holdRange(mm: unknown, f: unknown, r: number, dt: number, o: unknown): boolean }).holdRange.bind(m);
    let ok = 0;
    for (const { a, b } of cases) {
      const mon = m.makeMon('0004', 20, null, a.x, a.y);
      const foe = m.makeMon('0007', 20, null, b.x, b.y);
      let reached = false;
      for (let i = 0; i < 60 * 30 && !reached; i++) reached = hold(mon, foe, reach, 1 / 60, { speed: 3, stepEvery: 99 });
      if (reached) ok++;
    }
    expect(ok).toBe(cases.length);
  });
});
