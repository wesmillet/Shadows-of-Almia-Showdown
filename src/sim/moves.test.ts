import { describe, expect, it } from 'vitest';
import tmsJson from '../../data/items/tms.json';
import { canLearnTm, MOVES, moveValue, movesAt, pickMoves, roleOf, species, SPECIES } from './data';
import { moveReach } from './battle';

/** Species whose learnsets are pinned by hand (scripts/learnsets.py OVERRIDES) or who have no learnset. */
const PINNED = new Set(['0446', '0143', '0491']);

describe('movesets', () => {
  it('every level-up attack fits how its species fights', () => {
    const off: string[] = [];
    for (const s of SPECIES.values()) {
      if (PINNED.has(s.dex)) continue;
      const role = roleOf(s);
      if (role === 'mixed') continue;
      for (const [, id] of s.learnset ?? []) {
        const m = MOVES.get(id);
        if (!m || m.category === 'status' || m.signature) continue;
        if (m.category !== role) off.push(`${s.name} ${id}`);
      }
    }
    expect(off).toEqual([]);
  });

  it('a Pokémon carries its best attack and one of another type', () => {
    const infernape = species('0392');
    expect(roleOf(infernape)).toBe('physical');
    const at50 = movesAt(infernape, 50);
    expect(at50).toContain('flare-blitz');
    expect(at50).toContain('close-combat');
    expect(at50.every((id) => MOVES.get(id)?.category === 'physical')).toBe(true);
    // Given Flamethrower and Fire Punch, a puncher keeps the punch.
    expect(pickMoves(infernape, ['flamethrower', 'fire-punch', 'brick-break'])).toEqual(['fire-punch', 'brick-break']);
    // A signature move always stays.
    expect(movesAt(species('0249'), 60)).toContain('aeroblast');
  });

  it('values an attack by power, type and the stat it uses', () => {
    const charizard = species('0006');
    expect(moveValue(charizard, 'flamethrower')).toBeGreaterThan(moveValue(charizard, 'fire-punch'));
    expect(moveValue(charizard, 'flamethrower')).toBeGreaterThan(moveValue(charizard, 'thunderbolt'));
    expect(moveValue(charizard, 'swords-dance')).toBe(0);
  });
});

describe('TMs', () => {
  const tms = (tmsJson as { tms: Array<{ id: string; move: string; rare?: boolean }> }).tms;

  it('teach moves that exist; the rare ones are the strongest attacks or set-up moves', () => {
    for (const t of tms) {
      const m = MOVES.get(t.move);
      expect(m, t.id).toBeDefined();
      if (t.rare && m && m.category !== 'status') expect(m.power, t.id).toBeGreaterThanOrEqual(80);
      if (!t.rare && m && m.category !== 'status') expect(m.power, t.id).toBeGreaterThanOrEqual(70);
    }
  });

  it('go to Pokémon that fight the way the move hits', () => {
    const infernape = species('0392');
    expect(canLearnTm(infernape, 'thunder-punch')).toBe(true);
    expect(canLearnTm(infernape, 'flamethrower')).toBe(false);
    expect(canLearnTm(infernape, 'swords-dance')).toBe(true);
    expect(canLearnTm(infernape, 'nasty-plot')).toBe(false);
    const gengar = species('0094');
    expect(canLearnTm(gengar, 'thunderbolt')).toBe(true);
    expect(canLearnTm(gengar, 'earthquake')).toBe(false);
    const lucario = species('0448');
    expect(roleOf(lucario)).toBe('mixed');
    expect(canLearnTm(lucario, 'close-combat') && canLearnTm(lucario, 'flash-cannon')).toBe(true);
  });
});

describe('move tuning', () => {
  it('a stronger single-target attack is worth at least as much per second as a weaker one', () => {
    // Plain single-target attacks (no status, no stat change, no recoil, not a quick filler move).
    const quick = new Set(['quick-attack', 'bullet-punch', 'shadow-sneak', 'ice-shard', 'aqua-jet', 'mach-punch', 'sucker-punch']);
    const plain = [...MOVES.values()].filter((m) => m.shape === 'single' && m.power > 0 && !m.signature && !m.status && !m.stages && !m.recoil && !quick.has(m.id));
    plain.sort((a, b) => a.power - b.power);
    for (let i = 1; i < plain.length; i++) {
      const a = plain[i - 1] as (typeof plain)[number];
      const b = plain[i] as (typeof plain)[number];
      if (b.power > a.power) expect(b.power / b.cooldown, `${b.id} vs ${a.id}`).toBeGreaterThanOrEqual(a.power / a.cooldown - 1.2);
    }
  });

  it('reach: rings are close work, lines and aimed shots reach further', () => {
    const r = (id: string) => moveReach(MOVES.get(id) as NonNullable<ReturnType<typeof MOVES.get>>);
    expect(r('earthquake')).toBeLessThan(r('flamethrower'));
    expect(r('flamethrower')).toBeLessThan(r('shadow-ball'));
    expect(r('swords-dance')).toBeGreaterThan(50);
  });
});
