/** Sampling helpers for equirectangular grids (see geo.ts for conventions). */
import { wrapLon } from './geo';

/**
 * Bilinear sample of an equirectangular layer at a lat/lon. Samples are
 * treated as cell centers; longitude wraps, latitude clamps at the poles.
 */
export function sampleBilinear(
  data: ArrayLike<number>,
  width: number,
  height: number,
  lat: number,
  lon: number,
): number {
  const x = ((wrapLon(lon) + 180) / 360) * width - 0.5;
  const y = Math.max(0, Math.min(height - 1, ((90 - lat) / 180) * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const c0 = ((x0 % width) + width) % width;
  const c1 = (c0 + 1) % width;
  const r0 = y0;
  const r1 = Math.min(height - 1, y0 + 1);
  const top = data[r0 * width + c0]! * (1 - fx) + data[r0 * width + c1]! * fx;
  const bottom = data[r1 * width + c0]! * (1 - fx) + data[r1 * width + c1]! * fx;
  return top * (1 - fy) + bottom * fy;
}
