import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GROUPS, type GroupId } from '../../shared/decoder.ts';
import { IconGlyph } from './icons.tsx';
import type { Slot } from './model.ts';

export type Position = 'q1' | 'q2' | 'q5' | 'q6' | 'q3' | 'q4';

const PIPS: Record<GroupId, number> = { G1: 1, G2: 2, G3: 3, G4: 4 };

/** The dwell ring: a 1.5 px track and a 3 px accent arc that fills clockwise from 12 o'clock. */
export function Ring({ children }: { children?: ReactNode }) {
  return (
    <span className="ring" aria-hidden="true">
      <svg className="ring-svg" viewBox="0 0 64 64">
        <circle className="ring-track" cx="32" cy="32" r="30.5" />
      </svg>
      {/* The arc: two clipped half-rings that rotate into view, transform only (composited). */}
      <span className="arc arc-r"><span className="arc-half" /></span>
      <span className="arc arc-l"><span className="arc-half" /></span>
      <span className="ring-bloom" />
      {children}
    </span>
  );
}

function Pips({ group }: { group: GroupId }) {
  return <span className="pips" aria-hidden="true">{Array.from({ length: PIPS[group] }, (_, i) => <span key={i} />)}</span>;
}

/**
 * A group's letters, the tile's only text ("G H I J K L M N"). One row; two rows of up to four
 * when text is large. The spaces are real, so the accessible name is the letters themselves.
 */
function Letters({ group }: { group: GroupId }) {
  const letters = GROUPS.find((g) => g.id === group)!.letters.toUpperCase();
  const half = Math.ceil(letters.length / 2);
  const rows = letters.length > 4 ? [letters.slice(0, half), letters.slice(half)] : [letters];
  return (
    <span className="letters" style={{ '--count': letters.length } as CSSProperties}>
      {rows.map((row, i) => (
        <span key={i} className="letters-row">{i > 0 && ' '}{row.split('').join(' ')}</span>
      ))}
    </span>
  );
}

function Content({ slot }: { slot: Slot }) {
  if (!slot.label) return null;
  if (slot.group && slot.letters) {
    // A letter key: the two-circle motif (group dot, dwell ring), its letters, its count.
    return (
      <span className="content">
        <span className="motif"><span className="motif-dot" /><Ring /></span>
        <Letters group={slot.group} />
        <Pips group={slot.group} />
      </span>
    );
  }
  return (
    <span className="content">
      <Ring>{slot.icon && <IconGlyph name={slot.icon} />}</Ring>
      {/* The label row has a fixed height and its text sits on the row's floor, so labels of
          different sizes share a baseline across a row of cards. */}
      <span className="label" style={{ '--chars': Math.max(4, ...slot.label.split(/\s+/).map((w) => w.length)) } as CSSProperties}>
        <span className="label-text">{slot.label}</span>
      </span>
      {slot.value && <span className="value">{slot.value}</span>}
      {slot.group && <Pips group={slot.group} />}
    </span>
  );
}

const contentKey = (s: Slot) => `${s.label}|${s.value ?? ''}|${s.icon ?? ''}|${s.group ?? ''}|${s.tone}`;

/**
 * One actionable card. The card sits inside its backend quadrant and the quadrant is the hit
 * region. A relabel never happens under the eyes: while the card is latched after a selection
 * (`data-dwell="selected"`), the old content stays, and it cross-fades once the gaze has left.
 */
export function Tile({ slot, position, onActivate, isKey, scene }: { slot: Slot; position: Position; onActivate: (id: string) => void; isKey: boolean; scene: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(slot);
  const [leaving, setLeaving] = useState<Slot | null>(null);
  // A relabel within one scene (word start, accept, candidate change) is frequent: a plain 150 ms
  // cross-fade. A change of scene (page, view) gets the 300 ms phase cross-fade.
  const [quick, setQuick] = useState(false);
  const sceneRef = useRef(scene);

  useEffect(() => {
    if (contentKey(slot) === contentKey(shown)) { if (slot !== shown) setShown(slot); return; }
    const el = ref.current;
    const sameScene = sceneRef.current === scene;
    const swap = () => { setQuick(sameScene); setLeaving(shown.label ? shown : null); setShown(slot); };
    if (el?.dataset.dwell !== 'selected') { swap(); return; }
    // Held: the card still shows its old content. A key press on it releases the hold first
    // (see App), so nothing ever acts behind a label it is not showing.
    const release = () => { observer.disconnect(); window.removeEventListener('clarte:release', release); swap(); };
    const observer = new MutationObserver(() => { if (el.dataset.dwell !== 'selected') release(); });
    observer.observe(el, { attributes: true, attributeFilter: ['data-dwell'] });
    window.addEventListener('clarte:release', release);
    return () => { observer.disconnect(); window.removeEventListener('clarte:release', release); };
  }, [slot, shown, scene]);
  useEffect(() => { sceneRef.current = scene; });

  const blank = !shown.label;
  const face = blank ? 'none'
    : position === 'q3' ? (shown.enabled ? 'ink' : 'white')
    : shown.group && isKey ? 'group'
    : 'white';
  const enabled = slot.enabled && Boolean(slot.label);

  return (
    <button
      ref={ref}
      type="button"
      className={`tile ${isKey ? 'key' : 'control'} ${position} face-${face} tone-${shown.tone}`}
      data-action={blank ? undefined : slot.id}
      data-held={contentKey(slot) !== contentKey(shown) ? '' : undefined}
      data-dwell-class={slot.dwell}
      data-group={shown.group}
      aria-disabled={enabled ? undefined : 'true'}
      aria-hidden={blank ? 'true' : undefined}
      tabIndex={enabled ? 0 : -1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        // Like a key press: a click on a card still showing its previous label only releases it.
        if (ref.current?.dataset.held !== undefined) { window.dispatchEvent(new Event('clarte:release')); return; }
        if (enabled) onActivate(slot.id);
      }}
    >
      {leaving && (
        <span className={`content-out${quick ? ' is-quick' : ''}`} aria-hidden="true" onAnimationEnd={() => setLeaving(null)}>
          <Content slot={leaving} />
        </span>
      )}
      <span className={`content-in${leaving ? (quick ? ' is-entering is-quick' : ' is-entering') : ''}`} key={contentKey(shown)}>
        <Content slot={shown} />
      </span>
    </button>
  );
}
