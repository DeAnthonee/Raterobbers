import { describe, expect, it } from 'vitest';
import { makeConfig, type MatchConfig } from './config';
import { generateMap, isWalkable, roomIdAt } from './map';
import { createMatch, type TeamSetup } from './match';
import { createRng } from './rng';
import {
  applyInputEvent,
  canScoresChange,
  connectedTeamIds,
  findPlayer,
  findTeam,
  gemsRemainingHidden,
  leader,
  msToTicks,
  teamScores,
  tickMs,
  ticksToMs,
  type MatchState,
  type PlayerState,
  type TickEvent,
} from './state';
import {
  dropAllGems,
  forfeitMatch,
  removePlayer,
  setPlayerConnected,
  step,
  ticksForSeconds,
} from './sim';
import { TEST_TEMPLATE, facingFor, held, pathTo, placeFacing, runTicks } from './testing';
import { DIR_DELTA, type Dir, type Furniture, type GameMap } from './types';

const teams: TeamSetup[] = [
  {
    id: 0,
    name: 'Red',
    players: [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bob' },
    ],
  },
  {
    id: 1,
    name: 'Blue',
    players: [
      { id: 'c', name: 'Cat' },
      { id: 'd', name: 'Dan' },
    ],
  },
];

/** 3x3 map with the simple test template, no countdown, 20 Hz (50 ms ticks). */
function setup(overrides: Partial<MatchConfig> = {}): {
  config: MatchConfig;
  map: GameMap;
  state: MatchState;
} {
  const config = makeConfig({ seed: 7, countdownSec: 0, ...overrides });
  const map = generateMap(config, { templates: [TEST_TEMPLATE] });
  const { state } = createMatch(config, map, teams);
  return { config, map, state };
}

