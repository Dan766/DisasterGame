/**
 * Regional impact presentation (DESIGN.md §6): the incoming meteor streak, the flash and
 * the expanding shockwave ring. Pure presentation; the sim decides what an impact does.
 * World units are cells (100 m), x east / z south, matching `RegionView`.
 */
import { CameraShake } from '../../core/shake';
import {
  AdditiveBlending,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { degToRad } from '../../core/geo';
import { Particles } from '../fx/Particles';
import { REGION_SIZE } from '../../sim/region';
import type { Shockwave } from '../../sim/systems/impact';

const APPROACH_SECONDS = 1.1;
const APPROACH_DISTANCE = 700;
const FLASH_SECONDS = 0.9;
const UP = new Vector3(0, 1, 0);

interface Meteor {
  start: Vector3;
  end: Vector3;
  t: number;
  head: Sprite;
  trail: Mesh<ConeGeometry, MeshBasicMaterial>;
  onImpact: () => void;
}

interface Flash {
  sprite: Sprite;
  t: number;
  size: number;
}

interface Ring {
  mesh: Mesh<CylinderGeometry, MeshBasicMaterial>;
}

export class RegionFx {
  readonly group = new Group();
  private meteors: Meteor[] = [];
  private flashes: Flash[] = [];
  private readonly rings = new Map<Shockwave, Ring>();
  private readonly glow = makeGlowTexture();
  private readonly ringGeo = new CylinderGeometry(1, 1, 1, 72, 1, true);
  private readonly trailGeo = new ConeGeometry(1, 1, 12, 1, true);
  private readonly shake = new CameraShake();
  /** Shared pooled particles (ejecta now; smoke, sparks and debris as they land). */
  readonly particles = new Particles();

  constructor() {
    this.group.add(...this.particles.meshes);
  }

  /**
   * Streaks a meteor in from the sky toward `target` (world space, on the ground) and calls
   * `onImpact` when it lands. `angleDeg` is the entry angle above the horizon; `size` is
   * the visual head radius in world units.
   */
  launch(target: Vector3, angleDeg: number, size: number, onImpact: () => void): void {
    const a = degToRad(Math.min(85, Math.max(15, angleDeg)));
    // Arrive from the north-west so the streak crosses the default camera's view.
    const horiz = new Vector3(-0.6, 0, -0.8).multiplyScalar(Math.cos(a));
    const dir = horiz.add(new Vector3(0, Math.sin(a), 0)).normalize();
    const start = target.clone().addScaledVector(dir, APPROACH_DISTANCE);
    const head = new Sprite(
      new SpriteMaterial({
        map: this.glow,
        color: 0xffd9a0,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    head.scale.setScalar(size * 3);
    const trail = new Mesh(
      this.trailGeo,
      new MeshBasicMaterial({
        color: 0xff9a4a,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.group.add(head, trail);
    this.meteors.push({ start, end: target.clone(), t: 0, head, trail, onImpact });
  }

  /** Flash plus camera shake at the impact point. `size` is the flash radius in world units. */
  detonate(point: Vector3, size: number): void {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: this.glow,
        color: 0xfff1d0,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sprite.position.copy(point);
    this.group.add(sprite);
    this.flashes.push({ sprite, t: 0, size });
    this.shake.add(Math.min(1, 0.25 + size / 120));
    this.ejecta(point, size);
  }

  /** Throws a fan of rock and a dust plume up from the impact point. */
  private ejecta(point: Vector3, size: number): void {
    const rocks = Math.min(2500, Math.round(250 + size * 60));
    for (let i = 0; i < rocks; i++) {
      const az = Math.random() * Math.PI * 2;
      const elev = 0.9 + Math.random() * 0.6; // steep, so it arcs and falls back
      const speed = (0.6 + Math.random() * 0.9) * (12 + size * 1.6);
      this.particles.emit({
        x: point.x,
        y: point.y + 0.5,
        z: point.z,
        vx: Math.cos(az) * Math.cos(elev) * speed * 0.6,
        vy: Math.sin(elev) * speed,
        vz: Math.sin(az) * Math.cos(elev) * speed * 0.6,
        gravity: -45,
        life: 2.5 + Math.random() * 2.5,
        size: 0.5 + Math.random() * 0.9,
        color: 0xffb060,
        colorEnd: 0x2a2018,
        alpha: 0.95,
        additive: Math.random() < 0.4,
      });
    }
    const dust = Math.min(600, Math.round(80 + size * 14));
    for (let i = 0; i < dust; i++) {
      const az = Math.random() * Math.PI * 2;
      const out = Math.random() * size * 0.5;
      this.particles.emit({
        x: point.x + Math.cos(az) * out * 0.3,
        y: point.y + 1,
        z: point.z + Math.sin(az) * out * 0.3,
        vx: Math.cos(az) * out * 0.5,
        vy: 4 + Math.random() * (6 + size * 0.5),
        vz: Math.sin(az) * out * 0.5,
        gravity: 0.8,
        life: 6 + Math.random() * 5,
        size: 2 + size * 0.1,
        sizeEnd: 8 + size * 0.5,
        color: 0x8a7458,
        colorEnd: 0x4a4038,
        alpha: 0.5,
      });
    }
  }

  /** Advances the animations and syncs shockwave rings to the sim's active waves. */
  update(
    dt: number,
    waves: readonly Shockwave[],
    heightAt: (x: number, z: number) => number,
  ): void {
    for (let k = this.meteors.length - 1; k >= 0; k--) {
      const m = this.meteors[k]!;
      m.t += dt / APPROACH_SECONDS;
      const t = Math.min(1, m.t);
      const eased = t * t; // accelerates into the ground
      m.head.position.lerpVectors(m.start, m.end, eased);
      const tail = m.head.position.clone().lerp(m.start, 0.16);
      const axis = tail.clone().sub(m.head.position);
      const len = Math.max(0.001, axis.length());
      m.trail.position.copy(m.head.position).addScaledVector(axis, 0.5);
      m.trail.scale.set(m.head.scale.x * 0.25, len, m.head.scale.x * 0.25);
      m.trail.quaternion.copy(new Quaternion().setFromUnitVectors(UP, axis.divideScalar(len)));
      if (m.t >= 1) {
        this.group.remove(m.head, m.trail);
        m.head.material.dispose();
        m.trail.material.dispose();
        this.meteors.splice(k, 1);
        m.onImpact();
      }
    }

    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k]!;
      f.t += dt / FLASH_SECONDS;
      if (f.t >= 1) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(k, 1);
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.4 + 2.2 * Math.sqrt(f.t)));
      f.sprite.material.opacity = (1 - f.t) ** 2;
    }

    const live = new Set(waves);
    for (const [wave, ring] of this.rings) {
      if (live.has(wave)) continue;
      this.group.remove(ring.mesh);
      ring.mesh.material.dispose();
      this.rings.delete(wave);
    }
    for (const wave of waves) {
      let ring = this.rings.get(wave);
      if (!ring) {
        ring = {
          mesh: new Mesh(
            this.ringGeo,
            new MeshBasicMaterial({
              color: 0xfff0d8,
              transparent: true,
              blending: AdditiveBlending,
              depthWrite: false,
              side: DoubleSide,
              fog: false,
            }),
          ),
        };
        this.group.add(ring.mesh);
        this.rings.set(wave, ring);
      }
      const x = wave.col - REGION_SIZE / 2 + 0.5; // cell index → world (region is centered)
      const z = wave.row - REGION_SIZE / 2 + 0.5;
      const r = Math.max(0.5, wave.radius);
      const bandH = 6 + r * 0.04;
      ring.mesh.scale.set(r, bandH, r);
      ring.mesh.position.set(x, heightAt(x, z) + bandH * 0.3, z);
      ring.mesh.material.opacity = 0.5 * (1 - wave.radius / wave.maxRadius) ** 1.5;
    }

    this.shake.update(dt);
    this.particles.update(dt);
  }

  /** Keeps the camera shaking at least at `trauma` (0..1) while an earthquake is active. */
  holdShake(trauma: number): void {
    this.shake.hold(trauma);
  }

  /** Camera shake offset for this frame in world units; `distance` is camera-to-target so the on-screen sway stays constant. */
  shakeOffset(out: Vector3, distance = 100): Vector3 {
    const o = this.shake.sample(out);
    return out.set(o.x, o.y, o.z).multiplyScalar(distance * 0.02);
  }

  get busy(): boolean {
    return this.meteors.length > 0;
  }

  clear(): void {
    for (const m of this.meteors) {
      m.head.material.dispose();
      m.trail.material.dispose();
    }
    for (const f of this.flashes) f.sprite.material.dispose();
    for (const r of this.rings.values()) r.mesh.material.dispose();
    this.meteors = [];
    this.flashes = [];
    this.rings.clear();
    this.group.clear();
    this.group.add(...this.particles.meshes);
    this.particles.clear();
    this.shake.reset();
  }
}

function makeGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,200,120,0.55)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
