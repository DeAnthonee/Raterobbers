import type { RoomTemplate } from './format';

export const SYMMETRY_COUNT = 8;

/** Rotate the grid 90° clockwise. */
export function rotateRows(rows: readonly string[]): string[] {
  const size = rows.length;
  const out: string[] = [];
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      // new (x, y) comes from old (y, size-1-x)
      line += rows[size - 1 - x]?.[y] ?? '.';
    }
    out.push(line);
  }
  return out;
}

/** Mirror the grid left-to-right. */
export function mirrorRows(rows: readonly string[]): string[] {
  return rows.map((r) => r.split('').reverse().join(''));
}

/**
 * Apply symmetry `index` (0..7): low two bits = number of clockwise quarter turns,
 * bit 2 = mirror first.
 */
export function applySymmetry(template: RoomTemplate, index: number): RoomTemplate {
  if (!Number.isInteger(index) || index < 0 || index >= SYMMETRY_COUNT) {
    throw new Error(`symmetry index out of range: ${index}`);
  }
  let rows: string[] = index & 4 ? mirrorRows(template.rows) : [...template.rows];
  const turns = index & 3;
  for (let i = 0; i < turns; i++) rows = rotateRows(rows);
  return { id: template.id, size: template.size, rows };
}
