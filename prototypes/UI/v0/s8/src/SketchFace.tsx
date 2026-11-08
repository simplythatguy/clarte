/**
 * The Cloud's face: a few pen lines on the orb that draw themselves (owner, 2026-11-07, after a
 * hand-drawn onboarding reference). Only the lines are drawn; the orb is the face's round body.
 *
 * - Entering: each stroke draws once at a pen's pace (its duration follows its length, 160–520 ms,
 *   with a 70 ms lift between strokes); eyes first, then the mouth, then the extras.
 * - Leaving: the strokes erase themselves in reverse order, the last drawn first, each one
 *   retracting to where the pen started (140 ms, 40 ms apart). Then the orb fades (Orb.tsx).
 * - Changing face: the old face erases, then the new one draws.
 * Under reduced motion the faces cross-fade over 150 ms instead.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { EXPRESSIONS, type ExpressionKind } from './expressions.ts';

const LIFT_MS = 70;
const ERASE_MS = 140;
const ERASE_GAP = 40;
const pace = (length: number) => Math.min(520, Math.max(160, 140 + length * 4.5));
export const eraseTime = (kind: ExpressionKind) => ERASE_MS + ERASE_GAP * (EXPRESSIONS[kind].strokes.length - 1);
const seedOf = (kind: string) => [...kind].reduce((s, c) => s + c.charCodeAt(0), 0) % 97;

type Mode = 'draw' | 'erase' | 'still';

/** One face, drawn or erased. `mode: still` shows it finished, without motion (galleries). */
export function Strokes({ kind, mode, delayMs = 0, className = '' }: { kind: ExpressionKind; mode: Mode; delayMs?: number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const filter = `sketch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useLayoutEffect(() => {
    const paths = [...(svg.current?.querySelectorAll<SVGPathElement>('path') ?? [])];
    if (mode === 'draw') {
      let at = delayMs;
      for (const p of paths) {
        const ms = pace(p.getTotalLength());
        p.style.setProperty('--delay', `${at}ms`);
        p.style.setProperty('--dur', `${ms}ms`);
        at += ms + LIFT_MS;
      }
    } else if (mode === 'erase') {
      paths.forEach((p, i) => {
        p.style.setProperty('--delay', `${(paths.length - 1 - i) * ERASE_GAP}ms`);
        p.style.setProperty('--dur', `${ERASE_MS}ms`);
      });
    }
  }, [kind, mode, delayMs]);
  return (
    <svg ref={svg} className={`sketch ${className}`} data-mode={mode} data-kind={kind} viewBox="16 16 88 88" aria-hidden="true">
      <defs>
        <filter id={filter} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed={seedOf(kind)} />
          <feDisplacementMap in="SourceGraphic" scale="2.6" />
        </filter>
      </defs>
      <g filter={`url(#${filter})`}>
        {EXPRESSIONS[kind].strokes.map((d, i) => <path key={i} d={d} pathLength={1} />)}
      </g>
    </svg>
  );
}

/**
 * The face the Cloud wears. `visible` false erases it; a new `kind` erases the old face and draws
 * the new one. `enterDelay` lets the orb arrive before the pen starts.
 */
export function SketchFace({ kind, visible, enterDelay = 0 }: { kind: ExpressionKind; visible: boolean; enterDelay?: number }) {
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
  return <Strokes key={`${shown.kind}-${shown.n}`} kind={shown.kind} mode={shown.mode} delayMs={shown.delay} />;
}
