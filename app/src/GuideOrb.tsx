/**
 * The orb through onboarding (owner, 2026-11-08), drawn as the Cloud (cloud/Cloud.tsx, NAT-42). It rests above the greeting and the voice note,
 * and in calibration it is the point to look at: it glides to the centre of each backend quadrant
 * in turn, and while the tracker collects there a black pen line sketches round it, a little larger
 * than the orb so white shows between them, until it closes the loop.
 *
 * NAT-44 (owner, 2026-11-08):
 *  - Ghosting: as the Cloud glides to the next point, after-images of it trail along its path and
 *    fade as they catch up with it at the next position (ghosts.ts).
 *  - The ring is one hand-sketched ink line, never a perfect circle: a slightly egg-shaped, wobbly
 *    loop with pen tremor that runs on past where it began. Each point gets its own loop (ring.ts).
 *
 * One animation loop drives the calibration run (starting the dots once a face is in view, ending
 * the run on time) and places the orb. Positions and the ring are written to the element directly,
 * so the loop never re-renders React.
 */
import { useEffect, useRef } from 'react';
import { Cloud } from './cloud/Cloud.tsx';
import { sketchedRing } from './ring.ts';
import { GhostTrail } from './ghosts.ts';
import { TIMING, beginRun, eyesStatus, faceInView, positionAt, runDots, tickRun, useEyesStatus } from './eyes/session.ts';

type Place = { x: number; y: number; size: number };

/** The orb's size at rest, at rest over a voice page (NAT-32), waiting at the centre, and as a target. */
const SIZE = { rest: 132, voice: 88, centre: 96, target: 72 };
/** White between the orb and its ring, and the ring's line. */
const GAP = 10;
const LINE = 4;
const C = 100; // pathLength

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const arc = useRef<SVGPathElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const stillRef = useRef(still);
  stillRef.current = still;
  // The slow smile: once this calibration's dots have run, the Cloud smiles as it returns to the centre.
  const status = useEyesStatus();
  const ran = useRef(false);
  if (!calibrating) ran.current = false;
  else if (status.kind === 'calibrating' && status.startedAt !== null) ran.current = true;
  const smile = calibrating && ran.current && status.kind !== 'calibrating';

  useEffect(() => {
    let frame = 0;
    let shown = '';
    // The ring's loop is drawn anew for each point; `ringFor` is the point it was drawn for.
    let ringFor = -1;
    const sketchFor = (index: number) => {
      if (index === ringFor || !arc.current) return;
      ringFor = index;
      arc.current.setAttribute('d', sketchedRing(index * 7919 + Math.floor(Math.random() * 1e4)));
    };
    // Ghosting: only in calibration, and never when the Cloud is Still or motion is reduced.
    const trail = ghosts.current ? new GhostTrail(ghosts.current) : null;
    const ghostsOn = () => calibrating && !stillRef.current && !reducedMotion();
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
      // The pen eases in and out a little, as a hand does.
      const t = ring ?? 0;
      const pen = 0.5 * t + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * t));
      a.parentElement?.toggleAttribute('data-on', ring !== null);
      a.style.strokeDashoffset = String(C * (1 - pen));
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const s = eyesStatus();
      root.current?.toggleAttribute('data-target', calibrating && s.kind === 'calibrating');
      // The return to the centre after the points is a long glide: a gentler trail there.
      if (root.current) trail?.frame(now, root.current, ghostsOn(), s.kind === 'calibrating' ? 1 : 0.4);
      if (!calibrating) { place(rest(), null); return; }
      if (s.kind !== 'calibrating' || s.startedAt === null) {
        if (s.kind === 'calibrating' && faceInView()) beginRun(now);
        place(centre(), null);
        return;
      }
      tickRun(now);
      const pos = positionAt(now - s.startedAt, runDots());
      if (!pos || pos.phase === 'intro') { place(centre(), null); return; }
      if (pos.phase === 'collect') sketchFor(pos.index);
      place({ x: pos.dot.x, y: pos.dot.y, size: SIZE.target }, pos.phase === 'collect' ? pos.progress : null);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); trail?.dispose(); };
  }, [calibrating]);

  return (
    <>
    <div ref={ghosts} className="guide-ghosts" aria-hidden="true" />
    <div ref={root} className="guide-orb" style={{ ['--move' as string]: `${TIMING.moveMs}ms` }} aria-hidden="true">
      {/* As the calibration target its centre holds still (no lean) and white shows round it (no halo). */}
      <Cloud mood="idle" still={still} lean={!calibrating} halo={!calibrating} smile={smile} />
      <svg className="guide-ring" viewBox="-50 -50 100 100" style={{ ['--gap' as string]: `${GAP}px`, ['--line' as string]: `${LINE}px` }}>
        <path ref={arc} className="guide-ring-pen" pathLength={C} strokeDasharray={C} style={{ strokeDashoffset: C }} />
      </svg>
    </div>
    </>
  );
}
