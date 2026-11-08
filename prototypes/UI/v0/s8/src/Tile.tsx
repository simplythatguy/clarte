/**
 * A gaze target: one card inside one backend quadrant.
 *
 * The dwell (owner, 2026-11-08) is a line tracing the card's edge: it starts at the top left, runs
 * clockwise, and closes the loop exactly when the dwell completes. The choreography per look:
 *  - intent delay (150 ms groups, 250 ms controls): nothing changes, so a passing glance shows nothing;
 *  - trace: the glass brightens a step and the line runs round the edge, linear, so its length is
 *    the time left;
 *  - commit: the closed line floods inward as a translucent tint, like liquid: it wets the corners
 *    first and the last dry patch beads into an oval that closes at the centre (260 ms, launching
 *    promptly and settling), then the tint fades (280 ms, overlapping the flood's last 40 ms). The
 *    card is back at rest about half a second after the selection, even while gaze stays on it,
 *    and the tint never hides the card's new content, so nothing waits for it;
 *  - cancel: the line retracts the way it came over 150 ms.
 * Every step is a Web Animation started on a state transition, never a per-frame write. Under
 * reduced motion the line steps round in quarters and the commit is a brief tint without the flood.
 */
import { isValidElement, useEffect, useId, useRef, type ReactNode } from 'react';
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

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** The commit: the flood closes in, then the tint fades. Together about half a second. */
const FLOOD_MS = 260;
const FADE_MS = 280;
const FADE_AT = FLOOD_MS - 40;
const EASE_STATE = 'cubic-bezier(0.2, 0, 0, 1)';
const RETRACT_MS = 150;

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * The edge line (one rounded rect inset in the card, pathLength 1) and the flood: a tint masked by
 * a soft oval hole that starts larger than the card and shrinks to nothing at its centre.
 */
function traceController(svg: SVGSVGElement) {
  const line = svg.querySelector<SVGRectElement>('.trace-line')!;
  const hole = svg.querySelector<SVGEllipseElement>('.trace-hole')!;
  let anims: Animation[] = [];
  let floodEnds: Promise<void> | null = null;
  const stop = () => { anims.forEach((a) => a.cancel()); anims = []; floodEnds = null; };
  const offset = () => parseFloat(getComputedStyle(line).strokeDashoffset) || 0;
  const reset = () => {
    line.style.strokeDashoffset = '1';
    line.style.opacity = '0';
    hole.style.transform = 'scale(1)';
    svg.style.opacity = '1';
  };
  const play = (el: Element, frames: Keyframe[], ms: number, easing: string, delay = 0) => {
    const a = el.animate(frames, { duration: ms, easing, delay, fill: 'forwards' });
    anims.push(a);
    return a;
  };
  reset();
  return {
    /** Run the line from wherever it is to closed, linear, over `ms`. */
    trace(ms: number) {
      const from = offset();
      stop();
      line.style.opacity = '1';
      line.style.strokeDashoffset = '0';
      if (ms > 0 && from > 0.001) play(line, [{ strokeDashoffset: from }, { strokeDashoffset: 0 }], ms, 'linear');
    },
    /** Confirm mode: the loop shows closed, waiting. */
    closed() { stop(); reset(); line.style.opacity = '1'; line.style.strokeDashoffset = '0'; },
    /** A cancel: the line retracts the way it came. */
    retract(ms: number) {
      if (floodEnds) return;
      const from = offset();
      stop();
      reset();
      if (ms > 0 && from < 0.999) play(line, [{ strokeDashoffset: from, opacity: 1 }, { strokeDashoffset: 1, opacity: 1 }], ms, EASE_OUT);
    },
    /** The commit: the tint floods in from the edge and closes at the centre, then fades, then rest. */
    flood(reduce: boolean) {
      stop();
      line.style.opacity = '1';
      line.style.strokeDashoffset = '0';
      hole.style.transform = 'scale(0)';
      // From 0.8 the corners are already wet (0.86 is where the oval's edge meets them), so the flood
      // shows from its first frame; it launches promptly and the last dry drop closes gently.
      if (!reduce) play(hole, [{ transform: 'scale(0.8)' }, { transform: 'scale(0)' }], FLOOD_MS, EASE_STATE);
      const fade = play(svg, [{ opacity: 1 }, { opacity: 0 }], reduce ? 200 : FADE_MS, EASE_OUT, reduce ? 0 : FADE_AT);
      floodEnds = fade.finished.then(() => { stop(); reset(); }, () => {});
    },
    clear() { stop(); reset(); },
  };
}

type Phase = 'rest' | 'fill' | 'preview' | 'done';

export function Tile({ action, tone, group, icon, label, disabled: disabledProp = false, gone = false, fast = false, onActivate, className = '', children }: Props) {
  const disabled = disabledProp || gone;
  const card = useRef<HTMLButtonElement>(null);
  const traceRef = useRef<SVGSVGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    let phase: Phase = 'rest';
    let step = -1;
    const trace = traceRef.current ? traceController(traceRef.current) : null;
    // A persistent card whose action just changed (a screen change) starts from rest.
    if (card.current && card.current.dataset.gaze !== 'rest') card.current.dataset.gaze = 'rest';

    const enter = (next: Phase, remaining: number) => {
      const el = card.current;
      if (!el || !trace) return;
      const prev = phase;
      phase = next;
      el.dataset.gaze = next;
      const reduce = reducedMotion?.matches ?? false;
      if (next === 'fill') {
        if (!reduce) trace.trace(remaining);
      } else if (next === 'preview') {
        trace.closed();
      } else if (next === 'done') {
        trace.flood(reduce);
      } else if (prev === 'fill' || prev === 'preview') {
        trace.retract(reduce ? 0 : RETRACT_MS);
      }
    };

    return engine.subscribe((s) => {
      const el = card.current;
      if (!el) return;
      let next: Phase = 'rest';
      const dwellMs = engine.settings.dwellMs;
      // The line starts after the intent delay and closes exactly when the dwell completes.
      const start = intentDelay(action);
      let elapsed = 0;
      if (!disabled && s.action === action && !isQuiet(action, s)) {
        if (s.state === 'dwelling') {
          elapsed = s.progress * dwellMs;
          next = elapsed < start ? 'rest' : 'fill';
        } else if (s.state === 'previewed') {
          next = 'preview'; // Confirm mode: the loop closed, waiting
        } else if (s.state === 'selected') {
          next = 'done';
        }
      }
      if (next !== phase) enter(next, Math.max(0, dwellMs - Math.max(elapsed, start)));
      if (reducedMotion?.matches) {
        const span = Math.max(1, dwellMs - start);
        const nextStep = next === 'fill' ? Math.min(4, 1 + Math.floor(((elapsed - start) / span) * 4)) : next === 'preview' ? 4 : 0;
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
      <svg ref={traceRef} className="trace" aria-hidden="true">
        <defs>
          <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" /></filter>
          <mask id={`${id}-wet`}>
            <rect width="100%" height="100%" fill="#fff" />
            <ellipse className="trace-hole" cx="50%" cy="50%" rx="82%" ry="82%" fill="#000" filter={`url(#${id}-soft)`} />
          </mask>
        </defs>
        <rect className="trace-flood" mask={`url(#${id}-wet)`} />
        <rect className="trace-line" pathLength={1} />
      </svg>
      {icon && <span className="card-icon" aria-hidden="true"><Swap swapKey={iconKey(icon)} className="glyph-swap" leavingClass="glyph-leaving" fast={fast}>{icon}</Swap></span>}
      <span className="card-body">{children}</span>
    </button>
  );
}
