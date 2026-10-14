import { describe, expect, it } from 'vitest';
import fxManifest from '../../assets/fx/guardian_signs/manifest.json';
import { effectiveness, MOVES, SPECIES, statsAtLevel, TYPE_CHART } from './data';
import spawns from '../../data/spawns.json';

const FX_MANIFEST = (fxManifest as { effects: Record<string, { frames: number }> }).effects;

describe('type chart', () => {
  it('has all 18 types with symmetric coverage', () => {
    expect(TYPE_CHART.types).toHaveLength(18);
    for (const t of TYPE_CHART.types) expect(TYPE_CHART.colors[t]).toBeDefined();
    expect(effectiveness('water', ['fire'])).toBe(2);
    expect(effectiveness('electric', ['ground'])).toBe(0);
    expect(effectiveness('fire', ['water', 'grass'])).toBe(1);
    expect(effectiveness('dragon', ['fairy'])).toBe(0);
  });
});

describe('moves data', () => {
  it('has at least 20 moves across the five VFX families with valid types and shapes', () => {
    expect(MOVES.size).toBeGreaterThanOrEqual(20);
    const families = new Set<string>();
    for (const m of MOVES.values()) {
      expect(TYPE_CHART.types).toContain(m.type);
      expect(['single', 'line', 'cone', 'ring', 'self']).toContain(m.shape);
      expect(['burst', 'projectile', 'beam', 'ring', 'cloud']).toContain(m.vfx);
      expect(m.cooldown).toBeGreaterThanOrEqual(1.5);
      expect(m.cooldown).toBeLessThanOrEqual(6);
      families.add(m.vfx);
    }
    expect(families.size).toBe(5);
  });
});

describe('species data', () => {
  it('only uses known types and spawn tables reference known species', () => {
    for (const s of SPECIES.values()) {
      for (const t of s.types) expect(TYPE_CHART.types).toContain(t);
      expect(s.moves.length).toBe(4);
      for (const id of s.moves) expect(MOVES.has(id), `${s.name} knows unknown move ${id}`).toBe(true);
    }
    for (const biome of Object.values(spawns.biomes)) {
      for (const row of biome.table) expect(SPECIES.has(row.dex)).toBe(true);
    }
    for (const dex of spawns.starterPool) expect(SPECIES.has(dex)).toBe(true);
  });

  it('computes level stats', () => {
    const s = statsAtLevel({ hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 }, 15);
    expect(s.hp).toBe(35);
    expect(s.atk).toBe(21);
  });

  it('every move lists Guardian Signs effects that exist, with valid anchors and modes', () => {
    for (const m of MOVES.values()) {
      expect(m.fx?.length, m.id).toBeGreaterThan(0);
      for (const part of m.fx ?? []) {
        expect(FX_MANIFEST[part.id], `${m.id}: ${part.id}`).toBeDefined();
        expect(['target', 'attacker', 'projectile']).toContain(part.anchor);
        if (part.mode) expect(['beam', 'stream', 'status']).toContain(part.mode);
        if (part.anchor === 'projectile') expect((FX_MANIFEST[part.id]?.frames ?? 0) <= 8, `${m.id}: projectile ${part.id} should be a short loop`).toBe(true);
      }
    }
    // Impacts prefer effects with four or more frames: every move with impacts has an animated one.
    for (const m of MOVES.values()) {
      const impacts = (m.fx ?? []).filter((p) => p.anchor === 'target' && !p.mode);
      if (impacts.length) expect(Math.max(...impacts.map((p) => FX_MANIFEST[p.id]?.frames ?? 0)), `${m.id}`).toBeGreaterThanOrEqual(4);
    }
  });
});
