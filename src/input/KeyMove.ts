/** Held-key movement input: WASD / arrow keys, Shift to go faster. */

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_CODES = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT]);

/** Sprint multiplier while Shift is held. */
export const SPRINT = 2.5;

export interface MoveAxes {
  /** +1 right, -1 left. */
  x: number;
  /** +1 forward, -1 back. */
  y: number;
}

/** Movement direction from the set of held key codes; diagonals are normalized. */
export function moveAxes(held: ReadonlySet<string>): MoveAxes {
  const any = (codes: string[]) => codes.some((c) => held.has(c));
  const x = Number(any(RIGHT)) - Number(any(LEFT));
  const y = Number(any(FORWARD)) - Number(any(BACK));
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export class KeyMove {
  private readonly held = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (MOVE_CODES.has(e.code) || e.code.startsWith('Shift')) {
        this.held.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Keys released while the window is unfocused never send keyup.
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Current direction, already scaled by the sprint multiplier. */
  get axes(): MoveAxes {
    const a = moveAxes(this.held);
    const boost = this.held.has('ShiftLeft') || this.held.has('ShiftRight') ? SPRINT : 1;
    return { x: a.x * boost, y: a.y * boost };
  }
}
