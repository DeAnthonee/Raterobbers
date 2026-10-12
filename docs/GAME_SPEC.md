# Eye Spy — Game Spec

**Status:** v1 (MVP scope). Living document; the design conversation that produced it is summarized here so an engineer can build from this file alone.

---

## 1. The Pitch

**One line:** A fast, top-down, grid-based online heist where teams of burglars race through a mansion of rooms, ransack furniture for hidden gems, and hold the most when the clock runs out.

**Why it's fun:** Every room is a fresh, hand-built layout, so you never know where the gems are. Searching takes a beat, so there's constant tension between "search this dresser" and "run to the next room before the other team does." Later, clan abilities and traps turn the second half of every match into a steal-and-scramble brawl.

---

## 2. Platform Note

| Item | Decision |
|---|---|
| Platform | Web browser (desktop first). No install. |
| Devices | One device per player. **Online multiplayer is a hard requirement** — no local/pass-and-play mode. |
| Input | Keyboard (arrow keys / WASD + action keys) and gamepad (D-pad / left stick + face buttons). |
| Players | Configurable: 2–4 teams, 1–4 players per team. Default: 2 teams of 2. |
| Connection | Persistent WebSocket to an authoritative game server. |
| Future | Console release is a long-term goal. The architecture (Section 8) keeps the rules and server platform-agnostic so a console client can be built later without redoing the game. |

---

## 3. Core Loop

1. **Lobby.** Host creates a match, shares a join code. Players join, pick a team, ready up. Host starts.
2. **Explore.** The map is a grid of rooms. Move tile-by-tile (up/down/left/right) through doors between rooms.
3. **Search.** Walk up to a piece of furniture and hold the action button for a short channel. Most furniture is empty; some hides a gem.
4. **Collect.** A found gem is picked up and carried by that player and counts toward their team's score.
5. **Clock out.** When the match timer ends, the team holding the most gems wins. *(Later: traps and abilities let players knock gems loose and steal them, so the endgame becomes a fight, not a sprint.)*

---

## 4. Signature Mechanics

### 4.1 The Room Grid

The **map** is a grid of **rooms**. Each room is itself a grid of **tiles**. Both are configurable.

```
+-------+-------+-------+
|       |       |       |
|  R0   ==  R1  ==  R2  |
|       |       |       |
+--||---+--||---+--||---+
|       |       |       |
|  R3   ==  R4  ==  R5  |
|       |       |       |
+--||---+--||---+--||---+
|       |       |       |
|  R6   ==  R7  ==  R8  |
|       |       |       |
+-------+-------+-------+
   == / || = 2-tile-wide doorway, centered on the shared wall
```

| Parameter | Default | Notes |
|---|---|---|
| `mapRows × mapCols` | 3 × 3 (9 rooms) | Any rectangular layout ≥ 2 rooms. |
| `roomSize` | 12 × 12 tiles | 6×6 was the original placeholder and is too cramped for furniture-in-the-middle layouts. **Tune by playtest.** |
| `doorWidth` | 2 tiles | Centered on each shared wall. Every adjacent pair of rooms is connected. |
| Movement | 1 tile per step, 4 directions | Holding a direction auto-repeats steps at `moveIntervalMs` (default 150 ms ≈ 6.7 tiles/sec). No diagonals. |

**Decision — player collision:** Players **do not block each other** in MVP (they can occupy/pass through the same tile). This avoids doorway griefing before we have abilities to deal with it. *Alternative for later: solid players + a shove ability.*

### 4.2 Room Templates (hand-built, not random)

Rooms are **not** procedurally furnished. We maintain a **library of hand-authored room templates** (target: ~20). Each template is a `roomSize × roomSize` stamp that defines:

- **Furniture** footprints (1×1, 1×2, 2×2, etc.), each flagged `searchable: true/false`. Furniture is solid (blocks movement).
- **Decoration** (carpets, floor patterns) — purely visual, walkable.
- Furniture may sit anywhere, including the middle of the room, to make rooms feel designed and real.

**Template rules (validated at load time, enforced by tests):**
1. Door tiles and the one tile inward from every door are always clear.
2. Every walkable tile is reachable from every door (no sealed pockets).
3. Every searchable furniture piece has at least one adjacent walkable tile to search from.

**Match generation:** For each room slot, pick a template (without repeats until the library is exhausted). To stretch variety, each template may be applied with any of its **8 symmetries** (4 rotations × optional mirror). The map is generated once by the server from a `seed` and is identical for all players.

