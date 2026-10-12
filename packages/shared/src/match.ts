import type { ConfigError, MatchConfig } from './config';
import { manhattan } from './grid';
import { roomFloorTiles } from './map';
import { createRng, deriveSeed } from './rng';
import { msToTicks, type Gem, type MatchState, type PlayerState, type Team } from './state';
import type { GameMap, PlayerId, Room, RoomId, TeamId, TilePos } from './types';

export const SEED_SALT_SPAWN = 2;
export const SEED_SALT_GEMS = 3;
export const SEED_SALT_MATCH = 4;

export const TEAM_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'] as const;

export interface TeamSetup {
  id: TeamId;
  name: string;
  players: { id: PlayerId; name: string }[];
}

/**
 * Choose one spawn room per team, spread as far apart as possible on the room grid.
 * The first room is one of the rooms farthest from the centre (a corner on a rectangle),
 * picked by `seed` so team 0 is not always top-left; then greedily pick the room with the
 * largest minimum distance to the rooms already chosen. Deterministic.
 */
export function chooseSpawnRooms(map: GameMap, teamCount: number, seed = 0): RoomId[] {
  if (teamCount > map.rooms.length) {
    throw new Error('more teams than rooms');
  }
  const chosen: RoomId[] = [];
  const roomPos = (id: RoomId): TilePos => {
    const r = map.rooms[id] as Room;
    return { x: r.col, y: r.row };
  };
  const centre = { x: (map.mapCols - 1) / 2, y: (map.mapRows - 1) / 2 };
  const distFromCentre = (id: RoomId): number =>
    Math.abs(roomPos(id).x - centre.x) + Math.abs(roomPos(id).y - centre.y);
  const farthest = Math.max(...map.rooms.map((r) => distFromCentre(r.id)));
  const corners = map.rooms.filter((r) => distFromCentre(r.id) === farthest).map((r) => r.id);
  chosen.push(createRng(deriveSeed(seed, SEED_SALT_SPAWN)).pick(corners));
  while (chosen.length < teamCount) {
    let bestId: RoomId = -1;
    let bestScore = -1;
    for (const room of map.rooms) {
      if (chosen.includes(room.id)) continue;
      const dists = chosen.map((c) => manhattan(roomPos(c), roomPos(room.id)));
      const minDist = Math.min(...dists);
      const sumDist = dists.reduce((a, b) => a + b, 0);
      const fromCentre =
        Math.abs(roomPos(room.id).x - centre.x) + Math.abs(roomPos(room.id).y - centre.y);
      // Maximise the distance to the nearest chosen room, then total spread, then prefer
      // the edges over the centre. Lower ids win exact ties (strict >).
      const score = minDist * 1_000_000 + sumDist * 1_000 + fromCentre;
      if (score > bestScore) {
        bestScore = score;
        bestId = room.id;
      }
    }
    chosen.push(bestId);
  }
  return chosen;
}

/** Floor tiles of a room ordered by distance to its centre (closest first), deterministic. */
export function spawnTilesForRoom(map: GameMap, roomId: RoomId): TilePos[] {
  const room = map.rooms[roomId];
  if (!room) return [];
  const centre = { x: room.x + (room.size - 1) / 2, y: room.y + (room.size - 1) / 2 };
  return roomFloorTiles(map, roomId).sort(
    (a, b) =>
      Math.abs(a.x - centre.x) +
        Math.abs(a.y - centre.y) -
        (Math.abs(b.x - centre.x) + Math.abs(b.y - centre.y)) ||
      a.y - b.y ||
      a.x - b.x,
  );
}

export interface GemPlacementError {
  message: string;
}

/**
 * Distribute gems into searchable furniture outside the spawn rooms, at most one gem per
 * piece and at most ceil(gems / eligibleRooms) per room. Falls back to all rooms when every
 * room is a spawn room. Returns the furniture ids that receive a gem, or an error.
 */
export function placeGems(
  map: GameMap,
  config: MatchConfig,
  spawnRooms: readonly RoomId[],
): { furnitureIds: number[] } | { error: GemPlacementError } {
  const rng = createRng(deriveSeed(config.seed, SEED_SALT_GEMS));
  let eligibleRooms = map.rooms.map((r) => r.id).filter((id) => !spawnRooms.includes(id));
  if (eligibleRooms.length === 0) eligibleRooms = map.rooms.map((r) => r.id);
  const perRoomCap = Math.ceil(config.gemCount / eligibleRooms.length);
  const candidates = map.furniture.filter((f) => f.searchable && eligibleRooms.includes(f.roomId));
  if (candidates.length < config.gemCount) {
    return {
      error: {
        message: `need ${config.gemCount} searchable furniture pieces outside spawn rooms, found ${candidates.length}`,
      },
    };
  }
  const shuffled = rng.shuffle([...candidates]);
  const perRoom = new Map<RoomId, number>();
  const furnitureIds: number[] = [];
  // Pass 1: respect the per-room cap. Pass 2 (rare): fill from the rest if the cap starved us.
  for (const pass of [true, false]) {
    for (const f of shuffled) {
      if (furnitureIds.length >= config.gemCount) break;
      if (furnitureIds.includes(f.id)) continue;
      const n = perRoom.get(f.roomId) ?? 0;
      if (pass && n >= perRoomCap) continue;
      perRoom.set(f.roomId, n + 1);
      furnitureIds.push(f.id);
    }
  }
  if (furnitureIds.length < config.gemCount) {
    return { error: { message: 'could not place every gem' } };
  }
  return { furnitureIds };
}

