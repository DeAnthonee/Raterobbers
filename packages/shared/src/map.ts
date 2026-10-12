import { validateConfig, type ConfigError, type MatchConfig } from './config';
import { NEIGHBOURS, bfsReachable, idx, inBounds } from './grid';
import { createRng, deriveSeed, type Rng } from './rng';
import { CARPET_CHAR, extractPieces, isFloorChar, type RoomTemplate } from './templates/format';
import { templatesForSize } from './templates/library';
import { SYMMETRY_COUNT, applySymmetry } from './templates/symmetry';
import { doorOffset, validateTemplate, type TemplateError } from './templates/validate';
import { TileKind, type Furniture, type GameMap, type Room, type TilePos } from './types';

export const SEED_SALT_MAP = 1;

/** Validate every template in a library for the given room geometry, plus id uniqueness. */
export function validateLibrary(
  templates: readonly RoomTemplate[],
  roomSize: number,
  doorWidth: number,
): TemplateError[] {
  const errors: TemplateError[] = [];
  const seen = new Set<string>();
  for (const t of templates) {
    if (seen.has(t.id)) errors.push({ templateId: t.id, message: 'duplicate template id' });
    seen.add(t.id);
  }
  if (templates.length === 0) {
    errors.push({
      templateId: '',
      message: `no room templates available for room size ${roomSize}`,
    });
  }
  return errors.concat(templates.flatMap((t) => validateTemplate(t, roomSize, doorWidth)));
}

/**
 * Everything a lobby must check before Start: the numeric config and the template library
 * for that room size and door width. Template problems are reported against `roomSize`.
 */
export function validateMatchSetup(
  config: MatchConfig,
  templates: readonly RoomTemplate[] = templatesForSize(config.roomSize),
): ConfigError[] {
  const errors = validateConfig(config);
  if (errors.length > 0) return errors;
  return validateLibrary(templates, config.roomSize, config.doorWidth).map((e) => ({
    field: 'roomSize' as const,
    message: e.templateId ? `room template '${e.templateId}': ${e.message}` : e.message,
  }));
}

/** Global tile x of the left interior column of room column `col`. */
export function roomOriginX(col: number, roomSize: number): number {
  return col * (roomSize + 1) + 1;
}

/** Global tile y of the top interior row of room row `row`. */
export function roomOriginY(row: number, roomSize: number): number {
  return row * (roomSize + 1) + 1;
}

export function mapWidth(mapCols: number, roomSize: number): number {
  return mapCols * (roomSize + 1) + 1;
}

export function mapHeight(mapRows: number, roomSize: number): number {
  return mapRows * (roomSize + 1) + 1;
}

/**
 * Pick a template and symmetry for every room. Templates are drawn without repeats until
 * the library is exhausted, then the deck is reshuffled.
 */
function dealTemplates(
  rng: Rng,
  library: readonly RoomTemplate[],
  count: number,
): { template: RoomTemplate; symmetry: number }[] {
  const out: { template: RoomTemplate; symmetry: number }[] = [];
  let deck: RoomTemplate[] = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) deck = rng.shuffle([...library]);
    const template = deck.pop() as RoomTemplate;
    out.push({ template, symmetry: rng.int(SYMMETRY_COUNT) });
  }
  return out;
}

export interface GenerateMapOptions {
  /** Override the template library (tests, custom content). Defaults to the built-in one. */
  templates?: readonly RoomTemplate[];
}

/**
 * Build the full map for a match. Deterministic for a given config (seed included).
 * Throws if the config is invalid or has no valid templates for its room size; lobbies
 * should call `validateMatchSetup` first to get a friendly error instead.
 */
