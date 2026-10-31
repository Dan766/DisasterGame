import { livingPopulation, type GlobalWorld } from '../sim/world';
import { formatPopulation, formatTempAnomaly, formatUSD } from './format';

/** Top-right readout of the planet's condition. */
export class StatsPanel {
  readonly el = document.createElement('div');
  private readonly values: Record<string, HTMLElement> = {};

  constructor() {
    this.el.className = 'panel stats-panel';
    const rows: [string, string][] = [
      ['population', 'Population'],
      ['casualties', 'Casualties'],
      ['damage', 'Damage'],
      ['temp', 'Global temp'],
      ['sky', 'Sunlight blocked'],
      ['craters', 'Craters'],
    ];
    this.el.innerHTML = `<h2>Planet status</h2>${rows
      .map(
        ([key, label]) => `<div class="stat"><span>${label}</span><b data-key="${key}">–</b></div>`,
      )
      .join('')}`;
    for (const [key] of rows) this.values[key] = this.el.querySelector(`[data-key="${key}"]`)!;
  }

  update(world: GlobalWorld, skyOpacity: number): void {
    const s = world.stats;
    this.values.population!.textContent = formatPopulation(livingPopulation(world));
    this.values.casualties!.textContent = formatPopulation(s.casualties);
    this.values.damage!.textContent = formatUSD(s.damageUSD);
    this.values.temp!.textContent = formatTempAnomaly(s.globalTempAnomaly);
    this.values.temp!.classList.toggle('cold', s.globalTempAnomaly < -0.5);
    this.values.sky!.textContent = `${Math.round(skyOpacity * 100)}%`;
    this.values.craters!.textContent = String(world.craters.length);
    this.values.casualties!.classList.toggle('alarm', s.casualties > 0);
  }
}
