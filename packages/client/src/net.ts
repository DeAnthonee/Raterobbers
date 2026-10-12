/**
 * Thin wrapper over the Colyseus SDK. Everything the rest of the client needs from the
 * network goes through here so scenes never touch the SDK directly.
 */
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import type { GameMap, InputEvent, TickEvent, WireRoomState } from '@eyespy/shared';

export const GAME_ROOM = 'game';
const TOKEN_KEY = 'eyespy.reconnectionToken';

export function serverEndpoint(
  location: Pick<Location, 'protocol' | 'hostname' | 'port'> = window.location,
  env: { VITE_SERVER_URL?: string; DEV?: boolean } = import.meta.env,
): string {
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  const secure = location.protocol === 'https:';
  // In dev the Vite server runs on 5173 and the game server on 2567.
  const port = env.DEV ? ':2567' : location.port ? `:${location.port}` : '';
  return `${secure ? 'wss' : 'ws'}://${location.hostname}${port}`;
}

function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage may be unavailable (private mode); reconnection just won't survive a refresh.
  }
}

export function storedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The subset of the SDK room the wrapper relies on; also what tests fake. */
export interface RoomLike {
  sessionId: string;
  reconnectionToken: string;
  state: { toJSON(): unknown };
  onStateChange: ((cb: (state: unknown) => void) => unknown) & {
    remove(cb: (state: unknown) => void): void;
  };
  onMessage(type: string, cb: (payload: never) => void): unknown;
  onLeave(cb: (code: number) => void): unknown;
  onReconnect(cb: () => void): unknown;
  onError(cb: (code: number, message?: string) => void): unknown;
  send(type: string, payload?: unknown): void;
  leave(consented?: boolean): Promise<unknown>;
}

export interface Connection {
  readonly sessionId: string;
  state(): WireRoomState;
  /** Returns an unsubscribe for this listener only. */
  onState(cb: (state: WireRoomState) => void): () => void;
  onMap(cb: ((map: GameMap) => void) | null): void;
  onEvents(cb: ((events: TickEvent[]) => void) | null): void;
  /** Furniture ids my team has searched. Private per team, so it arrives as a message. */
  onSearched(cb: ((furnitureIds: number[]) => void) | null): void;
  onError(cb: (message: string) => void): void;
  onLeave(cb: (code: number) => void): void;
  send(type: string, payload?: unknown): void;
  sendInput: (event: InputEvent) => void;
  leave(): Promise<void>;
}

export function wrapRoom(room: RoomLike): Connection {
  storeToken(room.reconnectionToken);
  // The server rotates the token on every successful reconnection.
  room.onReconnect(() => storeToken(room.reconnectionToken));
  room.onLeave((code) => {
    // Keep the token unless we left on purpose: a refresh can still resume the seat.
    if (code === CloseCode.CONSENTED) storeToken(null);
  });
  room.onError((code, message) => console.warn('room error', code, message));

  const errorHandlers: ((m: string) => void)[] = [];
  room.onMessage('error', (msg: { message?: string }) => {
    for (const h of errorHandlers) h(msg?.message ?? 'Something went wrong');
  });
  let mapHandler: ((map: GameMap) => void) | null = null;
  let eventsHandler: ((events: TickEvent[]) => void) | null = null;
  let searchedHandler: ((ids: number[]) => void) | null = null;
  let lastMap: GameMap | null = null;
  let lastSearched: number[] = [];
  room.onMessage('map', (map: GameMap) => {
    lastMap = map;
    mapHandler?.(map);
  });
  room.onMessage('events', (events: TickEvent[]) => eventsHandler?.(events));
  room.onMessage('searched', (msg: { furnitureIds?: number[] }) => {
    lastSearched = msg?.furnitureIds ?? [];
    searchedHandler?.(lastSearched);
  });
  const toWire = (s: unknown): WireRoomState =>
    (s as { toJSON(): unknown }).toJSON() as WireRoomState;
  return {
    sessionId: room.sessionId,
    state: () => toWire(room.state),
    onState(cb) {
      const wrapped = (s: unknown): void => cb(toWire(s));
      room.onStateChange(wrapped);
      return () => room.onStateChange.remove(wrapped);
    },
    onMap(cb) {
      mapHandler = cb;
      if (cb && lastMap) cb(lastMap);
    },
    onEvents(cb) {
      eventsHandler = cb;
    },
    onSearched(cb) {
      searchedHandler = cb;
      if (cb) cb(lastSearched);
    },
    onError(cb) {
      errorHandlers.push(cb);
    },
    onLeave(cb) {
      room.onLeave(cb);
    },
    send: (type, payload) => room.send(type, payload),
    sendInput: (event) => room.send('input', event),
    leave: async () => {
      await room.leave(true);
    },
  };
}

export class Net {
  private readonly client: Client;

  constructor(endpoint = serverEndpoint()) {
    this.client = new Client(endpoint);
  }

  async create(name: string): Promise<Connection> {
    return wrapRoom((await this.client.create(GAME_ROOM, { name })) as unknown as RoomLike);
  }

  async join(code: string, name: string): Promise<Connection> {
    const room = await this.client.joinById(code.trim().toUpperCase(), { name });
    return wrapRoom(room as unknown as RoomLike);
  }

  /** Resume the previous session after a refresh, if the server still holds our seat. */
  async tryReconnect(): Promise<Connection | null> {
    const token = storedToken();
    if (!token) return null;
    try {
      return wrapRoom(
        (await this.client.reconnect(token)) as unknown as Room as unknown as RoomLike,
      );
    } catch {
      storeToken(null);
      return null;
    }
  }
}
