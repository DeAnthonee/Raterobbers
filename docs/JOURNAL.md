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

## 2026-10-12 — M2: Colyseus game server

**What landed** (`packages/server/src`):

- `schema.ts`: Colyseus Schema mirroring the shared wire format one-to-one (`RoomState` →
  `phase`, `joinCode`, `hostSessionId`, `config`, `lobby`, `match`). Built with the
  `schema()` / `t.*` builder API (decorators are being phased out in @colyseus/schema 5).
- `sync.ts`: `syncConfig` / `syncMatch` copy plain state into the schema, assigning only
  fields that changed so Colyseus sends small deltas. Tested with the schema `Encoder`:
  zero bytes when nothing changed, a small delta for one move.
- `GameRoom.ts`: join codes (5 letters, no I/O/0/1, registered in Presence so they are
  unique per process cluster), lobby messages (`setName`, `setTeam`, `ready`, `setConfig`
  host-only with `validateMatchSetup`, `start`), 20 Hz accumulator loop on
  `setTimestep` capped at 10 ticks per update, `input` events reduced into held inputs,
  `map` sent on start and on reconnect, `events` broadcast per tick, `onDrop` →
  `allowReconnection(grace)` with the held input reset, removal + gem scatter + forfeit
  check when the grace expires or a player leaves, `rematch` back to the lobby with a new
  seed. Teams with no players are dropped from the match config at start time.
- `app.ts` / `index.ts`: `defineServer` with one room type `game`; `PORT` env (default 2567).
- `build.mjs`: esbuild bundles `@eyespy/*` into `dist/index.js` and leaves node_modules
  external. Needed because Node's built-in type stripping loads `shared/src/index.ts` but
  cannot resolve its extension-less relative imports.

**Decisions and lessons.**

- **Do not depend on the `colyseus` meta-package.** It auto-installs the optional
  uWebSockets transport whose `uWebSockets.js` dependency is a git-over-SSH source; GitHub
  Actions cannot clone it and `pnpm install --frozen-lockfile` failed. The server depends
  on `@colyseus/core` + `@colyseus/ws-transport` directly. The lockfile has no git sources.
- The SDK's `waitForInitialState()` test helper hangs for the second client in a fresh
  process; the integration tests poll with `vi.waitFor` instead.
- The server treats every client payload as untrusted: inputs, names, team ids and config
  patches are parsed and validated before use.
