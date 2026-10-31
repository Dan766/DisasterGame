import { BoxGeometry, type BufferGeometry } from 'three';

/**
 * Unit sphere built by inflating a subdivided cube. Its triangles are far more
 * even than a UV sphere's, and it has no pole pinching (DESIGN.md §6.1).
 */
export function createCubeSphereGeometry(segments: number): BufferGeometry {
  const geometry = new BoxGeometry(2, 2, 2, segments, segments, segments);
  const pos = geometry.attributes.position!;
  const normal = geometry.attributes.normal!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    // Area-preserving-ish cube → sphere mapping.
    const sx = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
    const sy = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
    const sz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
    pos.setXYZ(i, sx, sy, sz);
    normal.setXYZ(i, sx, sy, sz);
  }
  geometry.deleteAttribute('uv');
  geometry.computeBoundingSphere();
  return geometry;
}