/** Lobby-side checks on the team roster. Empty when valid. */
export function validateTeams(config: MatchConfig, teams: readonly TeamSetup[]): ConfigError[] {
  const errors: ConfigError[] = [];
  if (teams.length !== config.teamCount) {
    errors.push({
      field: 'teamCount',
      message: `expected ${config.teamCount} teams, got ${teams.length}`,
    });
  }
  const teamIds = new Set<number>();
  const playerIds = new Set<string>();
  for (const t of teams) {
    if (teamIds.has(t.id)) errors.push({ field: 'general', message: `duplicate team id ${t.id}` });
    teamIds.add(t.id);
    if (t.players.length === 0) {
      errors.push({ field: 'general', message: `team '${t.name}' has no players` });
    }
    if (t.players.length > config.teamSize) {
      errors.push({
        field: 'teamSize',
        message: `team '${t.name}' has ${t.players.length} players, max is ${config.teamSize}`,
      });
    }
    for (const p of t.players) {
      if (playerIds.has(p.id)) {
        errors.push({ field: 'general', message: `duplicate player id ${p.id}` });
      }
      playerIds.add(p.id);
    }
  }
  return errors;
}

export interface CreateMatchResult {
  state: MatchState;
  spawnRooms: RoomId[];
}

/**
 * Build the initial match state: teams, players at their spawns, gems hidden in furniture,
 * countdown running. Throws on impossible setups (lobby validation should catch them first
 * via `placeGems` / `validateConfig`).
 */
export function createMatch(
  config: MatchConfig,
  map: GameMap,
  teams: TeamSetup[],
): CreateMatchResult {
  const teamErrors = validateTeams(config, teams);
  if (teamErrors.length > 0) throw new Error((teamErrors[0] as ConfigError).message);
  const spawnRooms = chooseSpawnRooms(map, teams.length, config.seed);
  const placed = placeGems(map, config, spawnRooms);
  if ('error' in placed) throw new Error(placed.error.message);

  const stateTeams: Team[] = [];
  const players: PlayerState[] = [];
  teams.forEach((setup, i) => {
    const roomId = spawnRooms[i] as RoomId;
    const tiles = spawnTilesForRoom(map, roomId);
    if (tiles.length < setup.players.length) {
      throw new Error(`spawn room ${roomId} has too few floor tiles`);
    }
    stateTeams.push({
      id: setup.id,
      name: setup.name,
      color: TEAM_COLORS[i % TEAM_COLORS.length] as string,
      playerIds: setup.players.map((p) => p.id),
    });
    setup.players.forEach((p, j) => {
      const tile = tiles[j] as TilePos;
      players.push({
        id: p.id,
        teamId: setup.id,
        name: p.name,
        connected: true,
        x: tile.x,
        y: tile.y,
        facing: 'down',
        lastRoomId: roomId,
        moveCooldownTicks: 0,
        search: null,
        searchLatchFurnitureId: null,
        carriedGemIds: [],
        effects: [],
        stats: { gemsFound: 0, furnitureSearched: 0, tilesWalked: 0 },
      });
    });
  });

  const gems: Gem[] = placed.furnitureIds.map((furnitureId, id) => ({
    id,
    location: { kind: 'furniture', furnitureId },
  }));

  const searchedByTeam: Record<TeamId, number[]> = {};
  for (const t of stateTeams) searchedByTeam[t.id] = [];

  const state: MatchState = {
    phase: config.countdownSec > 0 ? 'countdown' : 'playing',
    tick: 0,
    countdownTicksRemaining: msToTicks(config, config.countdownSec * 1000),
    timeTicksRemaining: msToTicks(config, config.matchDurationSec * 1000),
    overtimeTicksRemaining: 0,
    teams: stateTeams,
    players,
    gems,
    searchedByTeam,
    traps: [],
    rngState: deriveSeed(config.seed, SEED_SALT_MATCH),
    result: null,
  };
  return { state, spawnRooms };
}
