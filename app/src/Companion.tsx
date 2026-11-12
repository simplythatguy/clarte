/**
 * The companion (owner, 2026-11-08): the Cloud (cloud/Cloud.tsx, NAT-42), which took the mesh-gradient
 * ball's place; everything below is the ball's behaviour, unchanged. While
 * the middle holds no text it floats at the centre of the rest zone. When text arrives there (words heard,
 * the message typed, the sentence spoken, a menu title) it flies to the top-left of Q2 and docks as
 * a small mark in the thread's top row, and when the middle clears it flies back.
 *
 * The flight is one progress value, 0 at the centre and 1 docked. Position follows a curve that
 * rises first and then drifts left, so it clears the words rather than crossing them, and it never
 * travels near Q1. Size and lean both derive from the same value, so a change of mind
 * mid-flight just turns it round from where it is.
 *
 * Its face travels too: it looks where it is going. On landing, momentum carries it further
 * up-left, it glances back up-right, then rests. Its mood colour, swell and reaction faces come
 * from the conversation (App.tsx), docked or not.
 *
 * Still (the Motion setting) or reduced motion: no flight, it fades out and fades in at the other
 * place, and the face stays at rest.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, type AnimationPlaybackControls } from 'framer-motion';
import { Cloud, type OrbMood, type ShownReaction } from './cloud/Cloud.tsx';

type Pose = 'home' | 'dock';
type Face = { look: { x: number; y: number } | null; squint: boolean };

const AT_REST: Face = { look: null, squint: false };

/**
 * Leaving makes room for words being read: it launches at once and glides into the dock
 * (--ease-state). Coming back nothing is waiting on it, so it eases out and in (--ease-move).
 * The eyes lead the body by `lead`.
 */
const FLIGHT: Record<Pose, { duration: number; ease: [number, number, number, number]; lead: number }> = {
  dock: { duration: 0.62, ease: [0.2, 0, 0, 1], lead: 0.09 },
  home: { duration: 0.68, ease: [0.77, 0, 0.175, 1], lead: 0.09 },
};

/**
 * The landing look-around, then rest. The eyes reach well past their pointer range (1) so the glance
 * still reads when the ball is docked at 44 px.
 */
const LANDING: { face: Face; ms: number }[] = [
  { face: { look: { x: -2.6, y: -1.7 }, squint: false }, ms: 260 },
  { face: { look: { x: 2.3, y: -1.3 }, squint: false }, ms: 520 },
];
/** In flight the eyes look along the way it is heading, further than the pointer would take them. */
const LEAD_REACH = 1.6;

/** Docked, the ball sits in the thread's 48 px top row, 2 px in from each side, 40 px into Q2. */
const DOCK = { inset: 40, height: 44, row: 48 };
const ASPECT = 1;

type Geometry = { dx: number; dy: number; scale: number };

function measure(root: HTMLElement, body: HTMLElement, ball: HTMLElement): Geometry {
  const r = root.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  // The Cloud's box is the visible orb (its canvas overflows it for the swell and lean).
  const svgHeight = ball.offsetWidth / ASPECT;
  const edgeY = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--edge-y')) || 40;
  const home = { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
  const dock = { x: DOCK.inset + (DOCK.height * ASPECT) / 2, y: edgeY + DOCK.row / 2 };
  return { dx: dock.x - home.x, dy: dock.y - home.y, scale: DOCK.height / svgHeight };
}

/** The transform at progress `p`, heading `dir` (+1 to the dock, -1 home). It always stays a circle. */
function pose(g: Geometry, p: number, dir: number): string {
  // Quadratic curve from home (0, 0) to the dock, its control point nearly straight above home:
  // it rises out of the words first, then drifts left along the top.
  const cx = g.dx * 0.12;
  const cy = g.dy * 1.04;
  const x = 2 * (1 - p) * p * cx + p * p * g.dx;
  const y = 2 * (1 - p) * p * cy + p * p * g.dy;
  // It shrinks early on the way out (and so grows late on the way back).
  const s = 1 + (g.scale - 1) * (1 - Math.pow(1 - p, 2.2));
  const lean = -dir * 9 * Math.sin(Math.PI * p);
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${lean.toFixed(2)}deg) scale(${s.toFixed(4)})`;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Props = {
  /** The middle is blank: no live text and no title there. */
  visible: boolean;
  still: boolean;
  mood: OrbMood;
  pulse: number;
  listening: boolean;
  reaction: ShownReaction | null;
};

export function Companion({ visible, still, mood, pulse, listening, reaction }: Props) {
  const target: Pose = visible ? 'home' : 'dock';
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState<Face>(AT_REST);
  const flight = useRef({ p: visible ? 0 : 1, dir: 1, geometry: null as Geometry | null });

  const apply = () => {
    const f = flight.current;
    if (flightRef.current && f.geometry) flightRef.current.style.transform = pose(f.geometry, f.p, f.dir);
  };

  // Measure on mount and on every resize, and hold the current pose.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const ball = flightRef.current?.firstElementChild as HTMLElement | null;
    if (!root || !body || !ball) return;
    const remeasure = () => { flight.current.geometry = measure(root, body, ball); apply(); };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const f = flight.current;
    const goal = target === 'dock' ? 1 : 0;
    const el = flightRef.current;
    if (!el || f.p === goal) return;
    const running: AnimationPlaybackControls[] = [];
    const timers: number[] = [];
    let cancelled = false;
    const settle = (steps: typeof LANDING) => {
      let at = 0;
      for (const step of steps) { timers.push(window.setTimeout(() => setFace(step.face), at)); at += step.ms; }
      timers.push(window.setTimeout(() => setFace(AT_REST), at));
    };

    if (still || reducedMotion()) {
      setFace(AT_REST);
      running.push(animate(el, { opacity: 0 }, { duration: 0.15, ease: [0.23, 1, 0.32, 1] }));
      running[0].finished.then(() => {
        if (cancelled) return;
        f.p = goal;
        apply();
        running.push(animate(el, { opacity: 1 }, { duration: 0.15, ease: [0.23, 1, 0.32, 1] }));
      });
    } else {
      const g = f.geometry;
      const len = g ? Math.hypot(g.dx, g.dy) || 1 : 1;
      const toDock = target === 'dock';
      f.dir = toDock ? 1 : -1;
      // The eyes go first, towards where it is heading.
      const ahead = (toDock ? 1 : -1) * LEAD_REACH;
      setFace({ look: g ? { x: (ahead * g.dx) / len, y: (ahead * g.dy) / len } : null, squint: true });
      el.style.opacity = '1';
      const { duration, ease, lead } = FLIGHT[target];
      // Turned round mid-flight, it only travels the rest of the way.
      const share = Math.abs(goal - f.p);
      running.push(animate(f.p, goal, {
        duration: duration * (0.35 + 0.65 * share),
        ease,
        delay: lead,
        onUpdate: (v) => { f.p = v; apply(); },
        onComplete: () => settle(LANDING),
      }));
    }
    return () => {
      cancelled = true;
      running.forEach((a) => a.stop());
      timers.forEach(clearTimeout);
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={rootRef} className="companion" data-pose={target} data-still={still ? '' : undefined} aria-hidden="true">
      <div ref={bodyRef} className="companion-body">
        <div ref={flightRef} className="companion-flight">
          <div className="companion-float">
            <Cloud mood={mood} pulse={pulse} still={still || reducedMotion()} listening={listening} reaction={reaction} look={face.look} />
          </div>
        </div>
      </div>
    </div>
  );
}
