/**
 * The orb through onboarding (owner, 2026-11-08), drawn as the Cloud (cloud/Cloud.tsx, NAT-42). It rests above the greeting and the voice note,
 * and in calibration it is the point to look at: it glides to the centre of each backend quadrant
 * in turn, and while the tracker collects there a blue line draws round it, a little larger than
 * the orb so white shows between them, until it closes into a circle. It glides with no trail.
 * (Owner, 2026-11-09: the blue circle is back in place of NAT-44's pencil sketch, and NAT-44's
 * after-image trail is gone.)
 *
 * One animation loop drives the calibration run (starting the dots once a face is in view, ending
 * the run on time) and places the orb. Positions and the ring are written to the element directly,
 * so the loop never re-renders React.
 */
import { useEffect, useRef } from 'react';
import { Cloud } from './cloud/Cloud.tsx';
import { TIMING, beginRun, eyesStatus, faceInView, positionAt, runDots, tickRun, useEyesStatus } from './eyes/session.ts';

type Place = { x: number; y: number; size: number };

/** The orb's size at rest, at rest over a voice page (NAT-32), waiting at the centre, and as a target. */
const SIZE = { rest: 132, voice: 88, centre: 96, target: 72 };
/** White between the orb and its ring, and the ring's line: v1's 100 px ring round the 72 px ball. */
const GAP = 10;
const LINE = 4;
/** In calibration the eyes look straight ahead (owner, 2026-11-10). */
const STRAIGHT_AHEAD = { x: 0, y: 0 };
const C = 100; // pathLength


/** White between the orb and the onboarding text below it (styles.css .onboarding keeps the same room). */
const TEXT_GAP = 40;

/**
 * Above the onboarding text. The text is pushed down by the orb and the gap, so the two are centred
 * together in the three columns left of the tall card; the orb reads where the text landed.
 */
function rest(): Place {
  // A two-button voice page has the top row to itself: the orb has Q1–Q2 alone and rests at their centre.
  if (document.querySelector('.rest-entering .onboarding-split')) return { x: window.innerWidth / 4, y: window.innerHeight / 4, size: SIZE.rest };
  const text = document.querySelector('.rest-entering .onboarding > *')?.getBoundingClientRect();
  // Voice pages share the top row with the bottom row's cards, so the orb is smaller and closer.
  const voice = document.querySelector('.rest-entering .voice-page') !== null;
  const size = voice ? (document.documentElement.hasAttribute('data-large') ? 64 : SIZE.voice) : SIZE.rest;
  const gap = voice ? (document.documentElement.hasAttribute('data-large') ? 16 : 24) : TEXT_GAP;
  if (!text) return { x: window.innerWidth * 0.375, y: window.innerHeight / 2 - size / 2, size };
  return { x: text.left + text.width / 2, y: text.top - gap - size / 2, size };
}
const centre = (): Place => ({ x: window.innerWidth / 2, y: window.innerHeight / 2, size: SIZE.centre });

export function GuideOrb({ calibrating, still }: { calibrating: boolean; still: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  // The slow smile: once this calibration's dots have run, the Cloud smiles as it returns to the centre.
  const status = useEyesStatus();
  const ran = useRef(false);
  if (!calibrating) ran.current = false;
  else if (status.kind === 'calibrating' && status.startedAt !== null) ran.current = true;
  const smile = calibrating && ran.current && status.kind !== 'calibrating';

  useEffect(() => {
    let frame = 0;
    let shown = '';
    const place = (p: Place, ring: number | null) => {
      const el = root.current, a = arc.current;
      if (!el || !a) return;
      const key = `${Math.round(p.x)},${Math.round(p.y)},${p.size}`;
      if (key !== shown) {
        shown = key;
        el.style.setProperty('--x', `${p.x}px`);
        el.style.setProperty('--y', `${p.y}px`);
        el.style.setProperty('--size', `${p.size}px`);
      }
      a.style.opacity = ring === null ? '0' : '1';
      a.style.strokeDashoffset = String(C * (1 - (ring ?? 0)));
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const s = eyesStatus();
      root.current?.toggleAttribute('data-target', calibrating && s.kind === 'calibrating');
      if (!calibrating) { place(rest(), null); return; }
      if (s.kind !== 'calibrating' || s.startedAt === null) {
        if (s.kind === 'calibrating' && faceInView()) beginRun(now);
        place(centre(), null);
        return;
      }
      tickRun(now);
      const pos = positionAt(now - s.startedAt, runDots());
      if (!pos || pos.phase === 'intro') { place(centre(), null); return; }
      place({ x: pos.dot.x, y: pos.dot.y, size: SIZE.target }, pos.phase === 'collect' ? pos.progress : null);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [calibrating]);

  return (
    <div ref={root} className="guide-orb" style={{ ['--move' as string]: `${TIMING.moveMs}ms` }} aria-hidden="true">
      {/* As the calibration target its centre holds still (no lean). */}
      <Cloud mood="idle" still={still} lean={!calibrating} smile={smile} look={calibrating ? STRAIGHT_AHEAD : null} />
      <svg className="guide-ring" viewBox="-50 -50 100 100" style={{ ['--gap' as string]: `${GAP}px`, ['--line' as string]: `${LINE}px` }}>
        <circle ref={arc} r={50 - 2} pathLength={C} strokeDasharray={C} transform="rotate(-90)" style={{ strokeDashoffset: C, opacity: 0 }} />
      </svg>
    </div>
  );
}
