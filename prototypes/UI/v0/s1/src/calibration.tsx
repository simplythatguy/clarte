/**
 * Simulated calibration and first run, built to MOTION.md "The calibration sequence": the working
 * canvas throughout, one caption line at a time in a white pill that types itself, 28 px outlined
 * targets whose ring fills clockwise in accent exactly like the app's dwell ring, a guide dot that
 * travels with one easing, a bloom on every achieved point and a beat of stillness after it.
 * Escape skips it (handled by the app).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CalibrationStep } from './state.ts';
import { Rail, RingBox, type TileSpec } from './ui.tsx';

type Point = { x: number; y: number };

/** Nine points at the grid extremes, in reading order. */
const POINTS: Point[] = [0.1, 0.5, 0.9].flatMap((y) => [0.07, 0.5, 0.93].map((x) => ({ x, y })));
/** Four different points to check against. */
const CHECKS: Point[] = [{ x: 0.22, y: 0.3 }, { x: 0.78, y: 0.3 }, { x: 0.78, y: 0.7 }, { x: 0.22, y: 0.7 }];

const PACE = {
  points: { move: 1200, settle: 1800 },
  check: { move: 900, settle: 1200 },
  bloom: 450,
  beat: 400,
};

const TYPE_MS = 32;
const PUNCTUATION_REST = 180;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A caption line; the word between asterisks is the key word, highlighted in accent. */
type Line = string;

function typingTime(line: Line): number {
  const text = line.replace(/\*/g, '');
  return Array.from(text).reduce((ms, ch) => ms + TYPE_MS + (/[.,]/.test(ch) ? PUNCTUATION_REST : 0), 0);
}

function Typed({ line, active, frozen }: { line: Line; active: boolean; frozen: boolean }) {
  const text = line.replace(/\*/g, '');
  const [shown, setShown] = useState(frozen || !active || reducedMotion() ? text.length : 0);
  useEffect(() => {
    if (shown >= text.length) return;
    const previous = text[shown - 1] ?? '';
    const timer = setTimeout(() => setShown((n) => n + 1), TYPE_MS + (/[.,]/.test(previous) ? PUNCTUATION_REST : 0));
    return () => clearTimeout(timer);
  }, [shown, text]);
  // The visible slice with the key word marked; the sizing copy is the whole line, marked the same
  // way, so the pill's final size (key-word padding included) is reserved from the first letter.
  const slice = (upto: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let count = 0;
    line.split(/(\*[^*]+\*)/).forEach((segment, i) => {
      const marked = segment.startsWith('*');
      const body = marked ? segment.slice(1, -1) : segment;
      const visible = body.slice(0, Math.max(0, upto - count));
      count += body.length;
      if (visible) parts.push(marked ? <mark key={i}>{visible}</mark> : <span key={i}>{visible}</span>);
    });
    return parts;
  };
  const parts = slice(shown);
  return (
    <span className="typed">
      <span className="typed-full" aria-hidden="true">{slice(text.length)}</span>
      <span>
        {parts}
        {active && shown < text.length && <span className="type-caret" aria-hidden="true" />}
      </span>
    </span>
  );
}

/** One line at a time; when the next line starts, the previous settles to secondary ink. */
function Caption({ lines, style, frozen }: { lines: Line[]; style: CSSProperties; frozen: boolean }) {
  return (
    <div className="caption" style={style} aria-live="polite">
      {lines.map((line, i) => (
        <p key={i} className="line" data-settled={i < lines.length - 1 || undefined} aria-label={line.replace(/\*/g, '')}>
          <Typed line={line} active={i === lines.length - 1} frozen={frozen} />
        </p>
      ))}
    </div>
  );
}

type TargetState = 'wait' | 'active' | 'bloom' | 'done';

function Target({ point, state, settle, frozen }: { point: Point; state: TargetState; settle: number; frozen: boolean }) {
  const style = { left: `${point.x * 100}%`, top: `${point.y * 100}%`, '--settle': `${settle}ms` } as CSSProperties;
  return (
    <div className="target" data-state={state} data-frozen={frozen || undefined} style={style}>
      <RingBox><i className="target-dot" /></RingBox>
    </div>
  );
}