### 4.3 Gems

| Rule | Decision |
|---|---|
| Count | Configurable. **Always odd.** Default: `roomCount` if odd, else `roomCount + 1` (9 rooms → 9 gems; 4 rooms → 5; 6 rooms → 7). |
| Placement | Hidden inside searchable furniture at match start, spread across rooms: at most `ceil(gems / eligibleRooms)` per room. **Team spawn rooms contain no gems.** |
| Discovery | Players cannot see which furniture holds gems. Searching reveals it. |
| Searched state | After a search, that furniture is visually marked as "searched" **for the searching player's team only.** Other teams still see it as unsearched. *(Alternative: global visibility. Per-team was chosen for strategy depth; it is a one-line change.)* |
| Carrying | A player carries any number of gems. Team score = sum of gems carried by its players. |
| Dropping (later) | Abilities/traps can force a player to drop all carried gems. Dropped gems **scatter onto random walkable tiles within the current room** and can be picked up by any player who steps on them. The data model supports this from day one (a gem is always `hidden-in-furniture`, `carried-by-player`, or `on-floor-at-tile`). |

**Searching:** Stand on a tile adjacent to searchable furniture, facing it, and hold **Action** for `searchDurationMs` (default 1500 ms). Moving or releasing cancels. On completion: if the furniture holds a gem, it is transferred to the player; either way the furniture is marked searched for that team. Two players searching the same piece simultaneously: first to complete wins; the other's search completes as "empty."

### 4.4 Timer & Win Condition

- Match length `matchDurationSec` (default 300 s). Visible countdown for all players.
- **MVP (no stealing yet):** if every gem has been found, the match ends immediately — scores can no longer change.
- **Once stealing exists:** the match always runs to the timer; the all-gems-found moment is when the game becomes a brawl.
- At time-out, highest team gem count wins.
- **Tie at time-out** (possible when undiscovered gems remain, or once stealing exists): **sudden-death overtime** — play continues until any team's gem count changes, capped at `overtimeCapSec` (default 60 s), after which the match is a draw.

---

## 5. Game Flow (screen by screen)

| # | Screen | What happens |
|---|---|---|
| 1 | **Title / Home** | Enter display name. `Create Match` or `Join Match` (enter 4–6 char code). |
| 2 | **Lobby** | Shows join code, player list grouped by team, match config (teams, team size, map size, room size, gems, duration). Players click a team to switch. Host edits config and clicks `Start` when every slot has a ready player (min: 2 teams with ≥1 player each). |
| 3 | **Countdown** | 3-second countdown over the generated map. Players see their spawn room. |
| 4 | **Match** | Top-down view, camera follows the local player. HUD: timer, per-team gem counts, your carried gems, your room's mini-indicator on a 3×3 minimap. Controls: move, Action (search / pick up). |
| 5 | **Overtime** (if tie) | HUD flashes OVERTIME; same controls. |
| 6 | **Results** | Winning team, final gem counts, per-player stats (gems found, furniture searched, tiles walked). `Rematch` (same lobby, new seed) or `Leave`. |

**Spawning:** Each team spawns together in its own room, chosen to maximize distance between teams (corners first). Spawn rooms hold no gems.

---

## 6. Rules & Win Condition (compact)

| Rule | Value |
|---|---|
| Teams / players | 2–4 teams × 1–4 players (default 2×2) |
| Map | `mapRows × mapCols` rooms (default 3×3), each `roomSize²` tiles (default 12×12) |
| Movement | 4-directional, 1 tile/step, ~6.7 tiles/sec, players pass through each other |
| Search | Hold Action 1.5 s adjacent to furniture; cancel on move/release |
| Gems | Odd count (default = rooms, rounded up to odd), hidden in furniture, none in spawn rooms |
| Score | Gems carried by the team's players |
| Timer | 300 s default |
| End | Timer out (or all gems found, MVP only) → most gems wins |
| Tie | Sudden death until any score changes; 60 s cap → draw |

---

## 7. Game State / Data Model

All game state lives in the **shared rules package** and is owned by the server. Clients receive snapshots.

