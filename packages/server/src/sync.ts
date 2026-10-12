/**
 * Copy shared plain state into the Colyseus schema, writing only fields that changed so
 * delta patches stay small. Pure functions over (plain, schema) pairs; unit-tested.
 */
import type { MatchConfig, WireGem, WireMatch, WirePlayer, WireTeam } from '@eyespy/shared';
import type { ArraySchema, MapSchema } from '@colyseus/schema';
import {
  GemSchema,
  PlayerSchema,
  SearchedSchema,
  TeamSchema,
  type ConfigSchema,
  type MatchSchema,
} from './schema';

type Primitive = string | number | boolean;

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] !== value) target[key] = value;
}

function syncPrimitiveArray<V extends Primitive>(
  target: ArraySchema<V>,
  source: readonly V[],
): void {
  // Common case: unchanged, or appended to (searched lists, carried gems). Only rewrite
  // the whole array when an existing entry changed.
  const prefixMatches =
    target.length <= source.length && [...target].every((v, i) => source[i] === v);
  if (prefixMatches) {
    for (let i = target.length; i < source.length; i++) target.push(source[i] as V);
    return;
  }
  target.clear();
  for (const v of source) target.push(v);
}

/**
 * Strip what clients must not learn: where hidden gems are, the other teams' searched
 * lists (sent per team as a message instead), and the RNG state.
 */
export function toPublicWire(match: WireMatch): WireMatch {
  return {
    ...match,
    gems: match.gems.map((g) => (g.kind === 'furniture' ? { ...g, furnitureId: -1 } : g)),
    searchedByTeam: {},
    rngState: 0,
  };
}

export function syncConfig(config: MatchConfig, target: ConfigSchema): void {
  for (const key of Object.keys(config) as (keyof MatchConfig)[]) {
    assign(target, key, config[key]);
  }
}

function syncPlayer(p: WirePlayer, target: PlayerSchema): void {
  assign(target, 'id', p.id);
  assign(target, 'teamId', p.teamId);
  assign(target, 'name', p.name);
  assign(target, 'connected', p.connected);
  assign(target, 'x', p.x);
  assign(target, 'y', p.y);
  assign(target, 'facing', p.facing);
  assign(target, 'lastRoomId', p.lastRoomId);
  assign(target, 'moveCooldownTicks', p.moveCooldownTicks);
  assign(target, 'searchFurnitureId', p.searchFurnitureId);
  assign(target, 'searchProgressTicks', p.searchProgressTicks);
  assign(target, 'searchLatchFurnitureId', p.searchLatchFurnitureId);
  syncPrimitiveArray(target.carriedGemIds, p.carriedGemIds);
  assign(target, 'gemsFound', p.gemsFound);
  assign(target, 'furnitureSearched', p.furnitureSearched);
  assign(target, 'tilesWalked', p.tilesWalked);
}

function syncGem(g: WireGem, target: GemSchema): void {
  assign(target, 'id', g.id);
  assign(target, 'kind', g.kind);
  assign(target, 'furnitureId', g.furnitureId);
  assign(target, 'playerId', g.playerId);
  assign(target, 'x', g.x);
  assign(target, 'y', g.y);
}

function syncTeam(tm: WireTeam, target: TeamSchema): void {
  assign(target, 'id', tm.id);
  assign(target, 'name', tm.name);
  assign(target, 'color', tm.color);
  syncPrimitiveArray(target.playerIds, tm.playerIds);
}

/** Resize a schema array to `n` entries, creating with `make` and syncing each with `sync`. */
function syncObjectArray<S extends object, W>(
  target: ArraySchema<S>,
  source: readonly W[],
  make: () => S,
  sync: (w: W, s: S) => void,
): void {
  while (target.length > source.length) target.pop();
  source.forEach((w, i) => {
    let s = target[i];
    if (!s) {
      s = make();
      target.push(s);
    }
    sync(w, s);
  });
}

export function syncMatch(match: WireMatch, target: MatchSchema): void {
  assign(target, 'phase', match.phase);
  assign(target, 'tick', match.tick);
  assign(target, 'countdownTicksRemaining', match.countdownTicksRemaining);
  assign(target, 'timeTicksRemaining', match.timeTicksRemaining);
  assign(target, 'overtimeTicksRemaining', match.overtimeTicksRemaining);
  syncObjectArray(target.teams, match.teams, () => new TeamSchema(), syncTeam);
  syncObjectArray(target.players, match.players, () => new PlayerSchema(), syncPlayer);
  syncObjectArray(target.gems, match.gems, () => new GemSchema(), syncGem);

  const searched = target.searchedByTeam as MapSchema<SearchedSchema>;
  for (const key of [...searched.keys()]) {
    if (!(key in match.searchedByTeam)) searched.delete(key);
  }
  for (const [key, value] of Object.entries(match.searchedByTeam)) {
    let entry = searched.get(key);
    if (!entry) {
      entry = new SearchedSchema();
      searched.set(key, entry);
    }
    syncPrimitiveArray(entry.furnitureIds, value.furnitureIds);
  }

  assign(target, 'rngState', match.rngState);
  assign(target, 'hasResult', match.hasResult);
  assign(target, 'resultWinnerTeamId', match.resultWinnerTeamId);
  assign(target, 'resultReason', match.resultReason);
  const scores = target.resultScores as MapSchema<number>;
  for (const key of [...scores.keys()]) {
    if (!(key in match.resultScores)) scores.delete(key);
  }
  for (const [key, value] of Object.entries(match.resultScores)) {
    if (scores.get(key) !== value) scores.set(key, value);
  }
}
