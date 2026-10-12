/**
 * Room templates are ASCII grids, one string per row, `size` characters wide and `size`
 * rows tall. They describe the room interior only (walls and doors are added by map gen).
 *
 * Legend:
 *   `.`  floor
 *   `~`  carpet (floor with decoration)
 *   A-Z  searchable furniture; contiguous tiles of the same letter form one piece
 *   a-z  solid, non-searchable decoration (pillar, plant, ...); same grouping rule
 *
 * Grouping note: two separate pieces of the same letter must not touch orthogonally or
 * they merge into one piece. Use a different letter or leave a gap.
 */
import { NEIGHBOURS } from '../grid';

export interface RoomTemplate {
  id: string;
  size: number;
  rows: string[];
}

export const FLOOR_CHAR = '.';
export const CARPET_CHAR = '~';

/** Letter → display kind. Uppercase = searchable, lowercase = solid decoration. */
export const LEGEND: Readonly<Record<string, string>> = {
  B: 'bed',
  C: 'couch',
  D: 'dresser',
  H: 'chest',
  K: 'desk',
  N: 'nightstand',
  R: 'crate',
  S: 'shelf',
  T: 'table',
  W: 'wardrobe',
  f: 'fireplace',
  l: 'pillar',
  p: 'plant',
  s: 'statue',
};

export function isFloorChar(ch: string): boolean {
  return ch === FLOOR_CHAR || ch === CARPET_CHAR;
}

export function isSearchableChar(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

export function isSolidChar(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

export interface TemplatePiece {
  char: string;
  kind: string;
  searchable: boolean;
  /** Template-local positions. */
  tiles: { x: number; y: number }[];
}

/** Group contiguous same-letter tiles into furniture pieces. Assumes a valid template. */
export function extractPieces(template: RoomTemplate): TemplatePiece[] {
  const { size, rows } = template;
  const seen: boolean[] = new Array<boolean>(size * size).fill(false);
  const pieces: TemplatePiece[] = [];
  const at = (x: number, y: number): string => rows[y]?.[x] ?? FLOOR_CHAR;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = at(x, y);
      if (!isSolidChar(ch) || seen[y * size + x]) continue;
      const tiles: { x: number; y: number }[] = [];
      const stack = [{ x, y }];
      seen[y * size + x] = true;
      while (stack.length > 0) {
        const cur = stack.pop() as { x: number; y: number };
        tiles.push(cur);
        for (const d of NEIGHBOURS) {
          const nx = cur.x + d.x;
          const ny = cur.y + d.y;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (seen[ny * size + nx] || at(nx, ny) !== ch) continue;
          seen[ny * size + nx] = true;
          stack.push({ x: nx, y: ny });
        }
      }
      // Deterministic tile order (row-major) regardless of DFS order.
      tiles.sort((a, b) => a.y - b.y || a.x - b.x);
      pieces.push({
        char: ch,
        kind: LEGEND[ch] ?? 'unknown',
        searchable: isSearchableChar(ch),
        tiles,
      });
    }
  }
  return pieces;
}
