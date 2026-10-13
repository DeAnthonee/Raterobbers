# Deployment contract

How to run Rate Robbers on a host that auto-deploys from GitHub. Written for the Mac mini +
Cloudflare Tunnel setup; nothing here is Mac-specific.

| Item        | Value                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo        | `github.com/DeAnthonee/Raterobbers` (PUBLIC: no deploy key needed to pull; never commit secrets)                                                                                                                                                                                                                                                |
| Branch      | `master`. Every change lands through a PR whose CI (`check` + `e2e` jobs) must be green before merge; master itself is the deploy source.                                                                                                                                                                                                       |
| App folder  | Repository root (pnpm monorepo). `packages/server` is what runs, but it bundles `packages/shared` and serves `packages/client/dist`, so the whole repo must be checked out and built.                                                                                                                                                           |
| Runtime     | Node 22 (tested on 22.22 locally and 22.23 in CI). Build step: yes. Nothing is written to disk; all game state is in memory. No database. `DATA_DIR` is not read.                                                                                                                                                                               |
| Install     | `corepack enable && pnpm install --frozen-lockfile` (pnpm 10.28 is pinned by `packageManager`; dev dependencies are needed to build, so do not use `--prod`)                                                                                                                                                                                    |
| Build       | `pnpm build` (client bundle via Vite, server bundle via esbuild)                                                                                                                                                                                                                                                                                |
| Start       | `PORT=3400 pnpm start` (`node packages/server/dist/index.js`). Reads `process.env.PORT`, binds `0.0.0.0` (override with `HOST`). Working directory does not matter.                                                                                                                                                                             |
| Health      | `GET /healthz` → `200` JSON: `{ ok, version, build, playing, rooms, players, uptimeSec }`. `version` is `packages/server/package.json`'s version; `build` is the ISO time of the build, unique per deploy. `Cache-Control: no-store`.                                                                                                           |
| Tunnel      | WebSockets required (Colyseus over the `ws` library, `@colyseus/ws-transport`). The app expects the root of its hostname; no path prefix. The client connects to the origin it was served from, so `wss://raterobbers.deanthoneeking.com` works with no client config.                                                                          |
| Caching     | `/` and `/index.html`: `Cache-Control: no-cache`. Everything under `/assets/` is content-hashed by Vite (new names every build) and served `public, max-age=31536000, immutable`. Equivalent to `?v=` busting, with no stale-code risk.                                                                                                         |
| Restarts    | All state is in memory; a restart ends every live match (players see "Disconnected" and return to Home). On `SIGTERM` Colyseus shuts down gracefully (disconnects clients, disposes rooms) well within 20 s. Prefer restarting when `/healthz` reports `playing: 0`; if a match is in progress, waiting a few minutes is kind but not required. |
| Tests       | `pnpm check` (lint, format check, typecheck, unit tests for all packages). The server suite boots a Colyseus server on a random port in 20000–39999 on `127.0.0.1`. `pnpm e2e` (Playwright, needs Chromium) also exists; CI runs it, but it builds and binds a server on fixed port 2567 so it is not part of the deploy gate.                  |
| Ops channel | GitHub Issues are enabled. Issues titled `[OPS] …` are reports from the hosting machine's monitors. Standing rule for every work session: check open `[OPS]` issues first, fix or respond, and close them in the same PR when possible.                                                                                                         |

## Checklist for a fresh host

```bash
git clone https://github.com/DeAnthonee/Raterobbers.git && cd Raterobbers
corepack enable
pnpm install --frozen-lockfile
pnpm check            # gate
pnpm build
PORT=3400 pnpm start
curl -s http://127.0.0.1:3400/healthz
```

## Unusual things to know

- The game is one Node process serving both the WebSocket API and the static client.
  There is no separate web server to configure.
- Matches are joined by a 5-letter code shown in the lobby; there is no public match list.
- `pnpm e2e` rebuilds `packages/client/dist` with `VITE_E2E=1`, which enables a read-only
  `window.__raterobbers` state hook. Harmless if that build is then served, but a deploy
  always runs its own `pnpm build`.
- Phase 3 (accounts, progression) will add persistence. When it does, this document and
  the `DATA_DIR` line change; until then nothing touches the filesystem at runtime.
