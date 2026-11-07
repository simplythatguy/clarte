/**
 * Paints the shared engine's dwell state onto the tiles (MOTION "The dwell indicator").
 *
 * Writes happen only at state changes, never per frame; the arc itself runs on the compositor
 * (`arc.ts`).
 *
 *   idle ──(intent delay passed)──▶ focus ──(engine selects)──▶ done ──(gaze leaves)──▶ release ──▶ idle
 *                  ▲                  │ (look leaves before the end: the arc drains in 150 ms)
 *                  └──────────────────┘
 *
 * focus: the face steps one shade and the track becomes opaque (CSS on `data-dwell`), the arc
 * draws over exactly the dwell time remaining. done: the arc is complete (solid accent ring); the
 * bloom runs once. release: the solid ring fades to the track over 150 ms.
 */
import type { GazeEngine, GazeSnapshot } from '../../shared/gaze.ts';
import { dwellClass } from './model.ts';
import { clearArc, drainArc, drawArc, fillArc, type ArcRun } from './arc.ts';

export type DwellPaint = 'idle' | 'focus' | 'drain' | 'done' | 'release';

export const INTENT_DELAY = { letter: 150, control: 250 } as const;
const CUE_MS = 150;
const OUT_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createDwellPainter(root: () => HTMLElement | null) {
  let current: HTMLElement | null = null;
  const runs = new WeakMap<HTMLElement, ArcRun>();
  const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  const mark = (el: HTMLElement) => el.querySelector('.mark');
  const setState = (el: HTMLElement, paint: DwellPaint) => { if (el.dataset.dwell !== paint) el.dataset.dwell = paint; };

  const toIdle = (el: HTMLElement) => {
    const state = el.dataset.dwell;
    const run = runs.get(el);
    if (state === 'done') {
      // Re-arm: the solid ring fades back to its track once gaze has left.
      setState(el, 'release');
      clearTimeout(timers.get(el));
      if (reduced()) {
        // Release fades the track back instead of snapping (the stepped opacity holds it at 1).
        const track = el.querySelector('.ring');
        clearArc(run);
        runs.delete(el);
        track?.animate([{ opacity: 1 }, { opacity: 0.3 }], { duration: CUE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      }
      timers.set(el, setTimeout(() => {
        if (el.dataset.dwell !== 'release') return;
        clearArc(runs.get(el));
        runs.delete(el);
        setState(el, 'idle');
      }, CUE_MS));
    } else if (state === 'focus') {
      // Cancelled: the arc drains back from where it is instead of vanishing.
      if (run) drainArc(run, CUE_MS);
      setState(el, 'drain');
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => { if (el.dataset.dwell === 'drain') setState(el, 'idle'); }, CUE_MS));
    }
  };

  const paint = (snap: GazeSnapshot, engine: GazeEngine) => {
    const host = root();
    const id = snap.action;
    const el = host && id ? host.querySelector<HTMLElement>(`[data-action="${CSS.escape(id)}"]`) : null;
    if (el !== current) { if (current) toIdle(current); current = el; }
    if (!el || !id) return;
    const m = mark(el);
    if (!m) return;
    const state = el.dataset.dwell ?? 'idle';
    const dwellMs = engine.settings.dwellMs;

    if (snap.state === 'dwelling') {
      const elapsed = snap.progress * dwellMs;
      if (elapsed < INTENT_DELAY[dwellClass(id)]) { if (state === 'focus' || state === 'done') toIdle(el); return; }
      if (state !== 'focus') {
        clearTimeout(timers.get(el));
        setState(el, 'focus');
        runs.set(el, drawArc(m, dwellMs - elapsed, runs.get(el)));
      }
      // After the look leaves, the engine keeps the dwell alive twice over: for its 150 ms quadrant
      // hold it still counts the look as on the tile (and can commit), so the arc keeps filling,
      // because it is the engine's truth; then for its 150 ms grace it has moved the look away
      // but keeps the progress, and cannot commit. The arc pauses for the grace, so it never
      // fills on a tile the engine itself has left, and never pauses before a commit. On return
      // the arc jumps to the engine's progress (the clock kept running); a cancel drains from
      // where it stopped.
      const run = runs.get(el);
      if (run) {
        const away = snap.looked !== id;
        const remaining = dwellMs - elapsed;
        for (const a of run.anims) {
          if (away && a.playState === 'running') a.pause();
          else if (!away && a.playState === 'paused') { a.currentTime = Math.max(0, run.duration - remaining); a.play(); }
        }
      }
    } else if (snap.state === 'previewed') {
      if (state !== 'focus') { setState(el, 'focus'); runs.set(el, fillArc(m, runs.get(el))); }
    } else if (snap.state === 'selected' && snap.looked === id) {
      // "Keep looking" (letters only): after the commit cue, the next repeat counts down visibly.
      const repeatMs = dwellMs * 1.5;
      const sinceCommit = snap.progress * repeatMs;
      if (engine.settings.repeat === 'redwell' && state === 'done' && sinceCommit > 150 && snap.progress < 1) {
        setState(el, 'focus');
        runs.set(el, drawArc(m, repeatMs - sinceCommit, runs.get(el)));
        return;
      }
      if (state === 'focus' && engine.settings.repeat === 'redwell' && snap.progress < 1) return;
      if (state !== 'done') {
        clearTimeout(timers.get(el));
        runs.set(el, fillArc(m, runs.get(el)));
        setState(el, 'done');
      }
    } else {
      toIdle(el);
    }
  };

  /** Every selection completes the ring at once (the start of a repeat cycle too). */
  const commit = (id: string) => {
    const el = root()?.querySelector<HTMLElement>(`[data-action="${CSS.escape(id)}"]`);
    const m = el && mark(el);
    if (!el || !m) return;
    clearTimeout(timers.get(el));
    runs.set(el, fillArc(m, runs.get(el)));
    setState(el, 'done');
  };

  /** The one celebration: a copy of the ring scales 1 → 2.4 and fades .35 → 0 over 450 ms. */
  const bloom = (id: string) => {
    if (reduced()) return;
    const el = root()?.querySelector<HTMLElement>(`[data-action="${CSS.escape(id)}"] .ring-bloom`);
    el?.animate(
      [{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }],
      { duration: 450, easing: OUT_EASE },
    );
  };

  return { paint, commit, bloom };
}
