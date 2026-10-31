// Planet surface: smooth coastlines from filtered elevation, flat-shaded low-poly land,
// glossy ocean with shelf gradient, sea ice, night-side city lights, limb haze.

uniform sampler2D uElevation;
uniform sampler2D uColor;   // sRGB land albedo, alpha = sea ice
uniform sampler2D uLights;  // night-light intensity
uniform vec3 uSunDir;       // world space, normalized
uniform vec3 uAtmosphereColor;

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

void main() {
  vec2 uv = dirToUv(normalize(vDir));
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

  float ndl = dot(N, uSunDir);
  float sphereNdl = dot(sphereN, uSunDir);
  vec3 color = albedo * (0.035 + 1.15 * max(ndl, 0.0));

  // Sun glint on open water.
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(uSunDir + V);
  float glint = pow(max(dot(sphereN, H), 0.0), 80.0) * (1.0 - land) * (1.0 - seaIce);
  color += vec3(1.0, 0.92, 0.8) * glint * 0.7 * step(0.0, sphereNdl);

  // City lights on the night side: speckled points whose density follows population.
  float night = smoothstep(0.05, -0.2, sphereNdl);
  float lights = texture2D(uLights, uv).r;
  float grain = hash12(floor(uv * vec2(3072.0, 1536.0)));
  float lit = smoothstep(1.0 - lights * 0.85, 1.0 - lights * 0.85 + 0.08, grain);
  color += vec3(1.0, 0.7, 0.35) * (lit * (0.5 + lights) + lights * 0.15) * night * land;

  // Atmospheric haze toward the limb on the day side.
  float fresnel = pow(1.0 - max(dot(sphereN, V), 0.0), 3.0);
  color += uAtmosphereColor * fresnel * smoothstep(-0.25, 0.6, sphereNdl) * 0.8;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
