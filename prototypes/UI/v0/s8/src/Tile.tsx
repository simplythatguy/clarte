/**
 * A gaze target: one card inside one backend quadrant.
 *
 * The dwell (owner, 2026-11-08) is a line tracing the card's edge: it starts at the top left, runs
 * clockwise, and closes the loop exactly when the dwell completes. The choreography per look:
 *  - intent delay (150 ms groups, 250 ms controls): nothing changes, so a passing glance shows nothing;
 *  - trace: the glass brightens a step and the line runs round the edge, linear, so its length is
 *    the time left;
 *  - commit: the closed line floods inward as a translucent tint, like water: its edge is sharp and
 *    wavy, two or three long, random waves that travel round as it closes in on the centre (260 ms,
 *    launching promptly and settling). Where the water meets it sends one faint ripple back out to
 *    the edges as the tint fades (280 ms, overlapping the flood's last 40 ms). The
 *    card is back at rest about half a second after the selection, even while gaze stays on it,
 *    and the tint never hides the card's new content, so nothing waits for it;
 *  - cancel: the line retracts the way it came over 150 ms.
 * Every step is a Web Animation started on a state transition, never a per-frame write. Under
 * reduced motion the line steps round in quarters and the commit is a brief tint without the flood.
 */
import { isValidElement, useEffect, useRef, type ReactNode } from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';
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
/** The ripple the water sends back out, from where it meets to the edges. */
const RIPPLE_MS = 340;
const RETRACT_MS = 150;

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** A flood's water line: two long waves (two and three crests round the edge), random per selection. */
type Wave = { a: number; b: number; p: number; q: number };
const randomWave = (): Wave => ({ a: 0.07 + Math.random() * 0.04, b: 0.04 + Math.random() * 0.03, p: Math.random() * Math.PI * 2, q: Math.random() * Math.PI * 2 });

/**
 * A closed, smooth, wavy loop round the card's centre: `scale` 1 just reaches past the corners, 0 is
 * the centre, and `phase` moves the waves round. Catmull-Rom through 48 points, as cubic Béziers.
 */
function wavyLoop(w: number, h: number, scale: number, wave: Wave, phase: number): string {
  const n = 48;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const f = 1 + wave.a * Math.sin(2 * t + wave.p + phase) + wave.b * Math.sin(3 * t + wave.q - 1.4 * phase);
    pts.push([w / 2 + (w / 2) * 1.42 * scale * f * Math.cos(t), h / 2 + (h / 2) * 1.42 * scale * f * Math.sin(t)]);
  }
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

/**
 * The edge line (one rounded rect inset in the card, pathLength 1), the flood (the card's tint with
 * a wavy dry patch cut out, even-odd) and the ripple the water sends back out.
 */
function traceController(svg: SVGSVGElement) {
  const line = svg.querySelector<SVGRectElement>('.trace-line')!;
  const flood = svg.querySelector<SVGPathElement>('.trace-flood')!;
  const ripple = svg.querySelector<SVGPathElement>('.trace-ripple')!;
  let anims: Animation[] = [];
  let tweens: AnimationPlaybackControls[] = [];
  let floodEnds: Promise<void> | null = null;
  const stop = () => { anims.forEach((a) => a.cancel()); anims = []; tweens.forEach((t) => t.stop()); tweens = []; floodEnds = null; };
  const offset = () => parseFloat(getComputedStyle(line).strokeDashoffset) || 0;
  const reset = () => {
    line.style.strokeDashoffset = '1';
    line.style.opacity = '0';
    flood.setAttribute('d', '');
    ripple.setAttribute('d', '');
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
    /** The commit: the water floods in to the centre, a ripple runs back out, the tint fades, rest. */
    flood(reduce: boolean) {
      stop();
      line.style.opacity = '1';
      line.style.strokeDashoffset = '0';
      const { width: w, height: h } = svg.getBoundingClientRect();
      const card = `M0 0H${w.toFixed(1)}V${h.toFixed(1)}H0Z`;
      flood.setAttribute('d', card);
      if (!reduce) {
        const wave = randomWave();
        // From 0.8 the corners are already wet, so the water shows from the first frame.
        tweens.push(animate(0, 1, {
          duration: FLOOD_MS / 1000, ease: [0.2, 0, 0, 1],
          onUpdate: (k) => flood.setAttribute('d', k < 1 ? card + wavyLoop(w, h, 0.8 * (1 - k), wave, 2.2 * k) : card),
        }));
        tweens.push(animate(0, 1, {
          delay: (FLOOD_MS - 30) / 1000, duration: RIPPLE_MS / 1000, ease: [0.23, 1, 0.32, 1],
          onUpdate: (k) => {
            // The tween reports its start value during its delay; the ripple exists only once the water meets.
            if (k <= 0) return;
            ripple.setAttribute('d', wavyLoop(w, h, 0.05 + 0.95 * k, wave, 2.2 + 1.5 * k));
            ripple.style.opacity = String(0.5 * (1 - k));
          },
        }));
      }
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
        <path className="trace-flood" fillRule="evenodd" />
        <path className="trace-ripple" />
        <rect className="trace-line" pathLength={1} />
      </svg>
      {icon && <span className="card-icon" aria-hidden="true"><Swap swapKey={iconKey(icon)} className="glyph-swap" leavingClass="glyph-leaving" fast={fast}>{icon}</Swap></span>}
      <span className="card-body">{children}</span>
    </button>
  );
}
