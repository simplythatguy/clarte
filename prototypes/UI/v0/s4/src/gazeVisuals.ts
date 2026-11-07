/**
 * Renders the shared engine's dwell state onto the cards, outside React, once per snapshot.
 *
 * Choreography (BRIEF "Selection", MOTION.md "The dwell indicator"):
 * - Intent delay: the engine's 150 ms quadrant hold is the delay for letter keys; buttons wait a
 *   further 100 ms (250 ms in all). Nothing changes before that.
 * - Focus cue: one static step, the face one shade deeper and the ring's track fully opaque.
 * - Progress: the accent arc fills clockwise, linear, over the rest of the dwell: two composited
 *   rotations (see `Arc`), drained back over 150 ms from their live value when the gaze leaves.
 * - Commit: the ring turns solid accent and the bloom (a copy of the ring, transform and opacity
 *   only) runs on the same frame as the click. No bloom for keyboard selections.
 * - Re-arm: the ring stays solid while the gaze stays; it fades to the track once it has left.
 *
 * It also applies the two dwell classes and keeps auto-repeat to letter keys: the engine has one
 * `dwellMs` and one `repeat`, so both are set as the gaze reaches a key or a button, before any
 * dwell can finish. The setting is the time from the eyes arriving to the commit, so the engine's
 * hold is subtracted from it.
 */
import type { GazeEngine, GazeSnapshot } from '../../shared/gaze.ts';

export type DwellSpeeds = { letterMs: number; controlMs: number; repeat: 'leave' | 'redwell' };

const CONTROL_EXTRA_DELAY_MS = 100;
const BLOOM_MS = 450;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

type Visual = { state: 'focus' | 'dwell' | 'preview' | 'selected'; p: number };

