import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineRoom, defineServer } from '@colyseus/core';
import express from 'express';
import { GameRoom } from './GameRoom';

/** Room name clients join: `client.create('game')` / `client.joinById(code)`. */
export const GAME_ROOM = 'game';

/**
 * Where the built client lives. In production the server serves it on the same origin so
 * one deployment is the whole game. Override with CLIENT_DIST; unset or missing = API only.
 */
export function clientDistDir(): string | null {
  const dir = process.env.CLIENT_DIST ?? path.resolve(process.cwd(), '../client/dist');
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export const server = defineServer({
  rooms: {
    [GAME_ROOM]: defineRoom(GameRoom),
  },
  express: (app) => {
    app.get('/healthz', (_req, res) => {
      res.json({ ok: true });
    });
    const dist = clientDistDir();
    if (dist) app.use(express.static(dist));
  },
});
