/**
 * Spherical geometry and equirectangular grid helpers.
 *
 * Conventions (shared by sim and renderer):
 * - Latitude in degrees, -90 (south) … +90 (north).
 * - Longitude in degrees, -180 … +180 (wraps).
 * - Cartesian: +Y is north pole, lon 0 / lat 0 is +Z, lon +90 is +X.
 * - Grid row 0 is the northernmost row; column 0 starts at lon -180.
 */

export const PLANET_RADIUS_KM = 6371;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Cell {
  col: number;
  row: number;
}

const DEG = Math.PI / 180;

export const degToRad = (deg: number): number => deg * DEG;
export const radToDeg = (rad: number): number => rad / DEG;

/** Wraps a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function latLonToVec3(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const c = Math.cos(phi);
  return {
    x: radius * c * Math.sin(lambda),
    y: radius * Math.sin(phi),
    z: radius * c * Math.cos(lambda),
  };
}

export function vec3ToLatLon(v: Vec3): LatLon {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r === 0) return { lat: 0, lon: 0 };
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v.y / r))) / DEG,
    lon: Math.atan2(v.x, v.z) / DEG,
  };
}

/** Great-circle distance (haversine) between two points, in the radius' units. */
export function greatCircleDistance(a: LatLon, b: LatLon, radius = PLANET_RADIUS_KM): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Equirectangular cell containing a point. Longitude wraps; latitude clamps. */
export function latLonToCell(lat: number, lon: number, width: number, height: number): Cell {
  const u = (wrapLon(lon) + 180) / 360;
  const v = (90 - lat) / 180;
  return {
    col: Math.min(width - 1, Math.floor(u * width)),
    row: Math.max(0, Math.min(height - 1, Math.floor(v * height))),
  };
}

/** Center of an equirectangular cell. */
export function cellToLatLon(col: number, row: number, width: number, height: number): LatLon {
  return {
    lat: 90 - ((row + 0.5) * 180) / height,
    lon: -180 + ((col + 0.5) * 360) / width,
  };
}
