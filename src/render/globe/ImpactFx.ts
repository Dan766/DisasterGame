/**
 * Cinematic side of an impact (DESIGN.md §6): the incoming meteor streak, the
 * flash, expanding shockwave rings and camera shake. Pure presentation: the sim
 * decides what an impact does; this decides how it looks and when it lands.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from 'three';
import { degToRad } from '../../core/geo';
import { clamp } from '../../core/math';
import type { ShockRing } from './GlobeView';

const APPROACH_SECONDS = 1.3;
const SHOCK_SECONDS = 2.6;
/** Shockwaves are drawn at least this big so tiny impacts still read at globe scale. */
const MIN_SHOCK_KM = 120;

export interface LaunchOptions {
  /** World-space surface point. */
  point: Vector3;
  angleDeg: number;
  /** Visual size class, from log10 of energy. */
  energyMt: number;
  onImpact: () => void;
}

interface Meteor {
  start: Vector3;
  end: Vector3;
  t: number;
  head: Sprite;
  trail: Mesh<ConeGeometry, MeshBasicMaterial>;
  energyMt: number;
  onImpact: () => void;
}

interface Flash {
  sprite: Sprite;
  t: number;
  duration: number;
  size: number;
}

interface Shock {
  dir: Vector3;
  t: number;
  maxRadiusKm: number;
}

const UP = new Vector3(0, 1, 0);

export class ImpactFx {
  readonly root = new Group();
  private readonly glow = createGlowTexture();
  private meteors: Meteor[] = [];
  private flashes: Flash[] = [];
  private shocks: Shock[] = [];
  private shakeEnergy = 0;

  /** Sends a meteor at a surface point; `onImpact` fires when it lands. */
  launch({ point, angleDeg, energyMt, onImpact }: LaunchOptions): void {
    const normal = point.clone().normalize();
    // Come in from a random compass direction, tilted by the entry angle.
    let tangent = new Vector3().crossVectors(normal, randomUnit());
    if (tangent.lengthSq() < 1e-6) tangent = new Vector3().crossVectors(normal, UP);
    tangent.normalize();
    const angle = degToRad(angleDeg);
    const incoming = normal
      .clone()
      .multiplyScalar(Math.sin(angle))
      .addScaledVector(tangent, Math.cos(angle));
    const start = point.clone().addScaledVector(incoming, 1.1);

    const size = visualSize(energyMt);
    const head = new Sprite(
      new SpriteMaterial({
        map: this.glow,
        color: 0xffd9a0,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    head.scale.setScalar(size * 0.6);
    const trail = new Mesh(
      new ConeGeometry(size * 0.12, 1, 12, 1, true),
      new MeshBasicMaterial({
        color: 0xff8a3d,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(head, trail);
    this.meteors.push({ start, end: point.clone(), t: 0, head, trail, energyMt, onImpact });
  }

  /** Flash + shockwave at a surface point once the sim has applied the impact. */
  detonate(point: Vector3, energyMt: number, blastRadiusKm: number): void {
    const size = visualSize(energyMt) * 3;
    const sprite = new Sprite(
      new SpriteMaterial({
        map: this.glow,
        color: 0xfff1d6,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.copy(point).addScaledVector(point.clone().normalize(), 0.004);
    this.root.add(sprite);
    this.flashes.push({ sprite, t: 0, duration: 0.9 + Math.log10(energyMt + 1) * 0.12, size });

    this.shocks.push({
      dir: point.clone().normalize(),
      t: 0,
      maxRadiusKm: Math.max(blastRadiusKm * 1.3, MIN_SHOCK_KM),
    });
    if (this.shocks.length > 4) this.shocks.shift();
    this.shakeEnergy = Math.max(this.shakeEnergy, clamp(Math.log10(energyMt + 1) / 8, 0.05, 1));
  }

  update(dt: number): void {
    for (const m of this.meteors) {
      m.t += dt / APPROACH_SECONDS;
      const k = Math.min(1, m.t) ** 2; // accelerating fall
      const pos = m.start.clone().lerp(m.end, k);
      m.head.position.copy(pos);
      // Trail stretches behind the head along the flight path.
      const back = m.start.clone().sub(m.end).normalize();
      const length = Math.min(0.5, 0.08 + k * 0.4);
      m.trail.scale.set(1, length, 1);
      m.trail.position.copy(pos).addScaledVector(back, length / 2);
      m.trail.quaternion.copy(new Quaternion().setFromUnitVectors(UP, back.clone().negate()));
      if (m.t >= 1) {
        this.root.remove(m.head, m.trail);
        m.head.material.dispose();
        m.trail.geometry.dispose();
        m.trail.material.dispose();
        m.onImpact();
      }
    }
    this.meteors = this.meteors.filter((m) => m.t < 1);

    for (const f of this.flashes) {
      f.t += dt;
      const k = f.t / f.duration;
      const grow = Math.min(1, f.t / 0.12);
      f.sprite.scale.setScalar(f.size * (0.4 + 0.6 * grow) * (1 + k * 0.5));
      f.sprite.material.opacity = Math.max(0, 1 - k) ** 1.5;
      if (k >= 1) {
        this.root.remove(f.sprite);
        f.sprite.material.dispose();
      }
    }
    this.flashes = this.flashes.filter((f) => f.t < f.duration);

    for (const s of this.shocks) s.t += dt / SHOCK_SECONDS;
    this.shocks = this.shocks.filter((s) => s.t < 1);

    this.shakeEnergy = Math.max(0, this.shakeEnergy - dt * 1.4);
  }

  /** Current shockwave rings for GlobeView.setShocks. */
  shockRings(): ShockRing[] {
    return this.shocks.map((s) => ({
      dir: s.dir,
      radiusKm: s.maxRadiusKm * (1 - (1 - s.t) ** 2.5), // fast, then easing out
      alpha: (1 - s.t) ** 1.5,
    }));
  }

  /** Jolts the camera; call after controls update and before rendering. */
  applyShake(camera: Camera): void {
    if (this.shakeEnergy <= 0) return;
    const a = this.shakeEnergy ** 2 * 0.012;
    camera.rotateX((Math.random() - 0.5) * a);
    camera.rotateY((Math.random() - 0.5) * a);
    camera.updateMatrixWorld();
  }

  clear(): void {
    for (const m of this.meteors) this.root.remove(m.head, m.trail);
    for (const f of this.flashes) this.root.remove(f.sprite);
    this.meteors = [];
    this.flashes = [];
    this.shocks = [];
    this.shakeEnergy = 0;
  }
}

/** Globe-space size for a meteor/flash of a given energy (not to scale: readable). */
function visualSize(energyMt: number): number {
  return clamp(0.03 + Math.log10(energyMt + 1) * 0.012, 0.035, 0.16);
}

function randomUnit(): Vector3 {
  return new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}

function createGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,240,200,0.9)');
  g.addColorStop(0.5, 'rgba(255,150,60,0.35)');
  g.addColorStop(1, 'rgba(255,100,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
