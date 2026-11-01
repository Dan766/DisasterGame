/** Pure audio-mixing maths (kept free of WebAudio so it is unit-testable). */

export const SPEED_OF_SOUND = 343; // m/s

/** Seconds before a boom reaches the listener; capped so far impacts stay playable. */
export function boomDelaySeconds(distanceM: number, maxDelay = 4): number {
  return Math.min(maxDelay, Math.max(0, distanceM) / SPEED_OF_SOUND);
}

/** Boom loudness 0..1 from impact energy (megatons) and distance falloff. */
export function boomGain(megatons: number, distanceM = 0): number {
  const energy = Math.min(1, 0.25 + Math.log10(1 + Math.max(0, megatons)) / 4);
  return energy / (1 + Math.max(0, distanceM) / 4000);
}

/** Fire crackle level 0..1 from the number of burning cells (saturates around 2000). */
export function crackleLevel(burningCells: number): number {
  if (burningCells <= 0) return 0;
  return Math.min(1, Math.log10(1 + burningCells) / Math.log10(2001));
}

/** Wind-roar level 0..1 from the strongest nearby tornado's core radius in cells. */
export function windRoarLevel(radiiCells: readonly number[]): number {
  let r = 0;
  for (const v of radiiCells) r = Math.max(r, v);
  return Math.min(1, r / 7);
}

/** Rumble loudness 0..1 from the number of active earthquakes (saturates at three). */
export function quakeRumbleLevel(quakesActive: number): number {
  if (quakesActive <= 0) return 0;
  return Math.min(1, 0.45 + 0.275 * (quakesActive - 1));
}

/** Sustained camera trauma 0..1 while earthquakes shake; kept below an impact's peak. */
export function quakeShakeTrauma(quakesActive: number): number {
  return quakeRumbleLevel(quakesActive) * 0.5;
}