```ts
// Configuration chosen in lobby
MatchConfig {
  seed: number
  mapRows: number; mapCols: number        // default 3, 3
  roomSize: number                        // default 12
  doorWidth: number                       // default 2
  teamCount: number; teamSize: number     // default 2, 2
  gemCount: number                        // odd; default derived from room count
  matchDurationSec: number                // default 300
  overtimeCapSec: number                  // default 60
  moveIntervalMs: number                  // default 150
  searchDurationMs: number                // default 1500
}

// Generated once from seed + config
GameMap {
  rooms: Room[]                           // row-major
  tiles: TileKind[][]                     // global grid: Floor | Wall | Door | Furniture
  furniture: Furniture[]
}
Room { id, row, col, templateId, symmetry, bounds }
Furniture { id, roomId, tiles: TilePos[], searchable: boolean, kind: string }

// Live match state
MatchState {
  phase: 'lobby' | 'countdown' | 'playing' | 'overtime' | 'ended'
  tick: number
  timeRemainingMs: number
  teams: Team[]
  players: Player[]
  gems: Gem[]
  searchedByTeam: Record<TeamId, Set<FurnitureId>>   // per-team fog of searched furniture
  traps: Trap[]                                       // empty in MVP; reserved
}
Team { id, name, color, playerIds[] }
Player {
  id, teamId, name, connected: boolean
  pos: TilePos, facing: Dir
  search?: { furnitureId, startedTick }
  carriedGemIds: GemId[]
  effects: StatusEffect[]                             // empty in MVP; reserved (stun, burn, freeze, slow)
}
Gem { id, location:
  | { kind: 'furniture', furnitureId }
  | { kind: 'player', playerId }
  | { kind: 'floor', pos } }

// Inputs from clients (the only thing a client may send during play)
Input = { type: 'move', dir } | { type: 'actionDown' } | { type: 'actionUp' }
```

**Key logic (all in shared package, all unit-tested):**
- `generateMap(config)` — deterministic from seed; picks templates/symmetries, stamps tiles, validates connectivity.
- `placeGems(map, config, spawnRooms)` — deterministic distribution.
- `step(state, inputsThisTick, config)` — advances one tick: applies moves (walls/furniture block), progresses/cancels searches, resolves completed searches, picks up floor gems on step, updates timer, checks end/overtime conditions.
- `teamScores(state)` and `winner(state)`.

**Server tick:** 20 Hz. Clients send inputs as they happen; the server applies them on the next tick and broadcasts state deltas. Clients render the server's state with light interpolation. **No client-side prediction in MVP** (grid movement tolerates ~100 ms latency well); revisit if playtests feel sluggish.

---

## 8. Architecture & Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, one toolchain, shared types between client and server. |
| Repo | pnpm monorepo: `packages/shared`, `packages/server`, `packages/client` | Clean separation; rules are importable by both sides. |
| Shared rules | Pure TS, zero dependencies on DOM or Node | Deterministic and headless → trivially unit-testable. |
| Server | Node + **Colyseus** (rooms, state sync, reconnection) | Mature, built for exactly this; avoids hand-rolling WebSocket plumbing. |
| Client | **Phaser 3** (rendering, input, gamepad) + Vite | Standard 2D web game framework; thin layer over server state. |
| Tests | **Vitest** | Fast; shared-package tests run in ms with no browser. Server tests spin up a Colyseus room in-process. |
| Art | Simple placeholder tiles/sprites | Upgrade later without touching rules. |
| Hosting (later) | Static client + single Node server (Fly.io / Railway / Render) | Decide at M4. |

**Console path (future):** No console runs JavaScript natively, and each platform requires a registered developer account + NDA SDK. When that time comes, the **client** is rebuilt (e.g., Unity or a Godot console port) against the same server protocol; **shared rules and server carry over unchanged.** This is why rules are kept free of rendering code.

---

## 9. Engineering-Critical Notes (hardest parts & risks)

1. **Deterministic, authoritative simulation.** Everything that affects outcome (map gen, gem placement, movement, searches) runs on the server from a seed + ordered inputs. Clients never decide anything. Replay tests (seed + input log → identical final state) are the backbone of the test suite.
2. **Room template authoring & validation.** Twenty good templates is real design work. Ship a tiny text/JSON template format and a validator that fails loudly on sealed pockets, blocked doors, or unreachable furniture. Start with 5 templates; 20 is a content task, not a code task.
3. **Netcode feel without prediction.** Grid movement at 20 Hz with 150 ms step interval should feel fine at typical latency. Risk: feels laggy on bad connections. Mitigation: interpolation first; add input-prediction for the local player only if playtests demand it.
4. **Reconnection.** Colyseus supports it; we must define the gameplay rule (Section 10) and test it.
5. **Design the model for abilities now, build them later.** `effects`, `traps`, and the three-state `Gem.location` exist from M1 so Phase 2 doesn't require a data-model rewrite.

