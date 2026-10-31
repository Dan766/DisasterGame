// Back-face shell around the planet: glow strongest just past the limb, fading outward,
// lit by the sun so the night side keeps only a faint rim.

uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uLimbDot; // -dot(N, V) where a ray grazing the planet hits the shell

varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  // On back faces -dot(N, V) runs from 0 at the shell's outer edge to uLimbDot at the planet limb.
  float s = clamp(-dot(N, V) / uLimbDot, 0.0, 1.0);
  float intensity = s * s * s;
  float sunlit = smoothstep(-0.35, 0.5, dot(N, uSunDir)) * 0.9 + 0.1;
  gl_FragColor = vec4(uColor * intensity * sunlit * 1.3, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
