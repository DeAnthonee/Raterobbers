# Rate Robbers

A fast, top-down, grid-based online heist game for the web. Teams of burglars race through a mansion of hand-built rooms, search furniture for hidden gems, and hold the most when the timer runs out.

- **Game spec:** [docs/GAME_SPEC.md](docs/GAME_SPEC.md)
- **Roadmap / tasks:** [docs/TASKS.md](docs/TASKS.md)
- **Project journal:** [docs/JOURNAL.md](docs/JOURNAL.md)
- **Deployment contract:** [docs/DEPLOY.md](docs/DEPLOY.md)
- **AI session hand-off:** [CLAUDE.md](CLAUDE.md)

## Layout

```
packages/shared   pure, deterministic game rules (no DOM, no Node) — fully unit-tested
packages/server   authoritative Colyseus game server
packages/client   Vite + Phaser browser client
```

## Develop

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev        # game server on :2567 (tsx watch) + client on :5173 (vite)
pnpm check      # lint, format check, typecheck, unit tests (same as CI)
pnpm e2e        # Playwright smoke test: real server + client in headless Chromium
pnpm build
```

Open http://localhost:5173, create a match, and share the 5-letter code. A second browser tab (or a friend on your network) joins with the code.

## Deploy

One Node process serves both the API/WebSocket and the built client, so a single container is the whole game.

```bash
docker build -t rate-robbers .
docker run -p 2567:2567 rate-robbers      # open http://localhost:2567
```

Without Docker: `pnpm install --frozen-lockfile && pnpm build && PORT=3400 pnpm start`. Any host that runs Node 22 or a Docker image works. Set `PORT` if the platform assigns one; `GET /healthz` reports version and live match counts. The client connects to the same origin it was served from; to point a separately hosted client at another server, build it with `VITE_SERVER_URL=wss://your-server`.

> This repository previously held an Android mini-game; it was removed in M0 and remains in git history.
