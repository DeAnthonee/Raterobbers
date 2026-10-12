import { NEIGHBOURS, bfsReachable, idx } from '../grid';
import type { TilePos } from '../types';
import { FLOOR_CHAR, LEGEND, isFloorChar, isSolidChar, type RoomTemplate } from './format';

export interface TemplateError {
  templateId: string;
  message: string;
}

/** Offset of the first door tile along a wall of `roomSize` tiles. */
export function doorOffset(roomSize: number, doorWidth: number): number {
  return Math.floor((roomSize - doorWidth) / 2);
}

/**
 * Template-local tiles that must be floor so doors on every side work: the two interior
 * tiles directly in front of each door tile, on all four sides. (The door tile itself sits
 * in the wall and is added by map generation.)
 *
 * When `roomSize - doorWidth` is odd the door is off-centre by half a tile, so mirroring
 * moves it by one. The clearance set therefore includes both the rounded-down and the
 * rounded-up door span, which makes it invariant under all 8 symmetries: a template valid
 * in its canonical orientation is valid in every orientation.
 */
export function requiredClearTiles(roomSize: number, doorWidth: number): TilePos[] {
  const lo = doorOffset(roomSize, doorWidth);
  const hi = roomSize - lo - doorWidth; // mirrored offset; equals lo when the span is centred
  const start = Math.min(lo, hi);
  const end = Math.max(lo, hi) + doorWidth; // exclusive
  const tiles: TilePos[] = [];
  for (let k = start; k < end; k++) {
    tiles.push({ x: k, y: 0 }, { x: k, y: 1 });
    tiles.push({ x: k, y: roomSize - 1 }, { x: k, y: roomSize - 2 });
    tiles.push({ x: 0, y: k }, { x: 1, y: k });
    tiles.push({ x: roomSize - 1, y: k }, { x: roomSize - 2, y: k });
  }
  return tiles;
}

/** Returns an empty array if the template is valid for the given room size and door width. */
export function validateTemplate(
  template: RoomTemplate,
  roomSize: number,
  doorWidth: number,
): TemplateError[] {
  const errors: TemplateError[] = [];
  const err = (message: string): void => {
    errors.push({ templateId: template.id, message });
  };
  const { size, rows } = template;

  if (size !== roomSize) {
    err(`template size ${size} does not match room size ${roomSize}`);
    return errors;
  }
  if (rows.length !== size) {
    err(`expected ${size} rows, got ${rows.length}`);
    return errors;
  }
  for (let y = 0; y < size; y++) {
    const row = rows[y] ?? '';
    if (row.length !== size) {
      err(`row ${y} has length ${row.length}, expected ${size}`);
      return errors;
    }
    for (let x = 0; x < size; x++) {
      const ch = row[x] ?? FLOOR_CHAR;
      if (!isFloorChar(ch) && !(isSolidChar(ch) && ch in LEGEND)) {
        err(`unknown character '${ch}' at (${x}, ${y})`);
      }
    }
  }
  if (errors.length > 0) return errors;

  const at = (x: number, y: number): string => rows[y]?.[x] ?? FLOOR_CHAR;
  const passable = (x: number, y: number): boolean => isFloorChar(at(x, y));

  for (const t of requiredClearTiles(size, doorWidth)) {
    if (!passable(t.x, t.y)) err(`door clearance tile (${t.x}, ${t.y}) is not floor`);
  }
  if (errors.length > 0) return errors;

  // Connectivity: every floor tile reachable from the door approach tiles.
  const starts = requiredClearTiles(size, doorWidth);
  const reach = bfsReachable(size, size, passable, starts);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (passable(x, y) && !reach[idx(size, x, y)]) {
        err(`floor tile (${x}, ${y}) is not reachable from the doors`);
      }
    }
  }

  // Every searchable piece needs an adjacent floor tile. Check per tile group cheaply:
  // a piece is reachable if any of its tiles touches floor.
  const seen: boolean[] = new Array<boolean>(size * size).fill(false);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = at(x, y);
      if (!(ch >= 'A' && ch <= 'Z') || seen[idx(size, x, y)]) continue;
      const stack: TilePos[] = [{ x, y }];
      seen[idx(size, x, y)] = true;
      let touchesFloor = false;
      while (stack.length > 0) {
        const cur = stack.pop() as TilePos;
        for (const d of NEIGHBOURS) {
          const nx = cur.x + d.x;
          const ny = cur.y + d.y;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (passable(nx, ny)) touchesFloor = true;
          if (at(nx, ny) === ch && !seen[idx(size, nx, ny)]) {
            seen[idx(size, nx, ny)] = true;
            stack.push({ x: nx, y: ny });
          }
        }
      }
      if (!touchesFloor) err(`searchable piece '${ch}' at (${x}, ${y}) has no adjacent floor`);
    }
  }

  return errors;
}
