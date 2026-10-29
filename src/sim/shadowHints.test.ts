import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// How a Shadow Pokémon is caught (the Snag Machine, under 10% HP) is for players to find out:
// no line the game shows may say it.
const HINTS = [/under (10|ten) ?(%|percent)/i, /wear (it|the dark ones) (down )?under/i, /use (the|your) Snag Machine/i, /snag it under/i, /no Snag Machine/i, /bounce off its dark aura/i];

describe('Shadow Pokémon capture hints', () => {
  it('no game text explains the Snag Machine or the HP threshold for Shadow Pokémon', () => {
    const dir = join(import.meta.dirname, '..');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const found: string[] = [];
    for (const f of files) {
      readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (HINTS.some((h) => h.test(line))) found.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
