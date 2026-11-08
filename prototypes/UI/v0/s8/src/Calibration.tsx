/**
 * Simulated calibration and first run (MOTION.md "The calibration sequence"), on the working
 * light canvas so the calibrated brightness is the working brightness (RESEARCH §10).
 *
 *  1. Position: one ring, 38% of the shorter side. The caption types "Sit so your face fills the
 *     circle." At 1.3 s the simulated check passes: stroke to accent and a 12% accent fill over
 *     200 ms; the caption types "Good."; a 600 ms beat.
 *  2. Nine points: all outlines fade in together at 30% ink. The guide dot travels to each point
 *     (1200 ms, the move curve), the point's ring fills clockwise in accent over the 1800 ms settle
 *     (the same arc as the app's dwell ring), blooms (450 ms) and returns to a 30% outline; a
 *     400 ms beat; then the next. Caption: "Follow the dot."
 *  3. Check: four other points, travel 900 ms, settle 1200 ms. Caption: "One more look."
 *  4. Ready: title and result in the rest zone, Start in Q1 (the primary quadrant).
 * Escape skips. Under reduced motion the guide jumps and rings fill in one step.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CalibrationStep } from './model.ts';
import { Tile } from './Tile.tsx';
import { ArrowRight } from './icons.tsx';

type Point = [number, number];

const POINTS: Point[] = [
  [0.05, 0.08], [0.5, 0.08], [0.95, 0.08],
  [0.05, 0.5], [0.5, 0.5], [0.95, 0.5],
  [0.05, 0.92], [0.5, 0.92], [0.95, 0.92],
];
const CHECKS: Point[] = [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]];
const TIMING = { points: { move: 1200, settle: 1800 }, validate: { move: 900, settle: 1200 } };
const BEAT = 400;
const R = 13;
const C = 100; // pathLength
const TYPE_MS = 32;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Line = { text: string; key?: string };

/** Caption lines typing themselves at 32 ms per character, 180 ms rest after punctuation. */
function useTyped(lines: Line[]): { done: number; typed: number } {
  const [state, setState] = useState({ done: 0, typed: 0 });
  const progress = useRef({ done: 0, typed: 0 });
  useEffect(() => {
    if (reduce()) { progress.current = { done: lines.length, typed: 0 }; setState(progress.current); return; }
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const { done, typed } = progress.current;
      if (done >= lines.length) return;
      const text = lines[done].text;
      const next = typed + 1 > text.length ? { done: done + 1, typed: 0 } : { done, typed: typed + 1 };
      progress.current = next;
      setState(next);
      const ch = text[next.typed - 1] ?? '';
      timer = setTimeout(tick, /[.,]/.test(ch) ? TYPE_MS + 180 : TYPE_MS);
    };
    timer = setTimeout(tick, TYPE_MS);
    return () => clearTimeout(timer);
  }, [lines]);
  return state;
}

function renderLine(line: Line, count: number) {
  const text = line.text.slice(0, count);
  if (!line.key) return text;
  const at = line.text.indexOf(line.key);
  if (at < 0 || count <= at) return text;
  const end = Math.min(count, at + line.key.length);
  return <>{text.slice(0, at)}<mark>{text.slice(at, end)}</mark>{text.slice(end)}</>;
}

/** A white pill holding one line at a time; finished lines settle to secondary ink. */
function Caption({ lines, style }: { lines: Line[]; style: CSSProperties }) {
  const { done, typed } = useTyped(lines);
  return (
    <p className="caption" style={style} aria-live="polite">
      {lines.map((line, i) => {
        if (i > done || (i === done && typed === 0 && i > 0)) return null;
        const finished = i < done;
        return (
          <span key={i} className={`caption-line${i < lines.length - 1 && (finished || i < done) ? ' done-line' : ''}`}>
            {/* The pill holds the whole line's size from the start; the typed text sits over it. */}
            <span className="caption-reserve" aria-hidden="true">{line.text}</span>
            <span className="caption-typed">
              {renderLine(line, finished ? line.text.length : typed)}
              {!finished && <i className="caret" aria-hidden="true" />}
            </span>
          </span>
        );
      })}
    </p>
  );
}

function px(p: Point): { x: number; y: number } {
  return { x: p[0] * window.innerWidth, y: p[1] * window.innerHeight };
}

