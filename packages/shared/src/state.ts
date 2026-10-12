import type { MatchConfig } from './config';
import type { Dir, FurnitureId, GemId, PlayerId, RoomId, TeamId } from './types';

/**
 * Live match state. Plain data, JSON-safe, owned by the server. See GAME_SPEC.md §7.
 *
 * All durations inside the state are counted in **ticks**, never milliseconds, so the
 * simulation is exact at any tick rate (1000 / 30 is not representable in floating point).
 * Use `msToTicks` / `ticksToMs` at the edges (config in, HUD out).
 */

export type MatchPhase = 'countdown' | 'playing' | 'overtime' | 'ended';

export type EndReason = 'timer' | 'allGemsFound' | 'overtime' | 'draw' | 'forfeit';

export interface Team {
  id: TeamId;
  name: string;
  color: string;
  playerIds: PlayerId[];
}

/** Reserved for Phase 2 (stun, burn, freeze, slow). Empty in MVP. */
export interface StatusEffect {
  kind: string;
  remainingTicks: number;
}

/** Reserved for Phase 2. Empty in MVP. */
export interface Trap {
  id: number;
  kind: string;
  ownerId: PlayerId;
  x: number;
  y: number;
  furnitureId: FurnitureId | null;
}

export interface SearchProgress {
  furnitureId: FurnitureId;
  progressTicks: number;
}

export interface PlayerStats {
  gemsFound: number;
  furnitureSearched: number;
  tilesWalked: number;
}

export interface PlayerState {
  id: PlayerId;
  teamId: TeamId;
  name: string;
  connected: boolean;
  x: number;
  y: number;
  facing: Dir;
  /** Last room whose interior the player stood in. Door tiles keep the previous value. */
  lastRoomId: RoomId;
  /** Ticks until the next step is allowed. */
  moveCooldownTicks: number;
  search: SearchProgress | null;
  /**
   * Furniture just searched while Action is still held. A new channel on that piece needs
   * Action to be released first, so holding the button does not re-search forever.
   */
  searchLatchFurnitureId: FurnitureId | null;
  carriedGemIds: GemId[];
  effects: StatusEffect[];
  stats: PlayerStats;
}

export type GemLocation =
  | { kind: 'furniture'; furnitureId: FurnitureId }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'floor'; x: number; y: number };

export interface Gem {
  id: GemId;
  location: GemLocation;
}

export interface MatchResult {
  winnerTeamId: TeamId | null;
  reason: EndReason;
  scores: Record<TeamId, number>;
}

export interface MatchState {
  phase: MatchPhase;
  tick: number;
  countdownTicksRemaining: number;
  timeTicksRemaining: number;
  overtimeTicksRemaining: number;
  teams: Team[];
  players: PlayerState[];
  gems: Gem[];
  /** Per-team fog of searched furniture. Arrays (not Sets) so the state stays JSON-safe. */
  searchedByTeam: Record<TeamId, FurnitureId[]>;
  traps: Trap[];
  /** PRNG state for in-match randomness (gem scatter). Advances deterministically. */
  rngState: number;
  result: MatchResult | null;
}

/** What a player is currently holding down. The server reduces input events into this. */
export interface PlayerInput {
  dir: Dir | null;
  action: boolean;
}

export const IDLE_INPUT: Readonly<PlayerInput> = { dir: null, action: false };

/** Raw input events a client may send; see GAME_SPEC.md §7. */
export type InputEvent =
  { type: 'move'; dir: Dir | null } | { type: 'actionDown' } | { type: 'actionUp' };

/** Returns a new PlayerInput; never mutates `held`. */
export function applyInputEvent(held: PlayerInput, event: InputEvent): PlayerInput {
  switch (event.type) {
    case 'move':
      return { ...held, dir: event.dir };
    case 'actionDown':
      return { ...held, action: true };
    case 'actionUp':
      return { ...held, action: false };
  }
}

/** Things that happened during one `step`, for sound, effects, and server bookkeeping. */
export type TickEvent =
  | { type: 'phase'; phase: MatchPhase }
  | { type: 'searchComplete'; playerId: PlayerId; furnitureId: FurnitureId; gemId: GemId | null }
  | { type: 'gemPickedUp'; playerId: PlayerId; gemId: GemId; from: 'furniture' | 'floor' }
  | { type: 'gemsDropped'; playerId: PlayerId; gemIds: GemId[] }
  | { type: 'ended'; result: MatchResult };

export function tickMs(config: Pick<MatchConfig, 'tickRate'>): number {
  return 1000 / config.tickRate;
}

/** Whole ticks needed to cover `ms` (rounds up so a duration is never cut short). */
export function msToTicks(config: Pick<MatchConfig, 'tickRate'>, ms: number): number {
  return Math.ceil((ms * config.tickRate) / 1000);
}

export function ticksToMs(config: Pick<MatchConfig, 'tickRate'>, ticks: number): number {
  return (ticks * 1000) / config.tickRate;
}

export function findPlayer(state: MatchState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function findTeam(state: MatchState, teamId: TeamId): Team | undefined {
  return state.teams.find((t) => t.id === teamId);
}

/** Gems carried by each team's players. Every team is present, even at zero. */
export function teamScores(state: MatchState): Record<TeamId, number> {
  const scores: Record<TeamId, number> = {};
  for (const t of state.teams) scores[t.id] = 0;
  for (const p of state.players) {
    scores[p.teamId] = (scores[p.teamId] ?? 0) + p.carriedGemIds.length;
  }
  return scores;
}

/** The single team with the highest score, or null on a tie for first. */
export function leader(state: MatchState): TeamId | null {
  const scores = teamScores(state);
  let best: TeamId | null = null;
  let bestScore = -1;
  let tied = false;
  for (const t of state.teams) {
    const s = scores[t.id] ?? 0;
    if (s > bestScore) {
      best = t.id;
      bestScore = s;
      tied = false;
    } else if (s === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export function gemsRemainingHidden(state: MatchState): number {
  return state.gems.filter((g) => g.location.kind === 'furniture').length;
}

/** Teams that currently have at least one connected player. */
export function connectedTeamIds(state: MatchState): TeamId[] {
  const ids = new Set<TeamId>();
  for (const p of state.players) if (p.connected) ids.add(p.teamId);
  return state.teams.map((t) => t.id).filter((id) => ids.has(id));
}

/**
 * Whether any team's score can still change. In the MVP (no stealing) scores are frozen
 * once every gem is carried. Phase 2 must revisit this once gems can be knocked loose.
 */
export function canScoresChange(state: MatchState): boolean {
  return state.gems.some((g) => g.location.kind !== 'player');
}
