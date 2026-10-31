import { greatCircleDistance, type LatLon } from '../core/geo';
import { BIOME_NAMES, cellAt, type City, type GlobalWorld } from '../sim/world';
import { formatElevation, formatLatLon, formatPopulation } from './format';

const NEAR_CITY_KM = 400;

/** Hover readout for the cell under the cursor. */
export class Tooltip {
  readonly el = document.createElement('div');

  constructor() {
    this.el.className = 'panel tooltip';
    this.el.hidden = true;
  }

  show(world: GlobalWorld, at: LatLon, clientX: number, clientY: number): void {
    const i = cellAt(world, at.lat, at.lon);
    const elevation = world.elevation[i]!;
    const city = nearestCity(world.cities, at);
    const rows = [
      `<div class="tooltip-title">${BIOME_NAMES[world.biome[i]!]}</div>`,
      row('Location', formatLatLon(at.lat, at.lon)),
      row('Elevation', formatElevation(elevation)),
      row(
        'Climate',
        `${world.baseTemp[i]!.toFixed(0)} °C · ${Math.round(world.moisture[i]! * 100)}% wet`,
      ),
    ];
    if (elevation >= 0) rows.push(row('Population', formatPopulation(world.population[i]!)));
    if (city && city.distance < NEAR_CITY_KM) {
      rows.push(
        row(
          city.distance < 60 ? 'City' : 'Near',
          `${city.city.name} (${formatPopulation(city.city.population)})`,
        ),
      );
    }
    this.el.innerHTML = rows.join('');
    this.el.hidden = false;

    // Keep the tooltip on screen.
    const pad = 16;
    const { offsetWidth: w, offsetHeight: h } = this.el;
    const x = clientX + pad + w > window.innerWidth ? clientX - pad - w : clientX + pad;
    const y = clientY + pad + h > window.innerHeight ? clientY - pad - h : clientY + pad;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

function row(label: string, value: string): string {
  return `<div class="tooltip-row"><span>${label}</span><b>${value}</b></div>`;
}

function nearestCity(cities: City[], at: LatLon) {
  let best: { city: City; distance: number } | null = null;
  for (const city of cities) {
    const distance = greatCircleDistance(city, at);
    if (!best || distance < best.distance) best = { city, distance };
  }
  return best;
}
