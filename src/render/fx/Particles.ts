/**
 * Pooled GPU particle system (DESIGN.md §6): one draw call of instanced billboard quads shared
 * by ejecta, debris, smoke and sparks. Motion is analytic in the vertex shader
 * (`p0 + v·age + ½·g·age²`), so the CPU only writes a particle once, at emit time.
 * Slots are a ring buffer: when the 20k budget is full the oldest particle is recycled.
 * World units are cells (100 m), matching `RegionView`.
 */
import {
  AdditiveBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three';

export const PARTICLE_BUDGET = 20_000;

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds the particle lives. */
  life: number;
  /** Billboard size at birth / at death, world units. */
  size: number;
  sizeEnd?: number;
  /** Per-particle gravity (world units/s², negative = falls). Smoke uses a slight positive buoyancy. */
  gravity?: number;
  /** 0xRRGGBB colour at birth; fades to `colorEnd` (default same) over the life. */
  color: number;
  colorEnd?: number;
  /** Peak opacity. */
  alpha?: number;
  /** Additive (sparks, glow) vs normal (smoke, debris) blending. */
  additive?: boolean;
}

const VERT = /* glsl */ `
  attribute vec3 aPos;
  attribute vec3 aVel;
  attribute vec4 aLife;   // birth, life, gravity, additive(0/1)
  attribute vec2 aSize;   // start, end
  attribute vec4 aColor;  // rgb start packed into aColor.xyz, alpha in w
  attribute vec3 aColorEnd;
  uniform float uTime;
  uniform float uAdditive;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    float age = uTime - aLife.x;
    float t = age / aLife.y;
    // Dead, not yet born, or belongs to the other blend pass: collapse off-screen.
    if (t < 0.0 || t >= 1.0 || abs(aLife.w - uAdditive) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 world = aPos + aVel * age + vec3(0.0, 0.5 * aLife.z * age * age, 0.0);
    float size = mix(aSize.x, aSize.y, t);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    float fade = smoothstep(0.0, 0.08, t) * (1.0 - t);
    vColor = vec4(mix(aColor.rgb, aColorEnd, t), aColor.w * fade);
    vUv = position.xy * 2.0;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float soft = 1.0 - d * d;
    gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
  }
`;

interface Layer {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
}

export class Particles {
  readonly capacity: number;
  /** Add this to the scene. Two meshes (normal + additive) share one set of buffers. */
  readonly meshes: Mesh[];
  private readonly geo = new InstancedBufferGeometry();
  private readonly pos: InstancedBufferAttribute;
  private readonly vel: InstancedBufferAttribute;
  private readonly life: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly colorEnd: InstancedBufferAttribute;
  private readonly layers: Layer[];
  private head = 0;
  private time = 0;
  private emitted = 0;

  constructor(capacity = PARTICLE_BUDGET) {
    this.capacity = capacity;
    this.geo.setAttribute(
      'position',
      new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    );
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (itemSize: number, name: string): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      a.setUsage(35048 /* DynamicDrawUsage */);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.pos = attr(3, 'aPos');
    this.vel = attr(3, 'aVel');
    this.life = attr(4, 'aLife');
    this.size = attr(2, 'aSize');
    this.color = attr(4, 'aColor');
    this.colorEnd = attr(3, 'aColorEnd');
    // Everything starts "dead": birth far in the past with a 1 s life.
    for (let i = 0; i < capacity; i++) {
      this.life.setXYZW(i, -1e6, 1, 0, 0);
    }
    this.geo.instanceCount = capacity;

    const make = (additive: boolean): Layer => {
      const material = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uAdditive: { value: additive ? 1 : 0 } },
        transparent: true,
        depthWrite: false,
        blending: additive ? AdditiveBlending : NormalBlending,
      });
      const mesh = new Mesh(this.geo, material);
      mesh.frustumCulled = false; // positions are computed in the shader
      mesh.renderOrder = additive ? 11 : 10;
      return { mesh };
    };
    this.layers = [make(false), make(true)];
    this.meshes = this.layers.map((l) => l.mesh);
  }

  /** Number of particles currently alive (CPU-side estimate from emit times). */
  get liveCount(): number {
    let n = 0;
    const t = this.time;
    const a = this.life.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      const birth = a[i * 4]!;
      const age = t - birth;
      if (age >= 0 && age < a[i * 4 + 1]!) n++;
    }
    return n;
  }

  /** Total particles emitted since creation / last clear (recycled ones included). */
  get totalEmitted(): number {
    return this.emitted;
  }

  emit(s: ParticleSpec): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity; // ring: recycles the oldest when full
    this.emitted++;
    this.pos.setXYZ(i, s.x, s.y, s.z);
    this.vel.setXYZ(i, s.vx, s.vy, s.vz);
    this.life.setXYZW(i, this.time, Math.max(0.01, s.life), s.gravity ?? 0, s.additive ? 1 : 0);
    this.size.setXY(i, s.size, s.sizeEnd ?? s.size);
    const c = s.color;
    this.color.setXYZW(
      i,
      ((c >> 16) & 255) / 255,
      ((c >> 8) & 255) / 255,
      (c & 255) / 255,
      s.alpha ?? 1,
    );
    const e = s.colorEnd ?? c;
    this.colorEnd.setXYZ(i, ((e >> 16) & 255) / 255, ((e >> 8) & 255) / 255, (e & 255) / 255);
    this.markDirty(i);
  }

  /** Advances the shader clock. Call once per rendered frame with the real (unscaled) dt. */
  update(dt: number): void {
    this.time += dt;
    for (const l of this.layers) l.mesh.material.uniforms.uTime!.value = this.time;
    this.flush();
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.life.setXYZW(i, -1e6, 1, 0, 0);
    this.life.needsUpdate = true;
    this.head = 0;
    this.emitted = 0;
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
  }

  dispose(): void {
    this.geo.dispose();
    for (const l of this.layers) l.mesh.material.dispose();
  }

  private dirtyLo = Infinity;
  private dirtyHi = -1;

  private markDirty(i: number): void {
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    // A wrap-around emit makes the range span the buffer; fall back to a full upload then.
  }

  private flush(): void {
    if (this.dirtyHi < 0) return;
    const lo = this.dirtyLo;
    const n = this.dirtyHi - lo + 1;
    for (const a of [this.pos, this.vel, this.life, this.size, this.color, this.colorEnd]) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
  }
}
