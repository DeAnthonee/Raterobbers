import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameMap, WireRoomState } from '@raterobbers/shared';
import { GAME_ROOM, server } from './app';
import { GameRoom, parseConfigPatch, parseInputEvent, sanitizeName } from './GameRoom';
import { createMatch, generateMap, makeConfig, type TeamSetup } from '@raterobbers/shared';

/** Fast settings so the integration tests finish quickly. */
const FAST = { countdownSec: 0, reconnectGraceSec: 1, matchDurationSec: 30 };

describe('pure helpers', () => {
  it('sanitizeName trims, strips control characters, caps length, and defaults', () => {
    expect(sanitizeName('  Ann  ')).toBe('Ann');
    expect(sanitizeName('a\u0000b\u001fc')).toBe('abc');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16);
    expect(sanitizeName('')).toBe('Player');
    expect(sanitizeName(undefined)).toBe('Player');
    expect(sanitizeName(42)).toBe('Player');
    expect(sanitizeName({ toString: () => 'spoof' })).toBe('Player');
    // Counts code points, never splits a surrogate pair.
    const emoji = 'a' + '😀'.repeat(20);
    const out = sanitizeName(emoji);
    expect(Array.from(out)).toHaveLength(16);
    expect(out.endsWith('😀')).toBe(true);
  });

  it('parseInputEvent accepts only well-formed events', () => {
    expect(parseInputEvent({ type: 'move', dir: 'up' })).toEqual({ type: 'move', dir: 'up' });
    expect(parseInputEvent({ type: 'move', dir: null })).toEqual({ type: 'move', dir: null });
    expect(parseInputEvent({ type: 'actionDown' })).toEqual({ type: 'actionDown' });
    expect(parseInputEvent({ type: 'actionUp', dir: 'left' })).toEqual({ type: 'actionUp' });
    expect(parseInputEvent({ type: 'move', dir: 'diagonal' })).toBeNull();
    expect(parseInputEvent({ type: 'fly' })).toBeNull();
    expect(parseInputEvent('move')).toBeNull();
    expect(parseInputEvent(null)).toBeNull();
  });

  it('parseConfigPatch keeps only known numeric keys', () => {
    expect(parseConfigPatch({ roomSize: 12, seed: 'x', bogus: 1, tickRate: Infinity })).toEqual({
      roomSize: 12,
    });
    expect(parseConfigPatch(null)).toEqual({});
  });
});

describe('GameRoom.update (no network)', () => {
  const teams: TeamSetup[] = [
    { id: 0, name: 'Red', players: [{ id: 'a', name: 'Ann' }] },
    { id: 1, name: 'Blue', players: [{ id: 'b', name: 'Bob' }] },
  ];

  function bare(overrides: Record<string, number> = {}): GameRoom {
    const room = new GameRoom();
    const config = makeConfig({ seed: 1, countdownSec: 0, matchDurationSec: 30, ...overrides });
    const map = generateMap(config);
    room.matchConfig = config;
    room.map = map;
    room.match = createMatch(config, map, teams).state;
    // No transport in these tests: stub the network side effects.
    room.broadcast = (() => undefined) as unknown as GameRoom['broadcast'];
    room.broadcastPatch = (() => false) as unknown as GameRoom['broadcastPatch'];
    return room;
  }

  it('simulates one tick per 50 ms with no drift across uneven frames', () => {
    const room = bare();
    for (let i = 0; i < 1000; i++) room.update(1000 / 60);
    expect(room.match?.tick).toBe(333);
  });

  it('caps a long stall at 10 ticks', () => {
    const room = bare();
    room.update(5000);
    expect(room.match?.tick).toBe(10);
  });

  it('stops ticking once the match ends mid-update', () => {
    const room = bare();
    const match = room.match as NonNullable<GameRoom['match']>;
    match.timeTicksRemaining = 3;
    const a = match.players[0] as { carriedGemIds: number[] };
    (match.gems[0] as { location: unknown }).location = { kind: 'player', playerId: 'a' };
    a.carriedGemIds.push(0);
    room.update(500);
    expect(match.phase).toBe('ended');
    expect(match.tick).toBe(3);
    expect(room.state.phase).toBe('ended');
    room.update(500);
    expect(match.tick).toBe(3);
  });
});

