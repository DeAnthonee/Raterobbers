# Eye Spy — Task List

Mirror of the working task list. Update when a task changes state. Milestones are defined
in `docs/GAME_SPEC.md` §11.

## MVP (playable online match)

- [x] **Spec** — `docs/GAME_SPEC.md` (PR #1)
- [x] **M0** — Reset repo, pnpm monorepo (shared/server/client), lint/format/typecheck/test, CI, context docs
- [x] **M1a** — Shared: config + defaults + validation, core types, seeded PRNG, room template
      format + validator, 6 starter templates with 8 symmetries, `generateMap(config)`, tests
- [x] **M1b** — Shared: `createMatch` (spawns, gem placement), `step()` (movement, search channel,
      gem pickup, per-team searched sets, timer, early end, overtime/draw), `teamScores`/`winner`,
      replay determinism test, tests for every rule and edge case in the spec
- [ ] **M2** — Server: Colyseus room with join codes, lobby (teams, ready, host config, start
      validation), countdown, 20 Hz loop, state broadcast, reconnection grace + gem scatter,
      results + rematch, in-process integration tests
- [ ] **M3** — Client: Vite + Phaser scenes (Home, Lobby, Match, Results), tile renderer with
      placeholder art, camera follow, HUD, minimap, per-team searched overlay, keyboard + gamepad,
      interpolation, unit tests for non-canvas logic
- [ ] **M4** — Playable build: one-command local run, Dockerfile for server, static client build,
      deploy notes, Playwright smoke test (two clients join and move), template library toward 20

## Ongoing

- [ ] Reviewer agent pass before each milestone merge; worthwhile findings applied, rest noted in journal
- [ ] Journal entry after each milestone

## Phase 2 — Clans and abilities (after MVP)

- [ ] Clan selection + ability loadout with cooldowns
- [ ] Floor traps and furniture traps
- [ ] Status effects: stun, burn, freeze, slow
- [ ] Gem drop/scatter, floor pickup, stealing
- [ ] First clans: Fire, Ice, Earth, Lightning

## Phase 3 — Progression

- [ ] Accounts + persistence
- [ ] Clan levels, skill trees, gated clans (e.g. Lava = Fire L5 + Earth L5)
- [ ] Match history and stats
