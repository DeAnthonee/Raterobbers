/** Core data types shared by every layer. Plain data only: no classes, no methods. */

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface TilePos {
  x: number;
  y: number;
}

/** Stored as numbers so maps serialize compactly and sync cheaply. */
export const TileKind = {
  Wall: 0,
  Floor: 1,
  Door: 2,
  Furniture: 3,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

export type TeamId = number;
export type PlayerId = string;
export type GemId = number;
export type FurnitureId = number;
export type RoomId = number;

export interface Furniture {
  id: FurnitureId;
  roomId: RoomId;
  /** Short kind name from the template legend, e.g. "bed", "dresser". Display only. */
  kind: string;
  /** Global tile positions this piece occupies. */
  tiles: TilePos[];
  searchable: boolean;
}

export interface Room {
  id: RoomId;
  row: number;
  col: number;
  templateId: string;
  /** 0..7: index into the 8 symmetries (4 rotations x optional mirror). */
  symmetry: number;
  /** Top-left global tile of the room interior (inside the walls). */
  x: number;
  y: number;
  /** Interior size (tiles per side). */
  size: number;
}

export interface GameMap {
  width: number;
  height: number;
  /** Row-major flat grid, length width*height. */
  tiles: TileKind[];
  /** Row-major flat grid of 0/1: decorative carpet (walkable). Length width*height. */
  carpet: number[];
  /** Row-major flat grid: index into `furniture`, or -1. Length width*height. */
  furnitureAt: number[];
  rooms: Room[];
  furniture: Furniture[];
  roomSize: number;
  doorWidth: number;
  mapRows: number;
  mapCols: number;
}

export const DIR_DELTA: Record<Dir, TilePos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const ALL_DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
