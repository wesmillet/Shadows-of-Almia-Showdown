import { describe, expect, it } from 'vitest';
import { IdTable, SyncDecoder, SyncEncoder } from './sync';

describe('sync', () => {
  it('a field set to undefined is deleted on the mirror, not left as null', () => {
    const ids = new IdTable();
    const enc = new SyncEncoder(ids);
    const dec = new SyncDecoder();
    const view: { p: { downUntil?: number | undefined; x: number } } = { p: { downUntil: 12, x: 1 } };
    dec.apply(enc.encode(view));
    const p = () => (dec.root as { p: Record<string, unknown> }).p;
    expect(p().downUntil).toBe(12);
    view.p.downUntil = undefined;
    dec.apply(enc.encode(view));
    expect('downUntil' in p()).toBe(false);
    // and a fresh mirror (a reload) never sees it either
    const fresh = new SyncDecoder();
    fresh.apply(new SyncEncoder(ids).encode(view));
    expect('downUntil' in (fresh.root as { p: Record<string, unknown> }).p).toBe(false);
  });
});
