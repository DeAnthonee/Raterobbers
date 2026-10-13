/**
 * Colyseus state schema for a game room. Mirrors the shared wire format
 * (`@raterobbers/shared` `WireRoomState`) field for field so clients can read `state.toJSON()`
 * as a `WireRoomState`. All game logic lives in @raterobbers/shared; this file is just shape.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const LobbyPlayerSchema = schema(
  {
    sessionId: t.string(),
    name: t.string(),
    teamId: t.number(),
    ready: t.boolean(),
    connected: t.boolean(),
  },
  'LobbyPlayer',
);
export type LobbyPlayerSchema = SchemaType<typeof LobbyPlayerSchema>;

export const ConfigSchema = schema(
  {
    seed: t.number(),
    mapRows: t.number(),
    mapCols: t.number(),
    roomSize: t.number(),
    doorWidth: t.number(),
    teamCount: t.number(),
    teamSize: t.number(),
    gemCount: t.number(),
    matchDurationSec: t.number(),
    overtimeCapSec: t.number(),
    moveIntervalMs: t.number(),
    searchDurationMs: t.number(),
    reconnectGraceSec: t.number(),
    countdownSec: t.number(),
    tickRate: t.number(),
  },
  'Config',
);
export type ConfigSchema = SchemaType<typeof ConfigSchema>;

export const PlayerSchema = schema(
  {
    id: t.string(),
    teamId: t.number(),
    name: t.string(),
    connected: t.boolean(),
    x: t.number(),
    y: t.number(),
    facing: t.string(),
    lastRoomId: t.number(),
    moveCooldownTicks: t.number(),
    searchFurnitureId: t.number(),
    searchProgressTicks: t.number(),
    searchLatchFurnitureId: t.number(),
    carriedGemIds: t.array('number'),
    gemsFound: t.number(),
    furnitureSearched: t.number(),
    tilesWalked: t.number(),
  },
  'Player',
);
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

export const GemSchema = schema(
  {
    id: t.number(),
    kind: t.string(),
    furnitureId: t.number(),
    playerId: t.string(),
    x: t.number(),
    y: t.number(),
  },
  'Gem',
);
export type GemSchema = SchemaType<typeof GemSchema>;

export const TeamSchema = schema(
  {
    id: t.number(),
    name: t.string(),
    color: t.string(),
    playerIds: t.array('string'),
  },
  'Team',
);
export type TeamSchema = SchemaType<typeof TeamSchema>;

export const SearchedSchema = schema({ furnitureIds: t.array('number') }, 'Searched');
export type SearchedSchema = SchemaType<typeof SearchedSchema>;

export const MatchSchema = schema(
  {
    phase: t.string(),
    tick: t.number(),
    countdownTicksRemaining: t.number(),
    timeTicksRemaining: t.number(),
    overtimeTicksRemaining: t.number(),
    teams: t.array(TeamSchema),
    players: t.array(PlayerSchema),
    gems: t.array(GemSchema),
    searchedByTeam: t.map(SearchedSchema),
    rngState: t.number(),
    hasResult: t.boolean(),
    resultWinnerTeamId: t.number(),
    resultReason: t.string(),
    resultScores: t.map('number'),
  },
  'Match',
);
export type MatchSchema = SchemaType<typeof MatchSchema>;

export const RoomStateSchema = schema(
  {
    phase: t.string(),
    joinCode: t.string(),
    hostSessionId: t.string(),
    config: ConfigSchema,
    lobby: t.map(LobbyPlayerSchema),
    match: MatchSchema,
  },
  'RoomState',
);
export type RoomStateSchema = SchemaType<typeof RoomStateSchema>;