- Per-team searched-furniture fog is in the shared state and is filtered on the client
  for the MVP (a cheater with devtools could read the other team's list). Colyseus
  `StateView` filters can make it server-side later.

**Review pass (M2).** 32 findings from the reviewer agent; the ones that changed code:

- **Hidden information leaked to every client.** The schema carried each hidden gem's
  furniture id, every team's searched list, and the RNG state, and `events` broadcast every
  search result. Now `toPublicWire` masks hidden gem locations and the RNG state, the
  searched list travels as a per-team `searched` message, and `searchComplete` /
  furniture pickups go only to the searching team. Opponents still see gem _counts_.
- Rooms are **private** (`setPrivate(true)`): reachable by join code only, never by
  `join('game')` matchmaking.
- Lobby capacity is enforced on join and on config changes; host transfer skips
  disconnected players; a drop on the results screen keeps the seat (grace) instead of
  dropping the player; grace expiry after the match ended no longer mutates the finished
  match; rematch and start release pending reconnection seats so a ghost cannot block Start.
- `sanitizeName` accepts strings only and counts code points (no split surrogate pairs).
- Patches are broadcast right after each tick (`broadcastPatch`) so clients see exactly
  one tick per patch; `map`/`events`/`searched` messages use `afterNextPatch` so a client
  never sees an event before the state it describes. `maxMessagesPerSecond = 100`.
- Append-only arrays (searched lists, carried gems) are appended on the schema instead of
  rewritten. Direct `update()` tests cover the accumulator (no drift over 1000 uneven
  frames, 10-tick cap, stop on end).
- Kept as is: players stay an `ArraySchema` (the client keys its sprites by id, so instance
  shifting on removal does not matter); the reconnect grace doubles as the forfeit timer
  (documented in `checkForfeit`).

## 2026-10-12 — M3: browser client (Vite + Phaser)

**What landed** (`packages/client`):

- `net.ts`: thin wrapper over `@colyseus/sdk` (`create`, `joinById`, `reconnect` with the
  token kept in `sessionStorage`), exposing the wire state via `toJSON()` and the `map`,
  `events`, `searched`, and `error` messages.
- `inputMapper.ts`: per-frame held state (keyboard + gamepad merged) → edge-triggered
  input events; newest held direction wins. Unit-tested.
- `viewModel.ts`: pure HUD/result models, clock formatting, `glide()` interpolation (one
  tile per `moveIntervalMs`, snaps on teleports). Unit-tested.
- `ui.ts`: HTML overlays for Home (name, create, join code), Lobby (teams, ready, host
  settings, start), Results (winner, team and player stats, rematch), and toasts. Menus
  are plain DOM on purpose: forms and lists are easier and more accessible there than in
  a canvas.
- `scenes/MatchScene.ts`: draws the map once into a texture (walls, floor, carpet, doors,
  furniture by kind), players as team-coloured discs with a facing marker, name and gem
  count, floor gems, my team's searched overlay, search progress bar, HUD, a minimap of
  rooms, countdown and sudden-death banners. Camera follows the local player.
- `main.ts`: phase router. Lobby/results are overlays; countdown/playing/overtime run the
  match scene. A dev-only `window.__eyespy` hook exposes the wire state for end-to-end tests.

**Lessons.**

- Phaser auto-starts the first scene in its config. The match scene needs connection data,
  so an idle `BootScene` sits first and the match scene starts on demand.
- Verified end to end in headless Chromium (Playwright): two browsers create and join a
  match by code, ready up, start, and the host walks three tiles on arrow keys. This
  becomes the M4 smoke test.

## 2026-10-12 — M4: playable build

**What landed.**

- The server serves the built client (`packages/client/dist`) on the same origin via
  Express static, plus `/healthz`. One deployment is the whole game; the client connects
  to the origin it was served from (dev: Vite on 5173 → server on 2567).
- `Dockerfile` (multi-stage, pnpm, production deps only) and `.dockerignore`. Not run in
  this environment (no Docker daemon); the equivalent commands were exercised by hand:
  build both packages, run `node dist/index.js`, and fetch `/`, an asset, and `/healthz`.
- `pnpm e2e`: a Playwright test (`e2e/smoke.spec.ts`) that boots the real server and
  client, creates a match in one browser, joins by (lower-cased) code in another, readies
  up, starts, walks with arrow keys, and checks the guest sees the host's new position.
  Plus a bad-code case. CI runs it as a second job after the unit checks.
- Room template library grown from 6 to 14 (library, kitchen, hall, nursery, office,
  vault, conservatory, attic). Every template is checked under all 8 symmetries for door
  widths 1–4 on every test run.

**Decisions.**

- `pnpm e2e` is not part of `pnpm check` so the fast loop stays fast; CI runs both.
- Playwright pinned to 1.56 to match the browsers pre-installed in the cloud session;
  `PW_CHROMIUM_PATH` points it at a pre-installed Chromium instead of downloading one.

**Review pass (M3).** 14 findings from the reviewer agent; what changed:

- **Rematch was broken.** The SDK's `onStateChange` returns a _shared_ emitter, so the
  match scene's unsubscribe wiped the app's own listener; and Phaser reuses the scene
  instance, so cached player/gem views outlived their destroyed display objects. Now the
  wrapper removes only its own callback, the scene clears its caches in `init`, and
  shutdown removes the map texture, clears keyboard captures (they are global and were
  swallowing Space/arrows on the HTML screens afterwards) and nulls message handlers.
- A reconnection re-sends the same map; the client now keys the map by the match seed and
  only restarts the scene for a new seed. The map is dropped when the room returns to the
  lobby so the next start cannot briefly draw the old one.
- Reconnection token: refreshed after an SDK auto-reconnect (the server rotates it) and
  only cleared on a consented leave. Close codes compared against `CloseCode.CONSENTED`.
- Lobby overlay re-renders only when the visible model changed and keeps the focused
  input's value, so other players readying up no longer wipe the host's half-typed number.
  Start is disabled client-side until everyone is ready and two teams have players; room
  size is now editable; gem count steps by 2.
- Glide interpolation moves one axis at a time (no diagonal through furniture corners).
- Colours interpolated into style attributes are validated as hex; `esc()` is exported
  and tested; the network wrapper is testable through a `RoomLike` fake.
- Kept as is: one Phaser bundle (~1.4 MB), HUD "OVERTIME" prefix instead of flashing.
- An end-to-end rematch test now covers the path that was broken.
- The rematch end-to-end test then caught one more: Phaser can run the next start's
  `init()` before the previous run's shutdown, so an unsubscribe handle stored on the
  scene instance was nulled before shutdown used it and the dead scene kept receiving
  state. Subscriptions now live in a closure in `create()` with a liveness flag.
