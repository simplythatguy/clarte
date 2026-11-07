/**
 * Simulated calibration and first run, to MOTION.md "The calibration sequence, step by step":
 * light canvas throughout, one caption at a time typing at 32 ms per character, 28 px outlined
 * targets, a guide dot that travels on `--ease-move`, and during each settle the same accent ring
 * that the app uses for dwell, so the person learns it here. Nothing is tracked. Escape skips it.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CalibrationStep } from './model.ts';
import { Arc } from './Screen.tsx';
import { clearArc, drawArc, type ArcRun } from './arc.ts';

type Point = { x: number; y: number };

/** Nine points over the grid extremes in reading order (R-6 §3.4), as viewport fractions. */
export const GRID_POINTS: Point[] = [
  { x: 0.06, y: 0.08 }, { x: 0.5, y: 0.08 }, { x: 0.94, y: 0.08 },
  { x: 0.06, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.94, y: 0.5 },
  { x: 0.06, y: 0.92 }, { x: 0.5, y: 0.92 }, { x: 0.94, y: 0.92 },
];
/** The check uses four different points. */
export const CHECK_POINTS: Point[] = [
  { x: 0.28, y: 0.27 }, { x: 0.72, y: 0.27 }, { x: 0.72, y: 0.73 }, { x: 0.28, y: 0.73 },
];

const PACE = {
  points: { move: 1200, settle: 1800 },
  validate: { move: 900, settle: 1200 },
} as const;
const BLOOM_MS = 450;
const BEAT_MS = 400;
const TYPE_MS = 32;
const PUNCTUATION_REST_MS = 180;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A caption line: the whole pill appears, then its text types itself; the keyword is highlighted. */
type Line = { text: string; keyword?: string };

function useTyped(text: string, run: boolean): number {
  const [count, setCount] = useState(run ? 0 : text.length);
  useEffect(() => {
    if (!run) { setCount(text.length); return; }
    setCount(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      i += 1;
      setCount(i);
      if (i >= text.length) return;
      timer = setTimeout(next, /[.,]/.test(text[i - 1]) ? TYPE_MS + PUNCTUATION_REST_MS : TYPE_MS);
    };
    timer = setTimeout(next, TYPE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);
  return count;
}

function CaptionLine({ line, current, run }: { line: Line; current: boolean; run: boolean }) {
  const count = useTyped(line.text, run);
  const shown = line.text.slice(0, count);
  const k = line.keyword ? line.text.indexOf(line.keyword) : -1;
  let body: ReactNode = shown;
  if (k >= 0 && count > k) {
    const end = Math.min(count, k + line.keyword!.length);
    body = <>{shown.slice(0, k)}<mark>{shown.slice(k, end)}</mark>{shown.slice(end)}</>;
  }
  return (
    <p className="caption" data-current={current || undefined} aria-hidden="true">
      {/* The whole line sets the pill's size from the first frame; the typed text fills it. */}
      <span className="caption__body">
        <span className="caption__full">
          {k >= 0 ? <>{line.text.slice(0, k)}<mark>{line.keyword}</mark>{line.text.slice(k + line.keyword!.length)}</> : line.text}
        </span>
        <span>{body}</span>
      </span>
      {current && <span className="caption__caret" aria-hidden="true" data-done={count >= line.text.length || undefined} />}
    </p>
  );
}

function Captions({ lines, run, style, className = 'captions' }: { lines: Line[]; run: boolean; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={style} role="status" aria-label={lines.map((l) => l.text).join(' ')}>
      {lines.map((line, i) => <CaptionLine key={`${i}-${line.text}`} line={line} current={i === lines.length - 1} run={run} />)}
    </div>
  );
}

type Props = {
  step: CalibrationStep;
  onStep: (step: CalibrationStep) => void;
  /** Freeze on a given target for screenshots (clarteDebug) and for the outgoing layer. */
  frozenAt?: number;
  /** How long the app's control ring takes to fill: calibration fills at the same rate. */
  fillMs: number;
};

/**
 * The caption sits 24 px from the active target on the side with room and travels with the dot
 * (MOTION "Captions"): right of a left-hand target, left of a right-hand one, below or above a
 * centred one. Translate only, on the dot's own curve.
 */
function captionPlace(p: Point): CSSProperties {
  const gap = 'calc(26px + 24px)';
  const x = `${p.x * 100}vw`, y = `${p.y * 100}vh`;
  const translate =
    p.x < 0.4 ? `calc(${x} + ${gap}) calc(${y} - 50%)`
    : p.x > 0.6 ? `calc(${x} - ${gap} - 100%) calc(${y} - 50%)`
    : p.y < 0.6 ? `calc(${x} - 50%) calc(${y} + ${gap})`
    : `calc(${x} - 50%) calc(${y} - ${gap} - 100%)`;
  return { translate };
}

export function Calibration({ step, onStep, frozenAt, fillMs }: Props) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const frozen = frozenAt !== undefined;
  if (step === 'position') return <Position frozen={frozen} onDone={() => onStepRef.current('points')} />;
  if (step === 'points' || step === 'validate') {
    return (
      <Targets
        key={step}
        points={step === 'points' ? GRID_POINTS : CHECK_POINTS}
        pace={PACE[step]}
        fillMs={fillMs}
        caption={step === 'points' ? { text: 'Follow the dot.', keyword: 'dot' } : { text: 'One more look.', keyword: 'look' }}
        frozenAt={frozenAt}
        onDone={() => onStepRef.current(step === 'points' ? 'validate' : 'ready')}
      />
    );
  }
  return (
    <div className="calib calib--ready">
      <h1 className="calib__title">Ready</h1>
      <p className="calib__result">Your looks landed well inside every tile.</p>
    </div>
  );
}

/** Step 1: one ring, 38% of the shorter side. The simulated check passes after 1.2 s. */
function Position({ frozen, onDone }: { frozen: boolean; onDone: () => void }) {
  const [passed, setPassed] = useState(frozen);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (frozen) return;
    const caption = 'Sit so your face fills the circle.'.length * TYPE_MS + PUNCTUATION_REST_MS;
    const check = setTimeout(() => setPassed(true), caption + 1200);
    const next = setTimeout(() => done.current(), caption + 1200 + 'Good.'.length * TYPE_MS + PUNCTUATION_REST_MS + 600);
    return () => { clearTimeout(check); clearTimeout(next); };
  }, [frozen]);
  const lines: Line[] = [{ text: 'Sit so your face fills the circle.', keyword: 'circle' }];
  if (passed) lines.push({ text: 'Good.' });
  return (
    <div className="calib">
      <div className="calib__face" data-passed={passed || undefined} aria-hidden="true" />
      <Captions lines={lines} run={!frozen} style={{ top: 'calc(50% + min(19vh, 19vw) + 24px)' }} />
    </div>
  );
}

