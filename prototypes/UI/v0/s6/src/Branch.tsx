/**
 * The branch (owner concept, 2026-11-07): when two whole words fit the typed groups about equally
 * well, two lines grow from the word in progress, like edges in a node graph, and run until they
 * reach the two places to look next: the inner edge of Q1 (the first word) and of Q4 (the second).
 * Then everything is still. The word in progress is drawn as a selected object with a handle at
 * each end (the editor reference); the left handle's line goes to Q1 and the right one's to Q4.
 *
 * Motion (choreography, MOTION.md tiers): the branch appears after a group commit, so it is a
 * "tens a day" event: each line draws once over 480 ms on the ease-out curve while a small head
 * dot travels its front, and the end port fades in as the head arrives. Nothing loops and nothing
 * moves afterwards (gaze contract: stillness), so the line never competes with the dwell the
 * person is about to make. Leaving: the whole drawing fades over 150 ms. Under reduced motion the
 * finished drawing fades in over 150 ms.
 *
 * The drawing is decoration over rest zones and card edges: no `data-action`, aria-hidden, with
 * a status line for assistive technology instead.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';
import type { Conflict } from './conflict.ts';

const DRAW_S = 0.48;
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Point = [number, number];
type Geometry = { starts: [Point, Point]; ends: [Point, Point]; under: number };

/**
 * Each line leaves its handle downwards and turns outwards only below the word's descenders, so
 * neither line ever crosses the message or the thread above it; the lines arrive at the lower
 * inner edge of each card, at the message's own height where that is inside the card.
 */
function measure(svg: SVGSVGElement): Geometry | null {
  const host = svg.getBoundingClientRect();
  const word = document.querySelector<HTMLElement>('.now .word.in-progress');
  const left = document.querySelector<HTMLElement>('.cell-q1 .card');
  const right = document.querySelector<HTMLElement>('.cell-q4 .card');
  if (!word || !left || !right) return null;
  const w = word.getBoundingClientRect();
  const l = left.getBoundingClientRect();
  const r = right.getBoundingClientRect();
  // The handles sit on the selection outline, 0.1em outside the word (styles.css).
  const off = parseFloat(getComputedStyle(word).fontSize) * 0.1 + 0.75;
  const hy = w.top + w.height / 2 - host.top;
  const portY = (card: DOMRect) => Math.min(card.bottom - 48, Math.max(card.top + card.height / 2, w.top + w.height / 2));
  return {
    starts: [[w.left - off - host.left, hy], [w.right + off - host.left, hy]],
    under: w.bottom + off + 14 - host.top,
    ends: [
      [l.right - host.left, portY(l) - host.top],
      [r.left - host.left, portY(r) - host.top],
    ],
  };
}

/** A node-graph edge: drops from the handle, runs under the line, rises into the card. */
function edge([sx, sy]: Point, [ex, ey]: Point, under: number): string {
  const dir = ex < sx ? -1 : 1;
  const span = Math.abs(ex - sx);
  const drop = under;
  return `M ${sx} ${sy} V ${drop - 16} C ${sx} ${drop}, ${sx + dir * Math.min(60, span * 0.15)} ${drop}, ${sx + dir * Math.min(90, span * 0.25)} ${drop} `
    + `S ${ex - dir * Math.min(120, span * 0.3)} ${ey}, ${ex} ${ey}`;
}

type Props = { conflict: Conflict | null };

export function Branch({ conflict }: Props) {
  // Keep the last conflict while the drawing fades out.
  const [shown, setShown] = useState<Conflict | null>(conflict);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (conflict) { setShown(conflict); setLeaving(false); return; }
    if (!shown) return;
    setLeaving(true);
    const t = setTimeout(() => { setShown(null); setLeaving(false); }, 160);
    return () => clearTimeout(t);
  }, [conflict]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = shown ? `${shown.first}|${shown.second}` : '';
  return (
    <>
      <p className="sr-only" role="status">{conflict ? `Two words fit: ${conflict.first} or ${conflict.second}.` : ''}</p>
      {shown && <Drawing key={key} leaving={leaving} />}
    </>
  );
}

function Drawing({ leaving }: { leaving: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const paths = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const heads = [useRef<SVGCircleElement>(null), useRef<SVGCircleElement>(null)];
  const ports = [useRef<SVGCircleElement>(null), useRef<SVGCircleElement>(null)];
  const drawn = useRef(false);

  const layout = (geometry: Geometry) => {
    geometry.ends.forEach(([ex, ey], i) => {
      paths[i].current?.setAttribute('d', edge(geometry.starts[i], [ex, ey], geometry.under));
      ports[i].current?.setAttribute('cx', String(ex));
      ports[i].current?.setAttribute('cy', String(ey));
    });
  };

  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const geometry = measure(el);
    if (!geometry) return;
    layout(geometry);
    const controls: AnimationPlaybackControls[] = [];
    if (reducedMotion()) {
      drawn.current = true;
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'linear' });
    } else {
      paths.forEach((ref, i) => {
        const path = ref.current;
        const head = heads[i].current;
        const port = ports[i].current;
        if (!path || !head || !port) return;
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        port.style.opacity = '0';
        head.style.opacity = '1';
        controls.push(animate(0, 1, {
          duration: DRAW_S,
          ease: EASE_OUT,
          onUpdate: (p) => {
            path.style.strokeDashoffset = `${length * (1 - p)}`;
            const at = path.getPointAtLength(length * p);
            head.setAttribute('cx', String(at.x));
            head.setAttribute('cy', String(at.y));
          },
          onComplete: () => {
            path.style.strokeDasharray = '';
            path.style.strokeDashoffset = '';
            head.style.opacity = '0';
            port.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out', fill: 'forwards' });
            port.style.opacity = '1';
            drawn.current = true;
          },
        }));
      });
    }
    // A resize or a reflow of the message moves the anchors: follow them without redrawing.
    const ro = new ResizeObserver(() => { const g = svg.current && measure(svg.current); if (g) layout(g); });
    ro.observe(document.documentElement);
    const word = document.querySelector('.now');
    if (word) ro.observe(word);
    return () => { controls.forEach((c) => c.stop()); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg ref={svg} className={`branch${leaving ? ' branch-leaving' : ''}`} aria-hidden="true">
      {paths.map((ref, i) => <path key={i} ref={ref} className="branch-line" />)}
      {heads.map((ref, i) => <circle key={i} ref={ref} className="branch-head" r="4" style={{ opacity: 0 }} />)}
      {ports.map((ref, i) => <circle key={i} ref={ref} className="branch-port" r="7" />)}
    </svg>
  );
}
