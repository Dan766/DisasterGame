import { describe, expect, it } from 'vitest';
import {
  PLANET_RADIUS_KM,
  cellToLatLon,
  greatCircleDistance,
  latLonToCell,
  latLonToVec3,
  vec3ToLatLon,
  wrapLon,
} from '../src/core/geo';

describe('lat/lon ↔ vec3', () => {
  it('follows the axis conventions', () => {
    const north = latLonToVec3(90, 0);
    expect(north.y).toBeCloseTo(1);
    const origin = latLonToVec3(0, 0);
    expect(origin.z).toBeCloseTo(1);
    const east = latLonToVec3(0, 90);
    expect(east.x).toBeCloseTo(1);
  });

  it('round-trips', () => {
    for (const [lat, lon] of [
      [0, 0],
      [45, 120],
      [-33.9, -70.6],
      [89, 179],
      [-60, -179.5],
    ] as const) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon, 3.5));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('greatCircleDistance', () => {
  it('measures quarter and half circumferences', () => {
    const quarter = (Math.PI / 2) * PLANET_RADIUS_KM;
    expect(greatCircleDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(quarter, 6);
    expect(greatCircleDistance({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(quarter, 6);
    expect(greatCircleDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
      2 * quarter,
      6,
    );
  });

  it('handles the antimeridian', () => {
    const d = greatCircleDistance({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 });
    expect(d).toBeCloseTo((Math.PI / 180) * PLANET_RADIUS_KM, 6);
  });
});

describe('equirectangular cells', () => {
  const W = 512;
  const H = 256;

  it('wraps longitude', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-190)).toBeCloseTo(170);
    expect(wrapLon(180)).toBeCloseTo(-180);
    expect(wrapLon(45)).toBeCloseTo(45);
  });

  it('maps corners and clamps poles', () => {
    expect(latLonToCell(90, -180, W, H)).toEqual({ col: 0, row: 0 });
    expect(latLonToCell(-90, 179.999, W, H)).toEqual({ col: W - 1, row: H - 1 });
    expect(latLonToCell(0, 540, W, H).col).toBe(latLonToCell(0, 180, W, H).col);
  });

  it('cell centers round-trip to the same cell', () => {
    for (const [col, row] of [
      [0, 0],
      [255, 128],
      [511, 255],
      [100, 37],
    ] as const) {
      const { lat, lon } = cellToLatLon(col, row, W, H);
      expect(latLonToCell(lat, lon, W, H)).toEqual({ col, row });
    }
  });
});
