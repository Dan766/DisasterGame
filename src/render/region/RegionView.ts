import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  LinearFilter,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  RGBAFormat,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, hashCombine } from '../../core/rng';
import { clamp01 } from '../../core/math';
import {
  FireState,
  REGION_SIZE,
  Structure,
  heightAtCell,
  type RegionWorld,
} from '../../sim/region';
import { Biome } from '../../sim/world';

/** World units per cell (100 m). Heights are meters / 100 × VERTICAL_EXAGGERATION. */
const VERTICAL_EXAGGERATION = 1.6;
const METERS_PER_UNIT = 100;
const MAX_TREES = 14000;
const HALF = REGION_SIZE / 2;

interface Palette {
  sky: number;
  fog: number;
  low: number;
  high: number;
  rock: number;
  snow: number;
  tree: number;
  /** Trees per fuel unit (0 = bare). */
  treeDensity: number;
  burnt?: number;
}

const PALETTES: Record<number, Palette> = {
  [Biome.Forest]: {
    sky: 0x9cc7e8,
    fog: 0xb8d4e6,
    low: 0x4f8a3c,
    high: 0x3a6b30,
    rock: 0x6f6a60,
    snow: 0xf2f5f7,
    tree: 0x2b6a2e,
    treeDensity: 0.55,
  },
  [Biome.Jungle]: {
    sky: 0x8fcfd0,
    fog: 0xb0dad0,
    low: 0x2f8a3a,
    high: 0x1f6a2c,
    rock: 0x6a6a5a,
    snow: 0xf2f5f7,
    tree: 0x1f7a34,
    treeDensity: 0.7,
  },
  [Biome.Grassland]: {
    sky: 0x9fcdee,
    fog: 0xc2dcec,
    low: 0x9ab54a,
    high: 0x7d9a3a,
    rock: 0x7a735f,
    snow: 0xf2f5f7,
    tree: 0x4f8a3c,
    treeDensity: 0.07,
  },
  [Biome.Desert]: {
    sky: 0xe8cfa0,
    fog: 0xecd9b4,
    low: 0xd9b36a,
    high: 0xc29250,
    rock: 0x9a7650,
    snow: 0xf2f5f7,
    tree: 0x7a8a4a,
    treeDensity: 0.02,
  },
  [Biome.Tundra]: {
    sky: 0xb5c9d8,
    fog: 0xcfdbe3,
    low: 0x8f9a80,
    high: 0x76806c,
    rock: 0x7d7d78,
    snow: 0xf4f7f9,
    tree: 0x4d6a58,
    treeDensity: 0.05,
  },
  [Biome.Mountain]: {
    sky: 0xa6c3dc,
    fog: 0xc0d2e0,
    low: 0x6f8a54,
    high: 0x7a7468,
    rock: 0x77716a,
    snow: 0xf4f7f9,
    tree: 0x3d6a3a,
    treeDensity: 0.14,
  },
  [Biome.Ice]: {
    sky: 0xc5d9e8,
    fog: 0xdbe8f1,
    low: 0xe3eef5,
    high: 0xd5e3ee,
    rock: 0x9aa7b0,
    snow: 0xffffff,
    tree: 0x4d6a58,
    treeDensity: 0,
  },
  [Biome.Ocean]: {
    sky: 0x9cc7e8,
    fog: 0xb8d4e6,
    low: 0x4f8a3c,
    high: 0x3a6b30,
    rock: 0x6f6a60,
    snow: 0xf2f5f7,
    tree: 0x2b6a2e,
    treeDensity: 0,
  },
};

const ROAD_COLOR = new Color(0x4b4a48);
const FARM_COLORS = [new Color(0xc9b84a), new Color(0x8fae45), new Color(0xb69a4a)];
const SAND_COLOR = new Color(0xd8c690);
const WET_SAND_COLOR = new Color(0xb2a67a);

