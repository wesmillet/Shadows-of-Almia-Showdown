/** Small seeded PRNG (mulberry32) so a match replays for the same seed. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    const v = arr[Math.floor(this.next() * arr.length)];
    if (v === undefined) throw new Error('Rng.pick on empty array');
    return v;
  }

  /** Weighted pick; weights need not sum to one. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    const last = items[items.length - 1];
    if (last === undefined) throw new Error('Rng.weighted on empty array');
    return last;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = a;
    }
    return arr;
  }
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
