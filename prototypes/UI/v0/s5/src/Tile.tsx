/**
 * A gaze target: one card inside one backend quadrant.
 *
 * The dwell indicator is the visual direction's two-circle motif (MOTION.md "The dwell
 * indicator"): a static identity mark (the group's solid dot, or the control's icon) and a ring
 * that is the dwell. The ring is a 1.5 px track at rest. The choreography per look:
 *  - intent delay (150 ms groups, 250 ms controls): nothing changes;
 *  - focus cue: the face steps one shade and the track becomes opaque, a single static step held
 *    for 100 ms;
 *  - progress: an accent arc draws clockwise from 12 o'clock, linear, over the remaining dwell;
 *  - commit: the arc completes, the ring turns solid accent, and a copy of it blooms outward
 *    (scale 1 → 2.4, opacity 0.35 → 0, 450 ms) on a layer that never affects layout;
 *  - cancel: the arc drains back from wherever it is over 150 ms;
 *  - re-arm: the ring stays accent while gaze remains and fades to the track once gaze leaves.
 * Arc and bloom are Web Animations started only on state transitions, so a dwell costs no
 * per-frame DOM writes (MOTION acceptance 8). Under reduced motion there is no bloom and the
 * ring's opacity steps in four steps across the dwell instead of an arc drawing.
 */
import { isValidElement, useEffect, useRef, type ReactNode } from 'react';
import type { GroupId } from '../../shared/decoder.ts';
import { engine, intentDelay, isQuiet, lastActivationByKey } from './gaze.ts';
import { Swap } from './Swap.tsx';

/** A stable key per icon component, so an icon fades only when it actually changes. */
const iconIds = new WeakMap<object, string>();
let iconCount = 0;
function iconKey(icon: ReactNode): string {
  if (!isValidElement(icon) || typeof icon.type === 'string') return 'icon';
  let id = iconIds.get(icon.type);
  if (!id) { id = `icon-${(iconCount += 1)}`; iconIds.set(icon.type, id); }
  return id;
}

export type Tone = 'group' | 'surface' | 'ink';

/** What one quadrant's card shows on the current screen. */
export type SlotView = {
  action: string;
  tone: Tone;
  group?: GroupId;
  icon?: ReactNode;
  label?: string;
  disabled?: boolean;
  /** Keys the content: a new key cross-fades the content in place. */
  bodyKey: string;
  body: ReactNode;
};
export type SlotName = 'q1' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8';
export type Slots = Partial<Record<SlotName, SlotView>>;

type Props = {
  action: string;
  tone: Tone;
  group?: GroupId;
  /** Identity mark inside the ring for controls (an icon). Groups use their solid dot. */
  icon?: ReactNode;
  /** Accessible name, only where the visible text needs a verb or is absent. */
  label?: string;
  disabled?: boolean;
  /** No action in this quadrant on this screen: the card fades away and is not selectable. */
  gone?: boolean;
  /** The icon changed within one screen (a frequent change): fade it fast (Swap.tsx). */
  fast?: boolean;
  onActivate: (action: string) => void;
  className?: string;
  children?: ReactNode;
};

/** How long the static focus cue shows before progress starts moving. */
const FOCUS_HOLD = 100;
const R = 22;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * The dwell arc as two clipped half-rings rotated with `transform` (0–180° each), so progress,
 * drain and fill are compositor work only: no paint during a dwell (MOTION acceptance 8). The
 * right half draws 12 → 6 o'clock, then the left half 6 → 12, clockwise.
 */
function arcController(wrap: HTMLElement, right: HTMLElement, left: HTMLElement) {
  let anims: Animation[] = [];
  const angle = (el: HTMLElement) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const a = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    return Math.min(180, Math.max(0, a < -1 ? a + 360 : a));
  };
  const stop = () => { anims.forEach((a) => a.cancel()); anims = []; };
  const set = (r: number, l: number) => { right.style.transform = `rotate(${r}deg)`; left.style.transform = `rotate(${l}deg)`; };
  const turn = (el: HTMLElement, from: number, to: number, duration: number, delay = 0) => {
    if (duration <= 0 || Math.abs(from - to) < 0.5) return;
    anims.push(el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], { duration, delay, easing: 'linear', fill: 'backwards' }));
  };
  return {
    /** Draw from the current angle to complete over `ms`, linear (progress encodes time). */
    fill(ms: number) {
      const r0 = angle(right); const l0 = angle(left); stop();
      wrap.style.opacity = '1';
      const p0 = (r0 + l0) / 360;
      set(180, 180);
      if (ms <= 0 || p0 >= 1) return;
      const perUnit = ms / (1 - p0);
      if (p0 < 0.5) { const tR = perUnit * (0.5 - p0); turn(right, r0, 180, tR); turn(left, 0, 180, perUnit * 0.5, tR); }
      else turn(left, l0, 180, ms);
    },
    full() { stop(); set(180, 180); wrap.style.opacity = '1'; },
    /** A cancel: unwind from wherever it is while fading, over `ms`. */
    drain(ms: number) {
      const r0 = angle(right); const l0 = angle(left); stop();
      set(0, 0);
      if (ms <= 0 || r0 + l0 < 1) { wrap.style.opacity = '0'; return; }
      const tL = (ms * l0) / (r0 + l0);
      turn(left, l0, 0, tL);
      turn(right, r0, 0, ms - tL, tL);
      wrap.style.opacity = '0';
      anims.push(wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear' }));
    },
    /** After a commit: fade the solid ring back to the track without unwinding. */
    fade(ms: number) {
      stop();
      wrap.style.opacity = '0';
      if (ms > 0) {
        const a = wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE_OUT });
        anims.push(a);
        a.finished.then(() => set(0, 0), () => {});
      } else set(0, 0);
    },
  };
}

