import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { PLANET_RADIUS_KM } from '../../core/geo';
import type { GlobalWorld } from '../../sim/world';
import { createCubeSphereGeometry } from './cubeSphere';
import atmosphereFrag from './shaders/atmosphere.frag.glsl?raw';
import atmosphereVert from './shaders/atmosphere.vert.glsl?raw';
import globeFrag from './shaders/globe.frag.glsl?raw';
import globeVert from './shaders/globe.vert.glsl?raw';
import { buildSurfaceTextures, type SurfaceTextures } from './surfaceTextures';

/** Vertical exaggeration so mountains read at planet scale. */
export const ELEVATION_EXAGGERATION = 25;
/** Globe radius units per meter of elevation (planet radius = 1). */
export const DISPLACE_SCALE = ELEVATION_EXAGGERATION / (PLANET_RADIUS_KM * 1000);

const ATMOSPHERE_RADIUS = 1.08;
const ATMOSPHERE_COLOR = new Color(0x6fb2ff);

/** Renders the planet: displaced surface, atmosphere shell, night lights (DESIGN.md §6.1). */
export class GlobeView {
  readonly root = new Group();
  /** World-space direction toward the sun. */
  readonly sunDir = new Vector3(1, 0.35, 0.6).normalize();

  private textures: SurfaceTextures;
  private readonly surface: Mesh<ReturnType<typeof createCubeSphereGeometry>, ShaderMaterial>;
  private readonly atmosphere: Mesh<SphereGeometry, ShaderMaterial>;

  constructor(world: GlobalWorld) {
    this.textures = buildSurfaceTextures(world);

    const surfaceMaterial = new ShaderMaterial({
      vertexShader: globeVert,
      fragmentShader: globeFrag,
      uniforms: {
        uElevation: { value: this.textures.elevation },
        uColor: { value: this.textures.color },
        uLights: { value: this.textures.lights },
        uDisplaceScale: { value: DISPLACE_SCALE },
        uSunDir: { value: this.sunDir },
        uAtmosphereColor: { value: ATMOSPHERE_COLOR },
      },
    });
    this.surface = new Mesh(createCubeSphereGeometry(128), surfaceMaterial);
    this.root.add(this.surface);

    const atmosphereMaterial = new ShaderMaterial({
      vertexShader: atmosphereVert,
      fragmentShader: atmosphereFrag,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uColor: { value: ATMOSPHERE_COLOR },
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

  /** Swaps in a newly generated world. */
  setWorld(world: GlobalWorld): void {
    const old = this.textures;
    this.textures = buildSurfaceTextures(world);
    const u = this.surface.material.uniforms;
    u.uElevation!.value = this.textures.elevation;
    u.uColor!.value = this.textures.color;
    u.uLights!.value = this.textures.lights;
    disposeTextures(old);
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
  t.elevation.dispose();
  t.color.dispose();
  t.lights.dispose();
}
