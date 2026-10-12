import type { MatchConfig } from './config';
import { furnitureIdAt, isWalkable, roomFloorTiles, roomIdAt } from './map';
import { createRng } from './rng';
import {
  IDLE_INPUT,
  canScoresChange,
  leader,
  msToTicks,
  teamScores,
  type EndReason,
  type MatchState,
  type PlayerInput,
  type PlayerState,
  type TickEvent,
} from './state';
import { DIR_DELTA, type GameMap, type PlayerId, type TeamId } from './types';

/**
 * Inputs held by each player during this tick. Missing or unknown ids are treated as idle.
 * The owner of this map (the server) must reset a player's entry to `IDLE_INPUT` when they
 * disconnect, otherwise a stale held direction or button acts the moment they reconnect.
 */
export type TickInputs = Readonly<Record<PlayerId, PlayerInput>>;

function endMatch(
  state: MatchState,
  reason: EndReason,
  winnerTeamId: TeamId | null,
  events: TickEvent[],
): void {
  state.phase = 'ended';
  state.result = { winnerTeamId, reason, scores: teamScores(state) };
  for (const p of state.players) p.search = null;
  events.push({ type: 'phase', phase: 'ended' });
  events.push({ type: 'ended', result: state.result });
}

/** End the match now with an explicit winner, e.g. when every other team has left. */
export function forfeitMatch(
  state: MatchState,
  winnerTeamId: TeamId | null,
  events: TickEvent[] = [],
): TickEvent[] {
  if (state.phase !== 'ended') endMatch(state, 'forfeit', winnerTeamId, events);
  return events;
}

/** Decide what happens when time runs out (or all gems are found). */
function resolveEnd(
  state: MatchState,
  config: MatchConfig,
  reason: EndReason,
  events: TickEvent[],
): void {
  const lead = leader(state);
  if (lead !== null) {
    endMatch(state, reason, lead, events);
  } else if (!canScoresChange(state)) {
    endMatch(state, 'draw', null, events);
  } else if (state.phase === 'overtime' || config.overtimeCapSec <= 0) {
    endMatch(state, 'draw', null, events);
  } else {
    state.phase = 'overtime';
    state.overtimeTicksRemaining = msToTicks(config, config.overtimeCapSec * 1000);
    events.push({ type: 'phase', phase: 'overtime' });
  }
}

function pickUpFloorGems(state: MatchState, player: PlayerState, events: TickEvent[]): void {
  for (const gem of state.gems) {
    if (
      gem.location.kind === 'floor' &&
      gem.location.x === player.x &&
      gem.location.y === player.y
    ) {
      gem.location = { kind: 'player', playerId: player.id };
      player.carriedGemIds.push(gem.id);
      events.push({ type: 'gemPickedUp', playerId: player.id, gemId: gem.id, from: 'floor' });
    }
  }
}

function stepPlayer(
  state: MatchState,
  map: GameMap,
  config: MatchConfig,
  player: PlayerState,
  input: PlayerInput,
  events: TickEvent[],
): void {
  if (!player.connected) return;

  if (player.moveCooldownTicks > 0) player.moveCooldownTicks -= 1;

  // --- Movement ---
  if (input.dir !== null) {
    player.facing = input.dir;
    if (player.moveCooldownTicks === 0) {
      const delta = DIR_DELTA[input.dir];
      const nx = player.x + delta.x;
      const ny = player.y + delta.y;
      if (isWalkable(map, nx, ny)) {
        player.x = nx;
        player.y = ny;
        player.moveCooldownTicks = msToTicks(config, config.moveIntervalMs);
        player.stats.tilesWalked += 1;
        player.search = null;
        const room = roomIdAt(map, nx, ny);
        if (room !== undefined) player.lastRoomId = room;
        pickUpFloorGems(state, player, events);
      }
    }
  }

  // --- Search ---
  if (!input.action) {
    player.search = null;
    player.searchLatchFurnitureId = null;
    return;
  }
  const front = DIR_DELTA[player.facing];
  const targetId = furnitureIdAt(map, player.x + front.x, player.y + front.y);
  const target = targetId === undefined ? undefined : map.furniture[targetId];
  if (!target || !target.searchable) {
    player.search = null;
    return;
  }
  if (player.searchLatchFurnitureId === target.id) return; // needs a release first
  if (player.search === null || player.search.furnitureId !== target.id) {
    player.search = { furnitureId: target.id, progressTicks: 0 };
  }
  player.search.progressTicks += 1;
  if (player.search.progressTicks < msToTicks(config, config.searchDurationMs)) return;

  // Search complete.
  player.search = null;
  player.searchLatchFurnitureId = target.id;
  const searched =
    state.searchedByTeam[player.teamId] ?? (state.searchedByTeam[player.teamId] = []);
  if (!searched.includes(target.id)) {
    searched.push(target.id);
    player.stats.furnitureSearched += 1;
  }
  let foundGemId: number | null = null;
  for (const gem of state.gems) {
    if (gem.location.kind === 'furniture' && gem.location.furnitureId === target.id) {
      gem.location = { kind: 'player', playerId: player.id };
      player.carriedGemIds.push(gem.id);
      player.stats.gemsFound += 1;
      foundGemId = gem.id;
      events.push({ type: 'gemPickedUp', playerId: player.id, gemId: gem.id, from: 'furniture' });
    }
  }
  events.push({
    type: 'searchComplete',
    playerId: player.id,
    furnitureId: target.id,
    gemId: foundGemId,
  });
}

