import { describe, expect, it } from 'vitest';
import { lineOwned, ownedLineSet } from './starters';

describe('already-in-PC lines', () => {
  it('matches any stage of a line held in the PC, kept form included', () => {
    const lines = ownedLineSet([{ dex: '0001' }, { dex: '0004', evolvedFrom: '0006' }]);
    expect(lineOwned(lines, '0001')).toBe(true);
    expect(lineOwned(lines, '0003')).toBe(true);
    expect(lineOwned(lines, '0005')).toBe(true);
    expect(lineOwned(lines, '0007')).toBe(false);
  });
});
