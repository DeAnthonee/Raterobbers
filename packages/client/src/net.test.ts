import { describe, expect, it, vi } from 'vitest';
import { serverEndpoint, wrapRoom, type RoomLike } from './net';

/** A minimal fake of the SDK room with the same signal semantics (shared emitter). */
function fakeRoom(): RoomLike & {
  emitState(s: unknown): void;
  messages: Map<string, (p: never) => void>;
} {
  const stateHandlers: ((s: unknown) => void)[] = [];
  const messages = new Map<string, (p: never) => void>();
  const onStateChange = Object.assign(
    (cb: (s: unknown) => void) => {
      stateHandlers.push(cb);
      return { clear: () => stateHandlers.splice(0) };
    },
    {
      remove: (cb: (s: unknown) => void) => {
        const i = stateHandlers.indexOf(cb);
        if (i >= 0) stateHandlers.splice(i, 1);
      },
    },
  );
  return {
    sessionId: 's1',
    reconnectionToken: 'tok',
    state: { toJSON: () => ({ phase: 'lobby' }) },
    onStateChange,
    onMessage: (type, cb) => messages.set(type, cb),
    onLeave: () => undefined,
    onReconnect: () => undefined,
    onError: () => undefined,
    send: vi.fn(),
    leave: async () => undefined,
    emitState: (s) => {
      for (const h of [...stateHandlers]) h({ toJSON: () => s });
    },
    messages,
  };
}

describe('wrapRoom', () => {
  it('unsubscribing one state listener leaves the others attached', () => {
    const room = fakeRoom();
    const conn = wrapRoom(room);
    const a = vi.fn();
    const b = vi.fn();
    const offA = conn.onState(a);
    conn.onState(b);
    room.emitState({ phase: 'playing' });
    offA();
    room.emitState({ phase: 'ended' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenLastCalledWith({ phase: 'ended' });
  });

  it('replays the last map and searched list to late subscribers, and clears with null', () => {
    const room = fakeRoom();
    const conn = wrapRoom(room);
    const map = { width: 1 };
    (room.messages.get('map') as (p: unknown) => void)(map);
    (room.messages.get('searched') as (p: unknown) => void)({ furnitureIds: [3] });
    const onMap = vi.fn();
    const onSearched = vi.fn();
    conn.onMap(onMap);
    conn.onSearched(onSearched);
    expect(onMap).toHaveBeenCalledWith(map);
    expect(onSearched).toHaveBeenCalledWith([3]);
    conn.onMap(null);
    conn.onSearched(null);
    (room.messages.get('map') as (p: unknown) => void)(map);
    expect(onMap).toHaveBeenCalledTimes(1);
  });

  it('forwards inputs and error messages', () => {
    const room = fakeRoom();
    const conn = wrapRoom(room);
    conn.sendInput({ type: 'actionDown' });
    expect(room.send).toHaveBeenCalledWith('input', { type: 'actionDown' });
    const onError = vi.fn();
    conn.onError(onError);
    (room.messages.get('error') as (p: unknown) => void)({ message: 'nope' });
    (room.messages.get('error') as (p: unknown) => void)({});
    expect(onError).toHaveBeenNthCalledWith(1, 'nope');
    expect(onError).toHaveBeenNthCalledWith(2, 'Something went wrong');
  });
});

describe('serverEndpoint', () => {
  it('prefers the configured URL, else same origin, else the dev port', () => {
    const loc = { protocol: 'https:', hostname: 'play.example', port: '' };
    expect(serverEndpoint(loc, { VITE_SERVER_URL: 'wss://x' })).toBe('wss://x');
    expect(serverEndpoint(loc, {})).toBe('wss://play.example');
    expect(serverEndpoint({ ...loc, protocol: 'http:', port: '8080' }, {})).toBe(
      'ws://play.example:8080',
    );
    expect(
      serverEndpoint({ protocol: 'http:', hostname: 'localhost', port: '5173' }, { DEV: true }),
    ).toBe('ws://localhost:2567');
  });
});
