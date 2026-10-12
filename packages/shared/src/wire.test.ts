import { describe, expect, it } from 'vitest';
import { makeConfig } from './config';
import { generateMap } from './map';
import { createMatch, type TeamSetup } from './match';
import { createRng } from './rng';
import { dropAllGems, step } from './sim';
import { emptyWireMatch, gemFromWire, gemToWire, matchFromWire, matchToWire } from './wire';
import type { Dir } from './types';

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

describe('wire format', () => {
  it('round-trips a fresh match', () => {
    const config = makeConfig({ seed: 4 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    expect(matchFromWire(matchToWire(state))).toEqual(state);
  });

  it('round-trips a match in progress with searches, floor gems, and a result', () => {
    const config = makeConfig({ seed: 8, countdownSec: 0, matchDurationSec: 30 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const rng = createRng(1);
    const dirs: (Dir | null)[] = ['up', 'down', 'left', 'right', null];
    for (let t = 0; t < 700; t++) {
      const inputs: Record<string, { dir: Dir | null; action: boolean }> = {};
      for (const p of state.players)
        inputs[p.id] = { dir: rng.pick(dirs), action: rng.next() < 0.5 };
      if (t === 100) {
        // Force some carried gems and a scatter so every gem location kind appears.
        const g = state.gems[0];
        if (g) {
          g.location = { kind: 'player', playerId: 'a' };
          state.players[0]?.carriedGemIds.push(0);
        }
        dropAllGems(state, map, 'a');
      }
      step(state, map, config, inputs);
    }
    expect(state.phase).toBe('ended');
    // Make sure every location kind is present regardless of how the walk went.
    const first = state.gems[0];
    if (first) first.location = { kind: 'floor', x: 5, y: 5 };
    const second = state.gems[1];
    const carrier = state.players[0];
    if (second && carrier) {
      second.location = { kind: 'player', playerId: carrier.id };
      carrier.carriedGemIds.push(second.id);
    }
    const kinds = new Set(state.gems.map((g) => g.location.kind));
    expect(kinds.has('floor')).toBe(true);
    expect(kinds.has('player')).toBe(true);
    const wire = matchToWire(state);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
    expect(matchFromWire(wire)).toEqual(state);
  });

  it('flattens every gem location kind', () => {
    expect(gemToWire({ id: 1, location: { kind: 'furniture', furnitureId: 7 } })).toEqual({
      id: 1,
      kind: 'furniture',
      furnitureId: 7,
      playerId: '',
      x: -1,
      y: -1,
    });
    expect(gemToWire({ id: 2, location: { kind: 'player', playerId: 'z' } }).playerId).toBe('z');
    const floor = gemToWire({ id: 3, location: { kind: 'floor', x: 4, y: 5 } });
    expect([floor.x, floor.y]).toEqual([4, 5]);
    for (const g of [
      { id: 1, location: { kind: 'furniture' as const, furnitureId: 7 } },
      { id: 2, location: { kind: 'player' as const, playerId: 'z' } },
      { id: 3, location: { kind: 'floor' as const, x: 4, y: 5 } },
    ]) {
      expect(gemFromWire(gemToWire(g))).toEqual(g);
    }
  });

  it('round-trips a draw result (null winner) and an in-progress search', () => {
    const config = makeConfig({ seed: 2, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    state.result = { winnerTeamId: null, reason: 'draw', scores: { 0: 1, 1: 1 } };
    state.phase = 'ended';
    const a = state.players[0];
    if (a) a.search = { furnitureId: 3, progressTicks: 5 };
    expect(matchFromWire(matchToWire(state))).toEqual(state);
  });

  it('emptyWireMatch converts to a valid empty match', () => {
    const m = matchFromWire(emptyWireMatch());
    expect(m.players).toEqual([]);
    expect(m.result).toBeNull();
  });
});
