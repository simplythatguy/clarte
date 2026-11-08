/**
 * Lists of cards on a page: the Options screen's words and any menu page (owner, 2026-11-08).
 *
 * Up to five cards take their places directly. More than five show two at a time in Q5–Q6, with ←
 * in Q7 and → in Q8; an arrow fades when the list cannot go further that way. An arrow slides the
 * row one card: one card slides out, its neighbour moves over, the next slides in. The row is
 * clipped to the two cards' own strip, so a moving card never crosses into the arrows' quadrants,
 * and the strip takes no selection while it moves (it is inert for the slide).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Tile, type SlotName, type Slots, type SlotView } from './Tile.tsx';
import { Swap } from './Swap.tsx';
import { Back, Next } from './icons.tsx';

/** A page shows this many cards directly; more and it pages. */
const DIRECT = 5;
/** Cards in view while paging (Q5 and Q6). */
export const IN_VIEW = 2;
/** The row's slide: on-screen movement, so it eases in and out (--ease-move). */
const SLIDE_MS = 320;

export type Strip = { views: SlotView[]; at: number };
export type Paged = { slots: Slots; strip: Strip | null };

const arrow = (action: string, label: string, glyph: ReactElement, disabled: boolean): SlotView => ({
  action, tone: 'surface', label, disabled, className: 'card-arrow', bodyKey: action,
  body: <span className="arrow-glyph" aria-hidden="true">{glyph}</span>,
});

/** Where a list's cards go: directly in `order` when it fits, else a paged strip and arrows. */
export function pageList(views: SlotView[], at: number, order: SlotName[]): Paged {
  if (views.length <= DIRECT) {
    const slots: Slots = {};
    views.forEach((v, i) => { slots[order[i]] = v; });
    return { slots, strip: null };
  }
  const last = views.length - IN_VIEW;
  const shown = Math.min(Math.max(0, at), last);
  return {
    slots: {
      q7: arrow('page-prev', 'Previous', <Back />, shown === 0),
      q8: arrow('page-next', 'Next', <Next />, shown >= last),
    },
    strip: { views, at: shown },
  };
}

/** The paged row over Q5–Q6. */
export function PagedStrip({ strip, activate }: { strip: Strip; activate: (action: string) => void }) {
  const [sliding, setSliding] = useState(false);
  const shownAt = useRef(strip.at);
  useEffect(() => {
    if (shownAt.current === strip.at) return;
    shownAt.current = strip.at;
    setSliding(true);
    const t = setTimeout(() => setSliding(false), SLIDE_MS);
    return () => clearTimeout(t);
  }, [strip.at]);
  return (
    <div className="pager" inert={sliding || undefined}>
      <div className="pager-view">
        <div className="pager-track" style={{ ['--at' as string]: strip.at }}>
          {strip.views.map((v, i) => (
            <div key={v.action} className="pager-slot" inert={i < strip.at || i >= strip.at + IN_VIEW || undefined}>
              <Tile action={v.action} tone={v.tone} icon={v.icon} label={v.label} disabled={v.disabled} fast onActivate={activate}>
                <Swap swapKey={v.bodyKey} className="card-swap" leavingClass="card-leaving" fast>{v.body}</Swap>
              </Tile>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
