/**
 * On-screen controls for phones and tablets: a d-pad and a search button. The held state
 * is read once per frame by the match scene and merged with keyboard and gamepad input.
 *
 * `TouchState` is DOM-free (unit-tested); `TouchControls` owns the elements.
 */
import { NO_INPUT, type RawInput } from './inputMapper';

export type TouchKey = keyof RawInput;

export class TouchState {
  private readonly held = new Map<number, TouchKey>();

  /** A pointer started on `key`. */
  down(pointerId: number, key: TouchKey): void {
    this.held.set(pointerId, key);
  }

  /** A pointer was released or cancelled. Unknown pointers are ignored. */
  up(pointerId: number): void {
    this.held.delete(pointerId);
  }

  /** Release everything (e.g. the window lost focus). */
  clear(): void {
    this.held.clear();
  }

  raw(): RawInput {
    const out: RawInput = { ...NO_INPUT };
    for (const key of this.held.values()) out[key] = true;
    return out;
  }
}

/** True on devices whose primary pointer cannot hover, i.e. touch screens. */
export function isTouchDevice(
  mm: (q: string) => { matches: boolean } = (q) => window.matchMedia(q),
): boolean {
  return mm('(pointer: coarse)').matches;
}

const LAYOUT: { key: TouchKey; label: string; cls: string }[] = [
  { key: 'up', label: '▲', cls: 'up' },
  { key: 'left', label: '◀', cls: 'left' },
  { key: 'right', label: '▶', cls: 'right' },
  { key: 'down', label: '▼', cls: 'down' },
];

export class TouchControls {
  readonly state = new TouchState();
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    const pad = document.createElement('div');
    pad.className = 'dpad';
    for (const b of LAYOUT) pad.appendChild(this.button(b.key, b.label, `dir ${b.cls}`));
    const action = this.button('action', 'SEARCH', 'action');
    this.root.append(pad, action);
    parent.appendChild(this.root);
    window.addEventListener('blur', () => this.state.clear());
  }

  private button(key: TouchKey, label: string, cls: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${cls}`;
    el.textContent = label;
    el.dataset['key'] = key;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests) have no real pointer to capture.
      }
      this.state.down(e.pointerId, key);
    });
    const release = (e: PointerEvent): void => {
      this.state.up(e.pointerId);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.state.clear();
  }
}