type Phase = 'travel' | 'settle' | 'bloom' | 'beat';

/** Steps 2 and 3: targets fade in together, then for each: travel, settle (ring fills), bloom, beat. */
function Targets({ points, pace, fillMs, caption, frozenAt, onDone }: {
  points: Point[];
  fillMs: number;
  pace: { move: number; settle: number };
  caption: Line;
  frozenAt?: number;
  onDone: () => void;
}) {
  const frozen = frozenAt !== undefined;
  const [index, setIndex] = useState(frozenAt ?? 0);
  const [phase, setPhase] = useState<Phase>(frozen ? 'settle' : 'travel');
  const [started, setStarted] = useState(frozen);
  const done = useRef(onDone);
  done.current = onDone;
  const bloomRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef<ArcRun | undefined>(undefined);

  // A frozen screen (debug, outgoing layer) shows the active ring half drawn.
  useEffect(() => {
    if (!frozen || !markRef.current) return;
    const run = drawArc(markRef.current, fillMs);
    run.anims.forEach((a) => { a.pause(); a.currentTime = fillMs / 2; });
    return () => clearArc(run);
  }, [frozen, fillMs]);

  // The caption types before the first travel.
  useEffect(() => {
    if (frozen) return;
    const t = setTimeout(() => setStarted(true), caption.text.length * TYPE_MS + PUNCTUATION_REST_MS + 200);
    return () => clearTimeout(t);
  }, [frozen, caption.text]);

  useEffect(() => {
    if (frozen || !started) return;
    // The dot rests, then the ring fills at the app's control ring rate and blooms on the frame it
    // completes, as a commit does in the app. The settle stretches if a slow Controls setting
    // needs more time than the step allows.
    const settle = Math.max(pace.settle, fillMs);
    const at = (ms: number, fn: () => void) => setTimeout(fn, ms);
    const timers = [
      at(0, () => setPhase('travel')),
      at(pace.move, () => setPhase('settle')),
      at(pace.move + settle - fillMs, () => {
        if (markRef.current) runRef.current = drawArc(markRef.current, fillMs, runRef.current);
      }),
      at(pace.move + settle, () => {
        setPhase('bloom');
        if (!reduced()) bloomRef.current?.animate(
          [{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }],
          { duration: BLOOM_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
      }),
      at(pace.move + settle + BLOOM_MS, () => { setPhase('beat'); clearArc(runRef.current); runRef.current = undefined; }),
      at(pace.move + settle + BLOOM_MS + BEAT_MS, () => {
        if (index + 1 >= points.length) done.current();
        else setIndex(index + 1);
      }),
    ];
    return () => { timers.forEach(clearTimeout); clearArc(runRef.current); runRef.current = undefined; };
  }, [index, frozen, started, pace, fillMs, points.length]);

  const active = points[index];
  return (
    <div className="calib" style={{ ['--move' as string]: `${pace.move}ms` }}>
      {points.map((p, i) => {
        const finished = i < index || (i === index && (phase === 'bloom' || phase === 'beat'));
        // 'commit' is the completion frame (the bloom); under reduced motion it carries the app's
        // static commit cue, the accent ring, released to the resting outline at the beat.
        const state = i === index && phase === 'bloom' ? 'commit' : finished ? 'done' : i === index && started && phase === 'settle' ? 'active' : 'waiting';
        return (
          <span key={i} className="cal-target" data-state={state} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden="true">
            {i === index && (
              <span className="cal-mark" ref={markRef}>
                <svg className="ring" viewBox="0 0 52 52"><circle className="ring__track" cx="26" cy="26" r="25" /></svg>
                <Arc />
                <span className="ring-bloom" ref={bloomRef} />
              </span>
            )}
          </span>
        );
      })}
      <span
        className="cal-guide"
        data-hidden={!started || phase === 'beat' || phase === 'bloom' || undefined}
        // Before the first travel the dot waits at the centre, so it travels to every point.
        style={{ translate: started ? `${active.x * 100}vw ${active.y * 100}vh` : '50vw 50vh' }}
        aria-hidden="true"
      />
      <Captions lines={[caption]} run={!frozen} className="captions captions--at" style={captionPlace(active)} />
    </div>
  );
}
