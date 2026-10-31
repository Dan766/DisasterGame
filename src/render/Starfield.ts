import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';
import { latLonToVec3 } from '../core/geo';
import { createRng } from '../core/rng';

/** Static backdrop of stars on a large sphere around the scene. */
export function createStarfield(count = 4000, radius = 80): Points {
  const rng = createRng('stars');
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: latitude from asin of a uniform variable.
    const lat = (Math.asin(rng.float(-1, 1)) * 180) / Math.PI;
    const v = latLonToVec3(lat, rng.float(-180, 180), radius);
    positions.set([v.x, v.y, v.z], i * 3);
    const b = rng.next() ** 3 * 0.8 + 0.15;
    const warm = rng.float(-0.08, 0.08);
    colors.set([b * (1 + warm), b, b * (1 - warm)], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
  });
  return new Points(geometry, material);
}
