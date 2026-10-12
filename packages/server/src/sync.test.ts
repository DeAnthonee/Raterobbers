import { describe, expect, it } from 'vitest';
import {
  createMatch,
  generateMap,
  makeConfig,
  matchFromWire,
  matchToWire,
  step,
  type TeamSetup,
  type WireMatch,
} from '@eyespy/shared';
import { held, runTicks } from '@eyespy/shared/testing';
import { Encoder } from '@colyseus/schema';
import { ConfigSchema, MatchSchema } from './schema';
import { syncConfig, syncMatch, toPublicWire } from './sync';

const teams: TeamSetup[] = [
  {
    id: 0,
    name: 'Red',
    players: [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bob' },
    ],
  },
  { id: 1, name: 'Blue', players: [{ id: 'c', name: 'Cat' }] },
];

/** Bytes a full encode of `schema` would send: 0 when nothing changed since the last call. */
function patchBytes(schema: MatchSchema | ConfigSchema): number {
  const encoder = new Encoder(schema);
  const bytes = encoder.encode().byteLength;
  encoder.discardChanges();
  return bytes;
}

describe('syncConfig', () => {
  it('copies every config field into the schema', () => {
    const config = makeConfig({ seed: 9, mapRows: 2, tickRate: 30 });
    const target = new ConfigSchema();
    syncConfig(config, target);
    expect(target.toJSON()).toEqual(config);
  });
});

describe('syncMatch', () => {
  it('mirrors the wire format exactly so toJSON() round-trips to the match state', () => {
    const config = makeConfig({ seed: 3, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    runTicks(state, map, config, { a: held('right'), c: held('up', true) }, 40);
    const target = new MatchSchema();
    const pub = toPublicWire(matchToWire(state));
    syncMatch(pub, target);
    const json = target.toJSON() as unknown as WireMatch;
    expect(json).toEqual(pub);
    // The public wire differs from the private state only in what it hides.
    const back = matchFromWire(json);
    expect({ ...back, gems: undefined, searchedByTeam: undefined, rngState: undefined }).toEqual({
      ...state,
      gems: undefined,
      searchedByTeam: undefined,
      rngState: undefined,
    });
  });

  it('toPublicWire hides hidden gem locations, searched lists, and the RNG state', () => {
    const config = makeConfig({ seed: 3, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    state.searchedByTeam[0] = [1, 2];
    const floorGem = state.gems[1];
    if (floorGem) floorGem.location = { kind: 'floor', x: 3, y: 4 };
    const pub = toPublicWire(matchToWire(state));
    expect(pub.gems.every((g) => g.kind !== 'furniture' || g.furnitureId === -1)).toBe(true);
    expect(pub.gems[1]).toEqual({
      id: 1,
      kind: 'floor',
      furnitureId: -1,
      playerId: '',
      x: 3,
      y: 4,
    });
    expect(pub.searchedByTeam).toEqual({});
    expect(pub.rngState).toBe(0);
  });

  it('appends to grown arrays instead of rewriting them', () => {
    const config = makeConfig({ seed: 3, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const target = new MatchSchema();
    const a = state.players[0] as { carriedGemIds: number[] };
    a.carriedGemIds.push(0);
    syncMatch(matchToWire(state), target);
    const encoder = new Encoder(target);
    encoder.encode();
    encoder.discardChanges();
    a.carriedGemIds.push(1);
    syncMatch(matchToWire(state), target);
    const appended = encoder.encode().byteLength;
    encoder.discardChanges();
    a.carriedGemIds = [5, 1];
    syncMatch(matchToWire(state), target);
    const rewritten = encoder.encode().byteLength;
    expect(appended).toBeGreaterThan(0);
    expect(rewritten).toBeGreaterThan(appended);
    expect([...(target.players[0]?.carriedGemIds ?? [])]).toEqual([5, 1]);
  });

  it('writes nothing when the state did not change, and only deltas when it did', () => {
    const config = makeConfig({ seed: 3, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const target = new MatchSchema();
    syncMatch(matchToWire(state), target);
    const encoder = new Encoder(target);
    const full = encoder.encode().byteLength;
    encoder.discardChanges();
    expect(full).toBeGreaterThan(0);

    syncMatch(matchToWire(state), target);
    expect(encoder.encode().byteLength).toBe(0);

    step(state, map, config, { a: held('right') });
    syncMatch(matchToWire(state), target);
    const delta = encoder.encode().byteLength;
    encoder.discardChanges();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(full / 4);
  });

  it('removes players, gems, and map entries that disappeared', () => {
    const config = makeConfig({ seed: 3, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const target = new MatchSchema();
    syncMatch(matchToWire(state), target);
    expect(target.players.length).toBe(3);
    state.players = state.players.filter((p) => p.id !== 'b');
    state.gems = state.gems.slice(0, 4);
    state.result = { winnerTeamId: 1, reason: 'forfeit', scores: { 0: 0, 1: 0 } };
    syncMatch(matchToWire(state), target);
    expect(target.players.length).toBe(2);
    expect(target.gems.length).toBe(4);
    expect(target.resultScores.get('1')).toBe(0);
    state.result.scores = { 0: 0 };
    syncMatch(matchToWire(state), target);
    expect(target.resultScores.has('1')).toBe(false);
    expect(patchBytes(target)).toBeGreaterThan(0);
  });
});
