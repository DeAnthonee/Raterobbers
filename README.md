# Eye Spy

A fast, top-down, grid-based online heist game for the web. Teams of burglars race through a mansion of hand-built rooms, search furniture for hidden gems, and hold the most when the timer runs out.

- **Game spec:** [docs/GAME_SPEC.md](docs/GAME_SPEC.md)
- **Roadmap / tasks:** [docs/TASKS.md](docs/TASKS.md)
- **Project journal:** [docs/JOURNAL.md](docs/JOURNAL.md)
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
pnpm dev        # server + client with hot reload
pnpm check      # lint, format check, typecheck, tests (same as CI)
pnpm build
```

> This repository previously held an Android mini-game; it was removed in M0 and remains in git history.
