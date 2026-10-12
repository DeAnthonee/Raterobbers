/**
 * Test helpers shared across the rules test files, also importable by the server and client
 * test suites via `@eyespy/shared/testing`. Not part of the runtime API.
 */
import type { MatchConfig } from './config';
import { bfsReachable, idx } from './grid';
import { furnitureApproachTiles, isWalkable } from './map';
import type { MatchState, PlayerInput, PlayerState } from './state';
import { step, type TickInputs } from './sim';
import type { RoomTemplate } from './templates/format';
import { ALL_DIRS, DIR_DELTA, type Dir, type Furniture, type GameMap, type TilePos } from './types';

/** One chest, one crate, one plant; lots of open floor. Valid at 12x12 / door width 2. */
export const TEST_TEMPLATE: RoomTemplate = {
  id: 'test-room',
  size: 12,
  rows: [
    '............',
    '............',
    '............',
    '...H........',
    '............',
    '............',
    '............',
    '............',
    '........R...',
    '............',
    '............',
    '..p.........',
  ],
};

/** Put a player on an approach tile of `furniture`, facing it. Returns the facing used. */
export function placeFacing(player: PlayerState, map: GameMap, furniture: Furniture): Dir {
  const approach = furnitureApproachTiles(map, furniture.id)[0];
  if (!approach) throw new Error('furniture has no approach tile');
  for (const dir of ALL_DIRS) {
    const d = DIR_DELTA[dir];
    const tx = approach.x + d.x;
    const ty = approach.y + d.y;
    if (furniture.tiles.some((t) => t.x === tx && t.y === ty)) {
      player.x = approach.x;
      player.y = approach.y;
      player.facing = dir;
      player.lastRoomId = furniture.roomId;
      return dir;
    }
  }
  throw new Error('no facing direction reaches the furniture');
}

export function runTicks(
  state: MatchState,
  map: GameMap,
  config: MatchConfig,
  inputs: TickInputs,
  n: number,
): MatchState {
  for (let i = 0; i < n; i++) step(state, map, config, inputs);
  return state;
}

export function held(dir: Dir | null, action = false): PlayerInput {
  return { dir, action };
}

/**
 * Shortest walkable path from `from` to `to` as a list of directions (BFS). Empty when
 * already there; throws when unreachable. Handy for scripted bots in tests.
 */
export function pathTo(map: GameMap, from: TilePos, to: TilePos): Dir[] {
  const passable = (x: number, y: number): boolean => isWalkable(map, x, y);
  const reach = bfsReachable(map.width, map.height, passable, [from]);
  if (!reach[idx(map.width, to.x, to.y)]) throw new Error('target unreachable');
  // BFS from the target so we can walk downhill from `from`.
  const dist: number[] = new Array<number>(map.width * map.height).fill(-1);
  const queue: TilePos[] = [to];
  dist[idx(map.width, to.x, to.y)] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++] as TilePos;
    for (const dir of ALL_DIRS) {
      const nx = cur.x + DIR_DELTA[dir].x;
      const ny = cur.y + DIR_DELTA[dir].y;
      if (!passable(nx, ny) || dist[idx(map.width, nx, ny)] !== -1) continue;
      dist[idx(map.width, nx, ny)] = (dist[idx(map.width, cur.x, cur.y)] as number) + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  const path: Dir[] = [];
  let cur = { ...from };
  while (dist[idx(map.width, cur.x, cur.y)] !== 0) {
    const here = dist[idx(map.width, cur.x, cur.y)] as number;
    let next: Dir | null = null;
    for (const dir of ALL_DIRS) {
      const nx = cur.x + DIR_DELTA[dir].x;
      const ny = cur.y + DIR_DELTA[dir].y;
      if (passable(nx, ny) && dist[idx(map.width, nx, ny)] === here - 1) {
        next = dir;
        break;
      }
    }
    if (next === null) throw new Error('path reconstruction failed');
    path.push(next);
    cur = { x: cur.x + DIR_DELTA[next].x, y: cur.y + DIR_DELTA[next].y };
  }
  return path;
}

/** Direction from an approach tile into an adjacent furniture tile, or null. */
export function facingFor(from: TilePos, furniture: Furniture): Dir | null {
  for (const dir of ALL_DIRS) {
    const tx = from.x + DIR_DELTA[dir].x;
    const ty = from.y + DIR_DELTA[dir].y;
    if (furniture.tiles.some((t) => t.x === tx && t.y === ty)) return dir;
  }
  return null;
}
