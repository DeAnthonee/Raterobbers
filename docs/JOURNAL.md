# Eye Spy — Project Journal

A running log for humans and AI sessions. Newest entries at the bottom. Each entry says what
landed, what was decided and why, and anything a future session should know.

---

## 2026-10-12 — Design conversation and spec (PR #1)

**What happened.** The owner repurposed this repository (previously a small Android
dice-roll mini-game in Kotlin) into a new online multiplayer game. We talked through the
design over several messages and wrote it up as `docs/GAME_SPEC.md`.

**Key decisions and why.**

- **Web + TypeScript, online-only.** Owner's requirement. Keyboard and gamepad input.
- **Three-package split (shared rules / Colyseus server / Phaser client).** Chosen so the
  rules are deterministic and testable without a browser, so the server is authoritative
  (no cheating), and so a future console client can be rebuilt without touching the rules.
- **Hand-built room templates instead of random furniture.** Owner wanted rooms to feel
  designed and real, with furniture in the middle and carpets, not just along walls.
  Templates get 8 symmetries (rotations/mirrors) so ~20 templates give plenty of variety.
- **Gem count is always odd**, default derived from room count (9 rooms → 9, 4 → 5).
- **Abilities, traps, and clan progression are Phase 2/3.** Owner agreed the game should be
  playable end to end first. The data model reserves `effects`, `traps`, and a three-state
  `Gem.location` so Phase 2 does not need a rewrite.
- Smaller calls made by the AI and flagged to the owner (easy to change): 12×12 default
  room size, players pass through each other, 1.5 s search hold, searched furniture is
  visible per team only, MVP ends early when all gems are found, 30 s reconnect grace.

**Working agreement.** Owner pre-approved merging all PRs from the AI session, asked for
unit tests on everything, a reviewer agent pass before merging, and this journal.

## 2026-10-12 — M0: repo reset and monorepo scaffold

**What landed.** Removed the Android/Gradle project (still in git history before
commit `49a59bc`). Created the pnpm workspace with `@eyespy/shared`, `@eyespy/server`,
`@eyespy/client`; strict TypeScript; ESLint 10 flat config; Prettier; Vitest 5; a GitHub
Actions workflow running lint, format check, typecheck, tests, and build; `CLAUDE.md`,
this journal, and `docs/TASKS.md`.

**Decisions.**

- `@eyespy/shared` is consumed from source (`exports: ./src/index.ts`). Vite, Vitest, and
  `tsx` all handle TypeScript source directly, so no build step is needed in dev. The
  server's production build bundles shared in with esbuild. This keeps the dev loop simple.
- Pinned TypeScript 5.9 rather than the new TypeScript 7 (native) release to avoid
  tooling edge cases while the ecosystem catches up. Revisit later.
- Colyseus and Phaser are added in M2 and M3 respectively, not in the scaffold, so each
  milestone PR owns its own dependencies.
