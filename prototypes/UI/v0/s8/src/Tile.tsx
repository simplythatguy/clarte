/**
 * A gaze target: one card inside one backend quadrant.
 *
 * Style 6 · Glass (owner references, 2026-11-07): every card is a frosted glass tile with a plain
 * icon at its top left and its words at its bottom left; looking at it fills it with white from
 * the bottom up, so the card itself is the dwell (the glass-tiles reference: the tile under the
 * pointer turns white). The choreography per look:
 *  - intent delay (150 ms groups, 250 ms controls): nothing changes;
 *  - focus cue: the glass brightens one step and its edge turns white, held for 100 ms;
 *  - progress: a white wash rises from the bottom edge, linear, over the remaining dwell;
 *  - commit: the card is solid white and its edge turns the accent while gaze remains;
 *  - cancel: the wash drains back down from wherever it is over 150 ms;
 *  - re-arm: after a commit the wash fades (it does not drain) once gaze leaves.
 * The wash is one element scaled with `transform` by Web Animations started only on state
 * transitions, so a dwell costs no per-frame DOM writes and no paint (MOTION acceptance 8). Under
 * reduced motion the wash steps up in quarters instead of rising.
 */
import { isValidElement, useEffect, useRef, type ReactNode } from 'react';
import type { GroupId } from '../../shared/decoder.ts';
import { engine, intentDelay, isQuiet } from './gaze.ts';
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

export type Tone = 'group' | 'surface' | 'white' | 'ink';

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
  /** A wide card across this quadrant and the next one to the right, which it then owns. */
  span?: 2;
  body: ReactNode;
};
export type SlotName = 'q1' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8';
export type Slots = Partial<Record<SlotName, SlotView>>;

type Props = {
  action: string;
  tone: Tone;
  group?: GroupId;
  /** A control's plain icon, top left. Letter groups have none (owner, 2026-11-07). */
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
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** The white wash: `scaleY` from the bottom edge, with the arc's old interface. */
function washController(wash: HTMLElement) {
  let anims: Animation[] = [];
  const scale = () => Math.min(1, Math.max(0, new DOMMatrixReadOnly(getComputedStyle(wash).transform).d));
  const stop = () => { anims.forEach((a) => a.cancel()); anims = []; };
  const set = (v: number) => { wash.style.transform = `scaleY(${v})`; };
  const run = (from: number, to: number, ms: number) => {
    if (ms > 0 && Math.abs(from - to) > 0.001) anims.push(wash.animate([{ transform: `scaleY(${from})` }, { transform: `scaleY(${to})` }], { duration: ms, easing: 'linear' }));
  };
  return {
    /** Rise from wherever it is to full over `ms`, linear (progress encodes time). */
    fill(ms: number) { const s0 = scale(); stop(); wash.style.opacity = '1'; set(1); run(s0, 1, ms); },
    full() { stop(); wash.style.opacity = '1'; set(1); },
    /** A cancel: drain back down from wherever it is over `ms`. */
    drain(ms: number) { const s0 = scale(); stop(); set(0); run(s0, 0, ms); },
    /** After a commit: fade the full wash out without draining. */
    fade(ms: number) {
      stop();
      wash.style.opacity = '0';
      if (ms <= 0) { set(0); return; }
      const a = wash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE_OUT });
      anims.push(a);
      a.finished.then(() => set(0), () => {});
    },
  };
}

type Phase = 'rest' | 'focus' | 'fill' | 'preview' | 'done';

export function Tile({ action, tone, group, icon, label, disabled: disabledProp = false, gone = false, fast = false, onActivate, className = '', children }: Props) {
  const disabled = disabledProp || gone;
  const card = useRef<HTMLButtonElement>(null);
  const washRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let phase: Phase = 'rest';
    let step = -1;
    const wash = washRef.current ? washController(washRef.current) : null;
    // A persistent card whose action just changed (a screen change) starts from rest: the white
    // of the selection that caused the change fades back to glass.
    if (card.current && card.current.dataset.gaze !== 'rest') {
      card.current.dataset.gaze = 'rest';
      wash?.fade(150);
    }

    const enter = (next: Phase, remaining: number) => {
      const el = card.current;
      if (!el || !wash) return;
      const prev = phase;
      phase = next;
      el.dataset.gaze = next;
      const reduce = reducedMotion?.matches ?? false;
      if (next === 'preview') {
        wash.full();
      } else if (next === 'fill') {
        if (!reduce) wash.fill(remaining);
      } else if (next === 'done') {
        wash.full();
      } else if (prev === 'done') {
        // After a commit the white fades back to glass; it does not drain like a cancel.
        wash.fade(reduce ? 0 : 150);
      } else if (prev === 'fill' || prev === 'preview') {
        wash.drain(reduce ? 0 : 150);
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
          next = 'preview'; // Confirm mode: a half-strength full wash, waiting; no accent edge yet
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
      <span ref={washRef} className="wash" aria-hidden="true" />
      {icon && <span className="card-icon" aria-hidden="true"><Swap swapKey={iconKey(icon)} className="glyph-swap" leavingClass="glyph-leaving" fast={fast}>{icon}</Swap></span>}
      <span className="card-body">{children}</span>
    </button>
  );
}
