/**
 * Island generator for the Sunnyside tileset: simplex-noise land over sea,
 * streams that run from inland springs to the coast, trails between the
 * points of interest, and dense woods. Pure grids; the renderer turns them
 * into autotiles.
 */
import { Rng } from '../core/rng';
import { Simplex2 } from '../core/noise';
import { smoothstep } from '../core/math';

export const enum Cell {
  Sea = 0,
  Land = 1,
}

export interface IslandGrids {
  cols: number;
  rows: number;
  land: Uint8Array;
  river: Uint8Array;
  path: Uint8Array;
  /** Forest at tile resolution (set in 2x2 blocks so the 32 px canopy autotile lines up). */
  forest: Uint8Array;
  /** Walkable after rivers, cliffs and woods are considered. */
  walkable: Uint8Array;
  pois: Array<{ x: number; y: number }>;
}

export function generateIsland(seed: number, cols: number, rows: number, pois: Array<{ x: number; y: number }> = []): IslandGrids {
  const rng = new Rng(seed ^ 0x15a9d);
  const elev = new Simplex2(seed);
  const moist = new Simplex2(seed ^ 0x9e3779b9);
  const n = cols * rows;
  const land = new Uint8Array(n);
  const idx = (x: number, y: number) => y * cols + x;
  const cx = cols / 2;
  const cy = rows / 2;

  // Elevation: a central island with noise islands around it; the rim is always sea.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let e = elev.fbm(x / 15, y / 15, 3, 2, 0.5);
      const dc = Math.hypot(x - cx, y - cy) / (Math.min(cols, rows) / 2);
      e += 0.32 * (1 - smoothstep(0.1, 0.55, dc));
      e -= 0.45 * smoothstep(0.78, 1.0, dc);
      land[idx(x, y)] = e > 0.5 ? 1 : 0;
    }
  }
  // Cellular smoothing removes one-tile spits and holes so every land cell has a drawable edge.
  for (let pass = 0; pass < 5; pass++) {
    const next = new Uint8Array(land);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += land[idx(x + dx, y + dy)] ?? 0;
        next[idx(x, y)] = c >= 5 ? 1 : 0;
      }
    }
    land.set(next);
  }
  for (let x = 0; x < cols; x++) {
    land[idx(x, 0)] = land[idx(x, rows - 1)] = 0;
  }
  for (let y = 0; y < rows; y++) {
    land[idx(0, y)] = land[idx(cols - 1, y)] = 0;
  }
  // Thin out one-wide corridors: a land cell needs land on at least one side of both axes to stay.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (!land[idx(x, y)]) continue;
        const h = (land[idx(x - 1, y)] ?? 0) + (land[idx(x + 1, y)] ?? 0);
        const v = (land[idx(x, y - 1)] ?? 0) + (land[idx(x, y + 1)] ?? 0);
        if (h === 0 || v === 0) land[idx(x, y)] = 0;
      }
    }
  }
  // Fill small inland lakes (sea pockets not connected to the border) so the coast reads as one shape.
  {
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (land[i] || seen[i]) continue;
      const cells: number[] = [];
      const stack = [i];
      seen[i] = 1;
      let touchesBorder = false;
      while (stack.length) {
        const j = stack.pop() as number;
        cells.push(j);
        const x = j % cols;
        const y = Math.floor(j / cols);
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesBorder = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = idx(nx, ny);
          if (!land[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      if (!touchesBorder && cells.length < 30) for (const c of cells) land[c] = 1;
    }
  }
  // Keep only the largest connected landmass plus any that holds a point of interest.
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!land[i] || comp[i] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const j = stack.pop() as number;
      size++;
      const x = j % cols;
      const y = Math.floor(j / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = idx(nx, ny);
        if (land[k] && comp[k] === -1) {
          comp[k] = id;
          stack.push(k);
        }
      }
    }
    sizes.push(size);
  }
  let biggest = 0;
  sizes.forEach((s, i) => {
    if (s > (sizes[biggest] ?? 0)) biggest = i;
  });
  for (let i = 0; i < n; i++) if (land[i] && comp[i] !== biggest && (sizes[comp[i] as number] ?? 0) < 40) land[i] = 0;

  // Rivers: springs on high ground run downhill (by noise) to the sea.
  const river = new Uint8Array(n);
  const riverCount = 3;
  for (let r = 0; r < riverCount; r++) {
    let sx = 0;
    let sy = 0;
    let tries = 0;
    do {
      sx = rng.int(4, cols - 5);
      sy = rng.int(4, rows - 5);
      tries++;
    } while (tries < 200 && (!land[idx(sx, sy)] || elev.fbm(sx / 11, sy / 11, 4, 2, 0.5) < 0.62));
    let x = sx;
    let y = sy;
    const dirAng = rng.range(0, Math.PI * 2);
    let fx = Math.cos(dirAng);
    let fy = Math.sin(dirAng);
    for (let step = 0; step < 90; step++) {
      if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1 || !land[idx(x, y)]) break;
      // Streams are two tiles wide so the River autotile can draw banks.
      river[idx(x, y)] = 1;
      if (x + 1 < cols && land[idx(x + 1, y)]) river[idx(x + 1, y)] = 1;
      if (y + 1 < rows && land[idx(x, y + 1)]) river[idx(x, y + 1)] = 1;
      if (x + 1 < cols && y + 1 < rows && land[idx(x + 1, y + 1)]) river[idx(x + 1, y + 1)] = 1;
      // Bend toward the sea with a little noise.
      const wob = moist.noise(x / 6 + r * 10, y / 6) * 0.9;
      const ax = fx + wob * -fy;
      const ay = fy + wob * fx;
      const len = Math.hypot(ax, ay) || 1;
      fx = ax / len;
      fy = ay / len;
      if (Math.abs(fx) > Math.abs(fy)) x += fx > 0 ? 1 : -1;
      else y += fy > 0 ? 1 : -1;
    }
  }

  // Forest: moist, inland, away from rivers and points of interest, in 2x2 blocks.
  const forest = new Uint8Array(n);
  for (let by = 0; by < rows - 1; by += 2) {
    for (let bx = 0; bx < cols - 1; bx += 2) {
      const m = moist.fbm(bx / 9 + 40, by / 9 + 40, 3, 2, 0.5);
      let ok = m > 0.58;
      for (let dy = 0; dy < 2 && ok; dy++) {
        for (let dx = 0; dx < 2 && ok; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (!land[idx(x, y)] || river[idx(x, y)]) ok = false;
          for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!land[idx(x + ddx, y + ddy)]) ok = false;
          for (const p of pois) if (Math.hypot(p.x - x, p.y - y) < 4) ok = false;
          if (Math.hypot(x - cx, y - cy) < 4) ok = false;
        }
      }
      if (ok) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) forest[idx(bx + dx, by + dy)] = 1;
    }
  }
  // Drop canopy blocks that would stand alone (they have no proper edge tiles).
  for (let by = 0; by < rows - 1; by += 2) {
    for (let bx = 0; bx < cols - 1; bx += 2) {
      if (!forest[idx(bx, by)]) continue;
      const has = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && forest[idx(x, y)] === 1;
      const nb = (has(bx - 2, by) ? 1 : 0) + (has(bx + 2, by) ? 1 : 0) + (has(bx, by - 2) ? 1 : 0) + (has(bx, by + 2) ? 1 : 0);
      if (nb === 0) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) forest[idx(bx + dx, by + dy)] = 0;
    }
  }

  // Walkable: land, not river (unless a path fords it), not woods.
  const walkable = new Uint8Array(n);
  for (let i = 0; i < n; i++) walkable[i] = land[i] && !river[i] && !forest[i] ? 1 : 0;

  // Paths: breadth-first trails between the points of interest and the centre, over land.
  const path = new Uint8Array(n);
  const targets = [{ x: Math.floor(cx), y: Math.floor(cy) }, ...pois];
  const cost = (i: number): number => (!land[i] ? 1e9 : river[i] ? 6 : forest[i] ? 4 : path[i] ? 0.4 : 1);
  for (let k = 1; k < targets.length; k++) {
    const from = targets[k] as { x: number; y: number };
    const to = targets[0] as { x: number; y: number };
    const route = dijkstra(cols, rows, idx(from.x, from.y), idx(to.x, to.y), cost);
    // Trails are two tiles wide: the pack's Path autotile only has shapes for areas, not one-wide lines.
    for (const i of route) {
      const x = i % cols;
      const y = Math.floor(i / cols);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= cols || ny >= rows) continue;
        const j = idx(nx, ny);
        if (!land[j]) continue;
        path[j] = 1;
        walkable[j] = 1;
        forest[j] = 0;
      }
    }
  }
  // Paths through woods clear the 2x2 block they cross so the canopy autotile stays aligned.
  for (let by = 0; by < rows - 1; by += 2) {
    for (let bx = 0; bx < cols - 1; bx += 2) {
      let hit = false;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (path[idx(bx + dx, by + dy)]) hit = true;
      if (hit) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        forest[idx(bx + dx, by + dy)] = 0;
        if (land[idx(bx + dx, by + dy)] && !river[idx(bx + dx, by + dy)]) walkable[idx(bx + dx, by + dy)] = 1;
      }
    }
  }

  return { cols, rows, land, river, path, forest, walkable, pois };
}

/** Cheapest 4-connected route by Dijkstra; returns the cell indices from start to goal. */
export function dijkstra(cols: number, rows: number, start: number, goal: number, cost: (i: number) => number): number[] {
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[start] = 0;
  // Simple binary heap.
  const heap: Array<[number, number]> = [[0, start]];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= d) break;
      [heap[p], heap[k]] = [heap[k] as [number, number], heap[p] as [number, number]];
      k = p;
    }
  };
  const pop = (): [number, number] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0]) m = l;
        if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k] as [number, number], heap[m] as [number, number]];
        k = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop() as [number, number];
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % cols;
    const y = Math.floor(i / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      const c = cost(j);
      if (c >= 1e9) continue;
      const nd = d + c;
      if (nd < (dist[j] as number)) {
        dist[j] = nd;
        prev[j] = i;
        push(nd, j);
      }
    }
  }
  if (!Number.isFinite(dist[goal] as number)) return [];
  const out: number[] = [];
  for (let i = goal; i !== -1; i = prev[i] as number) out.push(i);
  return out.reverse();
}
