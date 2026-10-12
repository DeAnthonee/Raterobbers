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

## 2026-10-12 — M1a: shared types, config, RNG, templates, map generation

**What landed** (`packages/shared/src`):

- `types.ts`: plain-data types. `TileKind` is a numeric enum so maps serialize compactly.
  `GameMap` uses flat row-major arrays (`tiles`, `carpet`, `furnitureAt`) for cheap sync.
- `config.ts`: `MatchConfig`, `DEFAULT_CONFIG`, `makeConfig()` (derives the odd gem count
  from the room count unless given), `validateConfig()` with `LIMITS`.
- `rng.ts`: mulberry32 PRNG + `deriveSeed(seed, salt)` so map, gems, and spawns each get an
  independent stream from one match seed.
- `templates/`: ASCII template format (`.` floor, `~` carpet, `A-Z` searchable furniture,
  `a-z` solid decoration, contiguous same letters = one piece), validator (door clearance on
  all four sides, full connectivity, every searchable piece touches floor), 8 symmetries,
  and a starter library of 6 templates at 12×12.
- `map.ts`: `generateMap(config)` deals templates without repeats (reshuffling when the
  deck runs out), applies a random symmetry per room, stamps interiors into the global grid,
  cuts centered doors of `doorWidth` between every adjacent pair, and exposes query helpers
  (`tileAt`, `isWalkable`, `roomIdAt`, `roomFloorTiles`, `furnitureApproachTiles`,
  `isFullyConnected`).

**Decisions.**

- Templates must keep door clearance on **all four** sides even though border rooms have
  fewer doors. This makes every symmetry of a valid template valid, so the validator only
  needs to check the canonical orientation and symmetries are free.
- Global layout: room (r, c) interior starts at `(c*(S+1)+1, r*(S+1)+1)`; walls are shared
  single-tile lines. Map is `cols*(S+1)+1` wide.
- Door tiles belong to no room (`roomIdAt` returns undefined there). The simulation will
  track each player's last room so a player standing in a doorway still "belongs" somewhere
  for gem scatter.

**Lessons.** Two test bugs on the first run: a config rule that can't trigger inside the
configured limits, and a "asymmetric" test template that was symmetric about the diagonal.
Both were test mistakes, not code bugs. 62 tests pass.

**Review pass (M1a).** A reviewer agent went over the code with probe scripts. Worth keeping:

- **Real bug:** door clearance was only symmetric when `roomSize - doorWidth` was even. With an
  odd difference the door offset rounds down, mirroring shifts it by one, and a rotated
  template could put furniture in front of a door (reproduced: disconnected maps for door
  width 1). Fixed by making `requiredClearTiles` cover both the rounded-down and rounded-up
  span, validating the _stamped_ template in `generateMap`, and asserting full connectivity
  on the finished map.
- Added `validateMatchSetup(config, templates)` so the lobby can reject a Start with a clear
  message instead of the server throwing. `generateMap` now also rejects invalid configs.
- Library templates now keep columns/rows 4-7 clear on every wall so they work for door
  widths 1 through 4; tests cover all widths under all 8 symmetries.
