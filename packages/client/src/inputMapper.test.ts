import { describe, expect, it } from 'vitest';
import { InputMapper, NO_INPUT, mergeRaw, type RawInput } from './inputMapper';

const raw = (p: Partial<RawInput>): RawInput => ({ ...NO_INPUT, ...p });

describe('InputMapper', () => {
  it('emits a move when a direction is pressed and nothing while it is held', () => {
    const m = new InputMapper();
    expect(m.next(raw({ right: true }))).toEqual([{ type: 'move', dir: 'right' }]);
    expect(m.next(raw({ right: true }))).toEqual([]);
    expect(m.next(NO_INPUT)).toEqual([{ type: 'move', dir: null }]);
    expect(m.next(NO_INPUT)).toEqual([]);
  });

  it('the newest direction wins and releasing it falls back to the older one', () => {
    const m = new InputMapper();
    m.next(raw({ right: true }));
    expect(m.next(raw({ right: true, up: true }))).toEqual([{ type: 'move', dir: 'up' }]);
    expect(m.next(raw({ right: true, up: true }))).toEqual([]);
    expect(m.next(raw({ right: true }))).toEqual([{ type: 'move', dir: 'right' }]);
    expect(m.next(raw({ right: true, left: true }))).toEqual([{ type: 'move', dir: 'left' }]);
    expect(m.next(raw({ left: true }))).toEqual([]);
  });

  it('emits action edges independently of movement', () => {
    const m = new InputMapper();
    expect(m.next(raw({ action: true, down: true }))).toEqual([
      { type: 'move', dir: 'down' },
      { type: 'actionDown' },
    ]);
    expect(m.next(raw({ action: true, down: true }))).toEqual([]);
    expect(m.next(raw({ down: true }))).toEqual([{ type: 'actionUp' }]);
  });

  it('two directions pressed in the same frame resolve deterministically (last in u/d/l/r order)', () => {
    const m = new InputMapper();
    expect(m.next(raw({ right: true, down: true }))).toEqual([{ type: 'move', dir: 'right' }]);
    expect(new InputMapper().next(raw({ up: true, left: true }))).toEqual([
      { type: 'move', dir: 'left' },
    ]);
  });

  it('after a reset, pressing again emits the edges again', () => {
    const m = new InputMapper();
    m.next(raw({ action: true }));
    m.reset();
    expect(m.next(raw({ action: true }))).toEqual([{ type: 'actionDown' }]);
  });

  it('reset releases everything that was held', () => {
    const m = new InputMapper();
    m.next(raw({ left: true, action: true }));
    expect(m.reset()).toEqual([{ type: 'move', dir: null }, { type: 'actionUp' }]);
    expect(m.reset()).toEqual([]);
  });

  it('mergeRaw ORs two sources', () => {
    expect(mergeRaw(raw({ up: true }), raw({ action: true }))).toEqual(
      raw({ up: true, action: true }),
    );
  });
});
