/** Beating Lugia no longer makes it join: it escapes, and only a ball catches it. Rare Candy is only sold by the merchant. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('Lugia must be caught with a ball', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const fresh = () => new Match({ ground: world.ground(), rng: new Rng(7), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);

  it('a beaten Lugia leaves instead of joining, with no voucher', () => {
    const m = fresh();
    const p = m.seats[0]!.trainer;
    const L = m.makeMon('0249', 80, null, p.x + 2, p.y);
    L.legend = true;
    const before = p.party.length;
    const vouchers = () => p.items.reduce((n, e) => n + (e?.id === 'extraction-voucher' ? e.count : 0), 0);
    const v0 = vouchers();
    m.visitors.legendYields(L, p.party[0]!);
    expect(p.party.length).toBe(before);
    expect(p.party).not.toContain(L);
    expect(L.captured).toBe(true);
    expect(vouchers()).toBe(v0);
  });

  it('other legendaries still join when beaten', () => {
    const m = fresh();
    const p = m.seats[0]!.trainer;
    const H = m.makeMon('0720', 70, null, p.x + 2, p.y);
    H.legend = true;
    m.visitors.legendYields(H, p.party[0]!);
    expect(p.party).toContain(H);
  });

  it('no town shop sells Rare Candy', () => {
    const shops = readFileSync(join(import.meta.dirname, '..', 'data', 'shops.json'), 'utf8');
    expect(shops).not.toContain('rare-candy');
    expect(readFileSync(join(import.meta.dirname, '..', 'src', 'sim', 'visitors.ts'), 'utf8')).toContain("['rare-candy', 1200]");
  });
});
