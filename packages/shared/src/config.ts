/** Everything a lobby can tune. See docs/GAME_SPEC.md §4 and §7. */
export interface MatchConfig {
  seed: number;
  mapRows: number;
  mapCols: number;
  roomSize: number;
  doorWidth: number;
  teamCount: number;
  teamSize: number;
  /** Must be odd. */
  gemCount: number;
  matchDurationSec: number;
  overtimeCapSec: number;
  moveIntervalMs: number;
  searchDurationMs: number;
  reconnectGraceSec: number;
  countdownSec: number;
  /** Simulation ticks per second. */
  tickRate: number;
}

export const LIMITS = {
  mapRows: { min: 1, max: 6 },
  mapCols: { min: 1, max: 6 },
  roomSize: { min: 6, max: 24 },
  doorWidth: { min: 1, max: 4 },
  teamCount: { min: 2, max: 4 },
  teamSize: { min: 1, max: 4 },
  gemCount: { min: 1, max: 99 },
  matchDurationSec: { min: 30, max: 1800 },
  overtimeCapSec: { min: 0, max: 600 },
  moveIntervalMs: { min: 50, max: 1000 },
  searchDurationMs: { min: 0, max: 10000 },
  reconnectGraceSec: { min: 0, max: 300 },
  countdownSec: { min: 0, max: 10 },
  tickRate: { min: 5, max: 60 },
} as const;

/** Length of the join code the server mints and the client accepts. */
export const JOIN_CODE_LENGTH = 5;

/** Seeds are 32-bit: larger values alias (the PRNG only keeps the low 32 bits). */
export const MAX_SEED = 2 ** 32 - 1;

export function roomCount(config: Pick<MatchConfig, 'mapRows' | 'mapCols'>): number {
  return config.mapRows * config.mapCols;
}

/** Default gem count: the room count rounded up to an odd number (9 → 9, 4 → 5, 6 → 7). */
export function defaultGemCount(rooms: number): number {
  const n = Math.max(1, Math.floor(rooms));
  return n % 2 === 1 ? n : n + 1;
}

export const DEFAULT_CONFIG: MatchConfig = {
  seed: 1,
  mapRows: 3,
  mapCols: 3,
  roomSize: 12,
  doorWidth: 2,
  teamCount: 2,
  teamSize: 2,
  gemCount: defaultGemCount(9),
  matchDurationSec: 300,
  overtimeCapSec: 60,
  moveIntervalMs: 150,
  searchDurationMs: 1500,
  reconnectGraceSec: 30,
  countdownSec: 3,
  tickRate: 20,
};

/**
 * Build a config from partial overrides. `gemCount` defaults from the room count
 * unless given explicitly.
 */
export function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  const merged: MatchConfig = { ...DEFAULT_CONFIG, ...overrides };
  if (overrides.gemCount === undefined) {
    merged.gemCount = defaultGemCount(roomCount(merged));
  }
  return merged;
}

export interface ConfigError {
  field: keyof MatchConfig | 'general';
  message: string;
}

/** Returns an empty array when the config is valid. */
export function validateConfig(config: MatchConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = config[key];
    const { min, max } = LIMITS[key];
    if (!Number.isInteger(value)) {
      errors.push({ field: key, message: `${key} must be an integer` });
    } else if (value < min || value > max) {
      errors.push({ field: key, message: `${key} must be between ${min} and ${max}` });
    }
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > MAX_SEED) {
    errors.push({ field: 'seed', message: `seed must be an integer between 0 and ${MAX_SEED}` });
  }
  if (Number.isInteger(config.gemCount) && config.gemCount % 2 === 0) {
    errors.push({ field: 'gemCount', message: 'gemCount must be odd' });
  }
  const rooms = roomCount(config);
  if (rooms < 2) {
    errors.push({ field: 'general', message: 'the map needs at least 2 rooms' });
  }
  if (config.teamCount >= rooms) {
    errors.push({
      field: 'teamCount',
      message:
        'each team needs its own spawn room and gems need at least one non-spawn room: teamCount must be less than the room count',
    });
  }
  if (config.doorWidth > config.roomSize - 2) {
    errors.push({
      field: 'doorWidth',
      message: 'doorWidth must leave at least one wall tile per side',
    });
  }
  return errors;
}
