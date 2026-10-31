import type { FixedStepClock } from '../core/clock';
import { formatSimDate } from './format';

export const SPEEDS = [1, 10, 100, 365] as const;
const LABELS = ['1 day/s', '10 days/s', '100 days/s', '1 year/s'];

/** Bottom-center calendar with pause and speed buttons (Space, 1–4). */
export class TimeControls {
  readonly el = document.createElement('div');
  private readonly date: HTMLElement;
  private readonly pause: HTMLButtonElement;
  private readonly speedButtons: HTMLButtonElement[] = [];

  constructor(private readonly clock: FixedStepClock) {
    this.el.className = 'panel time-controls';
    this.el.innerHTML = `<button type="button" class="pause" title="Pause (Space)"></button><div class="speeds"></div><div class="date"></div>`;
    this.pause = this.el.querySelector('.pause')!;
    this.date = this.el.querySelector('.date')!;
    const speeds = this.el.querySelector('.speeds')!;
    SPEEDS.forEach((speed, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${speed}×`;
      b.title = `${LABELS[i]} (${i + 1})`;
      b.addEventListener('click', () => this.setSpeed(i));
      speeds.appendChild(b);
      this.speedButtons.push(b);
    });
    this.pause.addEventListener('click', () => this.togglePause());
    this.refresh();
  }

  togglePause(): void {
    this.clock.paused = !this.clock.paused;
    this.refresh();
  }

  /** Selects a speed by index and unpauses. */
  setSpeed(index: number): void {
    this.clock.speed = SPEEDS[index] ?? 1;
    this.clock.paused = false;
    this.refresh();
  }

  update(simDays: number): void {
    this.date.textContent = formatSimDate(simDays);
  }

  private refresh(): void {
    this.pause.textContent = this.clock.paused ? '▶' : '❚❚';
    this.pause.classList.toggle('active', this.clock.paused);
    this.speedButtons.forEach((b, i) =>
      b.classList.toggle('active', SPEEDS[i] === this.clock.speed),
    );
  }
}
