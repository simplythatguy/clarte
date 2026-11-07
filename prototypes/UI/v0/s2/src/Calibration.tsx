/**
 * Simulated calibration and first run, built to MOTION.md "The calibration sequence" on this style's
 * light canvas: one active thing at a time, 28 px outlined targets with a 6 px dot when active, one
 * guide that travels with one easing, the same accent ring that fills during a dwell, one bloom per
 * achieved target, a beat of stillness after it, and a caption pill that types itself.
 *
 *  1. Position: a ring of 38% of the shorter side; "Sit so your face fills the circle."; after the
 *     simulated check (1.2 s) the ring turns accent and "Good." types; a 600 ms beat.
 *  2. Nine points in reading order covering the grid extremes: outlines fade in together, the guide
 *     travels 1200 ms, the point's ring fills over 1800 ms, blooms 450 ms, a 400 ms beat.
 *  3. Check: four other points, travel 900 ms, settle 1200 ms; "One more look."
 *  4. Ready (title, result, Start in Q6 and Again in Q7, rendered by App).
 * Escape skips. Under reduced motion the guide jumps and rings fill by opacity steps.
 */
import { useEffect, useState } from 'react';
import type { CalibrationStep } from './model.ts';
import { Ring, arcRule } from './parts.tsx';

type Point = [number, number];
const NINE: Point[] = [[8, 12], [50, 12], [92, 12], [8, 50], [50, 50], [92, 50], [8, 88], [50, 88], [92, 88]];
const FOUR: Point[] = [[30, 30], [70, 30], [30, 70], [70, 70]];

const CHAR_MS = 32;
const typeMs = (text: string) => Array.from(text).reduce((t, ch) => t + CHAR_MS + (ch === '.' || ch === ',' ? 180 : 0), 0);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One caption line. `tone`: accent for anything about dwell (MOTION.md), ink otherwise. */
type Line = { text: string; key: string; tone?: 'accent' | 'ink' };
type TargetState = 'waiting' | 'active' | 'done';
type View = {
  ring: 'none' | 'shown' | 'good';
  points: Point[];
  states: TargetState[];
  fill: number;
  settleMs: number;
  guide: { at: Point; hidden: boolean; quick: boolean } | null;
  lines: Line[];
  /** Where the caption sits, in a band no guide path crosses (round 3): under the position ring;
   *  for the nine points right of centre, between the long first diagonal and the middle row; for
   *  the check, top centre. Verified by sampling every leg in scripts/regress.mjs. */
  caption: 'below-ring' | 'points' | 'check' | null;
};

const EMPTY: View = { ring: 'none', points: [], states: [], fill: -1, settleMs: 1800, guide: null, lines: [], caption: null };

/** One caption line: appears whole, then types at 32 ms per character with a 180 ms rest after a
 *  full stop or comma; the key word carries the meaning's colour; the caret is a still 1 px bar. */
function Typed({ line, past, frozen }: { line: Line; past: boolean; frozen: boolean }) {
  const [n, setN] = useState(frozen ? line.text.length : 0);
  useEffect(() => {
    if (frozen) return;
    let i = 0;
    let timer = 0;
    const step = () => {
      i += 1;
      setN(i);
      if (i < line.text.length) timer = window.setTimeout(step, CHAR_MS + (/[.,]/.test(line.text[i - 1]) ? 180 : 0));
    };
    timer = window.setTimeout(step, CHAR_MS);
    return () => window.clearTimeout(timer);
  }, [line, frozen]);
  const k = line.text.indexOf(line.key);
  const keyClass = `key${line.tone === 'accent' ? ' key--accent' : ''}`;
  const render = (count: number) => {
    const shown = line.text.slice(0, count);
    return k < 0 || count <= k
      ? [shown]
      : [shown.slice(0, k), <span key="k" className={keyClass}>{shown.slice(k, Math.min(count, k + line.key.length))}</span>, shown.slice(k + line.key.length)];
  };
  // The pill is sized by the whole line from the first frame (an invisible copy), so it appears
  // whole and does not grow as the text types itself.
  return (
    <span className={`cline${past ? ' is-past' : ''}`} aria-label={line.text}>
      <span className="cline-size" aria-hidden="true">{render(line.text.length)}</span>
      <span className="cline-text" aria-hidden="true">{render(n)}{n < line.text.length && <span className="caret" />}</span>
    </span>
  );
}

function frozenView(step: CalibrationStep): View {
  if (step === 'position') return { ...EMPTY, ring: 'shown', lines: [{ text: 'Sit so your face fills the circle.', key: 'face', tone: 'ink' }], caption: 'below-ring' };
  if (step === 'points') {
    return { ...EMPTY, points: NINE, states: NINE.map((_, i) => (i < 4 ? 'done' : i === 4 ? 'active' : 'waiting')), fill: 0.6, guide: { at: NINE[4], hidden: true, quick: false }, lines: [{ text: 'Follow the dot.', key: 'dot', tone: 'ink' }], caption: 'points' };
  }
  if (step === 'validate') {
    return { ...EMPTY, points: FOUR, states: ['done', 'active', 'waiting', 'waiting'], fill: 0.5, settleMs: 1200, guide: { at: FOUR[1], hidden: true, quick: true }, lines: [{ text: 'One more look.', key: 'look', tone: 'accent' }], caption: 'check' };
  }
  return EMPTY;
}

