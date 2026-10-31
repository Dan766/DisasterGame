import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, hashCombine } from '../../core/rng';
import { clamp01 } from '../../core/math';
import { REGION_SIZE, Structure, heightAtCell, type RegionWorld } from '../../sim/region';
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

  show(region: RegionWorld): void {
    this.clear();
    this.region = region;
    const palette = PALETTES[region.centerBiome] ?? PALETTES[Biome.Forest]!;
    this.scene.background = new Color(palette.sky);
    this.scene.fog = new Fog(palette.fog, 160, 520);

    this.group.add(this.buildTerrain(region, palette));
    this.group.add(this.buildWater(region));
    this.buildStructures(region);
    this.buildTrees(region, palette);
  }

  clear(): void {
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.region = null;
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
    const spots: { x: number; z: number; scale: number; tint: number }[] = [];
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
  }
}
