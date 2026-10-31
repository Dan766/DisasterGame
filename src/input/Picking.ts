import { Raycaster, Sphere, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { latLonToVec3, vec3ToLatLon, type LatLon } from '../core/geo';

export interface GlobePick extends LatLon {
  /** World-space point on the (displaced) surface. */
  point: Vector3;
}

/**
 * Ray → lat/lon on the planet. The first hit is against the unit sphere; it is
 * then refined against a sphere at the local displaced radius, so picks on
 * tall mountains near the limb land where the player clicked.
 */
export class GlobePicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly sphere = new Sphere(new Vector3(), 1);
  private readonly hit = new Vector3();
  private readonly local = new Vector3();

  constructor(
    private readonly globe: Object3D,
    /** Surface radius offset (planet radius = 1) at a point. */
    private readonly radiusOffsetAt: (lat: number, lon: number) => number,
  ) {}

  pick(clientX: number, clientY: number, camera: Camera, dom: HTMLElement): GlobePick | null {
    const rect = dom.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, camera);

    this.globe.updateWorldMatrix(true, false);
    this.sphere.center.setFromMatrixPosition(this.globe.matrixWorld);
    this.sphere.radius = 1;
    let latLon: LatLon | null = null;
    for (let iteration = 0; iteration < 3; iteration++) {
      if (!this.raycaster.ray.intersectSphere(this.sphere, this.hit)) break;
      latLon = vec3ToLatLon(this.globe.worldToLocal(this.local.copy(this.hit)));
      this.sphere.radius = 1 + this.radiusOffsetAt(latLon.lat, latLon.lon);
    }
    if (!latLon) return null;

    const r = 1 + this.radiusOffsetAt(latLon.lat, latLon.lon);
    const v = latLonToVec3(latLon.lat, latLon.lon, r);
    return { ...latLon, point: this.globe.localToWorld(new Vector3(v.x, v.y, v.z)) };
  }
}