/** One generated region as a lit, flat-shaded low-poly diorama (own scene). */
export class RegionView {
  readonly scene = new Scene();
  private readonly group = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private region: RegionWorld | null = null;
  private fireTex: DataTexture | null = null;
  private fireData: Uint8Array | null = null;
  /** Cells a tornado has passed over (0..255 scar strength), drawn under the fire colours. */
  private scar: Uint8Array | null = null;
  private trees: { mesh: InstancedMesh; cells: number[]; gone: Uint8Array } | null = null;
  private terrainMesh: Mesh | null = null;
  private waterMesh: Mesh | null = null;
  private fireMesh: Mesh | null = null;
  private structureSets: { mesh: InstancedMesh; cells: number[] }[] = [];
  private readonly charred = new Color(0x2a2220);

  constructor() {
    this.scene.add(this.group);
    this.scene.add(new HemisphereLight(0xdfeeff, 0x6b5b45, 0.9));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xfff2d8, 2.1);
    sun.position.set(-90, 140, 70);
    this.scene.add(sun);
  }

  /** Terrain height in world units at world-space x/z. */
  heightAt(x: number, z: number): number {
    if (!this.region) return 0;
    return (
      (Math.max(0, heightAtCell(this.region, x + HALF - 0.5, z + HALF - 0.5)) / METERS_PER_UNIT) *
      VERTICAL_EXAGGERATION
    );
  }

  /** Terrain-or-water surface height at the region center, in world units. */
  get centerHeight(): number {
    return this.heightAt(0, 0);
  }

  /** Half the region edge in world units. */
  readonly halfExtent = HALF;

  /**
   * Ray-marches a world-space ray onto the terrain and returns the (fractional) cell it
   * lands on, or null if it misses the region. Cell coords match `heightAtCell`.
   */
  pickCell(origin: Vector3, dir: Vector3): { col: number; row: number } | null {
    if (!this.region) return null;
    const STEP = 1;
    const MAX_DIST = 4000;
    let prevT = 0;
    for (let t = 0; t < MAX_DIST; t += STEP) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (Math.abs(x) > HALF || Math.abs(z) > HALF) {
        if (t > 0 && dir.y >= 0) return null;
        prevT = t;
        continue;
      }
      if (y <= this.heightAt(x, z)) {
        // Refine between the last outside sample and this one.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const inside =
            origin.y + dir.y * mid <= this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (inside) hi = mid;
          else lo = mid;
        }
        const hx = origin.x + dir.x * hi;
        const hz = origin.z + dir.z * hi;
        return { col: hx + HALF - 0.5, row: hz + HALF - 0.5 };
      }
      prevT = t;
    }
    return null;
  }

  show(region: RegionWorld): void {
    this.clear();
    this.region = region;
    const palette = PALETTES[region.centerBiome] ?? PALETTES[Biome.Forest]!;
    this.scene.background = new Color(palette.sky);
    this.scene.fog = new Fog(palette.fog, 160, 520);

    this.terrainMesh = this.buildTerrain(region, palette);
    this.waterMesh = this.buildWater(region);
    this.group.add(this.terrainMesh);
    this.group.add(this.waterMesh);
    this.buildStructures(region);
    this.buildTrees(region, palette);
    this.buildFireOverlay(region);
  }

  /**
   * Syncs the burn overlay and tree instances with the fire state: burning cells flicker
   * orange, burnt cells turn charcoal, and trees on burnt cells are removed.
   */
  updateFire(region: RegionWorld, timeSec: number): void {
    const tex = this.fireTex;
    const data = this.fireData;
    if (!tex || !data || this.region !== region) return;
    const n = REGION_SIZE;
    for (let row = 0; row < n; row++) {
      const out = (n - 1 - row) * n; // texture row 0 is the south edge
      for (let col = 0; col < n; col++) {
        const i = row * n + col;
        const o = (out + col) * 4;
        const st = region.fireState[i];
        if (st === FireState.Burning) {
          const flicker = 0.5 + 0.5 * Math.sin(timeSec * 9 + col * 1.7 + row * 2.3);
          data[o] = 255;
          data[o + 1] = 90 + flicker * 110;
          data[o + 2] = 10;
          data[o + 3] = 215;
        } else if (st === FireState.Burnt) {
          data[o] = 28;
          data[o + 1] = 24;
          data[o + 2] = 22;
          data[o + 3] = 190;
        } else if (this.scar && this.scar[i]! > 0) {
          // Tornado damage path: torn-up earth, a brown swath through the vegetation.
          data[o] = 74;
          data[o + 1] = 58;
          data[o + 2] = 42;
          data[o + 3] = this.scar[i]!;
        } else {
          data[o + 3] = 0;
        }
      }
    }
    tex.needsUpdate = true;

    const trees = this.trees;
    if (trees) {
      const m = new Matrix4();
      let colorsDirty = false;
      let matsDirty = false;
      for (let k = 0; k < trees.cells.length; k++) {
        const st = region.fireState[trees.cells[k]!];
        const prev = trees.gone[k]!;
        const next = st === FireState.Burnt ? 2 : st === FireState.Burning ? 1 : 0;
        if (next === prev) continue;
        trees.gone[k] = next;
        if (next === 2) {
          trees.mesh.setMatrixAt(k, m.makeScale(0, 0, 0));
          matsDirty = true;
        } else {
          trees.mesh.setColorAt(k, this.charred);
          colorsDirty = true;
        }
      }
      if (matsDirty) trees.mesh.instanceMatrix.needsUpdate = true;
      if (colorsDirty && trees.mesh.instanceColor) trees.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Marks the ground under a tornado's core as scarred (call each frame with its position).
   * Takes effect on the next `updateFire`.
   */
  markScar(col: number, row: number, radiusCells: number): void {
    const n = REGION_SIZE;
    if (!this.scar) this.scar = new Uint8Array(n * n);
    const r = Math.max(1, radiusCells);
    const c0 = Math.max(0, Math.floor(col - r));
    const c1 = Math.min(n - 1, Math.ceil(col + r));
    const r0 = Math.max(0, Math.floor(row - r));
    const r1 = Math.min(n - 1, Math.ceil(row + r));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d = Math.hypot(x - col, y - row) / r;
        if (d > 1) continue;
        const v = Math.round(190 * (1 - d * d * 0.6));
        const i = y * n + x;
        if (v > this.scar[i]!) this.scar[i] = v;
      }
    }
  }

  private buildFireOverlay(region: RegionWorld): void {
    const n = REGION_SIZE;
    this.scar = null;
    const data = new Uint8Array(n * n * 4);
    const tex = this.track(new DataTexture(data, n, n, RGBAFormat));
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    const geometry = this.track(new PlaneGeometry(n - 1, n - 1, n - 1, n - 1));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < n * n; i++) {
      positions.setY(
        i,
        (Math.max(region.height[i]!, -40) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION + 0.03,
      );
    }
    const material = this.track(
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.fireMesh = mesh;
    this.fireTex = tex;
    this.fireData = data;
  }

  clear(): void {
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.region = null;
    this.fireTex = null;
    this.fireData = null;
    this.scar = null;
    this.trees = null;
    this.terrainMesh = null;
    this.waterMesh = null;
    this.fireMesh = null;
    this.structureSets = [];
  }

  /**
   * Re-meshes the terrain after the sim edited `height` (a crater): updates vertex heights,
   * normals and the water/fire-overlay surfaces, scorches the ground around `scorch`, and
   * re-seats or removes the trees and structures standing on changed ground.
   */
  remeshTerrain(
    region: RegionWorld,
    scorch?: { col: number; row: number; radiusCells: number },
  ): void {
    if (this.region !== region || !this.terrainMesh) return;
    const n = REGION_SIZE;
    const terrain = this.terrainMesh.geometry;
    const tp = terrain.getAttribute('position') as BufferAttribute;
    const colors = terrain.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < n * n; i++) {
      tp.setY(i, (Math.max(region.height[i]!, -40) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION);
    }
    if (scorch) {
      const reach = scorch.radiusCells * 2.2;
      const r0 = Math.ceil(reach);
      const c = new Color();
      for (
        let row = Math.max(0, Math.round(scorch.row) - r0);
        row <= Math.min(n - 1, Math.round(scorch.row) + r0);
        row++
      ) {
        for (
          let col = Math.max(0, Math.round(scorch.col) - r0);
          col <= Math.min(n - 1, Math.round(scorch.col) + r0);
          col++
        ) {
          const d = Math.hypot(col - scorch.col, row - scorch.row);
          if (d > reach) continue;
          const i = row * n + col;
          const k = clamp01(1.15 - d / reach) * 0.85;
          c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i)).lerp(this.charred, k);
          colors.setXYZ(i, c.r, c.g, c.b);
        }
      }
      colors.needsUpdate = true;
    }
    tp.needsUpdate = true;
    terrain.computeVertexNormals();

    if (this.waterMesh) {
      const wp = this.waterMesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < n * n; i++) {
        const depth = region.water[i]!;
        const surface =
          depth > 0.05 ? Math.max(region.height[i]!, 0) + depth : region.height[i]! - 6;
        wp.setY(i, (Math.max(surface, -80) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION);
      }
      wp.needsUpdate = true;
      this.waterMesh.geometry.computeVertexNormals();
    }
    if (this.fireMesh) {
      const fp = this.fireMesh.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < n * n; i++) {
        fp.setY(
          i,
          (Math.max(region.height[i]!, -40) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION + 0.03,
        );
      }
      fp.needsUpdate = true;
    }

    // Structures: re-seat on the new ground, hide anything the sim removed.
    const m = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    for (const set of this.structureSets) {
      for (let k = 0; k < set.cells.length; k++) {
        const cell = set.cells[k]!;
        set.mesh.getMatrixAt(k, m);
        m.decompose(pos, quat, scale);
        if (scale.x === 0) continue;
        if (region.structHP[cell]! <= 0 || region.structure[cell] === Structure.None) {
          m.makeScale(0, 0, 0);
        } else {
          pos.y = this.heightAt(pos.x, pos.z);
          m.compose(pos, quat, scale);
        }
        set.mesh.setMatrixAt(k, m);
      }
      set.mesh.instanceMatrix.needsUpdate = true;
    }
    // Trees: cleared ground (fuel erased without burning) loses its trees.
    const trees = this.trees;
    if (trees) {
      for (let k = 0; k < trees.cells.length; k++) {
        const cell = trees.cells[k]!;
        if (trees.gone[k] === 2) continue;
        trees.mesh.getMatrixAt(k, m);
        m.decompose(pos, quat, scale);
        if (region.fuel[cell]! <= 0 && region.fireState[cell] === FireState.Unburnt) {
          trees.gone[k] = 2;
          m.makeScale(0, 0, 0);
        } else {
          pos.y = this.heightAt(pos.x, pos.z);
          m.compose(pos, quat, scale);
        }
        trees.mesh.setMatrixAt(k, m);
      }
      trees.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildTerrain(region: RegionWorld, palette: Palette): Mesh {
    const n = REGION_SIZE;
    const geometry = this.track(new PlaneGeometry(n - 1, n - 1, n - 1, n - 1));
    geometry.rotateX(-Math.PI / 2); // x east, z south
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const colors = new Float32Array(positions.count * 3);

    const high = new Color(palette.high);
    const rock = new Color(palette.rock);
    const snow = new Color(palette.snow);
    const tmp = new Color();
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const i = row * n + col; // PlaneGeometry vertex order matches row-major (row 0 = north)
        const h = region.height[i]!;
        positions.setY(i, (Math.max(h, -40) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION);

        const left = region.height[row * n + Math.max(0, col - 1)]!;
        const right = region.height[row * n + Math.min(n - 1, col + 1)]!;
        const up = region.height[Math.max(0, row - 1) * n + col]!;
        const down = region.height[Math.min(n - 1, row + 1) * n + col]!;
        const steep = clamp01((Math.hypot(right - left, down - up) / 200 - 0.25) * 2.2);

        const biomeLocal = PALETTES[region.biome[i]!] ?? palette;
        tmp.set(biomeLocal.low).lerp(high.set(biomeLocal.high), clamp01(h / 1500));
        tmp.lerp(rock.set(biomeLocal.rock), steep);
        const snowLine = region.biome[i] === Biome.Mountain ? 3600 : 5200;
        if (h > snowLine || region.biome[i] === Biome.Ice) {
          tmp.lerp(
            snow.set(biomeLocal.snow),
            clamp01((h - snowLine) / 500 + 0.6) * (1 - steep * 0.5),
          );
        }
        // Beaches and lake beds.
        if (h < 6 && h > -40) tmp.lerp(h < 1.5 ? WET_SAND_COLOR : SAND_COLOR, clamp01(0.9 - h / 8));
        if (h <= 0) tmp.lerp(WET_SAND_COLOR, 0.8);

        const s = region.structure[i];
        if (s === Structure.Road) tmp.lerp(ROAD_COLOR, 0.9);
        else if (s === Structure.Farm) tmp.lerp(FARM_COLORS[(col * 7 + row * 13) % 3]!, 0.85);
        else if (s === Structure.House || s === Structure.Tower) tmp.lerp(new Color(0x77806a), 0.5);
        // Break up flat color a little.
        const jitter = 0.96 + (0.08 * (((col * 73856093) ^ (row * 19349663)) % 100)) / 100;
        colors[i * 3] = tmp.r * jitter;
        colors[i * 3 + 1] = tmp.g * jitter;
        colors[i * 3 + 2] = tmp.b * jitter;
      }
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    return new Mesh(geometry, material);
  }

  private buildWater(region: RegionWorld): Mesh {
    const n = REGION_SIZE;
    const geometry = this.track(new PlaneGeometry(n - 1, n - 1, n - 1, n - 1));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < n * n; i++) {
      const depth = region.water[i]!;
      // Dry cells sink below the terrain so only wet cells show.
      const surface = depth > 0.05 ? Math.max(region.height[i]!, 0) + depth : region.height[i]! - 6;
      positions.setY(i, (Math.max(surface, -80) / METERS_PER_UNIT) * VERTICAL_EXAGGERATION);
    }
    geometry.computeVertexNormals();
    const material = this.track(
      new MeshPhongMaterial({
        color: 0x2f7fb8,
        specular: 0xaed6f0,
        shininess: 60,
        transparent: true,
        opacity: 0.82,
        flatShading: true,
        side: DoubleSide,
      }),
    );
    return new Mesh(geometry, material);
  }

  private buildStructures(region: RegionWorld): void {
    const houseGeo = this.track(
      mergeGeometries([
        new BoxGeometry(0.62, 0.42, 0.62).translate(0, 0.21, 0),
        new ConeGeometry(0.55, 0.38, 4).rotateY(Math.PI / 4).translate(0, 0.61, 0),
      ])!,
    );
    const towerGeo = this.track(new BoxGeometry(0.8, 4, 0.8).translate(0, 2, 0));
    const houses: number[] = [];
    const towers: number[] = [];
    for (let i = 0; i < region.structure.length; i++) {
      if (region.structHP[i]! <= 0) continue;
      if (region.structure[i] === Structure.House) houses.push(i);
      else if (region.structure[i] === Structure.Tower) towers.push(i);
    }
    const rng = createRng(hashCombine(region.seed, 77));
    const place = (cells: number[], geometry: BufferGeometry, palette: number[], tall: number) => {
      if (cells.length === 0) return;
      const material = this.track(new MeshLambertMaterial({ flatShading: true }));
      const mesh = new InstancedMesh(geometry, material, cells.length);
      const m = new Matrix4();
      const q = new Quaternion();
      const color = new Color();
      cells.forEach((cell, k) => {
        const col = cell % REGION_SIZE;
        const row = Math.floor(cell / REGION_SIZE);
        const x = col - HALF + 0.5;
        const z = row - HALF + 0.5;
        q.setFromAxisAngle(
          new Vector3(0, 1, 0),
          (rng.int(0, 3) * Math.PI) / 2 + rng.float(-0.1, 0.1),
        );
        m.compose(
          new Vector3(x, this.heightAt(x, z), z),
          q,
          new Vector3(1, tall * rng.float(0.85, 1.3), 1),
        );
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, color.set(rng.pick(palette)));
      });
      this.track({ dispose: () => mesh.dispose() });
      this.group.add(mesh);
      this.structureSets.push({ mesh, cells });
    };
    place(houses, houseGeo, [0xe8dcc6, 0xd9a58a, 0xc7d2d8, 0xe6c88f, 0xb78b6e], 1);
    place(towers, towerGeo, [0x9fb0bd, 0xb6bcc2, 0x8c9aa6], 1.6);
  }

  private buildTrees(region: RegionWorld, palette: Palette): void {
    if (palette.treeDensity <= 0) return;
    const rng = createRng(hashCombine(region.seed, 91));
    const treeGeo = this.track(
      mergeGeometries([
        new CylinderGeometry(0.06, 0.09, 0.3, 5).translate(0, 0.15, 0),
        new ConeGeometry(0.34, 0.9, 6).translate(0, 0.72, 0),
        new ConeGeometry(0.26, 0.7, 6).translate(0, 1.15, 0),
      ])!,
    );
    const spots: { x: number; z: number; scale: number; tint: number; cell: number }[] = [];
    for (let i = 0; i < region.fuel.length && spots.length < MAX_TREES; i++) {
      if (region.structure[i] !== Structure.None || region.water[i]! > 0.05) continue;
      const h = region.height[i]!;
      const biome = region.biome[i]!;
      if (h < 3 || biome === Biome.Ice || biome === Biome.Ocean) continue;
      if (biome === Biome.Mountain && h > 2800) continue;
      const density = (PALETTES[biome] ?? palette).treeDensity;
      const trees = region.fuel[i]! * density * (biome === Biome.Jungle ? 3 : 2);
      const count = Math.floor(trees) + (rng.chance(trees - Math.floor(trees)) ? 1 : 0);
      const col = i % REGION_SIZE;
      const row = Math.floor(i / REGION_SIZE);
      for (let k = 0; k < count && spots.length < MAX_TREES; k++) {
        spots.push({
          x: col - HALF + rng.float(0.05, 0.95),
          z: row - HALF + rng.float(0.05, 0.95),
          scale: rng.float(0.7, 1.5),
          tint: rng.float(-0.04, 0.12),
          cell: i,
        });
      }
    }
    if (spots.length === 0) return;
    const material = this.track(new MeshLambertMaterial({ flatShading: true }));
    const mesh = new InstancedMesh(treeGeo, material, spots.length);
    const m = new Matrix4();
    const base = new Color(palette.tree);
    const color = new Color();
    spots.forEach((s, k) => {
      m.makeScale(s.scale, s.scale, s.scale).setPosition(s.x, this.heightAt(s.x, s.z), s.z);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, color.copy(base).offsetHSL(0, 0, s.tint));
    });
    this.track({ dispose: () => mesh.dispose() });
    this.group.add(mesh);
    this.trees = {
      mesh,
      cells: spots.map((s) => s.cell),
      gone: new Uint8Array(spots.length),
    };
  }
}
