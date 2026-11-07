/**
 * Gaze wiring for style 2: the shared engine, two dwell classes, the dwell painter and the pointer
 * stream.
 *
 * The shared engine has one `dwellMs`. Letter groups and controls need different dwell times, so
 * the painter sets `dwellMs` (and the repeat rule) for whichever action the engine is looking at
 * before its next check.
 *
 * The painter owns the choreography of a selection (BRIEF "Selection", MOTION.md "The dwell
 * indicator"). It is event-driven: it writes only when a tile changes state, never per frame.
 *  - rest: the ring's track at 30%;
 *  - after 150 ms (groups) / 250 ms (controls): focus, one static step (face one shade, track opaque);
 *  - progress: two half-discs rotate under a ring mask (CSS transform transitions, linear, over the
 *    remaining dwell), so the compositor fills the arc and a cancel retargets from the current angle;
 *  - cancel: both halves rotate back to 0 over 150 ms;
 *  - commit: the ring is solid accent for 120 ms and blooms once (WAAPI, transform + opacity);
 *  - latched: the ring stays solid while gaze remains, and fades to the track once gaze leaves.
 * The rules go into one <style> in <head>, outside the subtree the actionable tracker observes.
 */
import { GazeEngine, type GazeSnapshot } from '../../shared/gaze.ts';
import { actionIn, collectActionables, viewportOf, type QuadrantId } from '../../shared/quadrants.ts';
import { arcRule } from './parts.tsx';

export const engine = new GazeEngine({ mode: 'dwell', dwellMs: 600 });

const GROUPS = new Set(['G1', 'G2', 'G3', 'G4']);
export const isGroup = (action: string | null): boolean => action !== null && GROUPS.has(action);

export type DwellTimes = { letter: number; control: number; repeat: 'leave' | 'redwell' };

export function resolveQuadrant(quadrant: QuadrantId): string | null {
  return actionIn(quadrant, collectActionables(), viewportOf())?.id ?? null;
}

type TileState = 'progress' | 'preview' | 'done' | 'drain';
type Paint = { state: TileState; rule: string };

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startDwellPainter(getTimes: () => DwellTimes): () => void {
  const sheet = document.createElement('style');
  sheet.dataset.owner = 'dwell';
  document.head.append(sheet);
  const painted = new Map<string, Paint>();
  const timers = new Map<string, number>();

  const element = (id: string) => document.querySelector<HTMLElement>(`[data-action="${id}"]`);
  const render = () => {
    sheet.textContent = Array.from(painted.values(), (p) => p.rule).join('\n');
    // Any card still marked for an action the painter no longer tracks is stale: clear it.
    document.querySelectorAll<HTMLElement>('[data-dwell]').forEach((el) => {
      if (!painted.has(el.dataset.action ?? '')) delete el.dataset.dwell;
    });
  };

  const set = (id: string, state: TileState | null, rule = '') => {
    const el = element(id);
    if (el) {
      if (state) el.dataset.dwell = state;
      else delete el.dataset.dwell;
    }
    if (state) painted.set(id, { state, rule });
    else painted.delete(id);
    render();
  };

  const arc = (id: string, to: 0 | 1, ms: number, timing = 'linear') => arcRule(`[data-action="${id}"]`, to, ms, timing, reduced());

  const onSnapshot = (s: GazeSnapshot) => {
    const times = getTimes();
    // Two dwell classes, and "keep looking" repeats letter groups only: a control never repeats,
    // because its label may already have changed under the gaze (BRIEF: no auto-repeat).
    const target = s.state === 'idle' ? s.looked : s.action;
    const dwellMs = isGroup(target) ? times.letter : times.control;
    const repeat = isGroup(target) ? times.repeat : 'leave';
    if (engine.settings.dwellMs !== dwellMs || engine.settings.repeat !== repeat) engine.settings = { ...engine.settings, dwellMs, repeat };

    // A latched selection shows its solid ring only while gaze stays on it; once gaze leaves, the
    // ring fades at once, even though the engine waits 300 ms to re-arm, so the solid ring can never
    // sit under a label that has already changed.
    const latchedAway = s.state === 'selected' && s.looked !== s.action;
    const active = (s.state === 'dwelling' || s.state === 'previewed' || s.state === 'selected') && !latchedAway ? s.action : null;

    // Anything no longer under gaze drains back and clears.
    for (const [id, paint] of painted) {
      if (id === active || paint.state === 'drain') continue;
      // A cancelled dwell drains back along the arc; a latched ring after a commit fades instead
      // (MOTION.md "Re-arm"), because unwinding would read as a cancel right after a success.
      const scope = `[data-action="${id}"]`;
      set(id, 'drain', paint.state === 'done'
        ? `${scope} .arc-a{transform:rotate(225deg);opacity:1;transition:none}${scope} .arc-b{transform:rotate(405deg);opacity:1;transition:none}${scope} .arcbox{opacity:0;transition:opacity 150ms cubic-bezier(0.2, 0, 0, 1)}`
        : arc(id, 0, 150));
      window.clearTimeout(timers.get(id));
      timers.set(id, window.setTimeout(() => { if (painted.get(id)?.state === 'drain') set(id, null); }, 170));
    }
    if (!active) return;

    const current = painted.get(active)?.state;
    if (s.state === 'dwelling') {
      const delay = isGroup(active) ? 150 : 250;
      const elapsed = s.progress * dwellMs;
      if (elapsed < delay) return;
      if (current !== 'progress') {
        window.clearTimeout(timers.get(active));
        const remaining = Math.max(0, dwellMs - elapsed);
        const timing = 'linear';
        // Focus (one static step) and the start of the fill land on the same frame.
        set(active, 'progress', arc(active, 1, remaining, timing));
      }
    } else if (s.state === 'previewed') {
      if (current !== 'preview') set(active, 'preview', arc(active, 1, 0));
    } else if (s.state === 'selected') {
      if (current !== 'done') set(active, 'done', arc(active, 1, 0));
    }
  };

  const unsubscribe = engine.subscribe(onSnapshot);
  return () => { unsubscribe(); sheet.remove(); timers.forEach((t) => window.clearTimeout(t)); };
}

