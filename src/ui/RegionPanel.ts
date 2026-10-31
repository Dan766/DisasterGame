import { BIOME_NAMES } from '../sim/world';
import type { RegionWorld } from '../sim/region';
import type { WindField } from '../sim/systems/wind';
import { formatLatLon, formatPopulation } from './format';

/** Banner shown while inside a regional view. */
export class RegionPanel {
  readonly el = document.createElement('div');

  private wind: WindField | null = null;

  constructor(onExit: () => void) {
    this.el.className = 'panel region-panel';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) onExit();
    });
    this.el.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (!this.wind || !input.dataset.wind) return;
      const value = Number(input.value);
      if (input.dataset.wind === 'dir') this.wind.fromDeg = value;
      else this.wind.speed = value;
      this.updateWindLabels();
    });
  }

  private updateWindLabels(): void {
    if (!this.wind) return;
    const dir = this.el.querySelector('[data-wind-label="dir"]');
    const spd = this.el.querySelector('[data-wind-label="speed"]');
    if (dir) dir.textContent = `${compass(this.wind.fromDeg)} ${Math.round(this.wind.fromDeg)}°`;
    if (spd) spd.textContent = `${this.wind.speed.toFixed(1)} m/s`;
  }

  /** Shows the panel; `wind` is the live field the sliders edit. */
  show(region: RegionWorld, wind: WindField): void {
    this.wind = wind;
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
      <div class="wind">
        <label>Wind from <b data-wind-label="dir"></b>
          <input type="range" data-wind="dir" min="0" max="359" step="1" value="${Math.round(wind.fromDeg)}" />
        </label>
        <label>Speed <b data-wind-label="speed"></b>
          <input type="range" data-wind="speed" min="0" max="30" step="0.5" value="${wind.speed}" />
        </label>
      </div>
      <div class="hint">Drag to orbit · right-drag to pan · wheel to zoom · click to ignite (or strike / touch down, with Asteroid / Tornado armed)</div>
      <button type="button">Back to globe (Esc)</button>`;
    this.updateWindLabels();
    this.el.hidden = false;
  }

  hide(): void {
    this.wind = null;
    this.el.hidden = true;
  }
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 8-point compass name for a bearing in degrees. */
export function compass(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}
