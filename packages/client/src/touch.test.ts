import { describe, expect, it } from 'vitest';
import { NO_INPUT } from './inputMapper';
import { TouchState, isTouchDevice } from './touch';

describe('TouchState', () => {
  it('tracks one key per pointer and merges them', () => {
    const t = new TouchState();
    expect(t.raw()).toEqual(NO_INPUT);
    t.down(1, 'right');
    expect(t.raw()).toEqual({ ...NO_INPUT, right: true });
    t.down(2, 'action'); // second finger
    expect(t.raw()).toEqual({ ...NO_INPUT, right: true, action: true });
    t.up(1);
    expect(t.raw()).toEqual({ ...NO_INPUT, action: true });
    t.up(99); // unknown pointer: ignored
    t.up(2);
    expect(t.raw()).toEqual(NO_INPUT);
  });

  it('a pointer sliding onto another key replaces its previous key', () => {
    const t = new TouchState();
    t.down(1, 'up');
    t.down(1, 'left');
    expect(t.raw()).toEqual({ ...NO_INPUT, left: true });
  });

  it('clear releases everything', () => {
    const t = new TouchState();
    t.down(1, 'down');
    t.down(2, 'action');
    t.clear();
    expect(t.raw()).toEqual(NO_INPUT);
  });
});

describe('isTouchDevice', () => {
  it('uses the coarse-pointer media query', () => {
    expect(isTouchDevice(() => ({ matches: true }))).toBe(true);
    expect(isTouchDevice(() => ({ matches: false }))).toBe(false);
  });
});
