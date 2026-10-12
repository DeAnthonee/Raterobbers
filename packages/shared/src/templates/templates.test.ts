import { describe, expect, it } from 'vitest';
import { extractPieces, type RoomTemplate } from './format';
import { TEMPLATES_12, templatesForSize } from './library';
import { SYMMETRY_COUNT, applySymmetry, mirrorRows, rotateRows } from './symmetry';
import { doorOffset, requiredClearTiles, validateTemplate } from './validate';

const empty = (size: number): string[] => Array.from({ length: size }, () => '.'.repeat(size));

function withChars(size: number, edits: Record<string, string>): string[] {
  const rows = empty(size).map((r) => r.split(''));
  for (const [key, ch] of Object.entries(edits)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    (rows[y] as string[])[x] = ch;
  }
  return rows.map((r) => r.join(''));
}

describe('doorOffset / requiredClearTiles', () => {
  it('centres the door on the wall', () => {
    expect(doorOffset(12, 2)).toBe(5);
    expect(doorOffset(6, 2)).toBe(2);
    expect(doorOffset(7, 1)).toBe(3);
  });

  it('is symmetric when the door is off-centre (odd roomSize - doorWidth)', () => {
    // 12 - 1 is odd: offset rounds down to 5, mirror maps it to 6; both must be clear.
    const tiles = requiredClearTiles(12, 1);
    expect(tiles).toContainEqual({ x: 5, y: 0 });
    expect(tiles).toContainEqual({ x: 6, y: 0 });
    expect(tiles).toContainEqual({ x: 0, y: 5 });
    expect(tiles).toContainEqual({ x: 0, y: 6 });
    expect(tiles).toHaveLength(16);
    const onlyLeftClear = withChars(12, { '6,0': 'B' });
    expect(validateTemplate({ id: 't', size: 12, rows: onlyLeftClear }, 12, 1)).not.toEqual([]);
    // Odd door width on an even room: 12 - 3 = 9 -> offsets 4 and 5 -> columns 4..7.
    expect(
      requiredClearTiles(12, 3)
        .filter((t) => t.y === 0)
        .map((t) => t.x),
    ).toEqual([4, 5, 6, 7]);
  });

  it('lists the edge tile and one inward tile on all four sides', () => {
    const tiles = requiredClearTiles(12, 2);
    expect(tiles).toHaveLength(16);
    expect(tiles).toContainEqual({ x: 5, y: 0 });
    expect(tiles).toContainEqual({ x: 6, y: 1 });
    expect(tiles).toContainEqual({ x: 0, y: 5 });
    expect(tiles).toContainEqual({ x: 10, y: 6 });
    expect(tiles).toContainEqual({ x: 5, y: 11 });
  });
});

describe('validateTemplate', () => {
  it('accepts an empty room', () => {
    expect(validateTemplate({ id: 't', size: 12, rows: empty(12) }, 12, 2)).toEqual([]);
  });

  it('rejects wrong size and ragged rows', () => {
    expect(validateTemplate({ id: 't', size: 10, rows: empty(10) }, 12, 2)).not.toEqual([]);
    expect(validateTemplate({ id: 't', size: 12, rows: empty(11) }, 12, 2)).not.toEqual([]);
    const ragged = empty(12);
    ragged[3] = '...........';
    expect(validateTemplate({ id: 't', size: 12, rows: ragged }, 12, 2)).not.toEqual([]);
  });

  it('rejects unknown characters', () => {
    const rows = withChars(12, { '3,3': '?' });
    const errors = validateTemplate({ id: 't', size: 12, rows }, 12, 2);
    expect(errors[0]?.message).toMatch(/unknown character/);
  });

  it('rejects furniture blocking a door or its approach', () => {
    const onEdge = withChars(12, { '5,0': 'B' });
    expect(validateTemplate({ id: 't', size: 12, rows: onEdge }, 12, 2)[0]?.message).toMatch(
      /door clearance/,
    );
    const inward = withChars(12, { '1,6': 'B' });
    expect(validateTemplate({ id: 't', size: 12, rows: inward }, 12, 2)[0]?.message).toMatch(
      /door clearance/,
    );
  });

  it('rejects sealed floor pockets', () => {
    // A ring of pillars around (6,6) with a floor tile inside.
    const rows = withChars(12, {
      '5,5': 'l',
      '6,5': 'l',
      '7,5': 'l',
      '5,6': 'l',
      '7,6': 'l',
      '5,7': 'l',
      '6,7': 'l',
      '7,7': 'l',
    });
    const errors = validateTemplate({ id: 't', size: 12, rows }, 12, 2);
    expect(errors.some((e) => /not reachable/.test(e.message))).toBe(true);
  });

  it('rejects searchable furniture with no adjacent floor', () => {
    // Chest fully wrapped by pillars.
    const rows = withChars(12, {
      '6,6': 'H',
      '5,6': 'l',
      '7,6': 'l',
      '6,5': 'l',
      '6,7': 'l',
    });
    const errors = validateTemplate({ id: 't', size: 12, rows }, 12, 2);
    expect(errors.some((e) => /no adjacent floor/.test(e.message))).toBe(true);
  });
});

