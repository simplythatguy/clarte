/**
 * The first run (owner, 2026-11-08): Welcome with Get started → eye calibration → making the
 * person's voice (VoiceSetup.tsx, NAT-32) → the conversation.
 *
 * Backend quadrants (owner, 2026-11-08): each page's one action is a tall ink card over Q4 and Q8,
 * so a look at either selects it, and the text is centred in the three columns to its left. Every
 * other quadrant is a rest zone. During calibration the card slides off to the right and slides
 * back as Continue. The orb (GuideOrb.tsx) rests above the text.
 *
 * Before calibration the eyes cannot select yet, so Get started counts down from 20 s and selects
 * itself, unless a key, a click or a mouse movement shows the person can select another way (App:
 * useAutoStart). After calibration Continue has no timer: the eyes select it.
 */
import type { ReactNode } from 'react';
import type { Slots, SlotView } from './Tile.tsx';
import { longest } from './text.ts';
import { ArrowRight } from './icons.tsx';


/** The page's one action: a tall ink card over Q4 and Q8, so a look at either selects it. */
export const tallCard = (action: string, label: string, icon: ReactNode, hint?: string): SlotView => ({
  action, tone: 'ink', icon, bodyKey: `${action}:${label}:${hint ? 'hint' : ''}`, className: 'card-tall',
  body: <><span className="card-label" style={longest(label)}>{label}</span>{hint && <span className="card-hint">{hint}</span>}</>,
});

/** `autoStart`: seconds before Get started selects itself, or null when it will not. */
export function welcomeSlots(autoStart: number | null): Slots {
  return { q4: tallCard('get-started', 'Get started', <ArrowRight />, autoStart === null ? undefined : `Starts in ${autoStart} s`) };
}

export function WelcomePage() {
  return (
    <section className="onboarding" aria-label="Welcome">
      <h1 className="page-title">Welcome to Clarté</h1>
    </section>
  );
}