/** The sweep over a set of points: travel, settle (the ring fills), bloom, a beat, next. */
function Sweep({ points, pace, caption, captionAt, frozenAt, onDone }: {
  points: Point[];
  pace: { move: number; settle: number };
  caption: Line;
  captionAt: CSSProperties;
  frozenAt: number | null;
  onDone: () => void;
}) {
  const frozen = frozenAt !== null;
  const done = useRef(onDone);
  done.current = onDone;
  const [index, setIndex] = useState(frozenAt ?? -1);
  const [phase, setPhase] = useState<'travel' | 'settle' | 'bloom' | 'beat'>(frozen ? 'settle' : 'travel');
  useEffect(() => {
    if (frozen) return;
    let cancelled = false;
    (async () => {
      await sleep(typingTime(caption) + 300);
      for (let i = 0; i < points.length; i++) {
        if (cancelled) return;
        setIndex(i);
        setPhase('travel');
        await sleep(reducedMotion() ? 200 : pace.move);
        if (cancelled) return;
        setPhase('settle');
        await sleep(pace.settle);
        if (cancelled) return;
        setPhase('bloom');
        await sleep(PACE.bloom);
        if (cancelled) return;
        setPhase('beat');
        await sleep(PACE.beat);
      }
      if (!cancelled) done.current();
    })();
    return () => { cancelled = true; };
  }, [frozen, points, pace, caption]);

  const stateOf = (k: number): TargetState => {
    if (k < index || (k === index && phase === 'beat')) return 'done';
    if (k === index && phase === 'settle') return 'active';
    if (k === index && phase === 'bloom') return 'bloom';
    return 'wait';
  };
  const at = index >= 0 ? points[index] : { x: 0.5, y: 0.5 };
  return (
    <>
      {points.map((p, k) => <Target key={k} point={p} state={stateOf(k)} settle={pace.settle} frozen={frozen} />)}
      <div
        className="guide"
        data-hidden={phase !== 'travel' || undefined}
        style={{ '--x': at.x, '--y': at.y, '--move': `${pace.move}ms` } as CSSProperties}
        aria-hidden="true"
      />
      <Caption lines={[caption]} style={captionAt} frozen={frozen} />
    </>
  );
}

const FIRST_LINE: Line = 'Sit so your face fills the *circle*.';

function Position({ frozen, onDone }: { frozen: boolean; onDone: () => void }) {
  const [pass, setPass] = useState(frozen);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (frozen) return;
    let cancelled = false;
    (async () => {
      await sleep(typingTime(FIRST_LINE) + 1200);
      if (cancelled) return;
      setPass(true);
      await sleep(typingTime('Good.') + 600);
      if (!cancelled) done.current();
    })();
    return () => { cancelled = true; };
  }, [frozen]);
  return (
    <>
      <div className="face-ring" data-pass={pass || undefined} aria-hidden="true" />
      <Caption
        lines={pass ? [FIRST_LINE, 'Good.'] : [FIRST_LINE]}
        style={{ left: '50%', top: 'calc(50% + 19vmin + 24px)', translate: '-50% 0', alignItems: 'center' }}
        frozen={frozen}
      />
    </>
  );
}

const START: TileSpec = { id: 'calib-start', kind: 'primary', label: 'Start', icon: 'next', vis: 'live' };

export function Calibration({ step, frozen, onStep }: { step: CalibrationStep; frozen: boolean; onStep: (step: CalibrationStep) => void }) {
  const next = (to: CalibrationStep) => () => onStep(to);
  return (
    <div className="calib" aria-label="Calibration">
        {step === 'position' && <Position frozen={frozen} onDone={next('points')} />}
        {step === 'points' && (
          <Sweep
            points={POINTS}
            pace={PACE.points}
            caption="Follow the *dot*."
            captionAt={{ left: 'calc(7% + 38px)', top: 'calc(10% - 22px)' }}
            frozenAt={frozen ? 4 : null}
            onDone={next('validate')}
          />
        )}
        {step === 'validate' && (
          <Sweep
            points={CHECKS}
            pace={PACE.check}
            caption="One more *look*."
            captionAt={{ left: 'calc(22% + 38px)', top: 'calc(30% - 22px)' }}
            frozenAt={frozen ? 1 : null}
            onDone={next('ready')}
          />
        )}
        {step === 'ready' && (
          <>
            {/* Start sits in the style's primary quadrant (Q2), where the candidate word lives. */}
            <Rail slots={[null, START, null, null]} edge="top" />
            <div className="middle">
              <h1 className="title">Ready</h1>
              <p className="partner ready-result">Steady across the whole screen. The bottom-right corner was a little less sure.</p>
            </div>
          </>
        )}
    </div>
  );
}
