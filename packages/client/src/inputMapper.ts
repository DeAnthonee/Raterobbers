import type { Dir, InputEvent } from '@eyespy/shared';

/** Raw held state sampled once per frame from keyboard and/or gamepad. */
export interface RawInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
}

export const NO_INPUT: Readonly<RawInput> = {
  up: false,
  down: false,
  left: false,
  right: false,
  action: false,
};

export function mergeRaw(a: RawInput, b: RawInput): RawInput {
  return {
    up: a.up || b.up,
    down: a.down || b.down,
    left: a.left || b.left,
    right: a.right || b.right,
    action: a.action || b.action,
  };
}

/**
 * Turns per-frame held state into the edge-triggered events the server expects. The most
 * recently pressed direction wins while several are held (so tapping a new direction turns
 * immediately), and releasing it falls back to the oldest still-held direction.
 */
export class InputMapper {
  private pressOrder: Dir[] = [];
  private sentDir: Dir | null = null;
  private sentAction = false;

  next(raw: RawInput): InputEvent[] {
    const events: InputEvent[] = [];
    const heldNow: Dir[] = (['up', 'down', 'left', 'right'] as const).filter((d) => raw[d]);
    this.pressOrder = this.pressOrder.filter((d) => heldNow.includes(d));
    for (const d of heldNow) if (!this.pressOrder.includes(d)) this.pressOrder.push(d);
    const dir = this.pressOrder[this.pressOrder.length - 1] ?? null;
    if (dir !== this.sentDir) {
      this.sentDir = dir;
      events.push({ type: 'move', dir });
    }
    if (raw.action !== this.sentAction) {
      this.sentAction = raw.action;
      events.push({ type: raw.action ? 'actionDown' : 'actionUp' });
    }
    return events;
  }

  /** Forget everything (e.g. when the window loses focus) and emit the matching releases. */
  reset(): InputEvent[] {
    return this.next(NO_INPUT);
  }
}
