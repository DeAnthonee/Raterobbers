import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from './rng';

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 5 }, () => a.next())).not.toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('next() stays in [0, 1) and int(n) in [0, n)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('int(n) eventually hits every value', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shuffle keeps the multiset and is deterministic', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = createRng(9).shuffle([...items]);
    const b = createRng(9).shuffle([...items]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
  });

  it('pick returns an element and throws on empty', () => {
    const rng = createRng(1);
    expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.int(0)).toThrow();
  });

  it('matches pinned golden values (replays depend on this never changing)', () => {
    const rng = createRng(42);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
    expect(deriveSeed(100, 1)).toBe(858608827);
    expect(deriveSeed(100, 2)).toBe(2449905808);
  });

  it('createRng(rng.state()) resumes the same stream', () => {
    const a = createRng(77);
    a.next();
    a.next();
    const b = createRng(a.state());
    expect(b.next()).toBe(a.next());
    expect(b.next()).toBe(a.next());
  });

  it('deriveSeed gives distinct streams per salt', () => {
    const s1 = deriveSeed(100, 1);
    const s2 = deriveSeed(100, 2);
    expect(s1).not.toBe(s2);
    expect(deriveSeed(100, 1)).toBe(s1);
  });
});
