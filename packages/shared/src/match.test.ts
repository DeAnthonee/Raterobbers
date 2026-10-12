import { describe, expect, it } from 'vitest';
import { makeConfig } from './config';
import { generateMap, roomIdAt } from './map';
import {
  chooseSpawnRooms,
  createMatch,
  placeGems,
  spawnTilesForRoom,
  validateTeams,
  type TeamSetup,
} from './match';
import { teamScores } from './state';
import { TEST_TEMPLATE } from './testing';

const twoTeams: TeamSetup[] = [
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

describe('chooseSpawnRooms', () => {
  it('puts 2 teams in opposite corners of a 3x3, starting corner chosen by seed', () => {
    const map = generateMap(makeConfig({ seed: 1 }));
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const rooms = chooseSpawnRooms(map, 2, seed);
      const key = [...rooms].sort().join(',');
      expect(['0,8', '2,6']).toContain(key);
      seen.add(String(rooms[0]));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(chooseSpawnRooms(map, 2, 5)).toEqual(chooseSpawnRooms(map, 2, 5));
  });

  it('puts 4 teams in the four corners of a 3x3', () => {
    const map = generateMap(makeConfig({ seed: 1 }));
    expect([...chooseSpawnRooms(map, 4)].sort()).toEqual([0, 2, 6, 8]);
  });

  it('uses the two ends of a 1x4 strip', () => {
    const map = generateMap(makeConfig({ seed: 1, mapRows: 1, mapCols: 4 }));
    expect([...chooseSpawnRooms(map, 2)].sort()).toEqual([0, 3]);
  });

  it('throws when there are more teams than rooms', () => {
    const map = generateMap(makeConfig({ seed: 1, mapRows: 1, mapCols: 3 }));
    expect(() => chooseSpawnRooms(map, 4)).toThrow();
  });
});

describe('spawnTilesForRoom', () => {
  it('orders walkable tiles by distance to the room centre', () => {
    const map = generateMap(makeConfig({ seed: 1 }), { templates: [TEST_TEMPLATE] });
    const tiles = spawnTilesForRoom(map, 4);
    const room = map.rooms[4] as { x: number; y: number; size: number };
    const first = tiles[0] as { x: number; y: number };
    expect(Math.abs(first.x - (room.x + 5.5))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(first.y - (room.y + 5.5))).toBeLessThanOrEqual(0.5);
    for (const t of tiles) expect(roomIdAt(map, t.x, t.y)).toBe(4);
    expect(spawnTilesForRoom(map, 99)).toEqual([]);
  });
});

describe('placeGems', () => {
  const config = makeConfig({ seed: 11 });
  const map = generateMap(config);

  it('places exactly gemCount gems in searchable furniture outside spawn rooms, one per piece', () => {
    const res = placeGems(map, config, [0, 8]);
    if ('error' in res) throw new Error(res.error.message);
    expect(res.furnitureIds).toHaveLength(9);
    expect(new Set(res.furnitureIds).size).toBe(9);
    for (const id of res.furnitureIds) {
      const f = map.furniture[id] as { searchable: boolean; roomId: number };
      expect(f.searchable).toBe(true);
      expect([0, 8]).not.toContain(f.roomId);
    }
  });

  it('respects the per-room cap', () => {
    const res = placeGems(map, config, [0, 8]);
    if ('error' in res) throw new Error(res.error.message);
    // 9 gems over 7 eligible rooms -> cap 2.
    const perRoom = new Map<number, number>();
    for (const id of res.furnitureIds) {
      const room = (map.furniture[id] as { roomId: number }).roomId;
      perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
    }
    for (const n of perRoom.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it('is deterministic for a seed', () => {
    expect(placeGems(map, config, [0, 8])).toEqual(placeGems(map, config, [0, 8]));
  });

  it('falls back to all rooms when every room is a spawn room', () => {
    const c = makeConfig({ seed: 2, mapRows: 1, mapCols: 3, teamCount: 2, gemCount: 3 });
    const m = generateMap(c);
    const res = placeGems(m, c, [0, 1, 2]);
    expect('furnitureIds' in res && res.furnitureIds.length).toBe(3);
  });

  it('reports an error when there is not enough furniture', () => {
    const c = makeConfig({ seed: 3, mapRows: 1, mapCols: 3, gemCount: 99 });
    const m = generateMap(c);
    const res = placeGems(m, c, [0]);
    expect('error' in res).toBe(true);
  });
});

describe('createMatch', () => {
  const config = makeConfig({ seed: 21 });
  const map = generateMap(config);
  const { state, spawnRooms } = createMatch(config, map, twoTeams);

  it('starts in countdown with the configured timers (in ticks)', () => {
    expect(state.phase).toBe('countdown');
    expect(state.countdownTicksRemaining).toBe(60);
    expect(state.timeTicksRemaining).toBe(6000);
    expect(state.tick).toBe(0);
    expect(state.result).toBeNull();
    expect([...spawnRooms].sort().join(',')).toMatch(/^(0,8|2,6)$/);
  });

  it('rounds durations up to whole ticks at awkward tick rates', () => {
    const c = makeConfig({ seed: 21, tickRate: 30, countdownSec: 1 });
    const s = createMatch(c, generateMap(c), twoTeams).state;
    expect(s.countdownTicksRemaining).toBe(30);
    expect(s.timeTicksRemaining).toBe(9000);
  });

  it('starts in playing when countdown is zero', () => {
    const c = makeConfig({ seed: 21, countdownSec: 0 });
    expect(createMatch(c, generateMap(c), twoTeams).state.phase).toBe('playing');
  });

  it('spawns each team together in its own room on distinct walkable tiles', () => {
    const seen = new Set<string>();
    for (const p of state.players) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(roomIdAt(map, p.x, p.y)).toBe(spawnRooms[p.teamId]);
      expect(p.lastRoomId).toBe(spawnRooms[p.teamId]);
      expect(p.carriedGemIds).toEqual([]);
      expect(p.connected).toBe(true);
    }
    expect(state.players.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('builds teams with colours and player lists', () => {
    expect(state.teams).toHaveLength(2);
    expect(state.teams[0]?.playerIds).toEqual(['a', 'b']);
    expect(state.teams[0]?.color).not.toBe(state.teams[1]?.color);
    expect(teamScores(state)).toEqual({ 0: 0, 1: 0 });
  });

  it('hides every gem in furniture and starts the fog empty', () => {
    expect(state.gems).toHaveLength(9);
    for (const g of state.gems) expect(g.location.kind).toBe('furniture');
    expect(state.searchedByTeam).toEqual({ 0: [], 1: [] });
    expect(state.traps).toEqual([]);
  });

  it('throws when the team count does not match the config', () => {
    expect(() => createMatch(config, map, [twoTeams[0] as TeamSetup])).toThrow(/expected 2 teams/);
  });

  it('validateTeams rejects duplicates, empty teams, and oversize teams', () => {
    expect(validateTeams(config, twoTeams)).toEqual([]);
    const dupTeam: TeamSetup[] = [
      { id: 0, name: 'A', players: [{ id: 'a', name: 'A' }] },
      { id: 0, name: 'B', players: [{ id: 'b', name: 'B' }] },
    ];
    expect(validateTeams(config, dupTeam).map((e) => e.message)).toContainEqual(
      expect.stringMatching(/duplicate team id/),
    );
    const dupPlayer: TeamSetup[] = [
      { id: 0, name: 'A', players: [{ id: 'a', name: 'A' }] },
      { id: 1, name: 'B', players: [{ id: 'a', name: 'B' }] },
    ];
    expect(validateTeams(config, dupPlayer).map((e) => e.message)).toContainEqual(
      expect.stringMatching(/duplicate player id/),
    );
    const empty: TeamSetup[] = [
      { id: 0, name: 'A', players: [{ id: 'a', name: 'A' }] },
      { id: 1, name: 'B', players: [] },
    ];
    expect(validateTeams(config, empty).map((e) => e.message)).toContainEqual(
      expect.stringMatching(/no players/),
    );
    const big: TeamSetup[] = [
      { id: 0, name: 'A', players: [{ id: 'a', name: 'A' }] },
      {
        id: 1,
        name: 'B',
        players: [
          { id: 'b', name: 'B' },
          { id: 'c', name: 'C' },
          { id: 'd', name: 'D' },
        ],
      },
    ];
    expect(validateTeams(config, big).map((e) => e.field)).toContain('teamSize');
    expect(() => createMatch(config, map, big)).toThrow(/max is 2/);
  });

  it('is JSON-safe', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
