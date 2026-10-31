import { greatCircleDistance, type LatLon } from '../core/geo';
import { Biome, cellAt, type GlobalWorld } from './world';

const NEAR_CITY_KM = 500;

const WILDS: Record<Biome, string> = {
  [Biome.Ocean]: 'the open ocean',
  [Biome.Ice]: 'the ice sheet',
  [Biome.Tundra]: 'the tundra',
  [Biome.Forest]: 'a remote forest',
  [Biome.Grassland]: 'remote grasslands',
  [Biome.Desert]: 'the desert',
  [Biome.Jungle]: 'the jungle',
  [Biome.Mountain]: 'the mountains',
};

/** Human-readable place for event messages: "near Kemhor", "the open ocean", … */
export function describeLocation(world: GlobalWorld, at: LatLon): string {
  let nearest: { name: string; d: number } | null = null;
  for (const city of world.cities) {
    const d = greatCircleDistance(city, at);
    if (!nearest || d < nearest.d) nearest = { name: city.name, d };
  }
  if (nearest && nearest.d < 40) return nearest.name;
  if (nearest && nearest.d < NEAR_CITY_KM) return `near ${nearest.name}`;
  return WILDS[world.biome[cellAt(world, at.lat, at.lon)]! as Biome];
}
