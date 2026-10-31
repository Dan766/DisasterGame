/**
 * Turns global sim layers into GPU data textures. Colors are presentation, so
 * they live here, not in sim/.
 */
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type TextureDataType,
  type PixelFormat,
} from 'three';
import { smoothstep } from '../../core/math';
import { Biome, type GlobalWorld } from '../../sim/world';

/** sRGB albedo per biome (index = Biome). Ocean cells use the beach color for soft coasts. */
const BIOME_COLORS = [
  new Color(0xd9c98f), // Ocean → beach sand at the shoreline
  new Color(0xf1f5f9), // Ice
  new Color(0x9aa184), // Tundra
  new Color(0x3d7a3a), // Forest
  new Color(0x92b04f), // Grassland
  new Color(0xe2c47c), // Desert
  new Color(0x2a6b2e), // Jungle
  new Color(0x7e6f62), // Mountain
];
const SNOW = new Color(0xf4f7fb);
const SAND = BIOME_COLORS[Biome.Ocean]!;

export interface SurfaceTextures {
  /** R16F meters. Linear filtering gives smooth coastlines in the shader. */
  elevation: DataTexture;
  /** sRGB land albedo; alpha = sea ice. */
  color: DataTexture;
  /** R8 night-light intensity from population density and damage. */
  lights: DataTexture;
}

export function buildSurfaceTextures(world: GlobalWorld): SurfaceTextures {
  const { width, height } = world;
  const n = width * height;

  const elevation = new Uint16Array(n);
  for (let i = 0; i < n; i++) elevation[i] = DataUtils.toHalfFloat(world.elevation[i]!);

  const color = new Uint8Array(n * 4);
  const lights = new Uint8Array(n);
  const tmp = new Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < n; i++) {
    const b = world.biome[i]!;
    const elev = world.elevation[i]!;
    const temp = world.baseTemp[i]!;
    const isOcean = elev < 0;

    if (isOcean) {
      tmp.copy(SAND);
    } else {
      tmp.copy(BIOME_COLORS[b]!);
      // Drier land fades toward its dusty side, wetter toward darker green.
      tmp.offsetHSL(0, 0, (0.5 - world.moisture[i]!) * 0.08);
      // Beaches on very low coastal land; snowcaps on cold high ground.
      tmp.lerp(SAND, smoothstep(30, 0, elev) * 0.6);
      if (b !== Biome.Ice) tmp.lerp(SNOW, smoothstep(-1, -9, temp) * smoothstep(800, 2500, elev));
    }
    // Color stores linear RGB internally; the texture is sRGB-encoded.
    tmp.getRGB(rgb, SRGBColorSpace);
    color[i * 4] = Math.round(rgb.r * 255);
    color[i * 4 + 1] = Math.round(rgb.g * 255);
    color[i * 4 + 2] = Math.round(rgb.b * 255);
    color[i * 4 + 3] = isOcean && b === Biome.Ice ? 255 : 0;

    const row = Math.floor(i / width);
    const density = world.population[i]! / world.rowAreaKm2[row]!;
    // ~30 people/km² starts to glow; ~1000/km² is fully lit.
    const glow = density > 0 ? smoothstep(1.5, 3, Math.log10(density)) : 0;
    lights[i] = Math.round(glow * (1 - world.damage[i]!) * 255);
  }

  return {
    elevation: makeTexture(elevation, width, height, RedFormat, HalfFloatType),
    color: makeTexture(color, width, height, RGBAFormat, UnsignedByteType, true),
    lights: makeTexture(lights, width, height, RedFormat, UnsignedByteType),
  };
}

function makeTexture(
  data: Uint8Array | Uint16Array,
  width: number,
  height: number,
  format: PixelFormat,
  type: TextureDataType,
  srgb = false,
): DataTexture {
  const tex = new DataTexture(data, width, height, format, type);
  tex.wrapS = RepeatWrapping; // longitude wraps
  tex.wrapT = ClampToEdgeWrapping;
  // No mipmaps: the per-fragment atan2 seam would otherwise pick the smallest mip.
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