/**
 * Advance the match by one tick. Mutates `state` in place and returns the events of this
 * tick (appended to `events` when one is passed, so hot loops can reuse an array).
 * Deterministic given (state, map, config, inputs). Players are processed in array order,
 * which is join order, so "first to complete a search" ties resolve the same way everywhere.
 */
export function step(
  state: MatchState,
  map: GameMap,
  config: MatchConfig,
  inputs: TickInputs,
  events: TickEvent[] = [],
): TickEvent[] {
  if (state.phase === 'ended') return events;
  state.tick += 1;

  if (state.phase === 'countdown') {
    if (state.countdownTicksRemaining > 0) state.countdownTicksRemaining -= 1;
    if (state.countdownTicksRemaining === 0) {
      state.phase = 'playing';
      events.push({ type: 'phase', phase: 'playing' });
    }
    return events;
  }

  for (const player of state.players) {
    stepPlayer(state, map, config, player, inputs[player.id] ?? IDLE_INPUT, events);
  }

  if (state.phase === 'playing') {
    if (state.timeTicksRemaining > 0) state.timeTicksRemaining -= 1;
    if (!canScoresChange(state)) {
      resolveEnd(state, config, 'allGemsFound', events);
    } else if (state.timeTicksRemaining === 0) {
      resolveEnd(state, config, 'timer', events);
    }
  } else if (state.phase === 'overtime') {
    if (state.overtimeTicksRemaining > 0) state.overtimeTicksRemaining -= 1;
    const lead = leader(state);
    if (lead !== null) {
      endMatch(state, 'overtime', lead, events);
    } else if (!canScoresChange(state) || state.overtimeTicksRemaining === 0) {
      endMatch(state, 'draw', null, events);
    }
  }
  return events;
}

/**
 * Mark a player connected or not. A disconnected player is frozen and cannot search.
 * The caller must also reset that player's held input (see `TickInputs`).
 */
export function setPlayerConnected(
  state: MatchState,
  playerId: PlayerId,
  connected: boolean,
): void {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  p.connected = connected;
  if (!connected) {
    p.search = null;
    p.searchLatchFurnitureId = null;
  }
}

/**
 * Drop every gem a player carries onto random floor tiles in their current room (distinct
 * tiles while enough exist; the player's own tile if the room somehow has none). Uses and
 * advances the match RNG, so it is deterministic.
 */
export function dropAllGems(
  state: MatchState,
  map: GameMap,
  playerId: PlayerId,
  events: TickEvent[] = [],
): TickEvent[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.carriedGemIds.length === 0) return events;
  const rng = createRng(state.rngState);
  let tiles = rng.shuffle(roomFloorTiles(map, p.lastRoomId));
  if (tiles.length === 0) tiles = [{ x: p.x, y: p.y }];
  const dropped = [...p.carriedGemIds];
  dropped.forEach((gemId, i) => {
    const gem = state.gems.find((g) => g.id === gemId);
    const tile = tiles[i % tiles.length] as { x: number; y: number };
    if (gem) gem.location = { kind: 'floor', x: tile.x, y: tile.y };
  });
  p.carriedGemIds = [];
  state.rngState = rng.state();
  events.push({ type: 'gemsDropped', playerId, gemIds: dropped });
  return events;
}

/**
 * Remove a player for good (reconnect grace expired). Their gems scatter in their room.
 * The team keeps existing for scoring.
 */
export function removePlayer(
  state: MatchState,
  map: GameMap,
  playerId: PlayerId,
  events: TickEvent[] = [],
): TickEvent[] {
  dropAllGems(state, map, playerId, events);
  state.players = state.players.filter((p) => p.id !== playerId);
  for (const t of state.teams) t.playerIds = t.playerIds.filter((id) => id !== playerId);
  return events;
}

/** Convert a duration in seconds to whole ticks (rounded up). */
export function ticksForSeconds(config: MatchConfig, seconds: number): number {
  return msToTicks(config, seconds * 1000);
}