function player(state: MatchState, id: string): PlayerState {
  const p = findPlayer(state, id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

function gemFurniture(state: MatchState, map: GameMap): Furniture {
  const gem = state.gems.find((g) => g.location.kind === 'furniture');
  if (!gem || gem.location.kind !== 'furniture') throw new Error('no hidden gem');
  return map.furniture[gem.location.furnitureId] as Furniture;
}

function emptySearchable(state: MatchState, map: GameMap): Furniture {
  const withGem = new Set(
    state.gems.flatMap((g) => (g.location.kind === 'furniture' ? [g.location.furnitureId] : [])),
  );
  const f = map.furniture.find((x) => x.searchable && !withGem.has(x.id));
  if (!f) throw new Error('no empty searchable furniture');
  return f;
}

/** Put the player on open floor in the middle of room 4 (no furniture around the centre). */
function toOpenFloor(p: PlayerState, map: GameMap): void {
  const room = map.rooms[4] as { x: number; y: number };
  p.x = room.x + 5;
  p.y = room.y + 5;
  p.lastRoomId = 4;
  if (!isWalkable(map, p.x, p.y)) throw new Error('expected open floor');
}

describe('tick helpers', () => {
  it('tickMs, msToTicks, ticksToMs and ticksForSeconds follow tickRate', () => {
    const config = makeConfig({ tickRate: 20 });
    expect(tickMs(config)).toBe(50);
    expect(ticksForSeconds(config, 1)).toBe(20);
    expect(ticksForSeconds(makeConfig({ tickRate: 10 }), 1.5)).toBe(15);
    expect(msToTicks(makeConfig({ tickRate: 30 }), 1500)).toBe(45);
    expect(msToTicks(makeConfig({ tickRate: 30 }), 150)).toBe(5); // 4.5 rounds up
    expect(ticksToMs(config, 30)).toBe(1500);
  });

  it('applyInputEvent reduces events into held state without mutating its input', () => {
    const start = { dir: null, action: false } as const;
    let h = applyInputEvent(start, { type: 'move', dir: 'left' });
    expect(start).toEqual({ dir: null, action: false });
    expect(h).toEqual({ dir: 'left', action: false });
    h = applyInputEvent(h, { type: 'actionDown' });
    expect(h.action).toBe(true);
    h = applyInputEvent(h, { type: 'move', dir: null });
    expect(h).toEqual({ dir: null, action: true });
    h = applyInputEvent(h, { type: 'actionUp' });
    expect(h.action).toBe(false);
  });
});

describe('countdown', () => {
  it('ignores input and switches to playing when the countdown ends', () => {
    const { config, map, state } = setup({ countdownSec: 1 });
    expect(state.phase).toBe('countdown');
    const a = player(state, 'a');
    const start = { x: a.x, y: a.y };
    runTicks(state, map, config, { a: held('right') }, 19);
    expect(state.phase).toBe('countdown');
    expect({ x: a.x, y: a.y }).toEqual(start);
    expect(state.timeTicksRemaining).toBe(6000);
    const events = step(state, map, config, {});
    expect(state.phase).toBe('playing');
    expect(state.tick).toBe(20);
    expect(events).toEqual([{ type: 'phase', phase: 'playing' }]);
  });
});

describe('movement', () => {
  it('moves one tile in the held direction and then waits moveIntervalMs', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const x0 = a.x;
    step(state, map, config, { a: held('right') });
    expect(a.x).toBe(x0 + 1);
    expect(a.facing).toBe('right');
    expect(a.stats.tilesWalked).toBe(1);
    // 150 ms interval at 50 ms ticks: next move on the 3rd following tick.
    step(state, map, config, { a: held('right') });
    step(state, map, config, { a: held('right') });
    expect(a.x).toBe(x0 + 1);
    step(state, map, config, { a: held('right') });
    expect(a.x).toBe(x0 + 2);
  });

  it('moves every 5th tick at 30 Hz (150 ms rounds up to 5 ticks) and ignores unknown ids', () => {
    const { config, map, state } = setup({ tickRate: 30 });
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const x0 = a.x;
    const inputs = { a: held('right'), ghost: held('left', true) };
    const xs: number[] = [];
    for (let i = 0; i < 11; i++) {
      step(state, map, config, inputs);
      xs.push(a.x - x0);
    }
    expect(xs).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3]);
    expect(state.players.map((p) => p.id)).not.toContain('ghost');
  });

  it('does not move when nothing is held and keeps facing', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const before = { x: a.x, y: a.y, facing: a.facing };
    runTicks(state, map, config, {}, 10);
    expect({ x: a.x, y: a.y, facing: a.facing }).toEqual(before);
  });

  it('is blocked by walls and furniture but still turns to face them', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = gemFurniture(state, map);
    const dir = placeFacing(a, map, f);
    a.facing = 'down';
    const before = { x: a.x, y: a.y };
    step(state, map, config, { a: held(dir) });
    expect({ x: a.x, y: a.y }).toEqual(before);
    expect(a.facing).toBe(dir);
    expect(a.stats.tilesWalked).toBe(0);

    // Walk into the outer wall from the top-left room.
    const room0 = map.rooms[0] as { x: number; y: number };
    a.x = room0.x;
    a.y = room0.y;
    a.lastRoomId = 0;
    runTicks(state, map, config, { a: held('up') }, 5);
    expect({ x: a.x, y: a.y }).toEqual({ x: room0.x, y: room0.y });
  });

  it('players pass through each other', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const c = player(state, 'c');
    toOpenFloor(a, map);
    c.x = a.x + 1;
    c.y = a.y;
    c.lastRoomId = 4;
    step(state, map, config, { a: held('right') });
    expect({ x: a.x, y: a.y }).toEqual({ x: c.x, y: c.y });
  });

  it('crosses doors and updates lastRoomId only inside rooms', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const room4 = map.rooms[4] as { x: number; y: number; size: number };
    // Door between room 4 and room 5 is on column room4.x + size, rows offset 5..6.
    a.x = room4.x + room4.size - 1;
    a.y = room4.y + 5;
    a.lastRoomId = 4;
    const inputs = { a: held('right' as Dir) };
    step(state, map, config, inputs); // onto the door tile
    expect(roomIdAt(map, a.x, a.y)).toBeUndefined();
    expect(a.lastRoomId).toBe(4);
    runTicks(state, map, config, inputs, 3); // into room 5
    expect(roomIdAt(map, a.x, a.y)).toBe(5);
    expect(a.lastRoomId).toBe(5);
  });

  it('frozen players do not move or search while disconnected', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    setPlayerConnected(state, 'a', false);
    const before = { x: a.x, y: a.y };
    runTicks(state, map, config, { a: held('right', true) }, 10);
    expect({ x: a.x, y: a.y }).toEqual(before);
    expect(a.search).toBeNull();
    setPlayerConnected(state, 'a', true);
    step(state, map, config, { a: held('right') });
    expect(a.x).toBe(before.x + 1);
    setPlayerConnected(state, 'nobody', false); // no-op
  });
});