function tileFor(action: string | null): HTMLElement | null {
  return action ? document.querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`) : null;
}

function ringOf(tile: HTMLElement): HTMLElement | null {
  return tile.querySelector<HTMLElement>('.content-in .ring');
}

function visualFor(s: GazeSnapshot, el: HTMLElement, dwellMs: number): Visual | null {
  const delay = el.dataset.dwellClass === 'letter' ? 0 : CONTROL_EXTRA_DELAY_MS;
  switch (s.state) {
    case 'dwelling': {
      const elapsed = s.progress * dwellMs;
      if (elapsed < delay) return null;
      return { state: elapsed <= delay ? 'focus' : 'dwell', p: Math.min(1, (elapsed - delay) / Math.max(1, dwellMs - delay)) };
    }
    case 'previewed':
      return { state: 'preview', p: 1 };
    case 'selected':
      // The latch outlives the look by the re-arm time; the ring lets go as soon as the eyes do.
      if (s.looked !== s.action) return null;
      return { state: 'selected', p: 1 };
    default:
      return null;
  }
}

/**
 * Cards whose meaning changed under the eyes (speech ended on Stop, the microphone failed on
 * Listen). The engine keeps dwelling on the same quadrant, so without this the new meaning would
 * run after one more dwell with no new look. A stale card shows no progress and its selection is
 * ignored until the eyes leave it.
 */
const stale = new Set<string>();
export const markStale = (action: string) => { stale.add(action); };
export const isStale = (action: string) => stale.has(action);
/** An explicit activation (click, screen reader) acts on what the card now says. */
export const clearStale = (action: string) => { stale.delete(action); };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function bloom(tile: HTMLElement): void {
  const el = tile.querySelector<HTMLElement>('.content-in .ring-bloom');
  if (!el || reducedMotion()) return;
  el.animate(
    [{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }],
    { duration: BLOOM_MS, easing: EASE_OUT },
  );
}

/** The rotation of each half for a progress value: the right half turns first, then the left. */
const turn = (p: number) => ({ r: Math.min(p, 0.5) * 360, l: Math.max(0, p - 0.5) * 360 });

/**
 * The arc as two composited rotations. A fill runs once per dwell, linear from the current value
 * to 1 over the time left; a drain retargets from the live value to 0 over 150 ms. Nothing is
 * written to a style attribute per frame, and the compositor runs both rotations, so a dwell costs
 * no layout or paint (MOTION.md acceptance 8).
 */
class Arc {
  private halves: [HTMLElement, HTMLElement];
  private animations: Animation[] = [];
  private from = 0;
  private to = 0;
  private duration = 1;
  private started = 0;
  private held = false;

  constructor(ring: HTMLElement) {
    this.halves = [ring.querySelector<HTMLElement>('.arc-r .arc-half')!, ring.querySelector<HTMLElement>('.arc-l .arc-half')!];
  }

  private value(): number {
    const t = Math.min(1, (performance.now() - this.started) / this.duration);
    return this.from + (this.to - this.from) * t;
  }

  private run(from: number, to: number, duration: number) {
    this.animations.forEach((a) => a.cancel());
    Object.assign(this, { from, to, duration: Math.max(1, duration), started: performance.now() });
    // Keyframes at the start, the end, and on each side of the two turning points (0 and 0.5),
    // where a half switches between hidden and shown. A half is hidden while it has not turned at
    // all, so the clip edges where the halves meet never show a hairline. Offsets follow progress,
    // so a linear timing keeps the arc's speed even across both halves.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const inside = (p: number) => p > lo && p < hi;
    const points = new Set([from, to]);
    for (const edge of [0.001, 0.5, 0.501]) if (inside(edge)) points.add(edge);
    const stops = [...points].sort((a, b) => (to >= from ? a - b : b - a));
    // A hold (from === to) still needs two keyframes, or its start falls back to the hidden base.
    if (stops.length === 1) stops.push(stops[0]);
    const offset = (p: number) => (to === from ? 0 : (p - from) / (to - from));
    const shown = { r: (p: number) => (p > 0.0005 ? 1 : 0), l: (p: number) => (p > 0.5005 ? 1 : 0) };
    this.animations = (['r', 'l'] as const).map((side, i) =>
      this.halves[i].animate(
        stops.map((p, k) => ({ transform: `rotate(${turn(p)[side]}deg)`, opacity: shown[side](p), offset: k === stops.length - 1 ? 1 : k === 0 ? 0 : offset(p) })),
        { duration: this.duration, easing: 'linear', fill: 'forwards' },
      ));
  }

  /** Fill to 1 by the engine's commit. Resuming after a hold continues from the live value. */
  fill(from: number, remainingMs: number) {
    if (this.held) { this.held = false; this.run(this.value(), 1, remainingMs); }
    else if (this.to !== 1) this.run(from, 1, remainingMs);
  }
  full() { this.held = false; if (this.to !== 1 || this.value() < 1) this.run(1, 1, 1); }
  drain() { this.held = false; if (this.to !== 0) this.run(this.value(), 0, 150); }
  /** The eyes have left but the engine has not cancelled yet: the arc stops where it is. */
  hold() { if (!this.held) { const v = this.value(); this.held = true; this.run(v, v, 1); } }
  /** After a commit the solid ring fades to the track rather than unwinding like a cancel. */
  fadeOut() {
    this.held = false;
    this.animations.forEach((a) => a.cancel());
    Object.assign(this, { from: 0, to: 0, duration: 1, started: performance.now() });
    this.animations = (['r', 'l'] as const).map((_, i) =>
      this.halves[i].animate(
        [{ transform: 'rotate(180deg)', opacity: 1 }, { transform: 'rotate(180deg)', opacity: 0, offset: 0.999 }, { transform: 'rotate(0deg)', opacity: 0 }],
        { duration: 150, easing: EASE_OUT, fill: 'forwards' },
      ));
  }
}

export function attachGazeVisuals(engine: GazeEngine, speeds: () => DwellSpeeds, keyboardAt: () => number): () => void {
  let current: { tile: HTMLElement; arc: Arc | null; state: Visual['state'] } | null = null;
  let lastLooked: string | null = null;

  const release = () => {
    if (!current) return;
    delete current.tile.dataset.dwell;
    delete current.tile.dataset.step;
    if (current.state === 'selected') current.arc?.fadeOut(); else current.arc?.drain();
    current = null;
  };

  return engine.subscribe((snapshot, event) => {
    for (const id of stale) if (snapshot.looked !== id) stale.delete(id);
    if (snapshot.looked !== lastLooked) {
      lastLooked = snapshot.looked;
      const looked = tileFor(snapshot.looked);
      if (looked) {
        const { letterMs, controlMs, repeat } = speeds();
        const letter = looked.dataset.dwellClass === 'letter';
        const dwellMs = Math.max(100, (letter ? letterMs : controlMs) - engine.settings.holdMs);
        const wantRepeat = letter ? repeat : 'leave';
        if (engine.settings.dwellMs !== dwellMs || engine.settings.repeat !== wantRepeat) engine.configure({ dwellMs, repeat: wantRepeat });
      }
    }

    if (event?.type === 'select') {
      const tile = tileFor(event.action);
      // Keyboard selections get no motion at all.
      if (tile && !stale.has(event.action) && performance.now() - keyboardAt() > 80) bloom(tile);
    }

    const el = tileFor(snapshot.action);
    const visual = el && !(snapshot.action && stale.has(snapshot.action)) ? visualFor(snapshot, el, engine.settings.dwellMs) : null;
    if (current && (current.tile !== el || !visual)) release();
    if (!el || !visual) return;

    if (!current) {
      const ring = ringOf(el);
      current = { tile: el, arc: ring ? new Arc(ring) : null, state: visual.state };
    }
    if (el.dataset.dwell !== visual.state) el.dataset.dwell = visual.state;
    // Reduced motion shows progress as four opacity steps of the ring instead of the arc.
    if (reducedMotion()) {
      const step = String(visual.state === 'dwell' || visual.state === 'focus' ? Math.floor(visual.p * 4) : 4);
      if (el.dataset.step !== step) el.dataset.step = step;
    }
    if (visual.state === 'dwell' || visual.state === 'focus') {
      // In the engine's grace (it no longer counts this card as looked at, and cannot commit it)
      // the arc stops where it is; it drains if the engine cancels, and continues if the eyes
      // return. While the engine still counts the look, the arc keeps filling, because the
      // engine can still commit it.
      const away = snapshot.looked !== snapshot.action;
      const delay = el.dataset.dwellClass === 'letter' ? 0 : CONTROL_EXTRA_DELAY_MS;
      if (away) current.arc?.hold();
      else current.arc?.fill(visual.p, (1 - visual.p) * Math.max(1, engine.settings.dwellMs - delay));
    } else {
      current.arc?.full();
    }
    current.state = visual.state;
  });
}
