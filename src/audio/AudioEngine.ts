import { boomGain } from './mix';

/**
 * Procedural WebAudio sound: impact boom, wind roar, fire crackle, UI click.
 * Everything is synthesised from filtered noise/oscillators, so no sample files are needed.
 * The AudioContext is created lazily on the first user gesture (browser autoplay policy).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  muted = false;

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
      this.windGain = this.startLoop(420, 0.9, 'lowpass');
      this.fireGain = this.startLoop(2600, 1.5, 'bandpass');
      this.rumbleGain = this.startLoop(70, 0.7, 'lowpass');
    }
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** Deep boom: sine sweep plus a noise burst, delayed by `delay` seconds. */
  boom(megatons: number, distanceM = 0, delay = 0): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + delay;
    const g = boomGain(megatons, distanceM);
    const out = ctx.createGain();
    out.gain.setValueAtTime(g, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    out.connect(master);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 1.8);
    osc.connect(out);
    osc.start(t);
    osc.stop(t + 2.6);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 1.5);
    src.connect(lp).connect(out);
    src.start(t);
    src.stop(t + 2.6);
  }

  /** Short UI tick. */
  click(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  /** Ambient loop levels, each 0..1. Call every frame or HUD tick. */
  setAmbient(wind: number, fire: number, rumble = 0): void {
    const { ctx } = this;
    if (!ctx) return;
    this.windGain?.gain.setTargetAtTime(wind * 0.5, ctx.currentTime, 0.3);
    this.fireGain?.gain.setTargetAtTime(fire * 0.35, ctx.currentTime, 0.3);
    this.rumbleGain?.gain.setTargetAtTime(rumble * 0.7, ctx.currentTime, 0.4);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Audio-only noise: a tiny LCG keeps this independent of Math.random in sim code paths.
    let s = 12345;
    for (let i = 0; i < data.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 0xffffffff) * 2 - 1;
    }
    return buf;
  }

  private startLoop(freq: number, q: number, type: BiquadFilterType): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    return g;
  }
}
