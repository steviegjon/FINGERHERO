// Keyboard input: held state + edge-triggered presses, consumed by the fixed-step update.

const JUMP = new Set(['Space', 'ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(target = window) {
    this.held = new Set();
    this.pressedQueue = [];
    this.anyKeyListeners = [];
    target.addEventListener('keydown', (e) => this._down(e));
    target.addEventListener('keyup', (e) => this._up(e));
    window.addEventListener('blur', () => this.held.clear());
  }

  _down(e) {
    if (PREVENT.has(e.code)) e.preventDefault();
    for (const fn of this.anyKeyListeners) fn(e);
    if (e.repeat) return;
    this.held.add(e.code);
    this.pressedQueue.push(e.code);
  }

  _up(e) {
    this.held.delete(e.code);
  }

  onAnyKey(fn) { this.anyKeyListeners.push(fn); }

  get jumpHeld() { for (const k of JUMP) if (this.held.has(k)) return true; return false; }
  get downHeld() { for (const k of DOWN) if (this.held.has(k)) return true; return false; }

  // Drain presses since last call. Returns an object of flags for this step.
  consume() {
    const q = this.pressedQueue;
    this.pressedQueue = [];
    const out = { jump: false, space: false, codes: q };
    for (const c of q) {
      if (JUMP.has(c)) out.jump = true;
      if (c === 'Space') out.space = true;
    }
    return out;
  }
}
