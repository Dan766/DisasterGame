export type OnboardingStep = 'pick' | 'aim' | 'done';

/** Which hint to show: nothing armed yet -> pick one; armed -> aim at the planet; acted -> done. */
export function onboardingStep(armed: boolean, acted: boolean): OnboardingStep {
  if (acted) return 'done';
  return armed ? 'aim' : 'pick';
}

const MESSAGES: Record<Exclude<OnboardingStep, 'done'>, string> = {
  pick: 'Pick a disaster on the left…',
  aim: '…then click the planet to unleash it',
};

const STORAGE_KEY = 'cataclysm.onboarded';

/** First-run hint banner; disappears for good after the first disaster is launched. */
export class Onboarding {
  readonly el = document.createElement('div');
  private armed = false;
  private acted = false;

  constructor() {
    this.el.className = 'onboarding';
    try {
      this.acted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* storage unavailable: show the hint every visit */
    }
    this.render();
  }

  setArmed(armed: boolean): void {
    this.armed = armed;
    this.render();
  }

  /** Call when the user launches or ignites something. */
  dismiss(): void {
    if (this.acted) return;
    this.acted = true;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    this.render();
  }

  private render(): void {
    const step = onboardingStep(this.armed, this.acted);
    this.el.hidden = step === 'done';
    if (step !== 'done') this.el.textContent = MESSAGES[step];
  }
}
