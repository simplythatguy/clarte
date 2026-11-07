/**
 * The dwell arc as two compositor-only animations (MOTION "The dwell indicator", acceptance 8).
 *
 * The ring's accent arc is drawn by two half-ring "blades", each inside a container clipped to one
 * half of the ring. The right blade rotates 0 → 180° over the first half of the dwell, the left
 * blade over the second half, so the arc grows clockwise from 12 o'clock. Only `transform`
 * animates, through the Web Animations API, so the browser draws it on the compositor: no layout
 * and no paint per frame. A cancel plays the same animations backwards from where they are, so the
 * arc drains instead of snapping; a commit finishes them, which leaves the ring solid.
 *
 * Under reduced motion the blades are hidden (CSS) and the track's opacity steps 0.3 → 1 in four
 * steps across the same time instead.
 */
export type ArcRun = { anims: Animation[]; duration: number };

const RIGHT: Keyframe[] = [{ transform: 'rotate(0deg)', offset: 0 }, { transform: 'rotate(180deg)', offset: 0.5 }, { transform: 'rotate(180deg)', offset: 1 }];
const LEFT: Keyframe[] = [{ transform: 'rotate(0deg)', offset: 0 }, { transform: 'rotate(0deg)', offset: 0.5 }, { transform: 'rotate(180deg)', offset: 1 }];
const TRACK: Keyframe[] = [{ opacity: 0.3 }, { opacity: 1 }];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Start drawing the arc in `mark` over `ms`, from empty. Cancels any run in progress. */
export function drawArc(mark: Element, ms: number, previous?: ArcRun): ArcRun {
  previous?.anims.forEach((a) => a.cancel());
  const duration = Math.max(1, ms);
  if (reduced()) {
    const ring = mark.querySelector('.ring');
    return { duration, anims: ring ? [ring.animate(TRACK, { duration, easing: 'steps(4, end)', fill: 'forwards' })] : [] };
  }
  const right = mark.querySelector('.arc-half--right .arc-blade');
  const left = mark.querySelector('.arc-half--left .arc-blade');
  const anims: Animation[] = [];
  if (right) anims.push(right.animate(RIGHT, { duration, easing: 'linear', fill: 'forwards' }));
  if (left) anims.push(left.animate(LEFT, { duration, easing: 'linear', fill: 'forwards' }));
  return { duration, anims };
}

/** Play the run backwards from where it is, reaching empty in `ms` however full it was. */
export function drainArc(run: ArcRun, ms = 150): void {
  for (const a of run.anims) {
    if (a.playState === 'idle') continue;
    const at = Math.min(Number(a.currentTime ?? 0), run.duration);
    if (!(at > 0)) { a.cancel(); continue; }
    a.playbackRate = -at / ms;
    a.onfinish = () => a.cancel();
    if (a.playState === 'finished' || a.playState === 'paused') a.play();
  }
}

/** Complete the arc at once: the solid ring of a commit. */
export function fillArc(mark: Element, run?: ArcRun): ArcRun {
  const r = run && run.anims.length ? run : drawArc(mark, 1);
  r.anims.forEach((a) => { a.playbackRate = 1; a.onfinish = null; a.finish(); });
  return r;
}

/** Remove the arc without motion (after its fade-out). */
export function clearArc(run?: ArcRun): void {
  run?.anims.forEach((a) => a.cancel());
}
