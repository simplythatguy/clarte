/**
 * Eye calibration, driving the real tracker (`eyes/session.ts`) with UI v1's calibration visuals.
 *
 *  1. Face: one ring, 38% of the shorter side, until the camera finds a face with open eyes.
 *  2. Intro, 2 s: "Look at each dot".
 *  3. Eight dots, one at the centre of each backend quadrant in snake order. The guide travels to
 *     the dot (600 ms), rests (300 ms), then the dot's ring fills clockwise while the tracker
 *     collects (1 s), as the app's dwell ring fills.
 *  4. "Calibrating" while the worker trains.
 *
 * Gaze cannot select anything here: the tracker is not calibrated yet. A failure shows its message
 * with Try again (Q4) and Use the mouse (Q1), which a click or Enter activates.
 *
 * This is a view only. The flow (starting the camera, arming the run, leaving when the new
 * calibration is in use, Escape) lives in App, because the stage keeps a copy of an outgoing screen
 * for its cross-fade and that copy must not start anything.
 */
import { useEffect, useRef } from 'react';
import { RUN_MS, TIMING, beginRun, faceInView, positionAt, runDots, tickRun, useEyesStatus } from './eyes/session.ts';
import { Tile } from './Tile.tsx';
import { ArrowRight, Back } from './icons.tsx';

const R = 13;
const C = 100; // pathLength

type Props = {
  /** What went wrong, when the camera failed or a run did not train. */
  failure: string | null;
  onRetry: () => void;
  onUseMouse: () => void;
};

export function Calibration({ failure, onRetry, onUseMouse }: Props) {
  const status = useEyesStatus();
  const guide = useRef<HTMLSpanElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const target = useRef<SVGSVGElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  const lastIndex = useRef(-1);

  // One animation loop drives the run: it starts the dots once a face is in view, moves the guide,
  // fills the active ring and ends the run on time.
  useEffect(() => {
    if (status.kind !== 'calibrating') return;
    let frame = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (status.startedAt === null) { if (faceInView()) beginRun(now); return; }
      tickRun(now);
      const pos = positionAt(now - status.startedAt, runDots());
      const g = guide.current, a = arc.current, t = target.current, c = caption.current;
      if (!g || !a || !t || !c) return;
      c.dataset.hidden = pos && pos.phase !== 'intro' ? 'true' : 'false';
      if (!pos || pos.phase === 'intro') { g.style.opacity = '0'; t.style.opacity = '0'; return; }
      const { dot } = pos;
      g.style.opacity = '1';
      t.style.opacity = '1';
      if (pos.index !== lastIndex.current) {
        lastIndex.current = pos.index;
        t.style.left = `${dot.x}px`;
        t.style.top = `${dot.y}px`;
        g.style.transition = pos.index === 0 ? 'none' : `transform ${TIMING.moveMs}ms cubic-bezier(0.23, 1, 0.32, 1)`;
        g.style.transform = `translate(${dot.x}px, ${dot.y}px)`;
      }
      a.style.strokeDashoffset = String(C * (1 - (pos.phase === 'collect' ? pos.progress : 0)));
      a.style.opacity = pos.phase === 'collect' ? '1' : '0';
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  if (failure) {
    const retry = () => { lastIndex.current = -1; onRetry(); };
    return (
      <>
        <div className="cell cell-q1">
          <Tile action="use-mouse" tone="surface" icon={<Back />} label="Use the mouse" onActivate={onUseMouse}>
            <span className="card-label">Use the mouse</span>
          </Tile>
        </div>
        <div className="cell cell-q4">
          <Tile action="calibrate-retry" tone="ink" icon={<ArrowRight />} label="Try again" onActivate={retry}>
            <span className="card-label">Try again</span>
          </Tile>
        </div>
        <section className="thread thread-title" aria-label="Calibration">
          <p className="page-title cal-message">{failure}</p>
        </section>
      </>
    );
  }

  const waiting = status.kind === 'starting' || status.kind === 'off' || (status.kind === 'calibrating' && status.startedAt === null);
  const side = 'min(38vw, 38vh)';
  const text = status.kind === 'training' ? 'Calibrating'
    : status.kind === 'starting' || status.kind === 'off' ? 'Starting the camera'
    : waiting ? 'Sit so the camera sees your face'
    : 'Look at each dot';
  return (
    <div className="calibration" aria-label="Calibration" data-run-ms={RUN_MS}>
      {waiting && (
        <svg className="cal-face" width="100%" height="100%" style={{ width: side, height: side }} viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="49" />
        </svg>
      )}
      <svg ref={target} className="cal-target" data-state="active" style={{ opacity: 0 }} viewBox="-14 -14 28 28" aria-hidden="true">
        <circle className="cal-ring" r={R} />
        <circle ref={arc} className="cal-arc" r={R} pathLength={C} strokeDasharray={C} transform="rotate(-90)" style={{ strokeDashoffset: C, opacity: 0 }} />
      </svg>
      <span ref={guide} className="cal-guide" style={{ left: 0, top: 0, opacity: 0 }} />
      <p ref={caption} className="caption cal-caption" aria-live="polite">{text}</p>
    </div>
  );
}