---

## 10. Edge Cases

| Case | Handling |
|---|---|
| Player disconnects mid-match | Avatar freezes in place for `reconnectGraceSec` (default 30 s) and can be rejoined with the same session. After grace: player is removed, carried gems **scatter in the room they stood in**. Team stays in the match. |
| Team has zero connected players | Team remains in scoring. If every team but one is fully disconnected for > 30 s, match ends; remaining team wins. |
| Host disconnects in lobby | Host role passes to the next player. Match config persists. |
| Two players search the same furniture | First completion takes the gem; the other completes as "empty." Both teams mark it searched. |
| Player moves during search | Search cancels, no progress saved. |
| Search a furniture already searched by your team | Allowed but useless; UI shows it as searched so nobody bothers. |
| Tie at time-out | Sudden death (Section 4.4); 60 s cap → draw. |
| Config produces impossible gem placement (gems > searchable furniture in non-spawn rooms) | Lobby validation rejects `Start` with a clear message. |
| Team count > number of rooms available for spawning | Lobby validation rejects. |
| Rematch | Same lobby, same teams, new seed. |
| Idle player (no input for whole match) | No special handling in MVP. |

---

## 11. Milestones

### M0 — Repo reset & scaffold
- Remove the Android/Gradle project (it is preserved in git history).
- pnpm workspace with `shared`, `server`, `client`; Vitest; lint/format; CI running tests.

### M1 — Shared rules (fully tested, no UI)
- Config + defaults, map generation from templates (start with 5 templates), gem placement, movement, search, timer, end/overtime, scoring.
- Replay test: seed + input log → deterministic final state.

### M2 — Server
- Colyseus room: lobby (create/join by code, team select, config, ready/start), 20 Hz simulation loop driving `step()`, state broadcast, reconnection grace.

### M3 — Client
- Phaser scenes: Home, Lobby, Match, Results. Tile renderer with placeholder art, camera follow, HUD, keyboard + gamepad input, per-team searched-furniture overlay.

### M4 — Playable online build
- Deploy server + client. Playtest with 4 players. Tune `roomSize`, `moveIntervalMs`, `searchDurationMs`, `matchDurationSec`. Grow template library toward 20.

**MVP = M0–M4.** A stranger can open a URL, join a code, and play a full match.

### Phase 2 — Clans & abilities (spec'd separately once MVP is playable)
- Clan selection in lobby; per-clan ability loadout with cooldowns.
- **Traps:** floor-tile traps (trigger on step) and furniture traps (trigger on search).
- **Status effects:** stun, burn (damage over time), freeze, slow.
- **Gem drop & scatter** on effect; gem pickup from floor; stealing.
- Ranged/area abilities travelling across tiles.
- Initial elemental clans: Fire (volcano traps, burn), Ice (freeze traps on furniture/floor), Earth, Lightning. Exact kits TBD.

### Phase 3 — Progression
- Player accounts + persistence (database).
- Clan levels and skill trees; unlockable moves.
- **Gated clans:** e.g., Lava unlocks at Fire L5 + Earth L5.
- Match history and stats.

### Later / Unscheduled
- Upgraded art and audio.
- Matchmaking (vs. join-code only).
- Console client.

---

## 12. MVP Scope vs. Later

**In MVP (M0–M4)**
- Online lobby with join codes, configurable teams/map/gems/timer
- 3×3 (configurable) room grid, hand-built templates with symmetries
- Grid movement, searching, gem pickup, per-team searched fog
- Timer, early end on all-gems-found, overtime, results screen
- Reconnection grace
- Placeholder art, keyboard + gamepad

**Later**
- Clans, abilities, traps, status effects, gem dropping/stealing
- Accounts, progression, gated clans
- Real art/audio, matchmaking, console

---

## 13. Why It's Fun

It's hide-and-seek with a stopwatch. Hand-built rooms mean every match starts with genuine uncertainty, the search channel makes every dresser a small gamble against the clock, and per-team fog means you're always wondering whether the other team already cleaned out the room you just walked into. Once clans arrive, the moment all gems are found flips the game from a race into a heist gone wrong, which is exactly where the burglar theme pays off.
