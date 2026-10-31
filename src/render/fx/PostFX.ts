/**
 * Region post-processing: bloom (fire, flashes, impact glow) and a vignette.
 * Presentation only. The globe view renders directly and skips this chain.
 */
import {
  type Camera,
  type Scene,
  type WebGLRenderer,
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null as unknown }, strength: { value: 0.45 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5)) * 1.41421356;
      c.rgb *= 1.0 - strength * smoothstep(0.45, 1.05, d);
      gl_FragColor = c;
    }`,
};

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly vignette: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.renderPass = new RenderPass(scene, camera);
    // Only genuinely bright pixels (flames, flashes, sparks) bloom; terrain stays crisp.
    this.bloom = new UnrealBloomPass(size.clone(), 0.55, 0.6, 0.85);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.vignette);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /** Render `scene` through the chain (swaps in the current scene/camera first). */
  render(scene: Scene, camera: Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
