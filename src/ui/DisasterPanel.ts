import {
  defaultParams,
  type DisasterDef,
  type NumberParam,
  type Params,
  type Preview,
} from '../sim/disasters/types';
import { formatParam } from './format';

/** Slider positions per number control (log/linear mapped onto this range). */
const STEPS = 1000;

/**
 * Disaster palette + parameter controls generated from each disaster's ParamSchema,
 * with a live readout of the selected configuration's reach.
 */
export class DisasterPanel {
  readonly el = document.createElement('div');
  private selectedDef: DisasterDef | null = null;
  private params: Params = {};
  private preview: Preview | null = null;
  private readonly paramsByDisaster = new Map<string, Params>();
  private readonly palette: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor(
    private readonly defs: readonly DisasterDef[],
    private readonly onChange: () => void,
  ) {
    this.el.className = 'panel disaster-panel';
    this.el.innerHTML = `<h2>Disasters</h2><div class="palette"></div><div class="disaster-body"></div>`;
    this.palette = this.el.querySelector('.palette')!;
    this.body = this.el.querySelector('.disaster-body')!;
    for (const def of defs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = def.name;
      button.dataset.id = def.id;
      button.addEventListener('click', () =>
        this.select(this.selectedDef?.id === def.id ? null : def.id),
      );
      this.palette.appendChild(button);
    }
    this.render();
  }

  get selected(): DisasterDef | null {
    return this.selectedDef;
  }

  get currentParams(): Params {
    return { ...this.params };
  }

  get currentPreview(): Preview | null {
    return this.preview;
  }

  select(id: string | null): void {
    if (this.selectedDef) this.paramsByDisaster.set(this.selectedDef.id, this.params);
    this.selectedDef = this.defs.find((d) => d.id === id) ?? null;
    this.params = this.selectedDef
      ? (this.paramsByDisaster.get(this.selectedDef.id) ?? defaultParams(this.selectedDef))
      : {};
    this.render();
    this.onChange();
  }

  private render(): void {
    for (const b of this.palette.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.id === this.selectedDef?.id);
    }
    const def = this.selectedDef;
    if (!def) {
      this.preview = null;
      this.body.innerHTML = `<div class="hint">Pick a disaster, then click the planet.</div>`;
      return;
    }
    this.body.innerHTML = '';
    for (const spec of def.params) {
      const row = document.createElement('label');
      row.className = 'param';
      if (spec.kind === 'number') {
        row.innerHTML = `<span class="param-label">${spec.label}</span><b class="param-value"></b>`;
        const value = row.querySelector<HTMLElement>('.param-value')!;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = String(STEPS);
        input.value = String(toSlider(spec, Number(this.params[spec.key])));
        const show = () =>
          (value.textContent = formatParam(Number(this.params[spec.key]), spec.unit));
        input.addEventListener('input', () => {
          this.params[spec.key] = fromSlider(spec, Number(input.value));
          show();
          this.updatePreview();
        });
        show();
        row.appendChild(input);
      } else {
        row.innerHTML = `<span class="param-label">${spec.label}</span>`;
        const group = document.createElement('div');
        group.className = 'segmented';
        for (const option of spec.options) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = option.label;
          b.classList.toggle('active', this.params[spec.key] === option.value);
          b.addEventListener('click', (e) => {
            e.preventDefault();
            this.params[spec.key] = option.value;
            for (const other of group.children) other.classList.toggle('active', other === b);
            this.updatePreview();
          });
          group.appendChild(b);
        }
        row.appendChild(group);
      }
      this.body.appendChild(row);
    }
    const facts = document.createElement('div');
    facts.className = 'facts';
    this.body.appendChild(facts);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click the planet to launch · Esc to cancel';
    this.body.appendChild(hint);
    this.updatePreview();
  }

  private updatePreview(): void {
    const def = this.selectedDef;
    if (!def) return;
    this.preview = def.preview(this.params);
    const facts = this.body.querySelector('.facts')!;
    facts.innerHTML = this.preview.facts
      .map((f) => `<div><span>${f.label}</span><b>${f.value}</b></div>`)
      .join('');
    this.onChange();
  }
}

function toSlider(spec: NumberParam, value: number): number {
  const t =
    spec.scale === 'log'
      ? Math.log(value / spec.min) / Math.log(spec.max / spec.min)
      : (value - spec.min) / (spec.max - spec.min);
  return Math.round(Math.min(1, Math.max(0, t)) * STEPS);
}

function fromSlider(spec: NumberParam, position: number): number {
  const t = position / STEPS;
  const v =
    spec.scale === 'log'
      ? spec.min * (spec.max / spec.min) ** t
      : spec.min + t * (spec.max - spec.min);
  // Round to 2 significant figures so values read cleanly.
  const magnitude = 10 ** (Math.floor(Math.log10(Math.abs(v) || 1)) - 1);
  return Math.round(v / magnitude) * magnitude;
}
