/**
 * The start of every launch (owner, 2026-11-08): Welcome → eye calibration → the conversation. The
 * first run also makes the person's voice (VoiceSetup.tsx, NAT-32) after calibration, until the
 * person has finished those pages once (App: `voiceDone`).
 *
 * Backend quadrants (owner, 2026-11-08): Welcome is a two-button page like the voice pages. Its two
 * cards share the bottom row as wide cards: Keyboard and mouse over Q5–Q6, and Get started, in ink,
 * over Q7–Q8. The words and the orb are centred in the top row, a rest zone. When calibration starts,
 * Get started slides off to the right and Keyboard and mouse fades. The calibration page's Try again
 * is a tall ink card over Q4 and Q8.
 *
 * Before calibration the eyes cannot select yet, so Get started counts down from 20 s and selects
 * itself, unless a key, a click or a mouse movement shows the person can select another way (App:
 * useAutoStart). Keyboard and mouse skips calibration: the session runs on clicks and keys 1–8,
 * with no camera and no selection by dwell.
 */
import type { ReactNode } from 'react';
import type { Slots, SlotView } from './Tile.tsx';
import { longest } from './text.ts';
import { ArrowRight, Keyboard } from './icons.tsx';

const face = (label: string, hint?: string) =>
  <><span className="card-label" style={longest(label)}>{label}</span>{hint && <span className="card-hint">{hint}</span>}</>;

/** A page's one action: a tall ink card over Q4 and Q8, so a look at either selects it. */
export const tallCard = (action: string, label: string, icon: ReactNode, hint?: string): SlotView => ({
  action, tone: 'ink', icon, bodyKey: `${action}:${label}:${hint ? 'hint' : ''}`, className: 'card-tall', body: face(label, hint),
});

/** `autoStart`: seconds before Get started selects itself, or null when it will not. */
export function welcomeSlots(autoStart: number | null): Slots {
  const hint = autoStart === null ? undefined : `Starts in ${autoStart} s`;
  return {
    q5: { action: 'keyboard-mouse', tone: 'surface', icon: <Keyboard />, span: 2, bodyKey: 'keyboard-mouse', body: face('Keyboard and mouse') },
    // `card-slide`: it slides off to the right as calibration starts, as the tall card did. One body
    // key with or without the hint: a press stops the countdown, and swapping the body under the
    // pointer then would detach the pressed node, so the click would never fire.
    q7: { action: 'get-started', tone: 'ink', icon: <ArrowRight />, span: 2, className: 'card-slide', bodyKey: 'get-started', body: face('Get started', hint) },
  };
}

export function WelcomePage() {
  return (
    <section className="onboarding welcome-page" aria-label="Welcome">
      <h1 className="page-title">Welcome to Clarté</h1>
    </section>
  );
}
