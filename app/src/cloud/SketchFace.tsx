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
import { faceMirror, subscribeFace, useMirrorSmile } from '../eyes/expression.ts';

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

/**
 * The slow smile (NAT-44, owner 2026-11-08: "when the cloud returns to the center it smiles slowly"):
 * the resting mouth widens and its corners lift, eased over SMILE_MS once the Cloud has landed
 * (SMILE_DELAY), and the eyes narrow a little, as a real smile reaches the eyes (styles.css, from
 * --smile). It relaxes faster than it comes. Only the resting face smiles this way.
 */
const SMILES: Partial<Record<ExpressionKind, { index: number; to: string }[]>> = {
  neutral: [{ index: 2, to: 'M43 68 Q60 87 77 68' }],
};
const SMILE_DELAY = 450;
const SMILE_MS = 1900;
const UNSMILE_MS = 450;
/** Mirroring the person's smile (NAT-47) follows them closely: no wait, and quicker. */
const MIRROR_SMILE_MS = 600;
/** Which side of the face an eye is on, from where its stroke starts: the Cloud's screen left or right. */
const sideOf = (d: string) => (Number(d.match(/-?\d+(\.\d+)?/)?.[0] ?? 60) < 60 ? 'l' : 'r');
const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
/** The path between `from` (0) and `to` (1); both have the same commands, so only the numbers move. */
function between(from: string, to: string, t: number): string {
  const a = numbers(from), b = numbers(to);
  let i = 0;
  return from.replace(/-?\d+(\.\d+)?/g, () => { const v = a[i] + (b[i] - a[i]) * t; i++; return v.toFixed(2); });
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Mode = 'draw' | 'erase' | 'still';

/**
 * One face, drawn or erased. `mode: still` shows it finished, without motion (galleries).
 * `alive` lets a drawn face blink and play its reaction's motion.
 */
export function Strokes({ kind, mode, delayMs = 0, className = '', alive = false, smile = false }: { kind: ExpressionKind; mode: Mode; delayMs?: number; className?: string; alive?: boolean; smile?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const drawnAt = useRef(0);
  const def = EXPRESSIONS[kind];
  const strokes = def.strokes.map(strokeOf);
  const hasEyes = strokes.some((s) => s.eye);
  // Mirroring (NAT-47): the person's smile; the slow smile (calibration) still wins when asked for.
  const mirrorSmile = useMirrorSmile();
  const smiling = smile || (alive && mode === 'draw' && mirrorSmile);
  const slowSmile = smile;

  // The slow smile: the mouth's path eases between its rest and its smile, from wherever it is now.
  const smileAt = useRef(0);
  useEffect(() => {
    const spec = SMILES[kind];
    const paths = svg.current?.querySelectorAll<SVGPathElement>('.sketch-blink > path');
    if (!spec || !paths || mode === 'erase') return;
    const goal = smiling ? 1 : 0;
    const set = (t: number) => {
      smileAt.current = t;
      const e = easeInOut(t);
      for (const m of spec) paths[m.index]?.setAttribute('d', between(strokes[m.index].d, m.to, e));
      svg.current?.style.setProperty('--smile', e.toFixed(3));
    };
    if (reducedMotion() || mode === 'still') { set(goal); return; }
    const from = smileAt.current;
    if (from === goal) return;
    const ms = (smiling ? (slowSmile ? SMILE_MS : MIRROR_SMILE_MS) : UNSMILE_MS) * Math.abs(goal - from);
    const delay = smiling && slowSmile ? SMILE_DELAY : 0;
    let frame = 0;
    const began = performance.now() + delay;
    const step = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - began) / ms));
      set(from + (goal - from) * u);
      if (u < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [smiling, kind, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirroring (NAT-47): each eye closes while the person's eye on that side is shut (a blink or a
  // wink), written straight to the element so it keeps up with the camera without re-rendering.
  useEffect(() => {
    const root = svg.current;
    if (!root || !alive || mode !== 'draw' || !hasEyes) return;
    // A shut eye is drawn as a closed lid, a small curve across where the eye is now (its shape
    // may have changed with a smile).
    const lids = () => {
      for (const part of root.querySelectorAll<SVGGElement>('.sketch-part[data-eye]')) {
        const eye = part.querySelector<SVGPathElement>('.sketch-blink > path');
        const lid = part.querySelector<SVGPathElement>('.sketch-lid');
        if (!eye || !lid) continue;
        const b = eye.getBBox();
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2, w = Math.max(10, b.width * 1.5);
        lid.setAttribute('d', `M${(cx - w / 2).toFixed(2)} ${(cy - 0.6).toFixed(2)} Q${cx.toFixed(2)} ${(cy + 3.4).toFixed(2)} ${(cx + w / 2).toFixed(2)} ${(cy - 0.6).toFixed(2)}`);
      }
    };
    const apply = () => {
      const f = faceMirror();
      if ((f.shutLeft && !root.hasAttribute('data-shut-l')) || (f.shutRight && !root.hasAttribute('data-shut-r'))) lids();
      root.toggleAttribute('data-shut-l', f.shutLeft);
      root.toggleAttribute('data-shut-r', f.shutRight);
    };
    apply();
    const off = subscribeFace(apply);
    return () => { off(); root.removeAttribute('data-shut-l'); root.removeAttribute('data-shut-r'); };
  }, [alive, mode, hasEyes, kind]);

  useLayoutEffect(() => {
    const root = svg.current;
    if (!root) return;
    const paths = [...root.querySelectorAll<SVGPathElement>('.sketch-blink > path')];
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
        // While it mirrors a face, the person's own blinks are its blinks (above).
        if (faceMirror().present) { next(1200); return; }
        const again = Math.random() < 0.18;
        blink(() => (again ? (timer = window.setTimeout(() => blink(() => next(2800 + Math.random() * 3700)), 110)) : next(2800 + Math.random() * 3700)));
      }, wait);
    };
    next(drawnAt.current + 700 + Math.random() * 600);
    return () => { clearTimeout(timer); root.removeAttribute('data-blink'); };
  }, [alive, mode, hasEyes, kind]);

  return (
    <svg ref={svg} className={`sketch ${className}`} data-mode={mode} data-kind={kind} data-alive={alive && mode !== 'still' ? '' : undefined} data-smile={smiling && SMILES[kind] ? '' : undefined} viewBox="16 16 88 88" aria-hidden="true">
      <g className="sketch-face" data-life={def.face}>
        {strokes.map((s, i) => (
          <g key={i} className="sketch-part" data-eye={s.eye ? '' : undefined} data-side={s.eye ? sideOf(s.d) : undefined} data-life={s.life} style={s.offset ? { ['--offset' as string]: `${s.offset}ms` } : undefined}>
            <g className="sketch-blink">
              <path d={s.d} pathLength={1} />
            </g>
            {s.eye && <path className="sketch-lid" />}
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
export function SketchFace({ kind, visible, enterDelay = 0, alive = true, smile = false }: { kind: ExpressionKind; visible: boolean; enterDelay?: number; alive?: boolean; smile?: boolean }) {
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
  return <Strokes key={`${shown.kind}-${shown.n}`} kind={shown.kind} mode={shown.mode} delayMs={shown.delay} alive={alive} smile={smile} />;
}
