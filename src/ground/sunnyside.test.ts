import { describe, expect, it } from 'vitest';
import data from '../../assets/tiles/sunnyside/sunnyside.json';
import { autotileIndex, MASK_BOTTOM, MASK_LEFT, MASK_RIGHT, MASK_TOP, neighbourMask, type SunnysideData } from './sunnyside';

const d = data as unknown as SunnysideData;

describe('GameMaker 16-tile autotile', () => {
  it('maps edges, corners and fill to the right slots', () => {
    const land = d.tilesets.tileset_sunnysideworld!.autotiles.Land!;
    expect(autotileIndex(land, 15)).toBe(land.tiles[0]);
    expect(autotileIndex(land, MASK_LEFT | MASK_RIGHT | MASK_BOTTOM)).toBe(land.tiles[3]); // top edge
    expect(autotileIndex(land, MASK_TOP | MASK_RIGHT | MASK_BOTTOM)).toBe(land.tiles[5]); // left edge
    expect(autotileIndex(land, MASK_LEFT | MASK_TOP | MASK_BOTTOM)).toBe(land.tiles[10]); // right edge
    expect(autotileIndex(land, MASK_LEFT | MASK_TOP | MASK_RIGHT)).toBe(land.tiles[12]); // bottom edge (cliff)
    expect(autotileIndex(land, MASK_RIGHT | MASK_BOTTOM)).toBe(land.tiles[7]);
    expect(autotileIndex(land, MASK_LEFT | MASK_BOTTOM)).toBe(land.tiles[11]);
    expect(autotileIndex(land, MASK_TOP | MASK_RIGHT)).toBe(land.tiles[13]);
    expect(autotileIndex(land, MASK_LEFT | MASK_TOP)).toBe(land.tiles[14]);
    expect(autotileIndex(land, 0)).toBe(land.tiles[0]); // isolated falls back to the fill
  });

  it('reproduces the demo room forest canopy from its presence grid', () => {
    const forest = d.tilesets.tileset_forest!.autotiles.forest_01!;
    const layer = d.demo_room.layers.find((l) => l.name === 'forest')!;
    const tiles = layer.tiles!;
    const present = (x: number, y: number) => (tiles[y]?.[x] ?? 0) !== 0;
    let checked = 0;
    let agree = 0;
    const shaped = new Set([3, 5, 6, 7, 9, 11, 12, 13, 14]);
    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < (tiles[y]?.length ?? 0); x++) {
        if (!present(x, y)) continue;
        const mask = neighbourMask(present, x, y);
        if (!shaped.has(mask)) continue;
        checked++;
        if (autotileIndex(forest, mask) === tiles[y]![x]) agree++;
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(agree / checked).toBeGreaterThan(0.9);
  });

  it('reproduces the demo room paths where the mask has a dedicated shape', () => {
    // The demo mixes three path sets and hand-placed tiles, so presence is "same set".
    const sets = ['Path 01', 'Path 02', 'Path 03'].map((n) => d.tilesets.tileset_sunnysideworld!.autotiles[n]!);
    const layer = d.demo_room.layers.find((l) => l.name === 'paths')!;
    const tiles = layer.tiles!;
    const shaped = new Set([3, 5, 6, 7, 9, 11, 12, 13, 14]);
    let checked = 0;
    let agree = 0;
    for (const set of sets) {
      const present = (x: number, y: number) => set.tiles.includes(tiles[y]?.[x] ?? 0) && (tiles[y]?.[x] ?? 0) !== 0;
      for (let y = 0; y < tiles.length; y++) {
        for (let x = 0; x < (tiles[y]?.length ?? 0); x++) {
          const idx = tiles[y]![x]!;
          if (!idx || !set.tiles.includes(idx)) continue;
          const mask = neighbourMask(present, x, y);
          if (!shaped.has(mask)) continue;
          checked++;
          if (autotileIndex(set, mask) === idx) agree++;
        }
      }
    }
    // Hand-placed path tiles in the demo only follow the mask about half the time; the
    // pixel-for-pixel re-render (?verify=demo) and the forest check above are the real test.
    expect(checked).toBeGreaterThan(150);
    expect(agree / checked).toBeGreaterThan(0.4);
  });
});
