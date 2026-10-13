import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineRoom, defineServer } from '@colyseus/core';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };
import { GameRoom } from './GameRoom';
import { liveStats } from './registry';

/** Room name clients join: `client.create('game')` / `client.joinById(code)`. */
export const GAME_ROOM = 'game';

/** Injected by build.mjs; absent when running from source with tsx. */
declare const __BUILD_TIME__: string | undefined;
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';
export const VERSION = pkg.version;
const startedAt = Date.now();

/**
 * Where the built client lives, resolved relative to this file so the working directory
 * does not matter: `src/app.ts` and `dist/index.js` are both two levels below `packages/`.
 * Override with CLIENT_DIST; missing = API only.
 */
export function clientDistDir(): string | null {
  const dir = process.env.CLIENT_DIST ?? path.resolve(import.meta.dirname, '../../client/dist');
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export interface Health {
  ok: true;
  version: string;
  build: string;
  playing: number;
  rooms: number;
  players: number;
  uptimeSec: number;
}

export function health(): Health {
  return {
    ok: true,
    version: VERSION,
    build: BUILD_TIME,
    ...liveStats(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  };
}

export const server = defineServer({
  rooms: {
    [GAME_ROOM]: defineRoom(GameRoom),
  },
  express: (app) => {
    app.get('/healthz', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(health());
    });
    const dist = clientDistDir();
    if (!dist) return;
    // index.html must never be cached so every deploy is picked up on the next load.
    const sendIndex = (_req: express.Request, res: express.Response): void => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    };
    app.get('/', sendIndex);
    app.get('/index.html', sendIndex);
    // Everything else Vite emits is content-hashed (e.g. /assets/index-BrWoocvA.js), so it
    // can be cached forever: a new build has new file names.
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, filePath) => {
          res.setHeader(
            'Cache-Control',
            filePath.includes(`${path.sep}assets${path.sep}`)
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          );
        },
      }),
    );
  },
});
