import { describe, expect, it } from 'vitest';
import { makeConfig } from './config';
import { idx } from './grid';
import {
  furnitureApproachTiles,
  furnitureIdAt,
  generateMap,
  isFullyConnected,
  isWalkable,
  mapHeight,
  mapWidth,
  roomFloorTiles,
  roomIdAt,
  roomOriginX,
  roomOriginY,
  tileAt,
} from './map';
import { TEST_TEMPLATE } from './testing';
import { applySymmetry } from './templates/symmetry';
import { templatesForSize } from './templates/library';
import { CARPET_CHAR, isFloorChar } from './templates/format';
import { TileKind } from './types';

describe('generateMap', () => {
  const config = makeConfig({ seed: 123 });
  const map = generateMap(config);

  it('has the expected dimensions and room count', () => {
    expect(map.width).toBe(mapWidth(3, 12));
    expect(map.height).toBe(mapHeight(3, 12));
    expect(map.width).toBe(40);
    expect(map.rooms).toHaveLength(9);
    expect(map.tiles).toHaveLength(map.width * map.height);
    expect(map.carpet).toHaveLength(map.width * map.height);
    expect(map.furnitureAt).toHaveLength(map.width * map.height);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    expect(generateMap(config)).toEqual(map);
    const other = generateMap(makeConfig({ seed: 124 }));
    expect(other).not.toEqual(map);
  });

  it('places room interiors at the right origins with walls between', () => {
    for (const room of map.rooms) {
      expect(room.x).toBe(roomOriginX(room.col, 12));
      expect(room.y).toBe(roomOriginY(room.row, 12));
      // Corners of the wall ring around the room are walls.
      expect(tileAt(map, room.x - 1, room.y - 1)).toBe(TileKind.Wall);
      expect(tileAt(map, room.x + room.size, room.y + room.size)).toBe(TileKind.Wall);
    }
  });

  it('cuts a door of doorWidth between every adjacent room pair and none on the border', () => {
    let doors = 0;
    for (const t of map.tiles) if (t === TileKind.Door) doors++;
    // 3x3 grid: 6 horizontal + 6 vertical adjacencies, 2 tiles each.
    expect(doors).toBe(12 * 2);
    for (let x = 0; x < map.width; x++) {
      expect(tileAt(map, x, 0)).toBe(TileKind.Wall);
      expect(tileAt(map, x, map.height - 1)).toBe(TileKind.Wall);
    }
    for (let y = 0; y < map.height; y++) {
      expect(tileAt(map, 0, y)).toBe(TileKind.Wall);
      expect(tileAt(map, map.width - 1, y)).toBe(TileKind.Wall);
    }
  });

  it('cuts doors at the centred offset and leaves the rest of the shared wall solid', () => {
    // Room size 12: stride 13; wall between rooms (0,0) and (0,1) is x=13; door rows 1+5, 1+6.
    expect(tileAt(map, 13, 6)).toBe(TileKind.Door);
    expect(tileAt(map, 13, 7)).toBe(TileKind.Door);
    expect(tileAt(map, 13, 5)).toBe(TileKind.Wall);
    expect(tileAt(map, 13, 8)).toBe(TileKind.Wall);
    // Wall between rooms (0,0) and (1,0) is y=13; door columns 1+5, 1+6.
    expect(tileAt(map, 6, 13)).toBe(TileKind.Door);
    expect(tileAt(map, 7, 13)).toBe(TileKind.Door);
    expect(tileAt(map, 5, 13)).toBe(TileKind.Wall);
    expect(tileAt(map, 8, 13)).toBe(TileKind.Wall);
  });

  it('stamps each room as its template under the recorded symmetry', () => {
    const library = templatesForSize(12);
    for (const room of map.rooms) {
      const template = library.find((t) => t.id === room.templateId);
      expect(template).toBeDefined();
      const stamped = applySymmetry(template as (typeof library)[number], room.symmetry);
      for (let y = 0; y < room.size; y++) {
        for (let x = 0; x < room.size; x++) {
          const ch = stamped.rows[y]?.[x] ?? '.';
          const gi = idx(map.width, room.x + x, room.y + y);
          expect(map.tiles[gi]).toBe(isFloorChar(ch) ? TileKind.Floor : TileKind.Furniture);
          expect(map.carpet[gi]).toBe(ch === CARPET_CHAR ? 1 : 0);
        }
      }
    }
  });

  it('uses non-identity symmetries and a stable fingerprint for a seed', () => {
    const fingerprint = map.rooms.map((r) => r.templateId + r.symmetry).join(',');
    expect(fingerprint).toBe(
      'hall2,bedroom6,conservatory7,kitchen3,study7,office6,attic4,vault4,storage4',
    );
    const symmetries = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const r of generateMap(makeConfig({ seed })).rooms) symmetries.add(r.symmetry);
    }
    expect(symmetries.size).toBe(8);
  });

  it.each([1, 2, 3, 4])('stays connected for door width %i across seeds', (doorWidth) => {
    for (let seed = 1; seed <= 15; seed++) {
      const m = generateMap(makeConfig({ seed, doorWidth }));
      const start = roomFloorTiles(m, 0)[0] as { x: number; y: number };
      expect(isFullyConnected(m, start)).toBe(true);
    }
  });

  it('is fully connected: every walkable tile reachable from any floor tile', () => {
    const start = roomFloorTiles(map, 0)[0];
    expect(start).toBeDefined();
    expect(isFullyConnected(map, start as { x: number; y: number })).toBe(true);
  });

  it('keeps furniture tiles and the furniture index in sync', () => {
    for (const piece of map.furniture) {
      expect(piece.tiles.length).toBeGreaterThan(0);
      for (const t of piece.tiles) {
        expect(tileAt(map, t.x, t.y)).toBe(TileKind.Furniture);
        expect(furnitureIdAt(map, t.x, t.y)).toBe(piece.id);
        expect(roomIdAt(map, t.x, t.y)).toBe(piece.roomId);
      }
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const f = map.furnitureAt[idx(map.width, x, y)];
        if (map.tiles[idx(map.width, x, y)] === TileKind.Furniture) expect(f).not.toBe(-1);
        else expect(f).toBe(-1);
      }
    }
  });

  it('every searchable piece has an approach tile', () => {
    for (const piece of map.furniture.filter((f) => f.searchable)) {
      expect(furnitureApproachTiles(map, piece.id).length).toBeGreaterThan(0);
    }
  });

  it('uses each template at most once before repeating', () => {
    const ids = map.rooms.map((r) => r.templateId);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    // The deck is dealt without repeats until the library is exhausted.
    const library = templatesForSize(12).length;
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(Math.ceil(9 / library));
    expect(counts.size).toBe(Math.min(9, library));
  });

  it('has carpet only on floor tiles', () => {
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.carpet[i] === 1) expect(map.tiles[i]).toBe(TileKind.Floor);
    }
    expect(map.carpet.some((c) => c === 1)).toBe(true);
  });
});

