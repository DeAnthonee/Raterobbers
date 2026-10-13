/**
 * Live rooms in this process, for the health endpoint. Rooms register in onCreate and
 * leave in onDispose; nothing here is persisted.
 */
import type { RoomStateSchema } from './schema';

interface LiveRoom {
  state: RoomStateSchema;
  clients: { length: number };
}

const rooms = new Set<LiveRoom>();

export function registerRoom(room: LiveRoom): void {
  rooms.add(room);
}

export function unregisterRoom(room: LiveRoom): void {
  rooms.delete(room);
}

export interface LiveStats {
  /** Rooms with a match in progress (countdown, playing, or overtime). */
  playing: number;
  /** All rooms, lobbies and results screens included. */
  rooms: number;
  /** Connected clients across all rooms. */
  players: number;
}

export function liveStats(): LiveStats {
  let playing = 0;
  let players = 0;
  for (const r of rooms) {
    const phase = r.state.phase;
    if (phase === 'countdown' || phase === 'playing' || phase === 'overtime') playing += 1;
    players += r.clients.length;
  }
  return { playing, rooms: rooms.size, players };
}
