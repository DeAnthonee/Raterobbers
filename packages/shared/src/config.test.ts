import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MAX_SEED,
  defaultGemCount,
  makeConfig,
  roomCount,
  validateConfig,
} from './config';
import { validateMatchSetup } from './map';
import { TEST_TEMPLATE } from './testing';

describe('validateMatchSetup', () => {
  it('accepts the defaults with the built-in library for every door width', () => {
    for (const doorWidth of [1, 2, 3, 4]) {
      expect(validateMatchSetup(makeConfig({ doorWidth }))).toEqual([]);
    }
  });

  it('reports config errors first, then template problems against roomSize', () => {
    expect(validateMatchSetup(makeConfig({ gemCount: 2 })).map((e) => e.field)).toEqual([
      'gemCount',
    ]);
    const noTemplates = validateMatchSetup(makeConfig({ roomSize: 7 }));
    expect(noTemplates[0]?.field).toBe('roomSize');
    expect(noTemplates[0]?.message).toMatch(/no room templates/);
    const bad = {
      ...TEST_TEMPLATE,
      rows: TEST_TEMPLATE.rows.map((r, i) => (i === 0 ? 'B'.repeat(12) : r)),
    };
    const errors = validateMatchSetup(makeConfig(), [bad]);
    expect(errors[0]?.field).toBe('roomSize');
    expect(errors[0]?.message).toMatch(/door clearance/);
  });
});

describe('defaultGemCount', () => {
  it('rounds the room count up to an odd number', () => {
    expect(defaultGemCount(9)).toBe(9);
    expect(defaultGemCount(4)).toBe(5);
    expect(defaultGemCount(6)).toBe(7);
    expect(defaultGemCount(1)).toBe(1);
    expect(defaultGemCount(2)).toBe(3);
  });
});

describe('makeConfig', () => {
  it('uses spec defaults', () => {
    const c = makeConfig();
    expect(c).toEqual(DEFAULT_CONFIG);
    expect(c.mapRows).toBe(3);
    expect(c.mapCols).toBe(3);
    expect(c.roomSize).toBe(12);
    expect(c.doorWidth).toBe(2);
    expect(c.gemCount).toBe(9);
    expect(c.matchDurationSec).toBe(300);
  });

  it('derives gemCount from the room count when not given', () => {
    expect(makeConfig({ mapRows: 2, mapCols: 2 }).gemCount).toBe(5);
    expect(makeConfig({ mapRows: 2, mapCols: 3 }).gemCount).toBe(7);
  });

  it('keeps an explicit gemCount', () => {
    expect(makeConfig({ mapRows: 2, mapCols: 2, gemCount: 3 }).gemCount).toBe(3);
  });
});

describe('validateConfig', () => {
  it('accepts the defaults', () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  it('rejects even gem counts', () => {
    const errors = validateConfig(makeConfig({ gemCount: 8 }));
    expect(errors.map((e) => e.field)).toContain('gemCount');
  });

  it('rejects maps with fewer than 2 rooms', () => {
    const errors = validateConfig(makeConfig({ mapRows: 1, mapCols: 1 }));
    expect(errors.some((e) => e.field === 'general')).toBe(true);
  });

  it('rejects teams >= rooms (every team needs a spawn room and gems need a free room)', () => {
    expect(
      validateConfig(makeConfig({ mapRows: 1, mapCols: 3, teamCount: 4 })).map((e) => e.field),
    ).toContain('teamCount');
    expect(
      validateConfig(makeConfig({ mapRows: 1, mapCols: 2, teamCount: 2 })).map((e) => e.field),
    ).toContain('teamCount');
    expect(validateConfig(makeConfig({ mapRows: 1, mapCols: 3, teamCount: 2 }))).toEqual([]);
  });

  it('bounds the seed to 32 bits', () => {
    expect(validateConfig(makeConfig({ seed: MAX_SEED }))).toEqual([]);
    expect(validateConfig(makeConfig({ seed: MAX_SEED + 1 })).map((e) => e.field)).toContain(
      'seed',
    );
    expect(validateConfig(makeConfig({ seed: -1 })).map((e) => e.field)).toContain('seed');
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(validateConfig(makeConfig({ teamSize: 0 })).map((e) => e.field)).toContain('teamSize');
    expect(validateConfig(makeConfig({ roomSize: 5 })).map((e) => e.field)).toContain('roomSize');
    expect(validateConfig(makeConfig({ tickRate: 20.5 })).map((e) => e.field)).toContain(
      'tickRate',
    );
    expect(validateConfig(makeConfig({ seed: 1.5 })).map((e) => e.field)).toContain('seed');
  });

  it('rejects doors too wide for the room', () => {
    // Widest allowed door in the smallest room still leaves one wall tile per side.
    expect(validateConfig(makeConfig({ roomSize: 6, doorWidth: 4 }))).toEqual([]);
    const errors = validateConfig(makeConfig({ roomSize: 6, doorWidth: 5 }));
    const messages = errors.filter((e) => e.field === 'doorWidth').map((e) => e.message);
    expect(messages.some((m) => /wall tile/.test(m))).toBe(true);
  });

  it('roomCount multiplies rows by cols', () => {
    expect(roomCount({ mapRows: 3, mapCols: 3 })).toBe(9);
    expect(roomCount({ mapRows: 2, mapCols: 5 })).toBe(10);
  });
});