describe('GameRoom', () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    // Loopback only, random port: the suite gates deploys and must not collide with the
    // live game or with another test run on the same machine.
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    await server.listen(port, '127.0.0.1');
    colyseus = new ColyseusTestServer(server);
  }, 30_000);
  afterAll(async () => {
    await colyseus.shutdown();
  });
  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function createRoom(): Promise<GameRoom> {
    return colyseus.createRoom<GameRoom>(GAME_ROOM, {});
  }

  async function join(room: GameRoom, name: string): Promise<SdkRoom> {
    const client = await colyseus.connectTo(room, { name });
    await vi.waitFor(() => expect(room.state.lobby.has(client.sessionId)).toBe(true));
    await vi.waitFor(() => expect(wire(client).joinCode).toBe(room.roomId));
    return client;
  }

  function wire(client: SdkRoom): WireRoomState {
    return (client.state as { toJSON(): unknown }).toJSON() as WireRoomState;
  }

  async function sendAndWait(room: GameRoom, client: SdkRoom, type: string, payload?: unknown) {
    const waiting = room.waitForMessage(type);
    client.send(type, payload);
    await waiting;
  }

  /** Hand a hidden gem to a player so the timer produces a winner instead of overtime. */
  function giveGem(match: NonNullable<GameRoom['match']>, playerId: string): void {
    const gem = match.gems.find((g) => g.location.kind === 'furniture');
    const p = match.players.find((x) => x.id === playerId);
    if (!gem || !p) throw new Error('no gem or player');
    gem.location = { kind: 'player', playerId };
    p.carriedGemIds.push(gem.id);
  }

  /** Host + one guest on different teams, both ready, fast config applied. */
  async function readyLobby(): Promise<{ room: GameRoom; host: SdkRoom; guest: SdkRoom }> {
    const room = await createRoom();
    const host = await join(room, 'Host');
    const guest = await join(room, 'Guest');
    await sendAndWait(room, host, 'setConfig', FAST);
    await sendAndWait(room, host, 'ready', { ready: true });
    await sendAndWait(room, guest, 'ready', { ready: true });
    return { room, host, guest };
  }

  async function startMatch(room: GameRoom, host: SdkRoom): Promise<GameMap> {
    const mapPromise = host.waitForMessage('map');
    await sendAndWait(room, host, 'start');
    const map = (await mapPromise) as GameMap;
    expect(room.match).not.toBeNull();
    return map;
  }

  it('serves /healthz with version and live counts', async () => {
    const before = await colyseus.http.get('/healthz');
    expect(before.statusCode).toBe(200);
    const body = before.data as {
      ok: boolean;
      version: string;
      playing: number;
      rooms: number;
      players: number;
    };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.playing).toBe(0);
    const { room, host } = await readyLobby();
    await startMatch(room, host);
    const during = (await colyseus.http.get('/healthz')).data as {
      playing: number;
      rooms: number;
      players: number;
    };
    expect(during.playing).toBe(1);
    expect(during.rooms).toBe(1);
    expect(during.players).toBe(2);
    expect(before.headers['cache-control']).toBe('no-store');
  });

  it('creates a private room with a 5-letter join code used as the room id', async () => {
    const room = await createRoom();
    expect(room.roomId).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(room.state.joinCode).toBe(room.roomId);
    expect(room.state.phase).toBe('lobby');
    // Private: cannot be matched by room name, only by code.
    await expect(colyseus.sdk.join(GAME_ROOM, { name: 'Stranger' })).rejects.toThrow();
    const byCode = await colyseus.sdk.joinById(room.roomId, { name: 'Friend' });
    expect(byCode.sessionId).toBeTruthy();
  });

  it('refuses joins once the lobby is full for the configured teams', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    await sendAndWait(room, host, 'setConfig', { teamCount: 2, teamSize: 1 });
    await join(room, 'Second');
    await expect(colyseus.sdk.joinById(room.roomId, { name: 'Third' })).rejects.toThrow(/full/);
    // And the host cannot shrink the teams below the current head count.
    const err = host.waitForMessage('error');
    await sendAndWait(room, host, 'setConfig', { teamCount: 2, teamSize: 1, mapRows: 3 });
    expect(room.config.mapRows).toBe(3); // still fits: 2 players, capacity 2
    await join(room, 'x').catch(() => undefined);
    await sendAndWait(room, host, 'setConfig', { teamSize: 0 });
    expect(((await err) as { message: string }).message).toMatch(/teamSize|Too many/);
  });

  it('seats joiners in the lobby, balances teams, and makes the first joiner host', async () => {
    const room = await createRoom();
    const a = await join(room, 'Ann');
    const b = await join(room, '  Bob ');
    const c = await join(room, 'Cat');
    await vi.waitFor(() => expect(Object.keys(wire(c).lobby)).toHaveLength(3));
    const s = wire(c);
    expect(s.hostSessionId).toBe(a.sessionId);
    expect(Object.keys(s.lobby)).toHaveLength(3);
    expect(s.lobby[b.sessionId]?.name).toBe('Bob');
    expect([s.lobby[a.sessionId]?.teamId, s.lobby[b.sessionId]?.teamId].sort()).toEqual([0, 1]);
    expect(s.lobby[c.sessionId]?.ready).toBe(false);
    expect(s.config.teamCount).toBe(2);
  });

  it('lets players switch teams, ready up, and rejects full or missing teams', async () => {
    const room = await createRoom();
    const a = await join(room, 'Ann');
    const b = await join(room, 'Bob');
    await sendAndWait(room, a, 'setTeam', { teamId: 1 }); // joins Bob's team (size 2 allowed)
    expect(room.state.lobby.get(a.sessionId)?.teamId).toBe(1);
    expect(room.state.lobby.get(b.sessionId)?.teamId).toBe(1);
    const c = await join(room, 'Cat'); // goes to the empty team 0
    expect(room.state.lobby.get(c.sessionId)?.teamId).toBe(0);
    const errorPromise = c.waitForMessage('error');
    await sendAndWait(room, c, 'setTeam', { teamId: 1 });
    expect(((await errorPromise) as { message: string }).message).toMatch(/full/);
    const error2 = c.waitForMessage('error');
    await sendAndWait(room, c, 'setTeam', { teamId: 7 });
    expect(((await error2) as { message: string }).message).toMatch(/No such team/);
    await sendAndWait(room, c, 'ready', { ready: true });
    expect(room.state.lobby.get(c.sessionId)?.ready).toBe(true);
  });

  it('only the host can change config; invalid config is rejected with a message', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    const guest = await join(room, 'Guest');
    const guestError = guest.waitForMessage('error');
    await sendAndWait(room, guest, 'setConfig', { roomSize: 12 });
    expect(((await guestError) as { message: string }).message).toMatch(/host/);
    const hostError = host.waitForMessage('error');
    await sendAndWait(room, host, 'setConfig', { gemCount: 4 });
    expect(((await hostError) as { message: string }).message).toMatch(/odd/);
    expect(room.config.gemCount).toBe(9);
    await sendAndWait(room, host, 'setConfig', { mapRows: 2, mapCols: 2, countdownSec: 1 });
    expect(room.config.mapRows).toBe(2);
    expect(room.config.gemCount).toBe(5); // re-derived from the room count
    await vi.waitFor(() => expect(wire(guest).config.countdownSec).toBe(1));
  });

  it('refuses to start until everyone is ready, and with 2+ players on one team', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    const err1 = host.waitForMessage('error');
    await sendAndWait(room, host, 'start');
    expect(((await err1) as { message: string }).message).toMatch(/ready/);
    const guest = await join(room, 'Guest');
    await sendAndWait(room, guest, 'setTeam', { teamId: 0 }); // both on team 0
    await sendAndWait(room, host, 'ready', { ready: true });
    await sendAndWait(room, guest, 'ready', { ready: true });
    const err2 = host.waitForMessage('error');
    await sendAndWait(room, host, 'start');
    expect(((await err2) as { message: string }).message).toMatch(/two teams/);
    expect(room.match).toBeNull();
  });

  it('a lone player can start a solo practice match', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    await sendAndWait(room, host, 'setConfig', FAST);
    await sendAndWait(room, host, 'ready', { ready: true });
    await startMatch(room, host);
    expect(room.match?.teams).toHaveLength(1);
    expect(room.match?.players).toHaveLength(1);
    expect(room.matchConfig?.teamCount).toBe(1);
    expect(room.state.phase).toBe('playing');
  });

  it('starts a match: sends the map, spawns players, locks the room, syncs state', async () => {
    const { room, host, guest } = await readyLobby();
    const guestMap = guest.waitForMessage('map');
    const map = await startMatch(room, host);
    expect((await guestMap) as GameMap).toEqual(map);
    expect(map.rooms).toHaveLength(9);
    expect(room.state.phase).toBe('playing');
    expect(room.match?.players.map((p) => p.id).sort()).toEqual(
      [host.sessionId, guest.sessionId].sort(),
    );
    await vi.waitFor(() => expect(wire(guest).phase).toBe('playing'));
    const s = wire(guest);
    expect(s.match.players).toHaveLength(2);
    expect(s.match.gems).toHaveLength(9);
    expect(s.match.teams.map((t) => t.name).sort()).toEqual(['Blue', 'Red']);
    // Locked: nobody else can join by code.
    await expect(colyseus.sdk.joinById(room.roomId, { name: 'Late' })).rejects.toThrow(/locked/i);
  });

  it('applies player input on the tick loop and the client sees the movement', async () => {
    const { room, host } = await readyLobby();
    await startMatch(room, host);
    const me = () => room.match?.players.find((p) => p.id === host.sessionId);
    const start = { x: me()?.x, y: me()?.y };
    // Try each direction until one moves us (the spawn may be against furniture).
    for (const dir of ['right', 'left', 'down', 'up'] as const) {
      const tickBefore = room.match?.tick ?? 0;
      await sendAndWait(room, host, 'input', { type: 'move', dir });
      await vi.waitFor(() => expect(room.match?.tick ?? 0).toBeGreaterThan(tickBefore + 4), {
        timeout: 2000,
      });
      await sendAndWait(room, host, 'input', { type: 'move', dir: null });
      if (me()?.x !== start.x || me()?.y !== start.y) break;
    }
    const moved = me();
    expect({ x: moved?.x, y: moved?.y }).not.toEqual(start);
    await vi.waitFor(
      () => {
        const p = wire(host).match.players.find((x) => x.id === host.sessionId);
        expect({ x: p?.x, y: p?.y }).toEqual({ x: moved?.x, y: moved?.y });
      },
      { timeout: 2000 },
    );
  });

  it('ignores input from the lobby and malformed input during a match', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    await sendAndWait(room, host, 'input', { type: 'move', dir: 'up' });
    expect(room.heldInputs[host.sessionId]).toBeUndefined();
    const guest = await join(room, 'Guest');
    await sendAndWait(room, host, 'setConfig', FAST);
    await sendAndWait(room, host, 'ready', { ready: true });
    await sendAndWait(room, guest, 'ready', { ready: true });
    await startMatch(room, host);
    await sendAndWait(room, host, 'input', { type: 'move', dir: 'diagonal' });
    await sendAndWait(room, host, 'input', 'nonsense');
    await sendAndWait(room, host, 'input', { type: 'actionDown', __proto__: { evil: 1 } });
    expect(room.heldInputs[host.sessionId]).toEqual({ dir: null, action: true });
    // Non-host start/rematch are refused.
    const err = guest.waitForMessage('error');
    await sendAndWait(room, guest, 'start');
    expect(((await err) as { message: string }).message).toMatch(/lobby/);
  });

  it('only the host may start, and rematch from the lobby is refused', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    const guest = await join(room, 'Guest');
    const err = guest.waitForMessage('error');
    await sendAndWait(room, guest, 'start');
    expect(((await err) as { message: string }).message).toMatch(/host/);
    const err2 = host.waitForMessage('error');
    await sendAndWait(room, host, 'rematch');
    expect(((await err2) as { message: string }).message).toMatch(/No finished match/);
  });

  it('a searching team gets its searched list and events; the other team does not', async () => {
    const { room, host, guest } = await readyLobby();
    await startMatch(room, host);
    const match = room.match as NonNullable<typeof room.match>;
    const me = match.players.find((p) => p.id === host.sessionId) as (typeof match.players)[number];
    // Stand the host next to a gem piece, facing it, and hold Action.
    const gem = match.gems.find((g) => g.location.kind === 'furniture');
    if (!gem || gem.location.kind !== 'furniture') throw new Error('no hidden gem');
    const piece = (room.map as NonNullable<typeof room.map>).furniture[gem.location.furnitureId];
    if (!piece) throw new Error('no piece');
    const t = piece.tiles[0] as { x: number; y: number };
    me.x = t.x;
    me.y = t.y + 1;
    me.facing = 'up';
    me.lastRoomId = piece.roomId;
    const hostSearched = host.waitForMessage('searched');
    const hostEvents = host.waitForMessage('events');
    let guestGotSearched = false;
    guest.onMessage('searched', (m: { furnitureIds: number[] }) => {
      if (m.furnitureIds.length > 0) guestGotSearched = true;
    });
    await sendAndWait(room, host, 'input', { type: 'actionDown' });
    await vi.waitFor(() => expect(me.carriedGemIds.length).toBe(1), { timeout: 4000 });
    expect(((await hostSearched) as { furnitureIds: number[] }).furnitureIds).toEqual([piece.id]);
    const events = (await hostEvents) as { type: string }[];
    expect(events.map((e) => e.type)).toEqual(['gemPickedUp', 'searchComplete']);
    await vi.waitFor(() =>
      expect(wire(guest).match.players.find((p) => p.id === host.sessionId)?.carriedGemIds).toEqual(
        [gem.id],
      ),
    );
    expect(guestGotSearched).toBe(false);
    // Hidden gem locations are masked on the wire for everyone.
    for (const g of wire(guest).match.gems)
      if (g.kind === 'furniture') expect(g.furnitureId).toBe(-1);
    expect(wire(guest).match.rngState).toBe(0);
  });

  it('a leaving player is removed and host passes to the next; a leaving opponent forfeits', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    const guest = await join(room, 'Guest');
    await host.leave(true);
    await vi.waitFor(() => expect(room.state.hostSessionId).toBe(guest.sessionId));
    expect(room.state.lobby.has(host.sessionId)).toBe(false);
    expect(room.state.lobby.size).toBe(1);

    const third = await join(room, 'Third');
    await sendAndWait(room, guest, 'setConfig', FAST);
    await sendAndWait(room, guest, 'ready', { ready: true });
    await sendAndWait(room, third, 'ready', { ready: true });
    await startMatch(room, guest);
    await third.leave(true);
    await vi.waitFor(() => expect(room.match?.phase).toBe('ended'));
    expect(room.match?.result?.reason).toBe('forfeit');
    const guestTeam = room.match?.teams.find((t) => t.playerIds.includes(guest.sessionId));
    expect(room.match?.result?.winnerTeamId).toBe(guestTeam?.id);
    expect(room.state.phase).toBe('ended');
  });

  it('a dropped player is frozen, then removed (gems scattered) after the grace period', async () => {
    const { room, host, guest } = await readyLobby();
    await startMatch(room, host);
    const gid = guest.sessionId;
    // Hand the guest a gem so we can see it scatter.
    const match = room.match as NonNullable<typeof room.match>;
    const gem = match.gems[0] as { location: unknown };
    gem.location = { kind: 'player', playerId: gid };
    match.players.find((p) => p.id === gid)?.carriedGemIds.push(0);

    await guest.leave(false); // unexpected disconnect
    await vi.waitFor(() => {
      expect(match.players.find((p) => p.id === gid)?.connected).toBe(false);
    });
    expect(room.state.lobby.get(gid)?.connected).toBe(false);
    expect(room.heldInputs[gid]).toEqual({ dir: null, action: false });
    expect(match.players.some((p) => p.id === gid)).toBe(true);

    await vi.waitFor(() => expect(match.players.some((p) => p.id === gid)).toBe(false), {
      timeout: 4000,
    });
    expect(match.gems[0]?.location.kind).toBe('floor');
    expect(room.state.lobby.has(gid)).toBe(false);
    // Only one team left with players: the host's team wins by forfeit.
    expect(match.phase).toBe('ended');
    expect(match.result?.reason).toBe('forfeit');
  }, 10_000);

  it('a dropped player can reconnect within the grace period and gets the map again', async () => {
    const { room, host, guest } = await readyLobby();
    await startMatch(room, host);
    const gid = guest.sessionId;
    const token = guest.reconnectionToken;
    await guest.leave(false);
    await vi.waitFor(() => {
      expect(room.match?.players.find((p) => p.id === gid)?.connected).toBe(false);
    });
    const again = await colyseus.sdk.reconnect(token);
    const mapAgain = again.waitForMessage('map');
    await vi.waitFor(() => {
      expect(room.match?.players.find((p) => p.id === gid)?.connected).toBe(true);
    });
    expect(((await mapAgain) as GameMap).rooms).toHaveLength(9);
    expect(room.state.lobby.get(gid)?.connected).toBe(true);
    expect(again.sessionId).toBe(gid);
  });

  it('host transfer skips disconnected players; a drop after the match ended keeps the seat', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    await sendAndWait(room, host, 'setConfig', { ...FAST, teamCount: 3, reconnectGraceSec: 2 });
    const guest = await join(room, 'Guest');
    const third = await join(room, 'Third');
    for (const c of [host, guest, third]) await sendAndWait(room, c, 'ready', { ready: true });
    await startMatch(room, host);
    const match = room.match as NonNullable<typeof room.match>;
    await guest.leave(false); // guest drops into grace
    await vi.waitFor(() => expect(room.state.lobby.get(guest.sessionId)?.connected).toBe(false));
    await host.leave(true); // host leaves for good: the role must skip the dropped guest
    await vi.waitFor(() => expect(room.state.hostSessionId).toBe(third.sessionId));

    // End the match while the guest is still in grace: their seat survives the drop.
    giveGem(match, third.sessionId);
    match.timeTicksRemaining = 1;
    await vi.waitFor(() => expect(room.state.phase).toBe('ended'));
    const playersAtEnd = match.players.length;
    await vi.waitFor(() => expect(room.state.lobby.has(guest.sessionId)).toBe(false), {
      timeout: 5000,
    });
    // Grace expired after the end: the finished match is left untouched.
    expect(match.players.length).toBe(playersAtEnd);
  });

  it('rematch drops players still in reconnect grace so Start is not blocked', async () => {
    const room = await createRoom();
    const host = await join(room, 'Host');
    await sendAndWait(room, host, 'setConfig', { ...FAST, teamCount: 3, reconnectGraceSec: 60 });
    const guest = await join(room, 'Guest');
    const third = await join(room, 'Third');
    expect([...room.state.lobby.values()].map((e) => e.teamId).sort()).toEqual([0, 1, 2]);
    for (const c of [host, guest, third]) await sendAndWait(room, c, 'ready', { ready: true });
    await startMatch(room, host);
    const match = room.match as NonNullable<typeof room.match>;
    await guest.leave(false);
    await vi.waitFor(() => expect(room.state.lobby.get(guest.sessionId)?.connected).toBe(false));
    giveGem(match, host.sessionId);
    match.timeTicksRemaining = 1;
    await vi.waitFor(() => expect(room.state.phase).toBe('ended'));
    await sendAndWait(room, host, 'rematch');
    expect(room.state.phase).toBe('lobby');
    expect(room.state.lobby.has(guest.sessionId)).toBe(false);
    expect(room.state.lobby.size).toBe(2);
    await sendAndWait(room, host, 'ready', { ready: true });
    await sendAndWait(room, third, 'ready', { ready: true });
    await startMatch(room, host);
    expect(room.match?.players.map((p) => p.id).sort()).toEqual(
      [host.sessionId, third.sessionId].sort(),
    );
  });

  it('rematch returns to the lobby with a new seed and everyone un-readied', async () => {
    const { room, host, guest } = await readyLobby();
    await startMatch(room, host);
    const seedBefore = room.config.seed;
    const err = guest.waitForMessage('error');
    await sendAndWait(room, guest, 'rematch');
    expect(((await err) as { message: string }).message).toMatch(/still running/);
    // End the match by forfeit-free means: force the shared state to ended via the timer.
    const match = room.match as NonNullable<typeof room.match>;
    match.timeTicksRemaining = 1;
    const p = match.players[0] as { carriedGemIds: number[] };
    (match.gems[0] as { location: unknown }).location = {
      kind: 'player',
      playerId: match.players[0]?.id,
    };
    p.carriedGemIds.push(0);
    await vi.waitFor(() => expect(room.state.phase).toBe('ended'));
    await sendAndWait(room, host, 'rematch');
    expect(room.state.phase).toBe('lobby');
    expect(room.match).toBeNull();
    expect(room.config.seed).not.toBe(seedBefore);
    expect([...room.state.lobby.values()].every((e) => !e.ready)).toBe(true);
    const late = await colyseus.sdk.joinById(room.roomId, { name: 'Late' });
    expect(late.sessionId).toBeTruthy();
  });
});
