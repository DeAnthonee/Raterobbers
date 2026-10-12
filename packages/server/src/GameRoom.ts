import {
  IDLE_INPUT,
  LIMITS,
  MAX_SEED,
  applyInputEvent,
  createMatch,
  emptyWireMatch,
  forfeitMatch,
  generateMap,
  makeConfig,
  matchToWire,
  removePlayer,
  setPlayerConnected,
  step,
  tickMs,
  validateMatchSetup,
  validateTeams,
  type GameMap,
  type InputEvent,
  type MatchConfig,
  type MatchState,
  type PlayerInput,
  type TeamSetup,
  type TickEvent,
} from '@eyespy/shared';
import { Room, type Client, type Deferred } from '@colyseus/core';
import { LobbyPlayerSchema, RoomStateSchema } from './schema';
import { syncConfig, syncMatch, toPublicWire } from './sync';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 5;
const CODES_CHANNEL = '$eyespy:joinCodes';
const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
const MAX_NAME_LENGTH = 16;
/**
 * Never simulate more than this many ticks in one update. After a longer stall (event loop
 * blocked, machine asleep) the extra wall time is dropped rather than replayed.
 */
const MAX_TICKS_PER_UPDATE = 10;
const MAX_MESSAGES_PER_SECOND = 100;

export interface JoinOptions {
  name?: string;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1));
}

