/**
 * Writes data/strike-times.json from the sprite folders' AnimData.xml (see src/sim/strikeTimes.ts).
 * Run after adding or changing sprites:  npx tsx scripts/strike-times.ts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAnimData } from '../src/sprites/animData';
import { strikeSeconds } from '../src/sim/battle';
import { STRIKE_ACTIONS } from '../src/sim/strikeTimes';

/** The table for every sprite folder under `pokemonDir`, sorted; timings in 60 fps ticks, as AnimData counts them. */
export function buildStrikeTable(pokemonDir: string): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {};
  for (const dex of readdirSync(pokemonDir).sort()) {
    const file = join(pokemonDir, dex, 'AnimData.xml');
    if (!existsSync(file)) continue;
    let data;
    try {
      data = parseAnimData(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const row: Record<string, number | null> = {};
    for (const a of STRIKE_ACTIONS) {
      const def = data.anims.get(a);
      if (!def) continue;
      const s = strikeSeconds(def);
      row[a] = s === null ? null : Math.round(s * 60);
    }
    out[dex] = row;
  }
  return out;
}

if (process.argv[1]?.endsWith('strike-times.ts')) {
  const root = join(import.meta.dirname, '..');
  const table = buildStrikeTable(join(root, 'assets', 'pokemon'));
  writeFileSync(join(root, 'data', 'strike-times.json'), JSON.stringify(table) + '\n');
  console.log(`data/strike-times.json: ${Object.keys(table).length} sprite folders, ${Object.values(table).reduce((s, r) => s + Object.keys(r).length, 0)} actions`);
}
