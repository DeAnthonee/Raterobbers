/**
 * Wire format: the flat, collection-friendly shape in which match state travels to clients.
 * Nested unions (Gem.location) and nullable objects are flattened into scalar fields so the
 * same shape can be expressed as a Colyseus Schema on the server and read back as plain JSON
 * on the client. `matchToWire` / `matchFromWire` are exact inverses (see wire.test.ts).
 */
import type { MatchConfig } from './config';
import type { Gem, MatchPhase, MatchState, PlayerState, Team } from './state';
import type { Dir } from './types';

export type RoomPhase = 'lobby' | MatchPhase;

export interface WireLobbyPlayer {
  sessionId: string;
  name: string;
  teamId: number;
  ready: boolean;
  connected: boolean;
}

export interface WirePlayer {
  id: string;
  teamId: number;
  name: string;
  connected: boolean;
  x: number;
  y: number;
  facing: Dir;
  lastRoomId: number;
  moveCooldownTicks: number;
  /** -1 when not searching. */
  searchFurnitureId: number;
  searchProgressTicks: number;
  /** -1 when not latched. */
  searchLatchFurnitureId: number;
  carriedGemIds: number[];
  gemsFound: number;
  furnitureSearched: number;
  tilesWalked: number;
}

export interface WireGem {
  id: number;
  kind: 'furniture' | 'player' | 'floor';
  /** -1 unless kind is 'furniture'. */
  furnitureId: number;
  /** '' unless kind is 'player'. */
  playerId: string;
  /** -1 unless kind is 'floor'. */
  x: number;
  y: number;
}

export interface WireTeam {
  id: number;
  name: string;
  color: string;
  playerIds: string[];
}

export interface WireSearched {
  furnitureIds: number[];
}

export interface WireMatch {
  phase: MatchPhase;
  tick: number;
  countdownTicksRemaining: number;
  timeTicksRemaining: number;
  overtimeTicksRemaining: number;
  teams: WireTeam[];
  players: WirePlayer[];
  gems: WireGem[];
  /** Keyed by team id as a string (map keys are strings on the wire). */
  searchedByTeam: Record<string, WireSearched>;
  rngState: number;
  hasResult: boolean;
  /** -1 when there is no winner (draw or no result yet). */
  resultWinnerTeamId: number;
  resultReason: string;
  resultScores: Record<string, number>;
}

/** The whole room as the client sees it. */
export interface WireRoomState {
  phase: RoomPhase;
  joinCode: string;
  hostSessionId: string;
  config: MatchConfig;
  lobby: Record<string, WireLobbyPlayer>;
  match: WireMatch;
}

export function playerToWire(p: PlayerState): WirePlayer {
  return {
    id: p.id,
    teamId: p.teamId,
    name: p.name,
    connected: p.connected,
    x: p.x,
    y: p.y,
    facing: p.facing,
    lastRoomId: p.lastRoomId,
    moveCooldownTicks: p.moveCooldownTicks,
    searchFurnitureId: p.search?.furnitureId ?? -1,
    searchProgressTicks: p.search?.progressTicks ?? 0,
    searchLatchFurnitureId: p.searchLatchFurnitureId ?? -1,
    carriedGemIds: [...p.carriedGemIds],
    gemsFound: p.stats.gemsFound,
    furnitureSearched: p.stats.furnitureSearched,
    tilesWalked: p.stats.tilesWalked,
  };
}

export function playerFromWire(w: WirePlayer): PlayerState {
  return {
    id: w.id,
    teamId: w.teamId,
    name: w.name,
    connected: w.connected,
    x: w.x,
    y: w.y,
    facing: w.facing,
    lastRoomId: w.lastRoomId,
    moveCooldownTicks: w.moveCooldownTicks,
    search:
      w.searchFurnitureId >= 0
        ? { furnitureId: w.searchFurnitureId, progressTicks: w.searchProgressTicks }
        : null,
    searchLatchFurnitureId: w.searchLatchFurnitureId >= 0 ? w.searchLatchFurnitureId : null,
    carriedGemIds: [...w.carriedGemIds],
    effects: [],
    stats: {
      gemsFound: w.gemsFound,
      furnitureSearched: w.furnitureSearched,
      tilesWalked: w.tilesWalked,
    },
  };
}