export function generateMap(config: MatchConfig, options: GenerateMapOptions = {}): GameMap {
  const { mapRows, mapCols, roomSize, doorWidth } = config;
  const library = options.templates ?? templatesForSize(roomSize);
  const problems = validateMatchSetup(config, library);
  if (problems.length > 0) {
    const first = problems[0] as ConfigError;
    throw new Error(`invalid match setup: ${first.message}`);
  }

  const rng = createRng(deriveSeed(config.seed, SEED_SALT_MAP));
  const width = mapWidth(mapCols, roomSize);
  const height = mapHeight(mapRows, roomSize);
  const tiles: TileKind[] = new Array<TileKind>(width * height).fill(TileKind.Wall);
  const carpet: number[] = new Array<number>(width * height).fill(0);
  const furnitureAt: number[] = new Array<number>(width * height).fill(-1);
  const rooms: Room[] = [];
  const furniture: Furniture[] = [];

  const deals = dealTemplates(rng, library, mapRows * mapCols);

  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const id = row * mapCols + col;
      const deal = deals[id] as { template: RoomTemplate; symmetry: number };
      const stamped = applySymmetry(deal.template, deal.symmetry);
      // Defensive: the clearance set is symmetric so this should never fire.
      const stampProblems = validateTemplate(stamped, roomSize, doorWidth);
      if (stampProblems.length > 0) {
        throw new Error(
          `room template '${deal.template.id}' invalid under symmetry ${deal.symmetry}: ${(stampProblems[0] as TemplateError).message}`,
        );
      }
      const ox = roomOriginX(col, roomSize);
      const oy = roomOriginY(row, roomSize);
      rooms.push({
        id,
        row,
        col,
        templateId: deal.template.id,
        symmetry: deal.symmetry,
        x: ox,
        y: oy,
        size: roomSize,
      });

      for (let y = 0; y < roomSize; y++) {
        for (let x = 0; x < roomSize; x++) {
          const ch = stamped.rows[y]?.[x] ?? '.';
          const gi = idx(width, ox + x, oy + y);
          if (isFloorChar(ch)) {
            tiles[gi] = TileKind.Floor;
            if (ch === CARPET_CHAR) carpet[gi] = 1;
          } else {
            tiles[gi] = TileKind.Furniture;
          }
        }
      }

      for (const piece of extractPieces(stamped)) {
        const fid = furniture.length;
        const global: TilePos[] = piece.tiles.map((t) => ({ x: ox + t.x, y: oy + t.y }));
        furniture.push({
          id: fid,
          roomId: id,
          kind: piece.kind,
          tiles: global,
          searchable: piece.searchable,
        });
        for (const t of global) furnitureAt[idx(width, t.x, t.y)] = fid;
      }
    }
  }

  // Doors between every pair of adjacent rooms.
  const off = doorOffset(roomSize, doorWidth);
  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const ox = roomOriginX(col, roomSize);
      const oy = roomOriginY(row, roomSize);
      if (col + 1 < mapCols) {
        const wx = ox + roomSize; // wall column shared with the room to the right
        for (let i = 0; i < doorWidth; i++) tiles[idx(width, wx, oy + off + i)] = TileKind.Door;
      }
      if (row + 1 < mapRows) {
        const wy = oy + roomSize; // wall row shared with the room below
        for (let i = 0; i < doorWidth; i++) tiles[idx(width, ox + off + i, wy)] = TileKind.Door;
      }
    }
  }

  const map: GameMap = {
    width,
    height,
    tiles,
    carpet,
    furnitureAt,
    rooms,
    furniture,
    roomSize,
    doorWidth,
    mapRows,
    mapCols,
  };
  const anyFloor = roomFloorTiles(map, 0)[0];
  if (!anyFloor || !isFullyConnected(map, anyFloor)) {
    throw new Error('generated map is not fully connected');
  }
  return map;
}

// ---- Query helpers used by rules and renderers ----

export function tileAt(map: GameMap, x: number, y: number): TileKind {
  if (!inBounds(map.width, map.height, x, y)) return TileKind.Wall;
  return map.tiles[idx(map.width, x, y)] ?? TileKind.Wall;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t === TileKind.Floor || t === TileKind.Door;
}

export function furnitureIdAt(map: GameMap, x: number, y: number): number | undefined {
  if (!inBounds(map.width, map.height, x, y)) return undefined;
  const f = map.furnitureAt[idx(map.width, x, y)] ?? -1;
  return f >= 0 ? f : undefined;
}

/** Room containing an interior tile, or undefined for walls and door tiles. */
export function roomIdAt(map: GameMap, x: number, y: number): number | undefined {
  const stride = map.roomSize + 1;
  const col = Math.floor((x - 1) / stride);
  const row = Math.floor((y - 1) / stride);
  if (col < 0 || row < 0 || col >= map.mapCols || row >= map.mapRows) return undefined;
  const lx = (x - 1) % stride;
  const ly = (y - 1) % stride;
  if (lx >= map.roomSize || ly >= map.roomSize) return undefined;
  return row * map.mapCols + col;
}

/** All walkable tiles inside a room's interior (doors excluded). */
export function roomFloorTiles(map: GameMap, roomId: number): TilePos[] {
  const room = map.rooms[roomId];
  if (!room) return [];
  const out: TilePos[] = [];
  for (let y = room.y; y < room.y + room.size; y++) {
    for (let x = room.x; x < room.x + room.size; x++) {
      if (isWalkable(map, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** Walkable tiles adjacent to any tile of a furniture piece. */
export function furnitureApproachTiles(map: GameMap, furnitureId: number): TilePos[] {
  const piece = map.furniture[furnitureId];
  if (!piece) return [];
  const seen = new Set<number>();
  const out: TilePos[] = [];
  for (const t of piece.tiles) {
    for (const d of NEIGHBOURS) {
      const nx = t.x + d.x;
      const ny = t.y + d.y;
      if (!isWalkable(map, nx, ny)) continue;
      const key = idx(map.width, nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

/** True when every walkable tile on the map is reachable from `start`. */
export function isFullyConnected(map: GameMap, start: TilePos): boolean {
  const reach = bfsReachable(map.width, map.height, (x, y) => isWalkable(map, x, y), [start]);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isWalkable(map, x, y) && !reach[idx(map.width, x, y)]) return false;
    }
  }
  return true;
}
