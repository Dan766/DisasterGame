// Displaces the cube-sphere by the elevation texture (land only; oceans stay a smooth sphere).

uniform sampler2D uElevation;
uniform float uDisplaceScale; // radius units per meter

varying vec3 vDir;         // object-space unit direction, for per-fragment lat/lon
varying vec3 vWorldPos;
varying vec3 vWorldNormal; // smooth sphere normal

#define PI 3.141592653589793

vec2 dirToUv(vec3 d) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(d.x, d.z);
  return vec2((lon + PI) / (2.0 * PI), 0.5 - lat / PI);
}

void main() {
  vec3 dir = normalize(position);
  vDir = dir;
  float elevation = texture2D(uElevation, dirToUv(dir)).r;
  vec3 displaced = dir * (1.0 + max(elevation, 0.0) * uDisplaceScale);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * dir);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