describe('searching', () => {
  it('fills the search channel and takes the gem on completion', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = gemFurniture(state, map);
    placeFacing(a, map, f);
    const inputs = { a: held(null, true) };
    step(state, map, config, inputs);
    expect(a.search).toEqual({ furnitureId: f.id, progressTicks: 1 });
    runTicks(state, map, config, inputs, 28);
    expect(a.search?.progressTicks).toBe(29);
    expect(a.carriedGemIds).toEqual([]);
    const events = step(state, map, config, inputs); // 30th tick: 1500 ms
    expect(events.map((e) => e.type)).toEqual(['gemPickedUp', 'searchComplete']);
    expect(a.search).toBeNull();
    expect(a.carriedGemIds).toHaveLength(1);
    expect(a.stats.gemsFound).toBe(1);
    expect(a.stats.furnitureSearched).toBe(1);
    const gem = state.gems.find((g) => g.id === a.carriedGemIds[0]);
    expect(gem?.location).toEqual({ kind: 'player', playerId: 'a' });
    expect(teamScores(state)).toEqual({ 0: 1, 1: 0 });
  });

  it('marks the furniture searched for the searching team only and reports the event', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = emptySearchable(state, map);
    placeFacing(a, map, f);
    const events: TickEvent[] = [];
    for (let i = 0; i < 30; i++) step(state, map, config, { a: held(null, true) }, events);
    expect(events).toEqual([
      { type: 'searchComplete', playerId: 'a', furnitureId: f.id, gemId: null },
    ]);
    expect(state.searchedByTeam[0]).toEqual([f.id]);
    expect(state.searchedByTeam[1]).toEqual([]);
    expect(a.carriedGemIds).toEqual([]);
    expect(a.stats.furnitureSearched).toBe(1);
  });

  it('holding Action after a search does not re-search; releasing and holding again does', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = emptySearchable(state, map);
    placeFacing(a, map, f);
    runTicks(state, map, config, { a: held(null, true) }, 30);
    expect(a.searchLatchFurnitureId).toBe(f.id);
    runTicks(state, map, config, { a: held(null, true) }, 60);
    expect(a.search).toBeNull();
    expect(a.stats.furnitureSearched).toBe(1);
    step(state, map, config, { a: held(null, false) });
    expect(a.searchLatchFurnitureId).toBeNull();
    const events: TickEvent[] = [];
    for (let i = 0; i < 30; i++) step(state, map, config, { a: held(null, true) }, events);
    // A repeat search on an already-searched piece completes but does not bump the stat.
    expect(events.filter((e) => e.type === 'searchComplete')).toHaveLength(1);
    expect(a.stats.furnitureSearched).toBe(1);
    expect(state.searchedByTeam[0]).toEqual([f.id]);
  });

  it('turning in place away from the furniture cancels the channel without moving', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = gemFurniture(state, map);
    const dir = placeFacing(a, map, f);
    runTicks(state, map, config, { a: held(null, true) }, 10);
    expect(a.search?.progressTicks).toBe(10);
    const opposite: Dir =
      dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left';
    a.moveCooldownTicks = 5; // can turn but not step this tick
    step(state, map, config, { a: held(opposite, true) });
    expect(a.facing).toBe(opposite);
    expect(a.search).toBeNull();
    expect(a.stats.tilesWalked).toBe(0);
  });

  it('cancels when the button is released or the player moves', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = gemFurniture(state, map);
    const dir = placeFacing(a, map, f);
    runTicks(state, map, config, { a: held(null, true) }, 10);
    expect(a.search?.progressTicks).toBe(10);
    step(state, map, config, { a: held(null, false) });
    expect(a.search).toBeNull();
    // Restart, then step sideways: progress is lost and nothing is found.
    runTicks(state, map, config, { a: held(null, true) }, 10);
    const side: Dir = dir === 'up' || dir === 'down' ? 'left' : 'up';
    step(state, map, config, { a: held(side, true) });
    expect(a.search).toBeNull();
    expect(a.carriedGemIds).toEqual([]);
  });

  it('pressing into the furniture while blocked keeps the search going', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const f = gemFurniture(state, map);
    const dir = placeFacing(a, map, f);
    runTicks(state, map, config, { a: held(dir, true) }, 30);
    expect(a.carriedGemIds).toHaveLength(1);
  });

  it('does nothing when facing floor or non-searchable decoration', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    runTicks(state, map, config, { a: held(null, true) }, 40);
    expect(a.search).toBeNull();
    expect(a.stats.furnitureSearched).toBe(0);
    const plant = map.furniture.find((x) => !x.searchable) as Furniture;
    placeFacing(a, map, plant);
    runTicks(state, map, config, { a: held(null, true) }, 40);
    expect(a.search).toBeNull();
    expect(a.stats.furnitureSearched).toBe(0);
  });

  it('completes instantly when searchDurationMs is 0', () => {
    const { config, map, state } = setup({ searchDurationMs: 0 });
    const a = player(state, 'a');
    placeFacing(a, map, gemFurniture(state, map));
    step(state, map, config, { a: held(null, true) });
    expect(a.carriedGemIds).toHaveLength(1);
  });

  it('a 1.5 s search takes exactly 45 ticks at 30 Hz', () => {
    const { config, map, state } = setup({ tickRate: 30 });
    const a = player(state, 'a');
    placeFacing(a, map, gemFurniture(state, map));
    runTicks(state, map, config, { a: held(null, true) }, 44);
    expect(a.carriedGemIds).toEqual([]);
    step(state, map, config, { a: held(null, true) });
    expect(a.carriedGemIds).toHaveLength(1);
  });

  it('a contested search goes to whoever completes first when they started on different ticks', () => {
    const { config, map, state } = setup();
    const f = gemFurniture(state, map);
    const a = player(state, 'a');
    const c = player(state, 'c');
    placeFacing(a, map, f);
    c.x = a.x;
    c.y = a.y;
    c.facing = a.facing;
    c.lastRoomId = a.lastRoomId;
    runTicks(state, map, config, { c: held(null, true) }, 5); // c starts 5 ticks earlier
    runTicks(state, map, config, { a: held(null, true), c: held(null, true) }, 25);
    expect(c.carriedGemIds).toHaveLength(1);
    expect(a.carriedGemIds).toHaveLength(0);
  });

  it('gives a contested gem to the earlier player in join order; both teams mark it', () => {
    const { config, map, state } = setup();
    const f = gemFurniture(state, map);
    const a = player(state, 'a');
    const c = player(state, 'c');
    placeFacing(a, map, f);
    // Put c on the same approach tile facing the same way (players overlap freely).
    c.x = a.x;
    c.y = a.y;
    c.facing = a.facing;
    c.lastRoomId = a.lastRoomId;
    runTicks(state, map, config, { a: held(null, true), c: held(null, true) }, 30);
    expect(a.carriedGemIds).toHaveLength(1);
    expect(c.carriedGemIds).toHaveLength(0);
    expect(c.stats.furnitureSearched).toBe(1);
    expect(state.searchedByTeam[0]).toEqual([f.id]);
    expect(state.searchedByTeam[1]).toEqual([f.id]);
  });
});