- `teamCount` must now be strictly less than the room count (gems need a non-spawn room).
- Seeds are bounded to 32 bits (`MAX_SEED`) because the PRNG aliases above that.
- Tests added: exact door positions, stamp round-trip against `applySymmetry`, golden PRNG
  values and a map fingerprint (so replays can't silently change), connectivity sweeps.
- Skipped on purpose: nothing substantive. All 14 findings were applied or were already
  handled in M1b (storing `rngState: number` instead of an Rng object).

## 2026-10-12 — M1b: match creation and tick simulation

**What landed** (`packages/shared/src`):

- `state.ts`: `MatchState` and friends as plain JSON-safe data. `searchedByTeam` is arrays,
  not Sets. `rngState` is a number so in-match randomness (gem scatter) is replayable.
  `PlayerInput` is held state (`dir`, `action`); `applyInputEvent` reduces the spec's raw
  events into it. `teamScores`, `leader`, `canScoresChange`.
- `match.ts`: `chooseSpawnRooms` (greedy max-min distance, corners first: 2 teams on 3×3 get
  rooms 0 and 8, 4 teams get the four corners), `spawnTilesForRoom` (closest to centre),
  `placeGems` (searchable furniture outside spawn rooms, one gem per piece, per-room cap
  `ceil(gems / eligibleRooms)`), `createMatch`.
- `sim.ts`: `step(state, map, config, inputs)` mutates and returns state. Movement with
  `moveIntervalMs` cooldown, facing updates even when blocked, players pass through each
  other, floor-gem pickup on step, `lastRoomId` tracking. Search: hold Action while facing
  searchable furniture; progress accrues per tick; release or a successful move cancels;
  pressing into the furniture while blocked does not. Completion marks the piece searched
  for the player's team and transfers a hidden gem. Timer, early end when no gem can change
  hands, overtime until a unique leader, cap → draw. `setPlayerConnected`, `dropAllGems`,
  `removePlayer`.
- `testing.ts`: shared test helpers (`TEST_TEMPLATE`, `placeFacing`, `runTicks`, `held`).

**Decisions.**

- Contested searches resolve in player array order (join order). Simple and deterministic;
  revisit if it feels unfair.
- "Overtime ends when any team's gem count changes" from the spec is implemented as
  "overtime ends when there is a unique leader", which is the same thing for two teams and
  the sensible reading for three or more.
- A tie where no gem can change hands (all gems carried, no stealing yet) is an immediate
  draw rather than a pointless 60 s overtime. `canScoresChange` is the single place Phase 2
  must update once gems can be knocked loose.
- `step` mutates in place for server performance. Tests use JSON round-trips to prove the
  state is plain data and that a serialized copy continues identically.

**Review pass (M1b).** Reviewer agent findings and what was done:

- **Timing now counts ticks, not milliseconds.** `1000 / 30` is not representable, so at
  30 Hz a 1.5 s search took 46 ticks instead of 45 and the timer ended one tick late.
  `MatchState` now stores `countdownTicksRemaining`, `timeTicksRemaining`,
  `overtimeTicksRemaining`, `moveCooldownTicks`, `search.progressTicks`. Config stays in
  ms; `msToTicks` (rounds up) and `ticksToMs` convert at the edges. No floats in state.
- **`step()` returns `TickEvent[]`** (`phase`, `searchComplete`, `gemPickedUp`,
  `gemsDropped`, `ended`) so the server and client can react without diffing snapshots.
  Pass an array in to reuse it.
- **Edge-triggered search.** After a search completes the piece is latched until Action is
  released, so holding the button no longer re-searches every 1.5 s. Re-searching an
  already-searched piece no longer bumps `furnitureSearched`.
- `forfeitMatch(state, winner)` and `connectedTeamIds(state)` for the server's
  "everyone else left" rule. `validateTeams` (unique ids, 1..teamSize per team) is called
  by `createMatch` and usable by the lobby.
- Spawn corner is now chosen by seed (`SEED_SALT_SPAWN`), so team 0 is not always top-left.
- `dropAllGems` falls back to the player's own tile if the room somehow has no floor.
- The replay test now drives scripted bots that path to gems (`pathTo` in
  `@eyespy/shared/testing`), hold Action, and get their gems dropped and re-collected, and
  pins a fingerprint for one seed. Tests added for 30 Hz timing, turning in place,
  contested searches on different ticks, empty teams, door-tile scatter, overtime won by a
  real search, overtime draws, forfeit, unknown input ids, non-mutating input reduction.
- Documented on `TickInputs`: the server must reset a player's held input on disconnect.
- Kept as is: contested same-tick searches go to join order (rare; documented); floor gems
  are picked up by stepping onto a tile, not by standing on one when a gem lands there
  (Phase 2 stun semantics will want that); floor pickups do not count as `gemsFound`.
- Added `wire.ts`: a flat wire format (`matchToWire` / `matchFromWire`, exact inverses) so
  the Colyseus schema in M2 can mirror the state and the client can rebuild a `MatchState`.
