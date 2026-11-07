import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CalibrationStep } from './model.ts';

/**
 * Simulated calibration, after the Neuralink Link flow (MOTION.md "The calibration sequence"), on
 * the app's own light canvas so the calibrated brightness is the working brightness. Nothing is
 * tracked; it teaches the motion language: the ring that fills clockwise in accent is the same
 * ring as the app's dwell indicator. Escape skips (handled by the app).
 */

const TYPE_MS = 32;
const REST_MS = 180;
const BLOOM_MS = 450;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const NINE: [number, number][] = [
  [8, 12], [50, 12], [92, 12],
  [8, 50], [50, 50], [92, 50],
  [8, 88], [50, 88], [92, 88],
];
const FOUR: [number, number][] = [[30, 30], [70, 30], [30, 70], [70, 70]];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How long a line takes to type, including the rests after punctuation. */
function typingMs(text: string): number {
  const plain = text.replace(/\*/g, '');
  return plain.length * TYPE_MS + (plain.match(/[.,]/g)?.length ?? 0) * REST_MS;
}

/** One caption line that types itself; `*word*` is the highlighted keyword. */
function CaptionLine({ text, past }: { text: string; past: boolean }) {
  const plain = text.replace(/\*/g, '');
  const [count, setCount] = useState(() => (reducedMotion() ? plain.length : 0));
  useEffect(() => {
    if (reducedMotion()) return;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      n += 1;
      setCount(n);
      if (n < plain.length) timer = setTimeout(step, /[.,]/.test(plain[n - 1]) ? REST_MS : TYPE_MS);
    };
    timer = setTimeout(step, TYPE_MS);
    return () => clearTimeout(timer);
  }, [plain]);

  // Segments: plain text and the *keyword*, each split into typed and untyped parts.
  const parts = text.split(/(\*[^*]+\*)/).filter(Boolean);
  let offset = 0;
  return (
    <p className={`caption-line${past ? ' is-past' : ''}`}>
      {parts.map((part, i) => {
        const key = part.startsWith('*');
        const body = key ? part.slice(1, -1) : part;
        const typed = Math.max(0, Math.min(body.length, count - offset));
        offset += body.length;
        const seg = (str: string, untyped: boolean) =>
          str ? <span className={untyped ? 'untyped' : undefined}>{key ? <span className="key">{str}</span> : str}</span> : null;
        return <span key={i}>{seg(body.slice(0, typed), false)}{seg(body.slice(typed), true)}</span>;
      })}
    </p>
  );
}

function Caption({ lines, style }: { lines: string[]; style: CSSProperties }) {
  return (
    <div className="caption" style={style} aria-live="polite">
      {lines.map((line, i) => <CaptionLine key={line} text={line} past={i < lines.length - 1} />)}
    </div>
  );
}

function bloom(el: Element | null) {
  if (!el || reducedMotion()) return;
  (el as HTMLElement).animate([{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: BLOOM_MS, easing: EASE_OUT });
}

/** A run of targets: the guide travels, the target fills while it settles, blooms, a beat, next. */
function Walk({ points, travelMs, settleMs, caption, onDone }: { points: [number, number][]; travelMs: number; settleMs: number; caption: string; onDone: () => void }) {
  // The guide starts between targets, never on one, and appears only when it starts to travel.
  const [at, setAt] = useState<[number, number]>([50, 31]);
  // The guide appears only when it starts to travel, so it never sits on a target looking active.
  const [moving, setMoving] = useState(false);
  const [active, setActive] = useState(-1);
  const [done, setDone] = useState(-1);
  const blooms = useRef<(HTMLSpanElement | null)[]>([]);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    let t = 200 + typingMs(caption) + 300;
    points.forEach((point, i) => {
      later(t, () => { setMoving(true); setAt(point); setActive(-1); });
      t += travelMs;
      // On arrival the guide gives way to the target's own centre dot.
      later(t, () => { setActive(i); setMoving(false); });
      t += settleMs;
      later(t, () => { bloom(blooms.current[i]); setDone(i); setActive(-1); });
      t += 400;
    });
    later(t, () => finish.current());
    return () => timers.forEach(clearTimeout);
  }, [points, travelMs, settleMs, caption]);

  return (
    <>
      {points.map(([x, y], i) => (
        <span key={i} className={`cal-target${i === active ? ' is-active' : ''}${i <= done ? ' is-done' : ''}`} style={{ left: `${x}%`, top: `${y}%`, '--settle-ms': `${settleMs}ms` } as CSSProperties}>
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle className="cal-outline" cx="14" cy="14" r="13.25" />
            <circle className="cal-arc" cx="14" cy="14" r="13.25" pathLength="100" />
          </svg>
          <span className="cal-centre" />
          <span className="cal-bloom" ref={(el) => { blooms.current[i] = el; }} />
        </span>
      ))}
      <span className={`cal-guide${moving ? ' is-moving' : ''}`} aria-hidden="true" style={{ transform: `translate(${at[0]}vw, ${at[1]}vh)`, '--travel-ms': `${travelMs}ms` } as CSSProperties} />
      <Caption lines={[caption]} style={{ left: '50%', top: 'calc(50% + 38px)', transform: 'translateX(-50%)' }} />
    </>
  );
}

function Position({ onDone }: { onDone: () => void }) {
  const first = 'Sit so your face fills the circle.';
  const [found, setFound] = useState(false);
  const finish = useRef(onDone);
  finish.current = onDone;
  useEffect(() => {
    const t1 = 200 + typingMs(first) + 1200;
    const a = setTimeout(() => setFound(true), t1);
    const b = setTimeout(() => finish.current(), t1 + typingMs('Good.') + 600);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return (
    <>
      <svg className={`cal-face${found ? ' is-found' : ''}`} viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49.5" /></svg>
      <Caption lines={found ? [first, 'Good.'] : [first]} style={{ left: '50%', top: 'calc(50% + 19vmin + 24px)', transform: 'translateX(-50%)' }} />
    </>
  );
}

export function Calibration({ step, onStep }: { step: CalibrationStep; onStep: (step: CalibrationStep) => void }) {
  return (
    <section className={`calibration cal-${step}`} aria-label="Calibration" key={step}>
      {step === 'position' && <Position onDone={() => onStep('points')} />}
      {step === 'points' && <Walk points={NINE} travelMs={1200} settleMs={1800} caption="Follow the *dot*." onDone={() => onStep('validate')} />}
      {step === 'validate' && <Walk points={FOUR} travelMs={900} settleMs={1200} caption="One more *look*." onDone={() => onStep('ready')} />}
      {step === 'ready' && (
        <div className="cal-ready">
          <h1 className="cal-title">Ready</h1>
          <p className="cal-result">Simulated run: thirteen points shown, nothing measured.</p>
        </div>
      )}
    </section>
  );
}
