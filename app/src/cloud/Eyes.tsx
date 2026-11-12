/**
 * The orb's face: UI v1's two long white eyes (owner, 2026-11-10), in v1's own units, where the
 * ball is a 240 box: ellipses 20 × 30 at (85, 108) and (155, 108). Orb.tsx moves the face box with
 * the look, the lean and the swell; the viewBox is that box's place in v1's ball (0.8 of the
 * radius wide, 0.3 of it below the centre), so the eyes land where v1 drew them.
 *
 *  - Blinks: with nobody in front of the camera they blink every 3 s, as v1's did. With a face in
 *    view they blink and wink with the person instead, as a mirror does: the person's left eye
 *    closes the eye on the screen's left (eyes/expression.ts).
 *  - Glare (owner, 2026-11-10): while gaze dwells on a letter group, and only then, each eye
 *    reflects the card's dwell line, the way a phone shows in the eyes of someone looking at it.
 *    The reflection is the eye's own shape at GLARE, drawn in the group's colour in step with the
 *    card's line (after the same intent delay, closing as the dwell completes). A click selects
 *    with no dwell: the glare floods at once, in the clicked group's colour. Like a real reflection it is mirrored:
 *    the card's line starts at its top left and runs clockwise, the glare starts at the top right
 *    and runs anticlockwise. It sits a little towards the card, as a reflection sits on the side
 *    of the eye facing what it shows. A selection floods it with the colour, as the card floods,
 *    and it fades with the card.
 */
import { useEffect, useRef } from 'react';
import { engine, intentDelay, isQuiet } from '../gaze.ts';
import { faceMirror, subscribeFace } from '../eyes/expression.ts';

const EYES = [{ side: 'l', cx: 85 }, { side: 'r', cx: 155 }] as const;
const CY = 108, RX = 20, RY = 30;
const GLARE = 0.55;
/** How far the glare sits towards the card, in v1 units (the eye leaves 9 either side of it). */
const GLARE_SHIFT = 3.5;
const RETRACT_MS = 150;
/** The card's commit: its circle grows (260 ms), holds (120 ms), then everything fades (280 ms). */
const FLOOD = { grow: 260, hold: 120, fade: 280 };

/** The glare's outline: the eye's shape at GLARE, from its top right, anticlockwise. */
function glarePath(cx: number): string {
  const rx = RX * GLARE, ry = RY * GLARE, c = Math.SQRT1_2;
  const [x0, y0, x1, y1] = [cx + rx * c, CY - ry * c, cx - rx * c, CY + ry * c].map((v) => v.toFixed(2));
  return `M${x0} ${y0}A${rx} ${ry} 0 1 0 ${x1} ${y1}A${rx} ${ry} 0 1 0 ${x0} ${y0}Z`;
}

type Glare = 'none' | 'trace' | 'closed' | 'flood';

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function Eyes({ alive }: { alive: boolean }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const apply = () => {
      const f = faceMirror();
      svg.toggleAttribute('data-face', f.present);
      svg.toggleAttribute('data-shut-l', f.shutLeft);
      svg.toggleAttribute('data-shut-r', f.shutRight);
    };
    apply();
    return subscribeFace(apply);
  }, []);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const lines = [...svg.querySelectorAll<SVGPathElement>('.orb-glare')];
    let glare: Glare = 'none';
    let shown: string | null = null;
    let running: Animation[] = [];
    const play = (frames: Keyframe[], duration: number) => {
      running.forEach((a) => a.cancel());
      running = lines.map((l) => l.animate(frames, { duration, easing: 'linear', fill: 'forwards' }));
    };
    const offsetNow = () => parseFloat(getComputedStyle(lines[0]).strokeDashoffset) || 0;

    const reflect = (card: Element) => {
      svg.style.setProperty('--glare', getComputedStyle(card).getPropertyValue('--gi').trim());
      const a = svg.getBoundingClientRect(), b = card.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      svg.style.setProperty('--glare-at', `${((dx / len) * GLARE_SHIFT).toFixed(2)}px ${((dy / len) * GLARE_SHIFT).toFixed(2)}px`);
    };

    const enter = (next: Glare, remaining: number) => {
      const prev = glare;
      glare = next;
      const reduce = reducedMotion?.matches ?? false;
      if (next === 'trace') {
        play([{ strokeDashoffset: offsetNow() || 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1 }], reduce ? 0 : remaining);
      } else if (next === 'closed') {
        play([{ strokeDashoffset: 0, opacity: 1 }], 0);
      } else if (next === 'flood') {
        const total = reduce ? FLOOD.fade : FLOOD.grow + FLOOD.hold + FLOOD.fade;
        const grown = reduce ? 0 : FLOOD.grow / total, held = reduce ? 0 : (FLOOD.grow + FLOOD.hold) / total;
        play([
          { strokeDashoffset: 0, fillOpacity: reduce ? 0.85 : 0, opacity: 1 },
          { strokeDashoffset: 0, fillOpacity: 0.85, opacity: 1, offset: grown },
          { strokeDashoffset: 0, fillOpacity: 0.85, opacity: 1, offset: held },
          { strokeDashoffset: 0, fillOpacity: 0.85, opacity: 0 },
        ], total);
      } else if (prev === 'trace' || prev === 'closed') {
        play([{ strokeDashoffset: offsetNow(), opacity: 1 }, { strokeDashoffset: 1, opacity: 1, offset: 0.99 }, { strokeDashoffset: 1, opacity: 0 }], reduce ? 0 : RETRACT_MS);
      }
      // After a flood the glare is already fading out with the card; it is left to finish.
    };

    return engine.subscribe((s) => {
      const action = s.action;
      const card = action ? document.querySelector(`.card[data-group][data-action="${CSS.escape(action)}"]`) : null;
      let next: Glare = 'none';
      let remaining = 0;
      if (action && card && !isQuiet(action, s)) {
        const dwellMs = engine.settings.dwellMs, start = intentDelay(action), elapsed = s.progress * dwellMs;
        if (s.state === 'dwelling') next = elapsed < start ? 'none' : 'trace';
        else if (s.state === 'previewed') next = 'closed';
        else if (s.state === 'selected') next = 'flood';
        remaining = Math.max(0, dwellMs - Math.max(elapsed, start));
      }
      if (next === glare) return;
      // Read the card when it is first dwelt on or clicked, before a selection changes it.
      if (next !== 'none' && card && action !== shown) { shown = action; reflect(card); }
      if (next === 'none') shown = null;
      enter(next, remaining);
    });
  }, []);

  return (
    <svg ref={ref} className="orb-eyes" viewBox="72 108 96 96" data-alive={alive || undefined} aria-hidden="true">
      {EYES.map(({ side, cx }) => (
        <g key={side} className="orb-eye" data-side={side}>
          <ellipse cx={cx} cy={CY} rx={RX} ry={RY} />
          <path className="orb-glare" d={glarePath(cx)} pathLength={1} />
        </g>
      ))}
    </svg>
  );
}