/** Strings only (no attacker-supplied toString), control characters stripped, 16 code points. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw.replace(/[\p{C}]/gu, '').trim();
  const name = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  return name.length > 0 ? name : 'Player';
}

function isDir(v: unknown): v is 'up' | 'down' | 'left' | 'right' {
  return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}

export function parseInputEvent(raw: unknown): InputEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as { type?: unknown; dir?: unknown };
  if (m.type === 'actionDown' || m.type === 'actionUp') return { type: m.type };
  if (m.type === 'move' && (m.dir === null || isDir(m.dir))) return { type: 'move', dir: m.dir };
  return null;
}

/** Keep only known numeric config keys from an untrusted partial. */
export function parseConfigPatch(raw: unknown): Partial<MatchConfig> {
  const out: Partial<MatchConfig> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

export class GameRoom extends Room<{ state: RoomStateSchema }> {
  override maxClients = 16;
  override state = new RoomStateSchema();
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  /** Lobby configuration. The running match uses `matchConfig` (teamCount may differ). */
  config: MatchConfig = makeConfig({ seed: randomSeed() });
  matchConfig: MatchConfig | null = null;
  map: GameMap | null = null;
  match: MatchState | null = null;
  heldInputs: Record<string, PlayerInput> = Object.create(null) as Record<string, PlayerInput>;

  private accumulatorMs = 0;
  private readonly events: TickEvent[] = [];
  /** Pending reconnection seats, so a rematch or start can release them early. */
  private readonly reconnections = new Map<string, Deferred<Client>>();

  override async onCreate(): Promise<void> {
    this.roomId = await this.generateJoinCode();
    this.state.joinCode = this.roomId;
    this.state.phase = 'lobby';
    syncConfig(this.config, this.state.config);
    syncMatch(emptyWireMatch(), this.state.match);
    // Only reachable by join code, never by `join('game')` matchmaking.
    await this.setPrivate(true);

    this.onMessage('setName', (client, msg: unknown) => {
      const entry = this.requireLobbyPhase(client);
      if (!entry) return;
      entry.name = sanitizeName((msg as { name?: unknown } | null)?.name);
    });

    this.onMessage('setTeam', (client, msg: unknown) => {
      const entry = this.requireLobbyPhase(client);
      if (!entry) return;
      const teamId = (msg as { teamId?: unknown } | null)?.teamId;
      if (typeof teamId !== 'number' || !Number.isInteger(teamId)) return;
      if (teamId < 0 || teamId >= this.config.teamCount) {
        return this.sendError(client, 'No such team');
      }
      if (teamId === entry.teamId) return;
      if (this.teamSize(teamId) >= this.config.teamSize) {
        return this.sendError(client, 'That team is full');
      }
      entry.teamId = teamId;
      entry.ready = false;
    });

    this.onMessage('ready', (client, msg: unknown) => {
      const entry = this.requireLobbyPhase(client);
      if (!entry) return;
      entry.ready = Boolean((msg as { ready?: unknown } | null)?.ready);
    });

    this.onMessage('setConfig', (client, msg: unknown) => {
      if (!this.requireLobbyPhase(client) || !this.requireHost(client)) return;
      const patch = parseConfigPatch(msg);
      const merged: Partial<MatchConfig> = { ...this.config, ...patch };
      // Changing the room grid without naming a gem count re-derives the default.
      if (
        (patch.mapRows !== undefined || patch.mapCols !== undefined) &&
        patch.gemCount === undefined
      ) {
        delete merged.gemCount;
      }
      const next = makeConfig(merged);
      const errors = validateMatchSetup(next);
      if (errors.length > 0) return this.sendError(client, errors[0]?.message ?? 'Invalid config');
      if (this.state.lobby.size > next.teamCount * next.teamSize) {
        return this.sendError(client, 'Too many players in the lobby for that setting');
      }
      this.config = next;
      syncConfig(this.config, this.state.config);
      for (const entry of this.state.lobby.values()) entry.ready = false;
      this.rebalanceTeams();
    });

    this.onMessage('start', (client) => {
      if (!this.requireLobbyPhase(client) || !this.requireHost(client)) return;
      const error = this.startMatch();
      if (error) this.sendError(client, error);
    });

    this.onMessage('input', (client, msg: unknown) => {
      const event = parseInputEvent(msg);
      if (!event || !this.match || isEnded(this.match)) return;
      const held = this.heldInputs[client.sessionId] ?? IDLE_INPUT;
      this.heldInputs[client.sessionId] = applyInputEvent(held, event);
    });

    this.onMessage('rematch', (client) => {
      if (this.state.phase === 'lobby')
        return this.sendError(client, 'No finished match to rematch');
      if (this.state.phase !== 'ended') return this.sendError(client, 'The match is still running');
      if (!this.requireHost(client)) return;
      this.returnToLobby();
    });

    this.setTimestep((deltaMs) => this.update(deltaMs));
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    if (this.state.phase !== 'lobby') {
      throw new Error('That match has already started');
    }
    if (this.state.lobby.size >= this.config.teamCount * this.config.teamSize) {
      throw new Error('That lobby is full');
    }
    const entry = new LobbyPlayerSchema();
    entry.sessionId = client.sessionId;
    entry.name = sanitizeName(options?.name);
    entry.teamId = this.leastPopulatedTeam();
    entry.ready = false;
    entry.connected = true;
    this.state.lobby.set(client.sessionId, entry);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
  }

  override async onDrop(client: Client): Promise<void> {
    const entry = this.state.lobby.get(client.sessionId);
    if (!entry) return;
    if (!this.match) {
      // Nothing to hold a seat for in the lobby: treat a drop like a leave.
      this.removeParticipant(client.sessionId);
      return;
    }
    entry.connected = false;
    if (!isEnded(this.match)) {
      setPlayerConnected(this.match, client.sessionId, false);
      this.heldInputs[client.sessionId] = IDLE_INPUT;
    }
    if (this.state.hostSessionId === client.sessionId) this.transferHost();
    const grace = (this.matchConfig ?? this.config).reconnectGraceSec;
    const seat = this.allowReconnection(client, grace);
    this.reconnections.set(client.sessionId, seat);
    try {
      await seat;
    } catch {
      this.removeParticipant(client.sessionId);
    } finally {
      if (this.reconnections.get(client.sessionId) === seat) {
        this.reconnections.delete(client.sessionId);
      }
    }
  }

  override onReconnect(client: Client): void {
    const entry = this.state.lobby.get(client.sessionId);
    if (!entry) return;
    entry.connected = true;
    if (this.match && !isEnded(this.match)) setPlayerConnected(this.match, client.sessionId, true);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    if (this.map) client.send('map', this.map);
    this.sendSearched(client.sessionId);
  }

  override onLeave(client: Client): void {
    this.removeParticipant(client.sessionId);
  }

  override async onDispose(): Promise<void> {
    await this.presence.srem(CODES_CHANNEL, this.roomId);
  }

  // ---- lobby helpers ----

  private requireLobbyPhase(client: Client): LobbyPlayerSchema | null {
    if (this.state.phase !== 'lobby') {
      this.sendError(client, 'Not in the lobby');
      return null;
    }
    return this.state.lobby.get(client.sessionId) ?? null;
  }

  private requireHost(client: Client): boolean {
    if (client.sessionId !== this.state.hostSessionId) {
      this.sendError(client, 'Only the host can do that');
      return false;
    }
    return true;
  }

  private sendError(client: Client, message: string): void {
    client.send('error', { message });
  }

  private teamSize(teamId: number): number {
    let n = 0;
    for (const entry of this.state.lobby.values()) if (entry.teamId === teamId) n++;
    return n;
  }

  private leastPopulatedTeam(): number {
    let best = 0;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let t = 0; t < this.config.teamCount; t++) {
      const size = this.teamSize(t);
      if (size < bestSize) {
        best = t;
        bestSize = size;
      }
    }
    return best;
  }

  /** After a config change: move players off removed or over-full teams. */
  private rebalanceTeams(): void {
    for (const entry of this.state.lobby.values()) {
      if (entry.teamId >= this.config.teamCount) entry.teamId = -1;
    }
    for (const entry of this.state.lobby.values()) {
      if (entry.teamId >= 0 && this.teamSize(entry.teamId) > this.config.teamSize)
        entry.teamId = -1;
    }
    for (const entry of this.state.lobby.values()) {
      if (entry.teamId < 0) entry.teamId = this.leastPopulatedTeam();
    }
  }

  /** Hand the host role to a connected player, else to anyone, else nobody. */
  private transferHost(): void {
    const entries = [...this.state.lobby.values()].filter(
      (e) => e.sessionId !== this.state.hostSessionId,
    );
    const next = entries.find((e) => e.connected) ?? entries[0];
    this.state.hostSessionId = next?.sessionId ?? '';
  }

  /** Release every pending reconnection seat and drop those players. */
  private dropDisconnected(): void {
    for (const entry of [...this.state.lobby.values()]) {
      if (entry.connected) continue;
      this.reconnections.get(entry.sessionId)?.reject(new Error('seat released'));
      this.reconnections.delete(entry.sessionId);
      this.removeParticipant(entry.sessionId);
    }
  }

  /** Returns an error message, or null when the match started. */
  startMatch(): string | null {
    this.dropDisconnected();
    const entries = [...this.state.lobby.values()];
    if (entries.some((e) => !e.ready)) return 'Everyone must be ready';
    const byTeam = new Map<number, LobbyPlayerSchema[]>();
    for (const e of entries) {
      const list = byTeam.get(e.teamId) ?? [];
      list.push(e);
      byTeam.set(e.teamId, list);
    }
    const teamIds = [...byTeam.keys()].sort((a, b) => a - b);
    if (teamIds.length < 2) return 'Need at least two teams with a player each';
    const teams: TeamSetup[] = teamIds.map((id) => ({
      id,
      name: TEAM_NAMES[id] ?? `Team ${id + 1}`,
      players: (byTeam.get(id) ?? []).map((e) => ({ id: e.sessionId, name: e.name })),
    }));
    const matchConfig = makeConfig({ ...this.config, teamCount: teams.length });
    const errors = [...validateMatchSetup(matchConfig), ...validateTeams(matchConfig, teams)];
    if (errors.length > 0) return errors[0]?.message ?? 'Invalid match setup';

    const map = generateMap(matchConfig);
    const { state } = createMatch(matchConfig, map, teams);
    this.matchConfig = matchConfig;
    this.map = map;
    this.match = state;
    this.heldInputs = Object.create(null) as Record<string, PlayerInput>;
    this.accumulatorMs = 0;
    this.state.phase = state.phase;
    syncMatch(toPublicWire(matchToWire(state)), this.state.match);
    void this.lock();
    this.broadcast('map', map, { afterNextPatch: true });
    for (const entry of entries) this.sendSearched(entry.sessionId);
    return null;
  }

  private returnToLobby(): void {
    this.dropDisconnected();
    this.match = null;
    this.map = null;
    this.matchConfig = null;
    this.heldInputs = Object.create(null) as Record<string, PlayerInput>;
    this.config = makeConfig({ ...this.config, seed: randomSeed() });
    syncConfig(this.config, this.state.config);
    for (const entry of this.state.lobby.values()) entry.ready = false;
    syncMatch(emptyWireMatch(), this.state.match);
    this.state.phase = 'lobby';
    void this.unlock();
  }

  /** Idempotent: drop a session from the lobby and, if a match is running, from the match. */
  removeParticipant(sessionId: string): void {
    const entry = this.state.lobby.get(sessionId);
    if (entry) this.state.lobby.delete(sessionId);
    delete this.heldInputs[sessionId];
    if (this.match && this.map && !isEnded(this.match)) {
      const before = this.match.players.length;
      this.events.length = 0;
      removePlayer(this.match, this.map, sessionId, this.events);
      if (this.match.players.length !== before) this.checkForfeit();
      this.flushEvents();
      syncMatch(toPublicWire(matchToWire(this.match)), this.state.match);
    }
    if (this.state.hostSessionId === sessionId) this.transferHost();
  }

  /**
   * Spec §10: when every team but one has no players left, the remaining team wins. A player
   * is gone once their reconnect grace expires, so the grace period is the forfeit timer.
   */
  private checkForfeit(): void {
    if (!this.match || isEnded(this.match)) return;
    const teamsWithPlayers = this.match.teams.filter((t) => t.playerIds.length > 0);
    if (teamsWithPlayers.length === 1 && this.match.teams.length > 1) {
      forfeitMatch(this.match, (teamsWithPlayers[0] as { id: number }).id, this.events);
    } else if (teamsWithPlayers.length === 0) {
      forfeitMatch(this.match, null, this.events);
    }
  }

  // ---- simulation ----

  update(deltaMs: number): void {
    if (!this.match || !this.map || !this.matchConfig || isEnded(this.match)) return;
    const dt = tickMs(this.matchConfig);
    this.accumulatorMs = Math.min(this.accumulatorMs + deltaMs, dt * MAX_TICKS_PER_UPDATE);
    let ticked = false;
    this.events.length = 0;
    while (this.accumulatorMs >= dt) {
      this.accumulatorMs -= dt;
      step(this.match, this.map, this.matchConfig, this.heldInputs, this.events);
      ticked = true;
      if (isEnded(this.match)) break;
    }
    if (!ticked) return;
    syncMatch(toPublicWire(matchToWire(this.match)), this.state.match);
    this.flushEvents();
    // Patch right after the tick so clients see one tick per patch instead of 0 or 2.
    this.broadcastPatch();
  }

  /**
   * Route this tick's events: what reveals hidden information (which piece was searched,
   * what it held) goes only to the searching team; the rest goes to everyone.
   */
  private flushEvents(): void {
    if (!this.match) return;
    const everyone: TickEvent[] = [];
    const perTeam = new Map<number, TickEvent[]>();
    const teamOf = (playerId: string): number | undefined =>
      this.match?.players.find((p) => p.id === playerId)?.teamId ??
      this.match?.teams.find((t) => t.playerIds.includes(playerId))?.id;
    const touchedTeams = new Set<number>();
    for (const e of this.events) {
      if (e.type === 'phase') this.state.phase = e.phase;
      if (e.type === 'searchComplete' || (e.type === 'gemPickedUp' && e.from === 'furniture')) {
        const team = teamOf(e.playerId);
        if (team === undefined) continue;
        const list = perTeam.get(team) ?? [];
        list.push(e);
        perTeam.set(team, list);
        if (e.type === 'searchComplete') touchedTeams.add(team);
      } else {
        everyone.push(e);
      }
    }
    if (everyone.length > 0) this.broadcast('events', everyone, { afterNextPatch: true });
    for (const [teamId, list] of perTeam) {
      for (const client of this.clients) {
        const entry = this.state.lobby.get(client.sessionId);
        if (entry && entry.teamId === teamId) client.send('events', list, { afterNextPatch: true });
      }
    }
    for (const teamId of touchedTeams) {
      for (const client of this.clients) {
        const entry = this.state.lobby.get(client.sessionId);
        if (entry && entry.teamId === teamId) this.sendSearched(client.sessionId);
      }
    }
    this.events.length = 0;
  }

  /** The searched-furniture list is private per team, so it travels as a message. */
  private sendSearched(sessionId: string): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    const entry = this.state.lobby.get(sessionId);
    if (!client || !entry || !this.match) return;
    const furnitureIds = this.match.searchedByTeam[entry.teamId] ?? [];
    client.send('searched', { furnitureIds: [...furnitureIds] }, { afterNextPatch: true });
  }

  // ---- join codes ----

  private async generateJoinCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_LETTERS.charAt(Math.floor(Math.random() * CODE_LETTERS.length));
      }
      // LocalPresence's sadd returns nothing, so check membership first. With Redis the
      // window between the two calls is microseconds; a collision would need two rooms
      // created in that window with the same 5-letter code (1 in 24^5).
      if ((await this.presence.sismember(CODES_CHANNEL, code)) === 1) continue;
      await this.presence.sadd(CODES_CHANNEL, code);
      return code;
    }
    throw new Error('could not allocate a join code');
  }
}

function isEnded(match: MatchState): boolean {
  return match.phase === 'ended';
}
