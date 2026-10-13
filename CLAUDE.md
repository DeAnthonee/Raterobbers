# Rate Robbers (repo: DeAnthonee/Raterobbers) — context for AI sessions

Read this first. It is the hand-off between sessions working on this repository.
The code started life in `DeAnthonee/Eye_Spy` (PRs #1–#5 there) and moved here with its full history on 2026-10-13; the public hostname is raterobbers.deanthoneeking.com.

## What we are building

A grid-based, team-vs-team, **online** heist game for the web browser. Teams of burglars
move tile by tile through a grid of hand-built rooms, search furniture for hidden gems,
and the team holding the most gems when the timer ends wins. Clan abilities and traps
come after the core game is playable.

- **The spec is the source of truth:** `docs/GAME_SPEC.md`. Read it before changing rules.
- **The journey so far:** `docs/JOURNAL.md`. Decisions, lessons, and why things are the way they are.
- **Task list / roadmap:** `docs/TASKS.md`. Keep it updated as work lands.
- **How it is hosted:** `docs/DEPLOY.md`. The health endpoint, ports, and test gate are a contract.

## Architecture (decided, do not relitigate without the owner)

pnpm monorepo, TypeScript everywhere:

| Package           | Role                                                              | Rules                                                 |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/shared` | Pure, deterministic game rules                                    | No DOM, no Node APIs, no I/O. Everything unit-tested. |
| `packages/server` | Authoritative Colyseus server, 20 Hz loop calling shared `step()` | Clients only ever send inputs.                        |
| `packages/client` | Vite + Phaser 3 renderer, keyboard + gamepad                      | Thin. Renders server state.                           |

Future console port rebuilds only the client; rules and server protocol carry over.

## Working agreements with the owner (DeAnthonee)

- **Before starting any work, check open GitHub Issues titled `[OPS]`.** They are reports
  from the hosting machine's monitors. Fix or respond, and close them in the same PR when
  possible. The deployment contract is `docs/DEPLOY.md`; keep it true when changing the
  server's start-up, health endpoint, ports, or anything written to disk.

- Owner has pre-approved merging all PRs from the AI session. Open a PR, run checks, merge it.
- Every feature ships with unit tests. No PR with red CI.
- Before merging a code milestone, run a reviewer subagent over the diff, judge its findings,
  apply the ones worth it, and note the rest in the journal.
- Append to `docs/JOURNAL.md` after each milestone: what landed, decisions, surprises.
- Build the MVP (M0–M4 in the spec) before any clan/ability work.

## Commands

```bash
pnpm install          # once
pnpm check            # lint + format:check + typecheck + test (what CI runs)
pnpm test             # all packages
pnpm --filter @raterobbers/shared test:watch
pnpm dev              # server (tsx watch) + client (vite) in parallel
pnpm build            # server bundle (esbuild) + client bundle (vite)
pnpm format           # fix formatting
```

CI (`.github/workflows/ci.yml`) runs `pnpm check` and `pnpm build` on every PR and on master.

## Conventions

- Strict TypeScript (`tsconfig.base.json`), ESLint flat config, Prettier.
- Tests live next to code as `*.test.ts` (Vitest).
- Shared rules are pure functions over plain data: `step(state, inputs, config) -> state`.
  Randomness only through the seeded PRNG in shared. Never `Math.random()` in rules.
- Milestone branches are merged into `master` via PR. Default branch is `master`.
