/**
 * The start of every launch (owner, 2026-11-08): Welcome → eye calibration → the conversation. The
 * first run also makes the person's voice (VoiceSetup.tsx, NAT-32) after calibration, until the
 * person has finished those pages once (App: `voiceDone`).
 *
 * Backend quadrants (owner, 2026-11-08): Get started is a tall ink card over Q4 and Q8, so a look
 * at either selects it, and the words and the orb are centred in the three columns to its left.
 * During calibration the card slides off to the right; the calibration page's Try again slides back
 * in its place. Keyboard and mouse is quiet text, not a card, at the foot of Q6 under the words: the
 * people who use it point and click, and the page should lead everyone else to try calibration.
 *
 * Before calibration the eyes cannot select yet, so Get started counts down from 20 s and selects
 * itself, unless a key, a click or a mouse movement shows the person can select another way (App:
 * useAutoStart). Keyboard and mouse skips calibration: the session runs on clicks and keys 1–8,
 * with no camera and no selection by dwell.
 */
import type { ReactNode } from 'react';
import type { Slots, SlotView } from './Tile.tsx';
import { longest } from './text.ts';
import { ArrowRight } from './icons.tsx';

const face = (label: string, hint?: string) =>
  <><span className="card-label" style={longest(label)}>{label}</span>{hint && <span className="card-hint">{hint}</span>}</>;

/**
 * A page's one action: a tall ink card over Q4 and Q8, so a look at either selects it. The body is
 * keyed by its label alone, so a hint that comes or goes (Get started's countdown) updates in place:
 * the press that stops the countdown must not swap the body under the pointer, or the click is lost.
 */
export const tallCard = (action: string, label: string, icon: ReactNode, hint?: string): SlotView => ({
  action, tone: 'ink', icon, bodyKey: `${action}:${label}`, className: 'card-tall', body: face(label, hint),
});

/** `autoStart`: seconds before Get started selects itself, or null when it will not. */
export function welcomeSlots(autoStart: number | null): Slots {
  return {
    q4: tallCard('get-started', 'Get started', <ArrowRight />, autoStart === null ? undefined : `Starts in ${autoStart} s`),
    // Owner, 2026-11-08: not a button, and subtle, so the eye goes to Get started.
    q6: { action: 'keyboard-mouse', tone: 'surface', className: 'card-quiet', bodyKey: 'keyboard-mouse', body: <span className="card-label">Keyboard and mouse</span> },
  };
}

export function WelcomePage() {
  return (
    <section className="onboarding" aria-label="Welcome">
      <h1 className="page-title">Welcome to Clarté</h1>
    </section>
  );
}
