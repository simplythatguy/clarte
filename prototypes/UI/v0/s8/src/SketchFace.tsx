/**
 * The Cloud's face: a few pen lines on the orb that draw themselves (owner, 2026-11-07, after a
 * hand-drawn onboarding reference). Only the lines are drawn; the orb is the face's round body.
 *
 * Sharp, pen-like and alive (NAT-26, owner 2026-11-07: "sharper … behave in a way that's realistic"):
 * - The lines are crisp vector ink. The old turbulence filter, which blurred and wobbled them, is gone.
 * - Entering: each stroke draws once with a pen's bell-shaped speed (slow start, fast middle, slow
 *   finish). A stroke's time follows its length, so a dot is a quick tap (90 ms) and a long mouth
 *   takes up to 480 ms. Between strokes the pen lifts and travels: the pause grows with the distance
 *   to the next stroke's start (50–150 ms), with a little hand-to-hand variation. Eyes first, then
 *   the mouth, then the extras.
 * - Once drawn: open eyes blink (a first blink as the face settles, then every 2.8–6.5 s, sometimes
 *   twice), and each reaction plays its own motion (expressions.ts `life` and `face`, styles.css).
 * - Leaving: the strokes erase themselves in reverse order, the last drawn first, each one
 *   retracting to where the pen started (140 ms, 40 ms apart). Then the orb fades (Orb.tsx).
 * - Changing face: the old face erases, then the new one draws.
 * With `alive` false (the Cloud set to Still) or under reduced motion nothing blinks or moves; under
 * reduced motion the faces cross-fade over 150 ms instead of drawing.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EXPRESSIONS, strokeOf, type ExpressionKind } from './expressions.ts';

const ERASE_MS = 140;
const ERASE_GAP = 40;
/** A stroke's drawing time from its length in grid units: a dot is a tap, a long line a sweep. */
const pace = (length: number) => Math.min(480, Math.max(90, 60 + length * 4.2));
/** The pen's lift and travel to the next stroke, from the distance between them, with a stable jitter. */
const lift = (distance: number, jitter: number) => Math.min(150, Math.max(50, 45 + distance * 1.7 + jitter));
export const eraseTime = (kind: ExpressionKind) => ERASE_MS + ERASE_GAP * (EXPRESSIONS[kind].strokes.length - 1);
const seedOf = (kind: string) => [...kind].reduce((s, c) => s + c.charCodeAt(0), 0);
/** A deterministic −12…12 ms wobble per stroke, so each face keeps its own hand. */
const jitterOf = (seed: number, i: number) => (((seed * 31 + i * 17) % 25) - 12);

const BLINK_MS = 190;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Mode = 'draw' | 'erase' | 'still';

/**
 * One face, drawn or erased. `mode: still` shows it finished, without motion (galleries).
 * `alive` lets a drawn face blink and play its reaction's motion.
 */
