/**
 * The mouse as a gaze tracker that streams.
 *
 * `shared/gaze.ts` `attachPointer` samples only on pointer events, so a pointer held still sends
 * nothing and the engine declares the gaze lost after `staleMs` (600 ms), before any dwell can
 * finish. A tracker reports continuously, so this adapter re-sends the last pointer position at
 * 30 Hz while the pointer is in the window. When the pointer leaves the window (looking off
 * screen) the dwell is cancelled at once and loss keeps being reported until the quadrant clears.
 * Proposed for shared in REPORT.md.
 */
import type { GazeEngine } from '../../shared/gaze.ts';

const RATE_MS = 33;

export function attachPointerStream(engine: GazeEngine): () => void {
  let last: { x: number; y: number } | null = null;
  let away = false;
  const move = (e: PointerEvent) => {
    away = false;
    last = { x: e.clientX, y: e.clientY };
    engine.sample(last.x, last.y, e.timeStamp);
  };
  const leave = (e: PointerEvent) => {
    if (e.relatedTarget) return; // still inside the page
    last = null;
    away = true;
    engine.cancel(e.timeStamp);
    engine.sample(null, null, e.timeStamp);
  };
  const timer = setInterval(() => {
    const now = performance.now();
    if (last) engine.sample(last.x, last.y, now);
    else if (away) engine.sample(null, null, now);
  }, RATE_MS);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerdown', move);
  window.addEventListener('pointerout', leave);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerdown', move);
    window.removeEventListener('pointerout', leave);
  };
}
