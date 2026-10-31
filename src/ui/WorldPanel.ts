import { oceanFraction, type GlobalWorld } from '../sim/world';
import { formatPopulation } from './format';

/** Top-left panel: world seed, regenerate controls and a world summary. */
export class WorldPanel {
  readonly el = document.createElement('div');
  private readonly seedInput: HTMLInputElement;
  private readonly summary: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[];

  constructor(onGenerate: (seed: string) => void) {
    this.el.className = 'panel world-panel';
    this.el.innerHTML = `
      <h1>Cataclysm Sandbox</h1>
      <form class="seed-row">
        <label for="seed-input">Seed</label>
        <input id="seed-input" name="seed" autocomplete="off" spellcheck="false" maxlength="32" />
        <button type="submit" title="Generate this seed">Generate</button>
        <button type="button" data-random title="Random seed">Random</button>
      </form>
      <div class="summary"></div>`;
    this.seedInput = this.el.querySelector('input')!;
    this.summary = this.el.querySelector('.summary')!;
    this.buttons = [...this.el.querySelectorAll('button')];

    const form = this.el.querySelector('form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const seed = this.seedInput.value.trim();
      if (seed) onGenerate(seed);
    });
    this.el.querySelector('[data-random]')!.addEventListener('click', () => {
      const seed = randomSeed();
      this.seedInput.value = seed;
      onGenerate(seed);
    });
    // Keep typing in the seed box from triggering game hotkeys.
    this.seedInput.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
    if (busy) this.summary.textContent = 'Generating…';
  }

  showWorld(world: GlobalWorld, genMs: number): void {
    this.seedInput.value = world.seed;
    const land = Math.round((1 - oceanFraction(world)) * 100);
    this.summary.innerHTML = `
      <div><span>Population</span><b>${formatPopulation(world.stats.initialPopulation)}</b></div>
      <div><span>Land</span><b>${land}%</b></div>
      <div><span>Cities</span><b>${world.cities.length}</b></div>
      <div class="muted">Generated in ${Math.round(genMs)} ms</div>`;
  }
}

export function randomSeed(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