export function Calibration({ step, frozen, onStep }: { step: CalibrationStep; frozen: boolean; onStep: (step: CalibrationStep) => void }) {
  const [view, setView] = useState<View>(() => (frozen ? frozenView(step) : EMPTY));

  useEffect(() => {
    if (frozen) { setView(frozenView(step)); return; }
    if (step === 'ready') { setView(EMPTY); return; }
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => { timers.push(window.setTimeout(resolve, ms)); });
    const update = (patch: Partial<View> | ((v: View) => Partial<View>)) => {
      if (!cancelled) setView((v) => ({ ...v, ...(typeof patch === 'function' ? patch(v) : patch) }));
    };
    const bloom = (index: number) => {
      if (reduced()) return;
      const target = document.querySelector<HTMLElement>(`.target[data-index="${index}"]`);
      if (!target) return;
      const cue = document.createElement('span');
      cue.className = 'commit-cue';
      Object.assign(cue.style, { inset: '0' });
      target.append(cue);
      const run = cue.animate([{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 450, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      run.onfinish = () => cue.remove();
    };
    const runTargets = async (points: Point[], travel: number, settle: number) => {
      update({ points, states: points.map(() => 'waiting'), fill: -1, settleMs: settle });
      await wait(200);
      for (let i = 0; i < points.length && !cancelled; i++) {
        update((v) => ({ guide: { at: points[i], hidden: false, quick: travel < 1200 }, states: v.states.map((s, j) => (j === i ? 'waiting' : s)) }));
        await wait(reduced() ? 150 : travel);
        update((v) => ({ guide: v.guide && { ...v.guide, hidden: true }, states: v.states.map((s, j) => (j === i ? 'active' : s)), fill: 0 }));
        await wait(50);
        update({ fill: 1 });
        await wait(settle);
        bloom(i);
        update((v) => ({ states: v.states.map((s, j) => (j === i ? 'done' : s)), fill: -1 }));
        await wait(400);
      }
    };

    void (async () => {
      if (step === 'position') {
        const first: Line = { text: 'Sit so your face fills the circle.', key: 'face', tone: 'ink' };
        update({ ...EMPTY, ring: 'shown', lines: [first], caption: 'below-ring' });
        await wait(200 + typeMs(first.text) + 1200);
        update({ ring: 'good', lines: [first, { text: 'Good.', key: 'Good', tone: 'accent' }] });
        await wait(typeMs('Good.') + 600);
        if (!cancelled) onStep('points');
      } else if (step === 'points') {
        const line: Line = { text: 'Follow the dot.', key: 'dot', tone: 'ink' };
        // Beside the first target, on the side with room, clear of the guide's first path.
        update({ ...EMPTY, guide: { at: [50, 50], hidden: false, quick: false }, lines: [line], caption: 'points' });
        await wait(200 + typeMs(line.text) + 300);
        await runTargets(NINE, 1200, 1800);
        if (!cancelled) onStep('validate');
      } else if (step === 'validate') {
        const line: Line = { text: 'One more look.', key: 'look', tone: 'accent' };
        update((v) => ({ ...EMPTY, guide: v.guide ?? { at: [50, 50], hidden: false, quick: true }, lines: [line], caption: 'check' }));
        await wait(200 + typeMs(line.text));
        await runTargets(FOUR, 900, 1200);
        if (!cancelled) onStep('ready');
      }
    })();
    return () => { cancelled = true; timers.forEach((t) => window.clearTimeout(t)); };
  }, [step, frozen, onStep]);

  return (
    <div className="calib" role="region" aria-label="Calibration">
      {view.ring !== 'none' && <span className={`calib-ring${view.ring === 'good' ? ' is-good' : ''}`} aria-hidden="true" />}
      {view.points.map(([x, y], i) => {
        const state = view.states[i];
        const scope = `.target[data-index="${i}"]`;
        const p = state === 'active' ? Math.max(0, view.fill) : 0;
        // Filling: the same composited arc as the app's dwell ring, at the settle duration. A frozen
        // still shows a fixed fraction.
        const rule = frozen && state === 'active'
          ? `${scope} .arc-a{transform:rotate(${45 + Math.min(1, p * 2) * 180}deg);opacity:1}${scope} .arc-b{transform:rotate(${225 + Math.max(0, p * 2 - 1) * 180}deg);opacity:1}`
          : state === 'active' ? arcRule(scope, view.fill === 1 ? 1 : 0, view.fill === 1 ? view.settleMs : 0, 'linear', reduced()) : '';
        return (
          <span key={`${view.points.length}-${i}`} data-index={i} className={`target target--${state}`} style={{ left: `${x}vw`, top: `${y}vh` }} aria-hidden="true">
            <span className="target-ring">
              <style>{rule}</style>
              <Ring size={28} />
            </span>
            <span className="tdot" />
          </span>
        );
      })}
      {view.guide && (
        <span
          className={`guide${view.guide.hidden ? ' is-hidden' : ''}${view.guide.quick ? ' is-quick' : ''}`}
          style={{ transform: `translate(${view.guide.at[0]}vw, ${view.guide.at[1]}vh)` }}
          aria-hidden="true"
        />
      )}
      {view.caption && (
        <span className={`caption caption--${view.caption}`}>
          {view.lines.map((line, i) => <Typed key={line.text} line={line} past={i < view.lines.length - 1} frozen={frozen} />)}
        </span>
      )}
      {step === 'ready' && (
        <div className="calib-ready">
          <h1 className="calib-title">Ready</h1>
          <p className="calib-result">Your eyes were found at all 13 points.</p>
        </div>
      )}
    </div>
  );
}
