// Planet surface: smooth coastlines from filtered elevation, flat-shaded low-poly land,
// glossy ocean with shelf gradient, sea ice, night-side city lights, limb haze —
// plus disaster layers: scorched land, wildfires, the ash veil, craters, shockwave
// rings and the targeting overlay. Everything that marks a place on the planet is
// drawn here per fragment, so it hugs the displaced terrain at any size.
//
// Direction uniforms are in globe object space; GlobeView's root is never rotated
// (the camera orbits instead), so object space doubles as world space for lighting.

uniform sampler2D uElevation;
uniform sampler2D uColor;   // sRGB land albedo, alpha = sea ice
uniform sampler2D uLights;  // night-light intensity
uniform sampler2D uEffects; // R = damage, G = fire
uniform sampler2D uAsh;     // ash veil opacity (coarse grid)
uniform vec3 uSunDir;       // world space, normalized
uniform vec3 uAtmosphereColor;
uniform float uTime;
uniform float uLightsScale; // share of the population still alive

#define MAX_CRATERS 32
uniform vec4 uCraters[MAX_CRATERS]; // xyz = center dir, w = angular radius
uniform int uCraterCount;

#define MAX_SHOCKS 8
uniform vec4 uShocks[MAX_SHOCKS]; // xyz = center dir, w = angular radius
uniform float uShockAlpha[MAX_SHOCKS];
uniform float uShockWave[MAX_SHOCKS]; // 1 = tsunami front (cool tint)

uniform float uTargetOn;
uniform vec3 uTargetDir;
uniform vec3 uTargetRadii; // angular radii: crater, blast, thermal (< 0 = none)

varying vec3 vDir;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

#define PI 3.141592653589793

vec2 dirToUv(vec3 d) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(d.x, d.z);
  return vec2((lon + PI) / (2.0 * PI), 0.5 - lat / PI);
}

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

// Dave Hoskins' hash without sine: stable across GPUs.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Great-circle angle between unit vectors; chord-based for precision at tiny angles.
float angDist(vec3 a, vec3 b) {
  return 2.0 * asin(min(length(a - b) * 0.5, 1.0));
}

// Sparse point lights on a lattice: one round dot per lattice cell that passes the
// density test, so they stay crisp points at any zoom instead of blocky squares.
// Returns dot coverage; `seed` receives the cell's random value.
float latticeDots(vec2 uv, vec2 res, float density, float salt, out float seed) {
  vec2 p = uv * res;
  vec2 cell = floor(p);
  seed = hash12(cell + salt);
  float on = step(1.0 - density, seed);
  vec2 offset = vec2(hash12(cell + salt + 7.1), hash12(cell + salt + 3.7)) * 0.5 + 0.25;
  float d = length(fract(p) - offset);
  float radius = 0.18 + 0.12 * density;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.75;
  return on * (1.0 - smoothstep(radius - aa, radius + aa, d));
}

// 1 on a ring of the given radius, `w` wide, anti-aliased by `aa`.
float ringLine(float d, float radius, float w, float aa) {
  return 1.0 - smoothstep(w, w + aa, abs(d - radius));
}