export function Strokes({ kind, mode, delayMs = 0, className = '', alive = false }: { kind: ExpressionKind; mode: Mode; delayMs?: number; className?: string; alive?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const drawnAt = useRef(0);
  const def = EXPRESSIONS[kind];
  const strokes = def.strokes.map(strokeOf);
  const hasEyes = strokes.some((s) => s.eye);

  useLayoutEffect(() => {
    const root = svg.current;
    if (!root) return;
    const paths = [...root.querySelectorAll<SVGPathElement>('path')];
    if (mode === 'draw') {
      const seed = seedOf(kind);
      let at = delayMs;
      let prevEnd: DOMPoint | null = null;
      paths.forEach((p, i) => {
        const length = p.getTotalLength();
        if (prevEnd) {
          const start = p.getPointAtLength(0);
          at += lift(Math.hypot(start.x - prevEnd.x, start.y - prevEnd.y), jitterOf(seed, i));
        }
        const ms = pace(length);
        p.style.setProperty('--delay', `${Math.round(at)}ms`);
        p.style.setProperty('--dur', `${Math.round(ms)}ms`);
        at += ms;
        prevEnd = p.getPointAtLength(length);
      });
      // The face comes alive a beat after the pen lifts from its last stroke.
      drawnAt.current = at + 180;
      root.style.setProperty('--life-delay', `${Math.round(drawnAt.current)}ms`);
    } else if (mode === 'erase') {
      paths.forEach((p, i) => {
        p.style.setProperty('--delay', `${(paths.length - 1 - i) * ERASE_GAP}ms`);
        p.style.setProperty('--dur', `${ERASE_MS}ms`);
      });
    }
  }, [kind, mode, delayMs]);

  // Blinking: a settling blink soon after the face is drawn, then at natural, uneven intervals.
  useEffect(() => {
    const root = svg.current;
    if (!root || !alive || mode !== 'draw' || !hasEyes || reducedMotion()) return;
    let timer = 0;
    const blink = (then: () => void) => {
      root.removeAttribute('data-blink');
      void root.getBoundingClientRect(); // restart the animation
      root.setAttribute('data-blink', '');
      timer = window.setTimeout(() => { root.removeAttribute('data-blink'); then(); }, BLINK_MS);
    };
    const next = (wait: number) => {
      timer = window.setTimeout(() => {
        const again = Math.random() < 0.18;
        blink(() => (again ? (timer = window.setTimeout(() => blink(() => next(2800 + Math.random() * 3700)), 110)) : next(2800 + Math.random() * 3700)));
      }, wait);
    };
    next(drawnAt.current + 700 + Math.random() * 600);
    return () => { clearTimeout(timer); root.removeAttribute('data-blink'); };
  }, [alive, mode, hasEyes, kind]);

  return (
    <svg ref={svg} className={`sketch ${className}`} data-mode={mode} data-kind={kind} data-alive={alive && mode !== 'still' ? '' : undefined} viewBox="16 16 88 88" aria-hidden="true">
      <g className="sketch-face" data-life={def.face}>
        {strokes.map((s, i) => (
          <g key={i} className="sketch-part" data-eye={s.eye ? '' : undefined} data-life={s.life} style={s.offset ? { ['--offset' as string]: `${s.offset}ms` } : undefined}>
            <g className="sketch-blink">
              <path d={s.d} pathLength={1} />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * The face the Cloud wears. `visible` false erases it; a new `kind` erases the old face and draws
 * the new one. `enterDelay` lets the orb arrive before the pen starts. `alive` (default on) lets
 * it blink and move once drawn; pass false when the Cloud is Still.
 */
export function SketchFace({ kind, visible, enterDelay = 0, alive = true }: { kind: ExpressionKind; visible: boolean; enterDelay?: number; alive?: boolean }) {
  const [shown, setShown] = useState<{ kind: ExpressionKind; mode: Mode; n: number; delay: number } | null>(visible ? { kind, mode: 'draw', n: 0, delay: enterDelay } : null);
  const want = visible ? kind : null;
  useEffect(() => {
    setShown((s) => {
      if (!s) return want ? { kind: want, mode: 'draw', n: 1, delay: enterDelay } : null;
      if (want === s.kind && s.mode === 'draw') return s;
      if (s.mode === 'erase') return s; // the erase finishes first (below)
      return { ...s, mode: 'erase' };
    });
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  // After an erase: draw what is wanted now, or nothing.
  const wantRef = useRef(want);
  wantRef.current = want;
  useEffect(() => {
    if (!shown || shown.mode !== 'erase') return;
    const t = setTimeout(() => {
      const next = wantRef.current;
      setShown((s) => (next ? { kind: next, mode: 'draw', n: (s?.n ?? 0) + 1, delay: 60 } : null));
    }, eraseTime(shown.kind) + 30);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  return <Strokes key={`${shown.kind}-${shown.n}`} kind={shown.kind} mode={shown.mode} delayMs={shown.delay} alive={alive} />;
}
