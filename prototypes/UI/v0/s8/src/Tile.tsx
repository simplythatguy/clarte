/**
 * A gaze target: one card inside one backend quadrant.
 *
 * The dwell (owner, 2026-11-08) is a line tracing the card's edge: it starts at the top left, runs
 * clockwise, and closes the loop exactly when the dwell completes. The choreography per look:
 *  - intent delay (150 ms groups, 250 ms controls): nothing changes, so a passing glance shows nothing;
 *  - trace: the glass brightens a step and the line runs round the edge, linear, so its length is
 *    the time left;
 *  - commit: a solid circle of the card's own vivid colour grows from the centre until it covers
 *    the card (260 ms) and holds a beat (120 ms); then the filled card, its line and its words fade
 *    out together, as one piece, to the card as it was (280 ms). When the selection turns the card
 *    into one that already has the fill's colour (Menu becoming Back), there is no exit: the fill
 *    hands over to the new card. Inside the circle
 *    the card's words and icon turn to the colour that reads on it (white, or ink on a white fill),
 *    exactly as far as the circle has reached: a copy of the content in that colour, clipped to the
 *    same circle. The card is back at rest about half a second after the selection, even while gaze
 *    stays on it, and its new content stays readable throughout, so nothing waits for it;
 *  - cancel: the line retracts the way it came over 150 ms.
 * Every step is a Web Animation started on a state transition, never a per-frame write. Under
 * reduced motion the line steps round in quarters and the commit is the fill fading out, without the circle growing.
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
  /** Extra classes for the card (the arrow cards). */
  className?: string;
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
/** The commit: the circle grows over the card, holds a beat, then fades as one piece. About 0.66 s. */
const FLOOD_MS = 260;
const HOLD_MS = 120;
const FADE_MS = 280;
const FADE_AT = FLOOD_MS + HOLD_MS;
const EASE_STATE = 'cubic-bezier(0.2, 0, 0, 1)';
const RETRACT_MS = 150;

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * The edge line (one rounded rect inset in the card, pathLength 1) and the fill: a layer over the
 * card in the fill colour holding a copy of the card's content in the colour that reads on it,
 * clipped to a circle that grows from the centre.
 */
function traceController(svg: SVGSVGElement, layer: HTMLElement) {
  const line = svg.querySelector<SVGRectElement>('.trace-line')!;
  const card = layer.parentElement!;
  let anims: Animation[] = [];
  let frame = 0;
  let timer = 0;
  let floodEnds: Promise<void> | null = null;
  const stop = () => { anims.forEach((a) => a.cancel()); anims = []; cancelAnimationFrame(frame); clearTimeout(timer); floodEnds = null; };
  const offset = () => parseFloat(getComputedStyle(line).strokeDashoffset) || 0;
  const reset = () => {
    line.style.strokeDashoffset = '1';
    line.style.opacity = '0';
    svg.style.opacity = '1';
    layer.style.opacity = '0';
    layer.style.removeProperty('--trace');
    layer.style.removeProperty('--on-trace');
    layer.replaceChildren();
  };
  const play = (el: Element, frames: Keyframe[], ms: number, easing: string, delay = 0) => {
    const a = el.animate(frames, { duration: ms, easing, delay, fill: 'forwards' });
    anims.push(a);
    return a;
  };
  /** The card's icon and words as they are now, to be shown in the fill's colour. */
  const copyContent = () => layer.replaceChildren(
    ...[...card.children].filter((c) => c.matches('.card-icon, .card-body')).map((c) => c.cloneNode(true)),
  );
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
    /** The commit: the circle grows over the card, the words invert under it, the fill fades, rest. */
    flood(reduce: boolean) {
      stop();
      line.style.opacity = '1';
      line.style.strokeDashoffset = '0';
      copyContent();
      // A selection usually changes the card's words (Listen becomes Stop). They render a frame or two
      // later, while the circle is still small, so the copy is refreshed to show the new words.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(copyContent); });
      const { width: w, height: h } = layer.getBoundingClientRect();
      const reach = `circle(${Math.ceil(Math.hypot(w, h) / 2) + 2}px at 50% 50%)`;
      layer.style.opacity = '1';
      layer.style.clipPath = reach;
      if (!reduce) play(layer, [{ clipPath: 'circle(0px at 50% 50%)' }, { clipPath: reach }], FLOOD_MS, EASE_STATE);
      // The fill keeps the colours it started with, even if the selection turns the card into another
      // (Menu becoming Back would otherwise flip its fill from ink to white mid-way).
      const look = getComputedStyle(card);
      const fill = getComputedStyle(layer).backgroundColor;
      layer.style.setProperty('--trace', fill);
      layer.style.setProperty('--on-trace', look.getPropertyValue('--on-trace'));
      const [ms, at] = reduce ? [200, 0] : [FADE_MS, FADE_AT];
      let settle: () => void = () => {};
      floodEnds = new Promise<void>((resolve) => { settle = resolve; }).then(() => { stop(); reset(); });
      timer = window.setTimeout(() => {
        // If the card the selection leads to is already the fill's colour, the fill is simply where
        // the card has arrived: hand over with no exit. Otherwise the filled card, its line and its
        // words fade out together, as one piece; nothing runs backwards.
        if (getComputedStyle(card).backgroundColor === fill) { settle(); return; }
        play(layer, [{ opacity: 1 }, { opacity: 0 }], ms, EASE_OUT);
        play(svg, [{ opacity: 1 }, { opacity: 0 }], ms, EASE_OUT).finished.then(settle, () => {});
      }, at);
    },
    clear() { stop(); reset(); },
  };
}

type Phase = 'rest' | 'fill' | 'preview' | 'done';

export function Tile({ action, tone, group, icon, label, disabled: disabledProp = false, gone = false, fast = false, onActivate, className = '', children }: Props) {
  const disabled = disabledProp || gone;
  const card = useRef<HTMLButtonElement>(null);
  const traceRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  // One controller for the card's whole life: a selection that changes the card's action (Menu
  // becoming Back, a page change) keeps its fill running across the change.
  const controller = useRef<ReturnType<typeof traceController> | null>(null);
  useEffect(() => {
    if (traceRef.current && fillRef.current) controller.current = traceController(traceRef.current, fillRef.current);
    return () => { controller.current?.clear(); controller.current = null; };
  }, []);

  useEffect(() => {
    let phase: Phase = 'rest';
    let step = -1;
    const trace = controller.current;
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
        <rect className="trace-line" pathLength={1} />
      </svg>
      {icon && <span className="card-icon" aria-hidden="true"><Swap swapKey={iconKey(icon)} className="glyph-swap" leavingClass="glyph-leaving" fast={fast}>{icon}</Swap></span>}
      <span className="card-body">{children}</span>
      <span ref={fillRef} className="trace-fill" aria-hidden="true" />
    </button>
  );
}