describe('timer and end conditions', () => {
  function giveGems(state: MatchState, playerId: string, count: number): void {
    const p = player(state, playerId);
    for (const g of state.gems) {
      if (count === 0) break;
      if (g.location.kind !== 'furniture') continue;
      g.location = { kind: 'player', playerId };
      p.carriedGemIds.push(g.id);
      count--;
    }
  }

  it('counts down the match timer in ticks', () => {
    const { config, map, state } = setup();
    runTicks(state, map, config, {}, 20);
    expect(state.timeTicksRemaining).toBe(5980);
    expect(ticksToMs(config, state.timeTicksRemaining)).toBe(299_000);
  });

  it('the timer ends on exactly ticksForSeconds ticks at 30 Hz', () => {
    const { config, map, state } = setup({ tickRate: 30, matchDurationSec: 30 });
    giveGems(state, 'a', 1);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30) - 1);
    expect(state.phase).toBe('playing');
    step(state, map, config, {});
    expect(state.phase).toBe('ended');
  });

  it('ends on the timer with the leading team as winner', () => {
    const { config, map, state } = setup({ matchDurationSec: 30 });
    giveGems(state, 'a', 2);
    giveGems(state, 'c', 1);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30) - 1);
    expect(state.phase).toBe('playing');
    step(state, map, config, {});
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ winnerTeamId: 0, reason: 'timer', scores: { 0: 2, 1: 1 } });
  });

  it('a tie at the timer with hidden gems left goes to overtime, won by the first to lead', () => {
    const { config, map, state } = setup({ matchDurationSec: 30, overtimeCapSec: 60 });
    giveGems(state, 'a', 1);
    giveGems(state, 'c', 1);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.phase).toBe('overtime');
    expect(state.overtimeTicksRemaining).toBe(1200);
    expect(state.timeTicksRemaining).toBe(0);
    runTicks(state, map, config, {}, 10);
    expect(state.phase).toBe('overtime');
    // Team 1 wins it with a real search.
    const d = player(state, 'd');
    placeFacing(d, map, gemFurniture(state, map));
    const events: TickEvent[] = [];
    for (let i = 0; i < 30; i++) step(state, map, config, { d: held(null, true) }, events);
    expect(state.phase).toBe('ended');
    expect(state.result?.winnerTeamId).toBe(1);
    expect(state.result?.reason).toBe('overtime');
    expect(events.map((e) => e.type)).toEqual(['gemPickedUp', 'searchComplete', 'phase', 'ended']);
  });

  it('overtime ends in a draw when the last hidden gem is found and scores stay tied', () => {
    const three: TeamSetup[] = [
      { id: 0, name: 'R', players: [{ id: 'a', name: 'A' }] },
      { id: 1, name: 'B', players: [{ id: 'b', name: 'B' }] },
      { id: 2, name: 'G', players: [{ id: 'c', name: 'C' }] },
    ];
    const config = makeConfig({ seed: 7, countdownSec: 0, teamCount: 3, matchDurationSec: 30 });
    const map = generateMap(config, { templates: [TEST_TEMPLATE] });
    const { state } = createMatch(config, map, three);
    giveGems(state, 'a', 4);
    giveGems(state, 'b', 4);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.phase).toBe('overtime');
    expect(gemsRemainingHidden(state)).toBe(1);
    giveGems(state, 'c', 1);
    step(state, map, config, {});
    expect(state.phase).toBe('ended');
    expect(state.result?.reason).toBe('draw');
  });

  it('overtime ends in a draw at the cap', () => {
    const { config, map, state } = setup({ matchDurationSec: 30, overtimeCapSec: 5 });
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.phase).toBe('overtime');
    runTicks(state, map, config, {}, ticksForSeconds(config, 5));
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ winnerTeamId: null, reason: 'draw', scores: { 0: 0, 1: 0 } });
  });

  it('a tie at the timer with no overtime configured is an immediate draw', () => {
    const { config, map, state } = setup({ matchDurationSec: 30, overtimeCapSec: 0 });
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.phase).toBe('ended');
    expect(state.result?.reason).toBe('draw');
  });

  it('ends early once every gem is found and someone leads', () => {
    const { config, map, state } = setup();
    giveGems(state, 'a', 5);
    giveGems(state, 'c', 4);
    expect(canScoresChange(state)).toBe(false);
    step(state, map, config, {});
    expect(state.phase).toBe('ended');
    expect(state.result?.reason).toBe('allGemsFound');
    expect(state.result?.winnerTeamId).toBe(0);
  });

  it('a tie with every gem found (3+ teams) is an immediate draw, even at the timer', () => {
    const three: TeamSetup[] = [
      { id: 0, name: 'R', players: [{ id: 'a', name: 'A' }] },
      { id: 1, name: 'B', players: [{ id: 'b', name: 'B' }] },
      { id: 2, name: 'G', players: [{ id: 'c', name: 'C' }] },
    ];
    const config = makeConfig({ seed: 7, countdownSec: 0, teamCount: 3 });
    const map = generateMap(config, { templates: [TEST_TEMPLATE] });
    const { state } = createMatch(config, map, three);
    giveGems(state, 'a', 4);
    giveGems(state, 'b', 4);
    giveGems(state, 'c', 1);
    expect(leader(state)).toBeNull();
    step(state, map, config, {});
    expect(state.phase).toBe('ended');
    expect(state.result?.reason).toBe('draw');
  });

  it('step is a no-op once ended', () => {
    const { config, map, state } = setup({ matchDurationSec: 30 });
    giveGems(state, 'a', 1);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.phase).toBe('ended');
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const snapshot = JSON.stringify(state);
    const events = step(state, map, config, { a: held('right', true) });
    runTicks(state, map, config, { a: held('right', true) }, 5);
    expect(events).toEqual([]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('forfeitMatch ends the match with the given winner', () => {
    const { map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const events = forfeitMatch(state, 1);
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ winnerTeamId: 1, reason: 'forfeit', scores: { 0: 0, 1: 0 } });
    expect(events.map((e) => e.type)).toEqual(['phase', 'ended']);
    expect(forfeitMatch(state, 0)).toEqual([]); // already ended
    expect(state.result?.winnerTeamId).toBe(1);
  });

  it('connectedTeamIds and findTeam reflect disconnects', () => {
    const { state } = setup();
    expect(connectedTeamIds(state)).toEqual([0, 1]);
    setPlayerConnected(state, 'c', false);
    setPlayerConnected(state, 'd', false);
    expect(connectedTeamIds(state)).toEqual([0]);
    expect(findTeam(state, 1)?.name).toBe('Blue');
    expect(findTeam(state, 9)).toBeUndefined();
  });

  it('a team whose last player was removed still appears in scores and results', () => {
    const { config, map, state } = setup({ matchDurationSec: 30 });
    removePlayer(state, map, 'c');
    removePlayer(state, map, 'd');
    expect(state.teams[1]?.playerIds).toEqual([]);
    expect(teamScores(state)).toEqual({ 0: 0, 1: 0 });
    giveGems(state, 'a', 1);
    runTicks(state, map, config, {}, ticksForSeconds(config, 30));
    expect(state.result?.scores).toEqual({ 0: 1, 1: 0 });
    expect(state.result?.winnerTeamId).toBe(0);
  });
});