void main() {
  vec3 dir = normalize(vDir);
  vec2 uv = dirToUv(dir);
  float pxAng = max(length(fwidth(dir)), 1e-6); // angle covered by one pixel

  float elevation = texture2D(uElevation, uv).r;
  vec4 surface = texture2D(uColor, uv);

  vec3 sphereN = normalize(vWorldNormal);
  vec3 facetN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (dot(facetN, sphereN) < 0.0) facetN = -facetN;

  // Anti-aliased land mask from the bilinearly filtered elevation.
  float aa = max(fwidth(elevation), 1.0);
  float land = smoothstep(-aa, aa, elevation);

  // Ocean: bright shelves near coasts fading to deep blue, plus sea ice.
  float depth = max(-elevation, 0.0);
  vec3 shallow = srgbToLinear(vec3(0.20, 0.62, 0.68));
  vec3 deep = srgbToLinear(vec3(0.03, 0.13, 0.32));
  vec3 ocean = mix(shallow, deep, smoothstep(0.0, 1400.0, depth));
  float seaIce = surface.a;
  ocean = mix(ocean, srgbToLinear(vec3(0.93, 0.96, 0.98)), seaIce);

  vec3 albedo = mix(ocean, surface.rgb, land);
  vec3 N = normalize(mix(sphereN, facetN, land));

  // Scorched, flattened land.
  vec4 fx = texture2D(uEffects, uv);
  float damage = fx.r * land;
  float fire = fx.g * land;
  albedo = mix(albedo, srgbToLinear(vec3(0.21, 0.18, 0.16)), damage * 0.75);

  // Craters: dark bowl with a sun-facing inner wall, bright rim, grey ejecta blanket.
  float bowl = 0.0;
  float rim = 0.0;
  float ejecta = 0.0;
  vec3 tilt = vec3(0.0);
  for (int i = 0; i < MAX_CRATERS; i++) {
    if (i >= uCraterCount) break;
    vec4 c = uCraters[i];
    float r = max(c.w, pxAng * 1.5); // always at least a visible dot
    float x = angDist(dir, c.xyz) / r;
    if (x > 2.6) continue;
    vec3 outward = dir - c.xyz * dot(dir, c.xyz);
    float len = length(outward);
    outward = len > 1e-9 ? outward / len : vec3(0.0);
    float inBowl = 1.0 - smoothstep(0.85, 1.0, x);
    float onRim = exp(-pow((x - 1.0) / 0.12, 2.0));
    bowl = max(bowl, inBowl);
    rim = max(rim, onRim);
    ejecta = max(ejecta, (1.0 - smoothstep(1.0, 2.6, x)) * step(1.0, x));
    tilt += -outward * 0.8 * x * inBowl + outward * 0.35 * onRim;
  }
  bowl *= land;
  albedo = mix(albedo, srgbToLinear(vec3(0.42, 0.40, 0.38)), ejecta * 0.35 * land);
  albedo = mix(albedo, srgbToLinear(vec3(0.16, 0.13, 0.12)), bowl * 0.85);
  albedo += vec3(0.08) * rim * land;
  N = normalize(N + tilt * land);

  float ndl = dot(N, uSunDir);
  float sphereNdl = dot(sphereN, uSunDir);
  vec3 color = albedo * (0.035 + 1.15 * max(ndl, 0.0));

  // Sun glint on open water.
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(uSunDir + V);
  float glint = pow(max(dot(sphereN, H), 0.0), 80.0) * (1.0 - land) * (1.0 - seaIce);
  color += vec3(1.0, 0.92, 0.8) * glint * 0.7 * step(0.0, sphereNdl);

  // Ash veil: a sunlit grey-brown pall over everything beneath it.
  float ash = texture2D(uAsh, uv).r;
  vec3 ashColor = srgbToLinear(vec3(0.45, 0.40, 0.36)) * (0.03 + 0.9 * max(sphereNdl, 0.0));
  // Capped so terrain (and craters) stay faintly readable under the thickest pall.
  color = mix(color, ashColor, ash * 0.75);
  float seeThrough = 1.0 - 0.7 * ash;

  // City lights on the night side: point lights whose density follows population.
  float night = smoothstep(0.05, -0.2, sphereNdl);
  float lights = texture2D(uLights, uv).r * (1.0 - fx.r) * uLightsScale;
  float lightSeed;
  float lit = latticeDots(uv, vec2(3072.0, 1536.0), lights * 0.85, 0.0, lightSeed);
  color += vec3(1.0, 0.7, 0.35) * (lit * (0.6 + lights) + lights * 0.12) * night * land * seeThrough;

  // Wildfires: flickering embers, vivid at night; by day mostly a smoky dimming.
  float emberSeed;
  float flame = latticeDots(uv, vec2(4096.0, 2048.0), fire * 0.9, 17.0, emberSeed);
  float flicker = 0.65 + 0.35 * sin(uTime * 9.0 + emberSeed * 40.0);
  color *= 1.0 - fire * 0.35 * (1.0 - night);
  color += vec3(1.0, 0.38, 0.08) * (flame * flicker * 1.5 + fire * 0.2) * (0.15 + 0.85 * night) * seeThrough;

  // Atmospheric haze toward the limb on the day side.
  float fresnel = pow(1.0 - max(dot(sphereN, V), 0.0), 3.0);
  color += uAtmosphereColor * fresnel * smoothstep(-0.25, 0.6, sphereNdl) * 0.8;

  // Shockwaves racing outward from fresh impacts.
  for (int i = 0; i < MAX_SHOCKS; i++) {
    float a = uShockAlpha[i];
    if (a <= 0.0) continue;
    vec4 s = uShocks[i];
    float d = angDist(dir, s.xyz);
    float w = max(s.w * 0.05, pxAng * 1.5);
    float front = exp(-pow((d - s.w) / w, 2.0));
    float behind = (1.0 - smoothstep(0.0, s.w, d)) * 0.2;
    if (uShockWave[i] > 0.5) {
      color += (vec3(0.55, 0.9, 1.0) * front * 1.3 + vec3(0.15, 0.45, 0.8) * behind * 0.5) * a;
    } else {
      color += (vec3(1.0, 0.85, 0.6) * front * 1.6 + vec3(1.0, 0.45, 0.15) * behind) * a;
    }
  }

  // Targeting overlay: fire radius, blast radius, crater footprint.
  if (uTargetOn > 0.5) {
    float d = angDist(dir, uTargetDir);
    float lw = pxAng * 0.9;
    float thermal = uTargetRadii.z > 0.0
      ? max(ringLine(d, uTargetRadii.z, lw, pxAng) * 0.9, step(d, uTargetRadii.z) * 0.07) : 0.0;
    float blast = uTargetRadii.y > 0.0
      ? max(ringLine(d, uTargetRadii.y, lw * 1.4, pxAng), step(d, uTargetRadii.y) * 0.12) : 0.0;
    float crater = uTargetRadii.x > 0.0
      ? (1.0 - smoothstep(uTargetRadii.x - pxAng, uTargetRadii.x + pxAng, d)) * 0.6 : 0.0;
    color = mix(color, vec3(1.0, 0.8, 0.2), thermal);
    color = mix(color, vec3(1.0, 0.4, 0.12), blast);
    color = mix(color, vec3(0.85, 0.08, 0.05), crater);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