/** The targets, a travelling guide dot, an arc that fills per point, one bloom per point. */
function PointRun({ points, timing, onDone }: { points: Point[]; timing: { move: number; settle: number }; onDone: () => void }) {
  const [active, setActive] = useState(-1);
  const guide = useRef<HTMLSpanElement>(null);
  const arcs = useRef<(SVGCircleElement | null)[]>([]);
  const bloom = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const still = reduce();
    let from = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const place = (p: { x: number; y: number }) => { if (guide.current) guide.current.style.transform = `translate(${p.x}px, ${p.y}px)`; };
    place(from);
    let t = 700; // the outlines fade in and the caption types before the first travel
    points.forEach((point, i) => {
      const to = px(point);
      const start = from;
      at(t, () => {
        place(to);
        if (guide.current) guide.current.style.opacity = '1';
        if (!still) guide.current?.animate([{ transform: `translate(${start.x}px, ${start.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }], { duration: timing.move, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
      });
      at(t + timing.move, () => {
        setActive(i);
        // The guide hands over to the target, so its small high-contrast centre stays visible.
        guide.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: EASE_OUT });
        if (guide.current) guide.current.style.opacity = '0';
        const arc = arcs.current[i];
        if (arc) {
          arc.style.strokeDashoffset = '0';
          arc.style.opacity = '1';
          if (!still) arc.animate([{ strokeDashoffset: C }, { strokeDashoffset: 0 }], { duration: timing.settle, easing: 'linear' });
          else {
            // Reduced motion: the whole ring steps its opacity across the settle, complete at the end.
            arc.style.opacity = '0.25';
            // Relative to arrival (this callback), so the steps land inside this point's settle.
            [0.25, 0.5, 0.75].forEach((f, k) => timers.push(setTimeout(() => { arc.style.opacity = String(0.5 + k * 0.25); }, timing.settle * f)));
          }
        }
      });
      at(t + timing.move + timing.settle, () => {
        setActive(-1);
        arcs.current[i]?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: EASE_OUT, fill: 'forwards' });
        if (!still && bloom.current) {
          bloom.current.style.left = `${to.x}px`;
          bloom.current.style.top = `${to.y}px`;
          bloom.current.animate([{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 450, easing: EASE_OUT });
        }
      });
      t += timing.move + timing.settle + BEAT;
      from = to;
    });
    at(t, onDone);
    return () => timers.forEach(clearTimeout);
  }, [points, timing, onDone]);

  return (
    <div className="cal-targets">
      {points.map(([x, y], i) => (
        <svg key={i} className="cal-target" data-state={i === active ? 'active' : 'waiting'} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} viewBox="-14 -14 28 28" aria-hidden="true">
          <circle className="cal-ring" r={R} />
          <circle ref={(el) => { arcs.current[i] = el; }} className="cal-arc" r={R} pathLength={C} strokeDasharray={C} transform="rotate(-90)" style={{ strokeDashoffset: C, opacity: 0 }} />
          <circle className="cal-dot" r="3" />
        </svg>
      ))}
      <span ref={bloom} className="cal-bloom" />
      <span ref={guide} className="cal-guide" style={{ left: 0, top: 0 }} />
    </div>
  );
}

type Props = {
  step: CalibrationStep;
  onStep: (step: CalibrationStep) => void;
  onDone: () => void;
  /** Route a tile activation through the gaze engine, like every other target. */
  activate: (action: string) => void;
};

const FIRST_LINE: Record<CalibrationStep, Line[]> = {
  position: [{ text: 'Sit so your face fills the circle.', key: 'circle' }],
  points: [{ text: 'Follow the dot.', key: 'dot' }],
  validate: [{ text: 'One more look.', key: 'look' }],
  ready: [],
};

export function Calibration({ step, onStep, onDone, activate }: Props) {
  const [found, setFound] = useState(false);
  const [lines, setLines] = useState<Line[]>(FIRST_LINE[step]);

  useEffect(() => {
    if (step !== 'position') return;
    const a = setTimeout(() => { setFound(true); setLines((l) => [...l, { text: 'Good.' }]); }, 1300);
    const b = setTimeout(() => onStep('points'), 2400);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [step, onStep]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onDone(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const toValidate = useRef(() => onStep('validate')).current;
  const toReady = useRef(() => onStep('ready')).current;

  if (step === 'ready') {
    return (
      <>
        <div className="cell cell-q1">
          <Tile action="start" tone="ink" icon={<ArrowRight />} onActivate={activate}>
            <span className="card-label">Start</span>
          </Tile>
        </div>
        <section className="thread thread-title" aria-label="Ready">
          <h1 className="page-title">Ready</h1>
          <p className="page-sub">Tracking is steady across the screen.</p>
        </section>
      </>
    );
  }

  const side = Math.min(window.innerWidth, window.innerHeight) * 0.38;
  return (
    <div className="calibration" aria-label="Calibration">
      {step === 'position' && (
        <>
          <svg className="cal-face" data-found={found || undefined} width={side} height={side} viewBox="-50 -50 100 100" aria-hidden="true">
            <circle r="49" />
          </svg>
          <Caption lines={lines} style={{ left: '50%', top: `calc(50% + ${side / 2 + 24}px)`, transform: 'translateX(-50%)' }} />
        </>
      )}
      {step === 'points' && (
        <>
          <PointRun points={POINTS} timing={TIMING.points} onDone={toValidate} />
          <Caption lines={lines} style={{ left: 'calc(5% + 38px)', top: 'calc(8% - 22px)' }} />
        </>
      )}
      {step === 'validate' && (
        <>
          <PointRun points={CHECKS} timing={TIMING.validate} onDone={toReady} />
          <Caption lines={lines} style={{ left: 'calc(27% + 38px)', top: 'calc(27% - 22px)' }} />
        </>
      )}
    </div>
  );
}
