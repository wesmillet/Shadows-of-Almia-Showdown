/**
 * Review harness helper: with UNWARN=1, Thunder and Stone Edge go back to their timing on the fixes
 * branch (no mark, no delay), so comparisons run under the fixes' rules only, without that prototype.
 */
import { move } from '../../src/sim/data';

export function applyUnwarn(): boolean {
  if (!process.env.UNWARN) return false;
  for (const id of ['thunder', 'stone-edge']) {
    const d = move(id) as { warn?: number; fx?: Array<{ anchor: string; delay?: number }> };
    const w = d.warn ?? 0;
    if (!w) continue;
    d.warn = undefined;
    for (const part of d.fx ?? []) if (part.anchor === 'target' && part.delay !== undefined) {
      const back = +(part.delay - w).toFixed(3);
      if (back > 0) part.delay = back;
      else delete part.delay;
    }
  }
  return true;
}