type Phase = 'rest' | 'focus' | 'fill' | 'preview' | 'done';

export function Tile({ action, tone, group, icon, label, disabled: disabledProp = false, gone = false, fast = false, onActivate, className = '', children }: Props) {
  const disabled = disabledProp || gone;
  const card = useRef<HTMLButtonElement>(null);
  const arcWrap = useRef<HTMLSpanElement>(null);
  const arcRight = useRef<HTMLSpanElement>(null);
  const arcLeft = useRef<HTMLSpanElement>(null);
  const bloom = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let phase: Phase = 'rest';
    let step = -1;
    const arc = arcWrap.current && arcRight.current && arcLeft.current ? arcController(arcWrap.current, arcRight.current, arcLeft.current) : null;
    // A persistent card whose action just changed (a screen change) starts from rest: the solid
    // ring of the selection that caused the change fades back to the track.
    if (card.current && card.current.dataset.gaze !== 'rest') {
      card.current.dataset.gaze = 'rest';
      arc?.fade(150);
    }

    const enter = (next: Phase, remaining: number) => {
      const el = card.current;
      if (!el || !arc) return;
      const prev = phase;
      phase = next;
      el.dataset.gaze = next;
      const reduce = reducedMotion?.matches ?? false;
      if (next === 'preview') {
        arc.full();
      } else if (next === 'fill') {
        if (!reduce) arc.fill(remaining);
      } else if (next === 'done') {
        arc.full();
        // No motion on keyboard-triggered actions (MOTION.md choreography rules).
        if (!reduce && !lastActivationByKey() && prev !== 'done' && bloom.current) {
          bloom.current.animate(
            [{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }],
            { duration: 450, easing: EASE_OUT },
          );
        }
      } else if (prev === 'done') {
        // After a commit the ring fades back to the track; it does not unwind like a cancel.
        arc.fade(reduce ? 0 : 150);
      } else if (prev === 'fill' || prev === 'preview') {
        arc.drain(reduce ? 0 : 150);
      }
    };

    return engine.subscribe((s) => {
      const el = card.current;
      if (!el) return;
      let next: Phase = 'rest';
      const dwellMs = engine.settings.dwellMs;
      // The static focus step shrinks at very short dwells so progress always has room to show.
      const start = intentDelay(action) + Math.min(FOCUS_HOLD, Math.max(0, (dwellMs - intentDelay(action)) / 3));
      let elapsed = 0;
      if (!disabled && s.action === action && !isQuiet(action, s)) {
        if (s.state === 'dwelling') {
          elapsed = s.progress * dwellMs;
          next = elapsed < intentDelay(action) ? 'rest' : elapsed < start ? 'focus' : 'fill';
        } else if (s.state === 'previewed') {
          next = 'preview'; // Confirm mode: complete arc, waiting; no success ring or bloom yet
        } else if (s.state === 'selected') {
          next = 'done';
        }
      }
      if (next !== phase) enter(next, Math.max(0, dwellMs - Math.max(elapsed, start)));
      if (reducedMotion?.matches) {
        const span = Math.max(1, dwellMs - start);
        const nextStep = next === 'fill' ? Math.min(4, 1 + Math.floor(((elapsed - start) / span) * 4)) : next === 'done' || next === 'preview' ? 4 : 0;
        if (nextStep !== step) { step = nextStep; el.dataset.step = String(step); }
      }
    });
  }, [action, disabled]);

  return (
    <button
      ref={card}
      type="button"
      className={`card card-${tone}${gone ? ' card-gone' : ''} ${className}`}
      data-group={group}
      data-action={disabled ? undefined : action}
      aria-disabled={disabled || undefined}
      aria-hidden={gone || undefined}
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      data-gaze="rest"
      onClick={() => { if (!disabled) onActivate(action); }}
    >
      <span className={`motif ${icon ? 'motif-icon' : group ? 'motif-dot' : 'motif-bare'}`} aria-hidden="true">
        {icon ? <span className="motif-glyph"><Swap swapKey={iconKey(icon)} className="glyph-swap" leavingClass="glyph-leaving" fast={fast}>{icon}</Swap></span> : group ? <span className="motif-id" /> : null}
        <span className="ring">
          <svg viewBox="0 0 48 48">
            <circle className="ring-track" cx="24" cy="24" r={R} />
          </svg>
          <span ref={arcWrap} className="arc" style={{ opacity: 0 }}>
            <span className="arc-half arc-right"><span ref={arcRight} className="arc-fill" /></span>
            <span className="arc-half arc-left"><span ref={arcLeft} className="arc-fill" /></span>
          </span>
          <span ref={bloom} className="ring-bloom" />
        </span>
      </span>
      <span className="card-body">{children}</span>
    </button>
  );
}
