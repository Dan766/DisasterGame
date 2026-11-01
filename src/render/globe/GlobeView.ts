import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
} from 'three';
import { PLANET_RADIUS_KM, latLonToVec3 } from '../../core/geo';
import type { Crater, GlobalWorld } from '../../sim/world';
import { createCubeSphereGeometry } from './cubeSphere';
import atmosphereFrag from './shaders/atmosphere.frag.glsl?raw';
import atmosphereVert from './shaders/atmosphere.vert.glsl?raw';
import globeFrag from './shaders/globe.frag.glsl?raw';
import globeVert from './shaders/globe.vert.glsl?raw';
import {
  buildSurfaceTextures,
  writeAsh,
  writeEffects,
  writeElevation,
  type SurfaceTextures,
} from './surfaceTextures';

/** Vertical exaggeration so mountains read at planet scale. */
export const ELEVATION_EXAGGERATION = 25;
/** Globe radius units per meter of elevation (planet radius = 1). */
export const DISPLACE_SCALE = ELEVATION_EXAGGERATION / (PLANET_RADIUS_KM * 1000);

const ATMOSPHERE_RADIUS = 1.08;
const ATMOSPHERE_COLOR = new Color(0x6fb2ff);
const ASHEN_SKY = new Color(0x8a7a6a);
const MAX_CRATERS = 32; // keep in sync with globe.frag.glsl
const MAX_SHOCKS = 8; // keep in sync with globe.frag.glsl

export interface ShockRing {
  /** Unit direction of the impact in globe space. */
  dir: Vector3;
  radiusKm: number;
  alpha: number;
  /** Cool water-wave styling instead of the fiery blast ring. */
  wave?: boolean;
}

export interface TargetRadiiKm {
  crater: number;
  blast: number;
  thermal: number;
}

/** Renders the planet: displaced surface, atmosphere shell, night lights, disaster layers. */
export class GlobeView {
  readonly root = new Group();
  /** World-space direction toward the sun. */
  readonly sunDir = new Vector3(1, 0.35, 0.6).normalize();

  private textures: SurfaceTextures;
  private readonly surface: Mesh<ReturnType<typeof createCubeSphereGeometry>, ShaderMaterial>;
  private readonly atmosphere: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly atmosphereColor = ATMOSPHERE_COLOR.clone();

