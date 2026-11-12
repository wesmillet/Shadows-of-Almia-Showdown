/** What a Pokémon in a match goes home as, in a PC (a Mega as its base form). */
import type { Mon } from '../src/sim/entities';

export interface PcFields {
  dex: string;
  name: string;
  level: number;
  shiny: boolean;
  alpha: boolean;
  legend: boolean;
  shadow: boolean;
  moves: string[];
  heldItem: string | null;
  /** A starter from their own PC: shown at the end, never kept again (only set when true). */
  fromPc?: boolean;
}

export function pcFields(m: Mon): PcFields {
  return {
    dex: m.megaFrom?.dex ?? m.dex, name: (m.megaFrom?.name ?? m.name).replace(/^Shadow /, ''), level: m.level, shiny: !!m.shiny, alpha: !!m.alpha,
    legend: !!m.legend, shadow: !!m.shadow, moves: [...m.moves], heldItem: m.heldItem ?? null,
    ...(m.fromPc ? { fromPc: true } : {}),
  };
}
