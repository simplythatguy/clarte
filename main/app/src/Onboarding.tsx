/**
 * The first run (owner, 2026-11-08): Welcome with Get started → eye calibration → voice cloning →
 * the conversation. Voice cloning is a placeholder until its screen is designed.
 *
 * Backend quadrants: each page has one action, an ink card that a look selects like any other card.
 * Get started sits in Q4, where the conversation's primary card sits, and the greeting at the
 * centre of the screen. On the voice page Continue is one tall card over Q4 and Q8, so a look at
 * either selects it, and the note is centred in the three columns to its left (owner, 2026-11-08).
 * Every other quadrant is a rest zone.
 */
import type { ReactNode } from 'react';
import type { Slots, SlotView } from './Tile.tsx';
import { longest } from './text.ts';
import { ArrowRight } from './icons.tsx';

export type OnboardingStep = 'welcome' | 'voice';

const card = (action: string, label: string, icon: ReactNode): SlotView => ({
  action, tone: 'ink', icon, bodyKey: `${action}:${label}`,
  body: <span className="card-label" style={longest(label)}>{label}</span>,
});

export function onboardingSlots(step: OnboardingStep): Slots {
  return step === 'welcome'
    ? { q4: card('get-started', 'Get started', <ArrowRight />) }
    : { q4: { ...card('voice-continue', 'Continue', <ArrowRight />), className: 'card-tall' } };
}

export function OnboardingPage({ step }: { step: OnboardingStep }) {
  return (
    <section className={`onboarding onboarding-${step}`} aria-label={step === 'welcome' ? 'Welcome' : 'Voice'}>
      {step === 'welcome'
        ? <h1 className="page-title">Welcome to Clarte</h1>
        : <p className="onboarding-note">This is being worked on</p>}
    </section>
  );
}
