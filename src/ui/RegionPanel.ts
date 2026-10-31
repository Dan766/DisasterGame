import { BIOME_NAMES } from '../sim/world';
import type { RegionWorld } from '../sim/region';
import { formatLatLon, formatPopulation } from './format';

/** Banner shown while inside a regional view. */
export class RegionPanel {
  readonly el = document.createElement('div');

  constructor(onExit: () => void) {
    this.el.className = 'panel region-panel';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) onExit();
    });
  }

  show(region: RegionWorld): void {
    const biomes = new Array<number>(BIOME_NAMES.length).fill(0);
    for (const b of region.biome) biomes[b]!++;
    const dominant = biomes.indexOf(Math.max(...biomes));
    const largest = [...region.towns].sort((a, b) => b.population - a.population)[0];
    const people = region.towns.reduce((sum, t) => sum + t.population, 0);
    this.el.innerHTML = `
      <h2>Regional view</h2>
      <div class="stat"><span>Location</span><b>${formatLatLon(region.lat, region.lon)}</b></div>
      <div class="stat"><span>Terrain</span><b>${BIOME_NAMES[dominant]}</b></div>
      <div class="stat"><span>Settlements</span><b>${
        largest ? `${region.towns.length} · ${largest.name}` : 'none'
      }</b></div>
      <div class="stat"><span>Population</span><b>${formatPopulation(people)}</b></div>
      <div class="hint">Drag to orbit · right-drag to pan · wheel to zoom · click to ignite (or strike, with Asteroid armed)</div>
      <button type="button">Back to globe (Esc)</button>`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
