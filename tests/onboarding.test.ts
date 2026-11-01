import { describe, expect, it } from 'vitest';
import { onboardingStep } from '../src/ui/Onboarding';

describe('onboardingStep', () => {
  it('asks to pick a disaster first, then to aim, then goes away', () => {
    expect(onboardingStep(false, false)).toBe('pick');
    expect(onboardingStep(true, false)).toBe('aim');
    expect(onboardingStep(true, true)).toBe('done');
    expect(onboardingStep(false, true)).toBe('done');
  });
});
