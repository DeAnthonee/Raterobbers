import type { TilePos } from './types';

/** Flat row-major index helpers and a generic BFS used by validation, map gen, and rules. */

export function idx(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export const NEIGHBOURS: readonly TilePos[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

/**
 * 4-connected flood fill. Returns a boolean grid (flat, row-major) of tiles reachable from
 * `starts` through tiles where `passable(x, y)` is true. Start tiles are included only if
 * they are themselves passable.
 */
export function bfsReachable(
  width: number,
  height: number,
  passable: (x: number, y: number) => boolean,
  starts: readonly TilePos[],
): boolean[] {
  const seen: boolean[] = new Array<boolean>(width * height).fill(false);
  const queue: TilePos[] = [];
  for (const s of starts) {
    if (inBounds(width, height, s.x, s.y) && passable(s.x, s.y) && !seen[idx(width, s.x, s.y)]) {
      seen[idx(width, s.x, s.y)] = true;
      queue.push(s);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++] as TilePos;
    for (const d of NEIGHBOURS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!inBounds(width, height, nx, ny)) continue;
      const i = idx(width, nx, ny);
      if (seen[i] || !passable(nx, ny)) continue;
      seen[i] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/** Manhattan distance. */
export function manhattan(a: TilePos, b: TilePos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