describe('map queries', () => {
  const map = generateMap(makeConfig({ seed: 5, mapRows: 2, mapCols: 2 }));

  it('roomIdAt maps interiors to rooms and walls/doors to undefined', () => {
    const r1 = map.rooms[1] as { x: number; y: number; size: number };
    expect(roomIdAt(map, r1.x, r1.y)).toBe(1);
    expect(roomIdAt(map, r1.x + r1.size - 1, r1.y + r1.size - 1)).toBe(1);
    expect(roomIdAt(map, 0, 0)).toBeUndefined();
    expect(roomIdAt(map, r1.x - 1, r1.y)).toBeUndefined(); // wall/door column between rooms 0 and 1
    expect(roomIdAt(map, -5, 3)).toBeUndefined();
    expect(roomIdAt(map, map.width + 2, 3)).toBeUndefined();
  });

  it('tileAt / isWalkable treat out-of-bounds as wall', () => {
    expect(tileAt(map, -1, -1)).toBe(TileKind.Wall);
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 1, 1)).toBe(true);
    expect(furnitureIdAt(map, -1, -1)).toBeUndefined();
  });

  it('roomFloorTiles returns only walkable interior tiles', () => {
    const tiles = roomFloorTiles(map, 0);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(144);
    for (const t of tiles) {
      expect(isWalkable(map, t.x, t.y)).toBe(true);
      expect(roomIdAt(map, t.x, t.y)).toBe(0);
    }
    expect(roomFloorTiles(map, 99)).toEqual([]);
    expect(furnitureApproachTiles(map, 9999)).toEqual([]);
  });
});

describe('generateMap errors', () => {
  it('throws when no templates exist for the room size', () => {
    expect(() => generateMap(makeConfig({ roomSize: 7 }))).toThrow(/no room templates/);
  });

  it('throws when a supplied template is invalid', () => {
    const bad = { id: 'bad', size: 12, rows: Array.from({ length: 12 }, () => 'B'.repeat(12)) };
    expect(() => generateMap(makeConfig(), { templates: [bad] })).toThrow(/room template 'bad'/);
  });

  it('throws on an invalid config instead of producing garbage', () => {
    expect(() => generateMap(makeConfig({ mapRows: 0 }))).toThrow(/invalid match setup/);
    expect(() => generateMap(makeConfig({ mapRows: 1, mapCols: 2 }))).toThrow(/teamCount/);
  });

  it('rejects duplicate template ids in a supplied library', () => {
    const t = TEST_TEMPLATE;
    expect(() => generateMap(makeConfig(), { templates: [t, { ...t }] })).toThrow(/duplicate/);
  });

  it('supports non-square room grids', () => {
    const m = generateMap(makeConfig({ seed: 2, mapRows: 1, mapCols: 4 }));
    expect(m.rooms).toHaveLength(4);
    expect(m.height).toBe(14);
    expect(m.width).toBe(53);
    expect(isFullyConnected(m, roomFloorTiles(m, 3)[0] as { x: number; y: number })).toBe(true);
  });
});