/**
 * Commit: the ring turns solid accent for 120 ms and blooms once, a copy of the ring scaling from
 * 1 to 2.4 while fading from 0.35 to 0 over 450 ms (MOTION.md). Transform and opacity only, on an
 * absolutely positioned element, so no layout moves. Skipped for keyboard input and reduced motion.
 */
export function commitCue(id: string, animate: boolean): void {
  const el = document.querySelector<HTMLElement>(`[data-action="${id}"]`);
  if (!el) return;
  el.dataset.commit = '';
  window.setTimeout(() => { delete el.dataset.commit; }, 120);
  // The solid ring and the bloom are drawn on the card itself, over the ring's position, because a
  // selection that changes the screen replaces the card's label layer on the next frame (round 4:
  // Menu and Done lost their bloom). Measured before the state change; removed when it finishes.
  const ring = el.querySelector<HTMLElement>('.xf-layer:not(.xf-out) .ringwrap');
  if (!ring) return;
  const a = el.getBoundingClientRect();
  const r = ring.getBoundingClientRect();
  const cue = document.createElement('span');
  cue.className = 'commit-cue';
  cue.setAttribute('aria-hidden', 'true');
  Object.assign(cue.style, { left: `${r.left - a.left}px`, top: `${r.top - a.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  el.append(cue);
  const frames: Keyframe[] = animate && !reduced()
    ? [{ transform: 'scale(1)', opacity: 1, offset: 0 }, { transform: 'scale(1)', opacity: 0.35, offset: 0.2 }, { transform: 'scale(2.4)', opacity: 0, offset: 1 }]
    : [{ opacity: 1 }, { opacity: 0 }];
  const run = cue.animate(frames, { duration: animate && !reduced() ? 570 : 120, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  run.onfinish = () => cue.remove();
  run.oncancel = () => cue.remove();
}

/**
 * The mouse as a tracker. The shared `attachPointer` samples only on pointer events, so a mouse held
 * still goes stale after `staleMs` (600 ms) and a dwell longer than that never completes. A webcam
 * tracker streams continuously, so this re-samples the last pointer position at 30 Hz; it also
 * makes the noise setting jitter a still gaze, as real noise would. Once the pointer leaves the
 * window the stream keeps sending empty samples, so the engine drops the quadrant after its 200 ms
 * blink grace and an in-progress dwell is cancelled ("looking off screen cancels"), as a tracker
 * that lost the eyes would. Proposed for shared in REPORT.md.
 */
export function attachPointerStream(): () => void {
  let last: { x: number; y: number } | 'lost' | 'none' = 'none';
  const move = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; engine.sample(last.x, last.y, e.timeStamp); };
  const leave = () => { last = 'lost'; engine.sample(null, null); };
  const timer = window.setInterval(() => {
    if (last === 'lost') engine.sample(null, null);
    else if (last !== 'none') engine.sample(last.x, last.y);
  }, 33);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerdown', move);
  document.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerdown', move);
    document.removeEventListener('pointerleave', leave);
    window.removeEventListener('blur', leave);
  };
}
