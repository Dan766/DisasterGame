import type { SimEvent } from '../sim/GlobeSim';
import { formatPopulation, formatSimDate, formatUSD } from './format';
import { formatMegatons } from '../sim/disasters/asteroid';

const MAX_ENTRIES = 6;

/** Bottom-right feed of what just happened, newest first. */
export class EventLog {
  readonly el = document.createElement('div');

  constructor() {
    this.el.className = 'panel event-log';
    this.el.hidden = true;
  }

  add(event: SimEvent): void {
    const entry = document.createElement('div');
    entry.className = 'event';
    const extra = event.ocean ? ' · ocean strike' : event.airburst ? ' · airburst' : '';
    entry.innerHTML = `
      <div class="event-meta">${formatSimDate(event.day)} · ${formatMegatons(event.megatons)}${extra}</div>
      <div class="event-title"></div>
      <div class="event-toll"><b>${formatPopulation(event.deaths)}</b> dead · ${formatUSD(event.damageUSD)} damage</div>`;
    // Titles include generated place names; set as text, not HTML.
    entry.querySelector('.event-title')!.textContent = event.title;
    this.el.prepend(entry);
    while (this.el.children.length > MAX_ENTRIES) this.el.lastElementChild!.remove();
    this.el.hidden = false;
  }

  clear(): void {
    this.el.innerHTML = '';
    this.el.hidden = true;
  }
}