export function gemToWire(g: Gem): WireGem {
  const base: WireGem = {
    id: g.id,
    kind: g.location.kind,
    furnitureId: -1,
    playerId: '',
    x: -1,
    y: -1,
  };
  switch (g.location.kind) {
    case 'furniture':
      base.furnitureId = g.location.furnitureId;
      break;
    case 'player':
      base.playerId = g.location.playerId;
      break;
    case 'floor':
      base.x = g.location.x;
      base.y = g.location.y;
      break;
  }
  return base;
}

export function gemFromWire(w: WireGem): Gem {
  switch (w.kind) {
    case 'furniture':
      return { id: w.id, location: { kind: 'furniture', furnitureId: w.furnitureId } };
    case 'player':
      return { id: w.id, location: { kind: 'player', playerId: w.playerId } };
    case 'floor':
      return { id: w.id, location: { kind: 'floor', x: w.x, y: w.y } };
  }
}

export function teamToWire(t: Team): WireTeam {
  return { id: t.id, name: t.name, color: t.color, playerIds: [...t.playerIds] };
}

export function matchToWire(s: MatchState): WireMatch {
  const searchedByTeam: Record<string, WireSearched> = {};
  for (const [teamId, ids] of Object.entries(s.searchedByTeam)) {
    searchedByTeam[teamId] = { furnitureIds: [...ids] };
  }
  const resultScores: Record<string, number> = {};
  if (s.result) {
    for (const [teamId, score] of Object.entries(s.result.scores)) resultScores[teamId] = score;
  }
  return {
    phase: s.phase,
    tick: s.tick,
    countdownTicksRemaining: s.countdownTicksRemaining,
    timeTicksRemaining: s.timeTicksRemaining,
    overtimeTicksRemaining: s.overtimeTicksRemaining,
    teams: s.teams.map(teamToWire),
    players: s.players.map(playerToWire),
    gems: s.gems.map(gemToWire),
    searchedByTeam,
    rngState: s.rngState,
    hasResult: s.result !== null,
    resultWinnerTeamId: s.result?.winnerTeamId ?? -1,
    resultReason: s.result?.reason ?? '',
    resultScores,
  };
}

export function matchFromWire(w: WireMatch): MatchState {
  const searchedByTeam: Record<number, number[]> = {};
  for (const [teamId, s] of Object.entries(w.searchedByTeam)) {
    searchedByTeam[Number(teamId)] = [...s.furnitureIds];
  }
  let result: MatchState['result'] = null;
  if (w.hasResult) {
    const scores: Record<number, number> = {};
    for (const [teamId, score] of Object.entries(w.resultScores)) scores[Number(teamId)] = score;
    result = {
      winnerTeamId: w.resultWinnerTeamId >= 0 ? w.resultWinnerTeamId : null,
      reason: w.resultReason as NonNullable<MatchState['result']>['reason'],
      scores,
    };
  }
  return {
    phase: w.phase,
    tick: w.tick,
    countdownTicksRemaining: w.countdownTicksRemaining,
    timeTicksRemaining: w.timeTicksRemaining,
    overtimeTicksRemaining: w.overtimeTicksRemaining,
    teams: w.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      playerIds: [...t.playerIds],
    })),
    players: w.players.map(playerFromWire),
    gems: w.gems.map(gemFromWire),
    searchedByTeam,
    traps: [],
    rngState: w.rngState,
    result,
  };
}

/** An empty match, used as the schema's resting value while the room is in the lobby. */
export function emptyWireMatch(): WireMatch {
  return {
    phase: 'ended',
    tick: 0,
    countdownTicksRemaining: 0,
    timeTicksRemaining: 0,
    overtimeTicksRemaining: 0,
    teams: [],
    players: [],
    gems: [],
    searchedByTeam: {},
    rngState: 0,
    hasResult: false,
    resultWinnerTeamId: -1,
    resultReason: '',
    resultScores: {},
  };
}
