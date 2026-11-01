import { BufferGeometry, Color, InstancedMesh, Material, Matrix4 } from 'three';

/** Pick an LOD level (0 = detailed, 1 = simple) with hysteresis so instances at the border don't flicker. */
export function selectLod(dist2: number, prev: 0 | 1, nearDist: number, hysteresis = 0.1): 0 | 1 {
  const limit = prev === 0 ? nearDist * (1 + hysteresis) : nearDist * (1 - hysteresis);
  return dist2 > limit * limit ? 1 : 0;
}

const ZERO = new Matrix4().makeScale(0, 0, 0);

/**
 * A set of instanced structures drawn with a detailed mesh up close and a cheaper one far away.
 * Authoritative transforms live in `base`; each instance is shown in exactly one of the two meshes
 * (the other gets a zero-scale matrix). A matrix with zero X-scale means "removed".
 */
export class StructureLodSet {
  readonly near: InstancedMesh;
  readonly far: InstancedMesh;
  private readonly base: Float32Array;
  private readonly level: Uint8Array;
  private readonly px: Float32Array;
  private readonly pz: Float32Array;
  private readonly py: Float32Array;

  constructor(
    readonly cells: number[],
    nearGeo: BufferGeometry,
    farGeo: BufferGeometry,
    material: Material,
    private readonly nearDist: number,
  ) {
    const n = cells.length;
    this.near = new InstancedMesh(nearGeo, material, n);
    this.far = new InstancedMesh(farGeo, material, n);
    this.base = new Float32Array(n * 16);
    this.level = new Uint8Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    // Per-frame cull would use the bounding sphere of the initial (identity) matrices otherwise.
    this.near.frustumCulled = false;
    this.far.frustumCulled = false;
    for (let k = 0; k < n; k++) this.far.setMatrixAt(k, ZERO);
  }

  get count(): number {
    return this.cells.length;
  }

  getMatrix(k: number, out: Matrix4): Matrix4 {
    return out.fromArray(this.base, k * 16);
  }

  /** Store the authoritative matrix and show it in whichever mesh the instance's level selects. */
  setMatrix(k: number, m: Matrix4): void {
    m.toArray(this.base, k * 16);
    this.px[k] = m.elements[12]!;
    this.py[k] = m.elements[13]!;
    this.pz[k] = m.elements[14]!;
    this.apply(k);
  }

  setColor(k: number, c: Color): void {
    this.near.setColorAt(k, c);
    this.far.setColorAt(k, c);
  }

  private apply(k: number): void {
    const m = new Matrix4().fromArray(this.base, k * 16);
    const far = this.level[k] === 1;
    this.near.setMatrixAt(k, far ? ZERO : m);
    this.far.setMatrixAt(k, far ? m : ZERO);
  }

  /** Re-evaluate levels for the camera position; returns how many instances switched. */
  updateLod(cx: number, cy: number, cz: number): number {
    let changed = 0;
    for (let k = 0; k < this.cells.length; k++) {
      if (this.base[k * 16]! === 0) continue; // removed
      const dx = this.px[k]! - cx;
      const dy = this.py[k]! - cy;
      const dz = this.pz[k]! - cz;
      const next = selectLod(dx * dx + dy * dy + dz * dz, this.level[k] as 0 | 1, this.nearDist);
      if (next !== this.level[k]) {
        this.level[k] = next;
        this.apply(k);
        changed++;
      }
    }
    if (changed > 0) this.markDirty();
    return changed;
  }

  markDirty(): void {
    this.near.instanceMatrix.needsUpdate = true;
    this.far.instanceMatrix.needsUpdate = true;
    if (this.near.instanceColor) this.near.instanceColor.needsUpdate = true;
    if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
  }

  levelOf(k: number): 0 | 1 {
    return this.level[k] as 0 | 1;
  }
}