describe('extractPieces', () => {
  it('groups contiguous same letters into one piece', () => {
    const rows = withChars(12, { '2,2': 'B', '3,2': 'B', '2,3': 'B', '8,8': 'B', '4,4': 'p' });
    const pieces = extractPieces({ id: 't', size: 12, rows });
    const beds = pieces.filter((p) => p.kind === 'bed');
    expect(beds).toHaveLength(2);
    expect(beds[0]?.tiles).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
    ]);
    expect(beds[0]?.searchable).toBe(true);
    const plant = pieces.find((p) => p.kind === 'plant');
    expect(plant?.searchable).toBe(false);
  });

  it('does not merge different adjacent letters', () => {
    const rows = withChars(12, { '2,2': 'N', '3,2': 'D' });
    const kinds = extractPieces({ id: 't', size: 12, rows })
      .map((p) => p.kind)
      .sort();
    expect(kinds).toEqual(['dresser', 'nightstand']);
  });
});

describe('symmetry', () => {
  const t: RoomTemplate = {
    id: 'asym',
    size: 4,
    rows: ['B...', '....', '...p', '....'],
  };

  it('rotating four times is the identity, mirroring twice is the identity', () => {
    let rows = t.rows;
    for (let i = 0; i < 4; i++) rows = rotateRows(rows);
    expect(rows).toEqual(t.rows);
    expect(mirrorRows(mirrorRows(t.rows))).toEqual(t.rows);
  });

  it('rotates clockwise', () => {
    expect(rotateRows(t.rows)).toEqual(['...B', '....', '....', '.p..']);
  });

  it('applySymmetry(0) is the identity and indexes are range-checked', () => {
    expect(applySymmetry(t, 0).rows).toEqual(t.rows);
    expect(() => applySymmetry(t, SYMMETRY_COUNT)).toThrow();
    expect(() => applySymmetry(t, -1)).toThrow();
  });

  it('produces 8 distinct variants for an asymmetric template', () => {
    const variants = new Set(
      Array.from({ length: SYMMETRY_COUNT }, (_, i) => applySymmetry(t, i).rows.join('/')),
    );
    expect(variants.size).toBe(8);
  });
});

describe('built-in library', () => {
  it('has at least 14 templates at size 12', () => {
    expect(TEMPLATES_12.length).toBeGreaterThanOrEqual(14);
    expect(templatesForSize(12)).toBe(TEMPLATES_12);
    expect(templatesForSize(99)).toEqual([]);
  });

  it('has unique ids', () => {
    const ids = TEMPLATES_12.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TEMPLATES_12.map((t) => [t.id, t] as const))(
    'template %s is valid under all 8 symmetries for door widths 1-4',
    (_id, template) => {
      for (const doorWidth of [1, 2, 3, 4]) {
        for (let s = 0; s < SYMMETRY_COUNT; s++) {
          expect(validateTemplate(applySymmetry(template, s), 12, doorWidth)).toEqual([]);
        }
      }
    },
  );

  it('a template valid in one orientation is valid in all (clearance is symmetric)', () => {
    for (const doorWidth of [1, 2, 3, 4]) {
      for (let seed = 0; seed < 40; seed++) {
        // Pseudo-random scatter of furniture; keep whatever the validator accepts upright.
        const edits: Record<string, string> = {};
        for (let i = 0; i < 12; i++) {
          const x = (seed * 7 + i * 5) % 12;
          const y = (seed * 3 + i * 11) % 12;
          edits[`${x},${y}`] = 'H';
        }
        const t = { id: 't', size: 12, rows: withChars(12, edits) };
        if (validateTemplate(t, 12, doorWidth).length > 0) continue;
        for (let s = 0; s < SYMMETRY_COUNT; s++) {
          expect(validateTemplate(applySymmetry(t, s), 12, doorWidth)).toEqual([]);
        }
      }
    }
  });

  it.each(TEMPLATES_12.map((t) => [t.id, t] as const))(
    'template %s has at least one searchable piece',
    (_id, template) => {
      expect(extractPieces(template).some((p) => p.searchable)).toBe(true);
    },
  );
});
