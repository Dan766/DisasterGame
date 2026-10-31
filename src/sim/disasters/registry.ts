import { asteroid } from './asteroid';
import type { DisasterDef } from './types';

/** Every disaster the game knows, in palette order. */
export const DISASTERS: readonly DisasterDef[] = [asteroid];

export function getDisaster(id: string): DisasterDef | undefined {
  return DISASTERS.find((d) => d.id === id);
}
