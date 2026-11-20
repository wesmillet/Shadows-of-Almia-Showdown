import { describe, expect, it } from 'vitest';
import { changelogSections } from './changelog';

describe("what's new", () => {
  it('reads sections and items, joining wrapped lines; the unreleased one is the latest', () => {
    const s = changelogSections('# Changelog\n\nintro\n\n## Update 1.7 (not live yet)\n\n- One\n- Two that\n  wraps\n\n## Update 1.6: November 16\n\n- Old\n');
    expect(s.map((x) => x.title)).toEqual(['Update 1.7', 'Update 1.6: November 16']);
    expect(s[0]!.latest).toBe(true);
    expect(s[0]!.items).toEqual(['One', 'Two that wraps']);
  });
  it('the real changelog parses', () => {
    expect(changelogSections().length).toBeGreaterThan(3);
  });
});