  constructor(world: GlobalWorld) {
    this.textures = buildSurfaceTextures(world);

    const surfaceMaterial = new ShaderMaterial({
      vertexShader: globeVert,
      fragmentShader: globeFrag,
      uniforms: {
        uElevation: { value: this.textures.elevation },
        uColor: { value: this.textures.color },
        uLights: { value: this.textures.lights },
        uEffects: { value: this.textures.effects },
        uAsh: { value: this.textures.ash },
        uDisplaceScale: { value: DISPLACE_SCALE },
        uSunDir: { value: this.sunDir },
        uAtmosphereColor: { value: this.atmosphereColor },
        uTime: { value: 0 },
        uLightsScale: { value: 1 },
        uCraters: { value: Array.from({ length: MAX_CRATERS }, () => new Vector4()) },
        uCraterCount: { value: 0 },
        uShocks: { value: Array.from({ length: MAX_SHOCKS }, () => new Vector4()) },
        uShockWave: { value: new Array<number>(MAX_SHOCKS).fill(0) },
        uShockAlpha: { value: new Array<number>(MAX_SHOCKS).fill(0) },
        uTargetOn: { value: 0 },
        uTargetDir: { value: new Vector3(0, 0, 1) },
        uTargetRadii: { value: new Vector3(-1, -1, -1) },
      },
    });
    this.surface = new Mesh(createCubeSphereGeometry(128), surfaceMaterial);
    this.root.add(this.surface);

    const atmosphereMaterial = new ShaderMaterial({
      vertexShader: atmosphereVert,
      fragmentShader: atmosphereFrag,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uColor: { value: this.atmosphereColor },
        uLimbDot: { value: Math.sqrt(1 - 1 / ATMOSPHERE_RADIUS ** 2) },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new Mesh(new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48), atmosphereMaterial);
    this.root.add(this.atmosphere);
  }

  private get uniforms() {
    return this.surface.material.uniforms as Record<string, { value: unknown }>;
  }

  /** Swaps in a newly generated world. */
  setWorld(world: GlobalWorld): void {
    const old = this.textures;
    this.textures = buildSurfaceTextures(world);
    const u = this.uniforms;
    u.uElevation!.value = this.textures.elevation;
    u.uColor!.value = this.textures.color;
    u.uLights!.value = this.textures.lights;
    u.uEffects!.value = this.textures.effects;
    u.uAsh!.value = this.textures.ash;
    this.setCraters([]);
    this.setShocks([]);
    this.setLightsScale(1);
    this.setAshOpacity(0);
    disposeTextures(old);
  }

  /** Re-uploads the layers the sim reports as changed. */
  syncLayers(
    world: GlobalWorld,
    dirty: { terrain: boolean; effects: boolean; ash: boolean },
  ): void {
    if (dirty.terrain) writeElevation(world, this.textures.elevation);
    if (dirty.effects) writeEffects(world, this.textures.effects);
    if (dirty.ash) writeAsh(world, this.textures.ash);
  }

  /** Shows land craters (largest first if there are more than the shader holds). */
  setCraters(craters: readonly Crater[]): void {
    const visible = craters
      .filter((c) => !c.ocean)
      .sort((a, b) => b.radiusKm - a.radiusKm)
      .slice(0, MAX_CRATERS);
    const slots = this.uniforms.uCraters!.value as Vector4[];
    visible.forEach((c, i) => {
      const v = latLonToVec3(c.lat, c.lon);
      slots[i]!.set(v.x, v.y, v.z, c.radiusKm / PLANET_RADIUS_KM);
    });
    this.uniforms.uCraterCount!.value = visible.length;
  }

  setShocks(shocks: readonly ShockRing[]): void {
    const slots = this.uniforms.uShocks!.value as Vector4[];
    const alpha = this.uniforms.uShockAlpha!.value as number[];
    const wave = this.uniforms.uShockWave!.value as number[];
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const s = shocks[i];
      alpha[i] = s ? s.alpha : 0;
      wave[i] = s?.wave ? 1 : 0;
      if (s) slots[i]!.set(s.dir.x, s.dir.y, s.dir.z, s.radiusKm / PLANET_RADIUS_KM);
    }
  }

  /** Targeting overlay at a surface direction, or hidden with `null`. */
  setTarget(dir: Vector3 | null, radii?: TargetRadiiKm): void {
    this.uniforms.uTargetOn!.value = dir && radii ? 1 : 0;
    if (!dir || !radii) return;
    (this.uniforms.uTargetDir!.value as Vector3).copy(dir).normalize();
    (this.uniforms.uTargetRadii!.value as Vector3).set(
      radii.crater > 0 ? radii.crater / PLANET_RADIUS_KM : -1,
      radii.blast > 0 ? radii.blast / PLANET_RADIUS_KM : -1,
      radii.thermal > 0 ? radii.thermal / PLANET_RADIUS_KM : -1,
    );
  }

  /** Dims night lights as the population falls. */
  setLightsScale(scale: number): void {
    this.uniforms.uLightsScale!.value = scale;
  }

  /** Tints the sky from blue toward ash-grey as the global veil thickens. */
  setAshOpacity(opacity: number): void {
    this.atmosphereColor.copy(ATMOSPHERE_COLOR).lerp(ASHEN_SKY, Math.min(1, opacity) * 0.85);
    this.atmosphereColor.multiplyScalar(1 - 0.5 * Math.min(1, opacity));
  }

  update(timeSeconds: number): void {
    this.uniforms.uTime!.value = timeSeconds;
  }

  dispose(): void {
    disposeTextures(this.textures);
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.atmosphere.geometry.dispose();
    this.atmosphere.material.dispose();
  }
}

function disposeTextures(t: SurfaceTextures) {
  for (const tex of Object.values(t)) tex.dispose();
}
