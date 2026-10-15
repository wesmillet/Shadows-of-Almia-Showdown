/**
 * Evolution. A species lists its evolutions in species.json (`evolves`: the
 * species it becomes and the level it happens at; several entries, like
 * Eevee's, mean one is picked at random). Party Pokémon evolve in the field
 * when a level-up takes them past that level: a short glow, then the swap
 * (EVOLVE_SWAP seconds in), then the glow fades (EVOLVE_SECONDS in all).
 * Wild Pokémon spawned above an evolution level appear already evolved.
 */
import type { Rng } from '../core/rng';
import { AnimPlayer, type PokemonSprites } from '../sprites/pokemonSprite';
import { SPECIES, statsAtLevel, type SpeciesDef } from './data';
import type { Mon } from './entities';

export const EVOLVE_SWAP = 1.1;
export const EVOLVE_SECONDS = 1.9;

/** The evolutions open to a species at a level (empty when none is due). */
export function evolutionsAt(sp: SpeciesDef, level: number): string[] {
  return (sp.evolves ?? []).filter((e) => level >= e.level && SPECIES.has(e.to)).map((e) => e.to);
}

/** Picks one due evolution, or null. */
export function pickEvolution(sp: SpeciesDef, level: number, rng: Rng): string | null {
  const due = evolutionsAt(sp, level);
  return due.length ? rng.pick(due) : null;
}

/**
 * The form a Pokémon of `dex` has at `level`, following its line as far as the level
 * allows. With `wild`, each step past an evolution level is only a chance (10% at the
 * level, +4% a level above it, at most 50%), so base forms stay common in the field.
 */
export function formAtLevel(dex: string, level: number, rng: Rng, wild = false): string {
  let cur = dex;
  for (let guard = 0; guard < 4; guard++) {
    const sp = SPECIES.get(cur);
    const next = sp ? pickEvolution(sp, level, rng) : null;
    if (!next || !sp) break;
    if (wild) {
      const at = Math.min(...(sp.evolves ?? []).map((e) => e.level));
      if (!rng.chance(Math.min(0.5, 0.1 + 0.04 * (level - at)))) break;
    }
    cur = next;
  }
  return cur;
}

/**
 * Turns `m` into `to`: species, types, stats (keeping the same share of HP),
 * sprites. Moves from the old species' kit become the new kit's move in the
 * same slot; anything taught by a TM stays.
 */
export function applyEvolution(m: Mon, to: SpeciesDef, sprites: PokemonSprites): void {
  const from = m.species;
  const share = m.maxHp > 0 ? m.hp / m.maxHp : 1;
  // Species with level-up learnsets keep the moves they know; fixed kits swap slot for slot.
  if (!to.learnset?.length) m.moves = m.moves.map((id, i) => (id === from.moves[i] ? (to.moves[i] ?? id) : id));
  m.dex = to.dex;
  m.species = to;
  if (m.name === from.name) m.name = to.name;
  m.types = [...to.types];
  m.stats = statsAtLevel(to.stats, m.level);
  if (!m.boss) {
    m.maxHp = m.stats.hp;
    m.hp = m.fainted ? 0 : Math.max(1, Math.round(share * m.maxHp));
  }
  m.sprites = sprites;
  m.anim = new AnimPlayer(sprites);
  m.anim.dir = m.dir;
}