describe('dropping, scattering, and removal', () => {
  it('dropAllGems scatters carried gems onto distinct floor tiles in the current room', () => {
    const { map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    for (const g of state.gems.slice(0, 3)) {
      g.location = { kind: 'player', playerId: 'a' };
      a.carriedGemIds.push(g.id);
    }
    const rngBefore = state.rngState;
    dropAllGems(state, map, 'a');
    expect(a.carriedGemIds).toEqual([]);
    expect(state.rngState).not.toBe(rngBefore);
    const floor = state.gems.filter((g) => g.location.kind === 'floor');
    expect(floor).toHaveLength(3);
    const tiles = new Set<string>();
    for (const g of floor) {
      if (g.location.kind !== 'floor') continue;
      expect(isWalkable(map, g.location.x, g.location.y)).toBe(true);
      expect(roomIdAt(map, g.location.x, g.location.y)).toBe(4);
      tiles.add(`${g.location.x},${g.location.y}`);
    }
    expect(tiles.size).toBe(3);
    dropAllGems(state, map, 'a'); // nothing carried: no-op
    dropAllGems(state, map, 'zzz'); // unknown: no-op
  });

  it('dropAllGems from a door tile scatters into the last room entered', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    const room4 = map.rooms[4] as { x: number; y: number; size: number };
    a.x = room4.x + room4.size - 1;
    a.y = room4.y + 5;
    a.lastRoomId = 4;
    step(state, map, config, { a: held('right') }); // now on the door tile
    expect(roomIdAt(map, a.x, a.y)).toBeUndefined();
    (state.gems[0] as { location: unknown }).location = { kind: 'player', playerId: 'a' };
    a.carriedGemIds.push(0);
    const events = dropAllGems(state, map, 'a');
    expect(events).toEqual([{ type: 'gemsDropped', playerId: 'a', gemIds: [0] }]);
    const loc = state.gems[0]?.location;
    expect(loc?.kind).toBe('floor');
    if (loc?.kind === 'floor') expect(roomIdAt(map, loc.x, loc.y)).toBe(4);
  });

  it('dropAllGems is deterministic', () => {
    const run = (): string => {
      const { map, state } = setup();
      const a = player(state, 'a');
      toOpenFloor(a, map);
      for (const g of state.gems.slice(0, 4)) {
        g.location = { kind: 'player', playerId: 'a' };
        a.carriedGemIds.push(g.id);
      }
      dropAllGems(state, map, 'a');
      return JSON.stringify(state.gems);
    };
    expect(run()).toBe(run());
  });

  it('walking onto a floor gem picks it up', () => {
    const { config, map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    const gem = state.gems[0] as { location: unknown };
    gem.location = { kind: 'floor', x: a.x + 1, y: a.y };
    const events = step(state, map, config, { a: held('right') });
    expect(events).toEqual([{ type: 'gemPickedUp', playerId: 'a', gemId: 0, from: 'floor' }]);
    expect(a.carriedGemIds).toEqual([0]);
    expect(state.gems[0]?.location).toEqual({ kind: 'player', playerId: 'a' });
  });

  it('removePlayer scatters their gems and drops them from the team', () => {
    const { map, state } = setup();
    const a = player(state, 'a');
    toOpenFloor(a, map);
    (state.gems[0] as { location: unknown }).location = { kind: 'player', playerId: 'a' };
    a.carriedGemIds.push(0);
    removePlayer(state, map, 'a');
    expect(findPlayer(state, 'a')).toBeUndefined();
    expect(state.teams[0]?.playerIds).toEqual(['b']);
    expect(state.gems[0]?.location.kind).toBe('floor');
    expect(teamScores(state)).toEqual({ 0: 0, 1: 0 });
  });
});

describe('replay determinism', () => {
  /**
   * A scripted "bot": walk to the nearest hidden gem's approach tile, face it, hold Action,
   * repeat. Produces real searches, pickups, and (with the scripted drop/remove) scatters.
   */
  function approachTiles(map: GameMap, f: Furniture): { x: number; y: number }[] {
    return f.tiles
      .flatMap((t) =>
        (['up', 'down', 'left', 'right'] as Dir[]).map((d) => ({
          x: t.x + DIR_DELTA[d].x,
          y: t.y + DIR_DELTA[d].y,
        })),
      )
      .filter((t) => isWalkable(map, t.x, t.y))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function botInput(
    state: MatchState,
    map: GameMap,
    p: PlayerState,
    memo: Map<string, Dir[]>,
  ): { dir: Dir | null; action: boolean } {
    // Frozen players and the countdown do not move; planning then would desync the plan.
    if (state.phase === 'countdown' || !p.connected) return { dir: null, action: false };
    let plan = memo.get(p.id);
    if (!plan) {
      let best: { path: Dir[]; approach: { x: number; y: number }; f: Furniture } | null = null;
      for (const g of state.gems) {
        if (g.location.kind !== 'furniture') continue;
        const f = map.furniture[g.location.furnitureId] as Furniture;
        for (const approach of approachTiles(map, f)) {
          const path = pathTo(map, { x: p.x, y: p.y }, approach);
          if (!best || path.length < best.path.length) best = { path, approach, f };
        }
      }
      if (!best) return { dir: null, action: false };
      plan = [...best.path, facingFor(best.approach, best.f) as Dir];
      memo.set(p.id, plan);
    }
    const next = plan[0] as Dir;
    if (plan.length === 1) {
      // At the approach tile: face the furniture and hold Action until the latch says done.
      if (p.searchLatchFurnitureId !== null) {
        memo.delete(p.id);
        return { dir: null, action: false };
      }
      return { dir: p.facing === next ? null : next, action: true };
    }
    // Keep holding the direction until the step actually happens this tick.
    const target = { x: p.x + DIR_DELTA[next].x, y: p.y + DIR_DELTA[next].y };
    if (p.moveCooldownTicks <= 1 && isWalkable(map, target.x, target.y)) plan.shift();
    return { dir: next, action: false };
  }

  function scriptedRun(seed: number, ticks: number): { state: MatchState; events: TickEvent[] } {
    const config = makeConfig({ seed, countdownSec: 1, matchDurationSec: 60 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const memo = new Map<string, Dir[]>();
    const events: TickEvent[] = [];
    for (let t = 0; t < ticks; t++) {
      const inputs: Record<string, { dir: Dir | null; action: boolean }> = {};
      for (const p of state.players) inputs[p.id] = botInput(state, map, p, memo);
      if (t === 500) dropAllGems(state, map, 'a', events);
      if (t === 600) setPlayerConnected(state, 'b', false);
      if (t === 700) removePlayer(state, map, 'b', events);
      step(state, map, config, inputs, events);
    }
    return { state, events };
  }

  it('the bots actually find, drop, and re-collect gems', () => {
    const { state, events } = scriptedRun(99, 1200);
    const found = events.filter((e) => e.type === 'gemPickedUp' && e.from === 'furniture');
    const dropped = events.filter((e) => e.type === 'gemsDropped' && e.gemIds.length > 0);
    expect(found.length).toBeGreaterThan(2);
    expect(dropped.length).toBeGreaterThanOrEqual(1);
    expect(state.players.map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(Object.values(state.searchedByTeam).some((ids) => ids.length > 0)).toBe(true);
    expect(state.rngState).not.toBe(
      createMatch(makeConfig({ seed: 99 }), generateMap(makeConfig({ seed: 99 })), teams).state
        .rngState,
    );
  });

  it('the same seed and inputs produce identical state and events', () => {
    const a = scriptedRun(99, 1200);
    const b = scriptedRun(99, 1200);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    // The bots may clear the map before the tick budget; then the match ends early.
    expect(a.state.tick === 1200 || a.state.phase === 'ended').toBe(true);
    expect(a.state.tick).toBeGreaterThan(100);
  });

  it('matches a pinned fingerprint (a rule change must update this on purpose)', () => {
    const { state } = scriptedRun(42, 900);
    const fingerprint = JSON.stringify({
      tick: state.tick,
      phase: state.phase,
      scores: teamScores(state),
      players: state.players.map((p) => [p.id, p.x, p.y, p.carriedGemIds.length]),
      gems: state.gems.map((g) => g.location.kind[0]).join(''),
      rng: state.rngState,
    });
    expect(fingerprint).toBe(
      '{"tick":460,"phase":"ended","scores":{"0":0,"1":7},"players":[["a",9,35,0],["c",9,35,1],["d",9,35,6]],"gems":"ffppppppp","rng":1286816280}',
    );
  });

  it('a JSON round trip of the state continues identically', () => {
    const config = makeConfig({ seed: 5, countdownSec: 0 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    runTicks(state, map, config, { a: held('right'), c: held('up', true) }, 50);
    const copy = JSON.parse(JSON.stringify(state)) as MatchState;
    runTicks(state, map, config, { a: held('down', true), d: held('left') }, 50);
    runTicks(copy, map, config, { a: held('down', true), d: held('left') }, 50);
    expect(copy).toEqual(state);
  });

  it('random walks never leave walkable tiles', () => {
    const config = makeConfig({ seed: 3, countdownSec: 1, matchDurationSec: 60 });
    const map = generateMap(config);
    const { state } = createMatch(config, map, teams);
    const rng = createRng(31);
    const dirs: (Dir | null)[] = ['up', 'down', 'left', 'right', null];
    for (let t = 0; t < 1000; t++) {
      const inputs: Record<string, { dir: Dir | null; action: boolean }> = {};
      for (const p of state.players) {
        inputs[p.id] = { dir: rng.pick(dirs), action: rng.next() < 0.3 };
      }
      step(state, map, config, inputs);
    }
    for (const p of state.players) {
      expect(isWalkable(map, p.x, p.y)).toBe(true);
      const d = DIR_DELTA[p.facing];
      expect(Math.abs(d.x) + Math.abs(d.y)).toBe(1);
    }
  });
});
