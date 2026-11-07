/**
 * The Rails building blocks in the shared light skin: cards that float in the canvas, each with
 * one instrument (the dwell ring), the message with its word in progress, and the state pill.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { groupLetters, groupOf, type GroupId } from '../../shared/decoder.ts';
import type { Glyph, Word } from '../../shared/composer.ts';
import { selectDirectly } from './gaze.ts';
import { Icon, type IconName } from './icons.tsx';

export type TileKind = 'control' | 'primary' | 'group' | 'setting' | 'phrase';
export type Visibility = 'live' | 'muted' | 'hidden';

export type TileSpec = {
  id: string;
  kind: TileKind;
  label: string;
  icon?: IconName;
  value?: string;
  vis: Visibility;
  /** Why a muted card cannot be selected, for its accessible name. */
  blocked?: string;
};

export type RailSlots = [TileSpec | null, TileSpec | null, TileSpec | null, TileSpec | null];

const groupIndex = (id: string) => Number(id.slice(1));

/**
 * The dwell arc, built from transforms only so it runs on the compositor: two clipped half-rings
 * that rotate 0 → 180° in turn (the right half sweeps 12 → 6 o'clock, then the left half 6 → 12).
 * No stroke animation, no paint per frame (MOTION acceptance 8).
 */
export function RingArc() {
  return (
    <span className="arc" aria-hidden="true">
      <span className="half half--r"><span className="sweep"><i /></span></span>
      <span className="half half--l"><span className="sweep"><i /></span></span>
    </span>
  );
}

/** The 1.5 px track that is present on every card at rest, plus the arc and the bloom copy. */
export function RingBox({ children }: { children?: ReactNode }) {
  return (
    <span className="ring-box">
      <svg className="ring" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <circle className="track" cx="24" cy="24" r="22.5" />
      </svg>
      <RingArc />
      <span className="bloom" />
      {children}
    </span>
  );
}

/**
 * The instrument: a track ring that the dwell fills clockwise in accent, and a bloom copy for
 * the commit. Groups pair it with their solid identity dot (the two-circle motif); controls
 * carry their glyph inside it.
 */
function Instrument({ spec }: { spec: TileSpec }) {
  return (
    <span className={`instrument instrument--${spec.kind === 'group' ? 'pair' : 'solo'}`} aria-hidden="true">
      {spec.kind === 'group' && <span className="id-dot" />}
      <RingBox>{spec.icon && <Icon name={spec.icon} />}</RingBox>
    </span>
  );
}

function TileBody({ spec }: { spec: TileSpec }) {
  switch (spec.kind) {
    case 'group': {
      // Two halves, shown as one row normally and as two lines at large text (G–N: 4 + 4).
      const letters = groupLetters(spec.id as GroupId, '');
      const half = Math.ceil(letters.length / 2);
      return (
        <>
          <span className="letters"><span className="letters-line">{letters.slice(0, half)}</span><span className="letters-line">{letters.slice(half)}</span></span>
          <span className="pips" aria-hidden="true">{Array.from({ length: groupIndex(spec.id) }, (_, i) => <i key={i} />)}</span>
        </>
      );
    }
    case 'control':
      // A muted control says why, on the card, where the eye already is (minimal-ui, apple-hig-ui).
      if (spec.blocked && spec.vis === 'muted') {
        return (
          <>
            <span className="label">{spec.label}</span>
            <span className="blocked">{spec.blocked}</span>
          </>
        );
      }
      return <span className="label">{spec.label}</span>;
    case 'setting':
      if (spec.blocked && spec.vis === 'muted') {
        return (
          <>
            <span className="name">{spec.label}</span>
            <span className="blocked">{spec.blocked}</span>
          </>
        );
      }
      return (
        <>
          <span className="name">{spec.label}</span>
          <span className="value">{spec.value}</span>
        </>
      );
    case 'primary':
      return <span className="label label--primary" style={{ '--len': Math.max(4, spec.label.length) } as CSSProperties}>{spec.label}</span>;
    default:
      return <span className="label">{spec.label}</span>;
  }
}

function accessibleName(spec: TileSpec): string {
  if (spec.blocked && spec.vis !== 'live') return `${spec.label}, ${spec.blocked}`;
  if (spec.kind === 'setting') return `${spec.label}: ${spec.value}`;
  if (spec.kind === 'group') return `Letters ${groupLetters(spec.id as GroupId)}`;
  if (spec.id.startsWith('autocomplete')) return `Use word: ${spec.label}`;
  return spec.label;
}

const contentKey = (spec: TileSpec) => `${spec.kind}:${spec.label}:${spec.value ?? ''}:${spec.icon ?? ''}:${spec.blocked && spec.vis === 'muted' ? spec.blocked : ''}`;

export function Tile({ spec }: { spec: TileSpec }) {
  const live = spec.vis === 'live';
  // A card going quiet keeps the label it had, so it fades out whole instead of emptying first.
  const kept = useRef(spec);
  if (spec.vis !== 'hidden' || !kept.current.label) kept.current = spec;
  const shown = spec.vis === 'hidden' ? { ...kept.current, vis: spec.vis } : spec;
  // A relabel cross-fades in place: the outgoing label fades out over 150 ms under the incoming one.
  const key = contentKey(shown);
  const [outgoing, setOutgoing] = useState<TileSpec | null>(null);
  const previous = useRef(shown);
  useLayoutEffect(() => {
    if (contentKey(previous.current) === key) { previous.current = shown; return; }
    setOutgoing(previous.current);
    previous.current = shown;
    const timer = setTimeout(() => setOutgoing(null), 160);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <button
      type="button"
      className={`tile tile--${spec.kind}`}
      data-group={spec.kind === 'group' ? groupIndex(spec.id) : undefined}
      data-action={live ? spec.id : undefined}
      data-vis={spec.vis}
      data-blocked={spec.blocked && spec.vis === 'muted' ? '' : undefined}
      disabled={!live}
      aria-hidden={spec.vis === 'hidden' || undefined}
      aria-label={accessibleName(spec)}
      tabIndex={live ? 0 : -1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { if (live) selectDirectly(spec.id, e.timeStamp); }}
    >
      <Instrument spec={shown} />
      <span className="content-stack">
        {outgoing && (
          <span className="content content--out" data-swap={outgoing.id.startsWith('autocomplete') ? 'quick' : undefined} aria-hidden="true" key={`out-${contentKey(outgoing)}`}>
            <TileBody spec={outgoing} />
          </span>
        )}
        <span className="content" data-swap={spec.id.startsWith('autocomplete') ? 'quick' : undefined} key={key}>
          <TileBody spec={shown} />
        </span>
      </span>
    </button>
  );
}

export function Rail({ slots, edge }: { slots: readonly (TileSpec | null)[]; edge: 'top' | 'bottom' }) {
  return (
    <div className={`rail rail--${edge}`}>
      {slots.map((spec, i) => (spec ? <Tile key={`${edge}-${i}`} spec={spec} /> : <div key={`${edge}-${i}`} className="slot" aria-hidden="true" />))}
    </div>
  );
}

/** Display form: the message reads as a sentence even though the decoder works in lower case. */
export function displayWord(text: string, first: boolean): string {
  if (/^i('|’|$)/.test(text)) return `I${text.slice(1)}`;
  return first ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function letterGroup(ch: string): number | undefined {
  const g = groupOf(ch);
  return g ? Number(g.slice(1)) : undefined;
}

/**
 * The message: accepted words in ink, then the word in progress as the live best decode. Each
 * typed group is one glyph in its group's ink (a dot when no candidate exists), followed by the
 * predicted remainder as ghost letters. Glyphs are keyed by position and letter, so a new or
 * changed glyph fades in where it stands and nothing slides. A just-accepted word settles from
 * group ink to plain ink. Every spoken word is its own span, so a phrase highlights word by word.
 */
export function Message(props: {
  words: Word[];
  glyphs: Glyph[];
  lastDecoded: { index: number; groups: GroupId[]; key: number } | null;
  wordColours: boolean;
  speakingIndex: number | null;
  caret: boolean;
}) {
  const { words, glyphs, lastDecoded, wordColours, speakingIndex, caret } = props;
  // A typed glyph that is removed (Delete) or changes letter (a new decode) fades out over 120 ms
  // where it stood, as an overlay, while whatever now takes that place fades in; nothing slides
  // (MOTION "Choreography", Delete). Accepting or reopening a word is the settle's, not this.
  type Placed = { left: number; top: number; text: string; group?: string; dot: boolean };
  const para = useRef<HTMLParagraphElement | null>(null);
  const placed = useRef<Placed[]>([]);
  const wordCount = useRef(words.length);
  const [leaving, setLeaving] = useState<{ key: number; glyphs: Placed[] } | null>(null);
  // Where each typed glyph stands, from the paragraph's corner (nothing transforms the message).
  // Measured after every render and again when a face loads or the window resizes, since either
  // moves the glyphs without a render.
  const measure = useCallback(() => {
    const root = para.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    // Only the word in progress: the fading overlays share the glyph classes and must not count.
    placed.current = [...root.querySelectorAll<HTMLElement>('.in-progress .glyph--typed, .in-progress .glyph--dot')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin.left, top: r.top - origin.top, text: el.textContent ?? '', group: el.dataset.group, dot: el.classList.contains('glyph--dot') };
    });
  }, []);
  useLayoutEffect(() => {
    const before = placed.current;
    const sameWords = wordCount.current === words.length;
    wordCount.current = words.length;
    measure();
    if (!sameWords || document.documentElement.dataset.input === 'keys') return;
    const now = placed.current;
    const gone = before.filter((g, i) => !now[i] || now[i].text !== g.text || now[i].dot !== g.dot);
    if (gone.length) setLeaving({ key: performance.now(), glyphs: gone });
  });
  useEffect(() => {
    document.fonts.addEventListener('loadingdone', measure);
    window.addEventListener('resize', measure);
    return () => { document.fonts.removeEventListener('loadingdone', measure); window.removeEventListener('resize', measure); };
  }, [measure]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), 140);
    return () => clearTimeout(timer);
  }, [leaving]);
  let spokenIndex = 0;
  const spoken = () => {
    const i = spokenIndex++;
    return speakingIndex === null ? undefined : i < speakingIndex ? 'done' : i === speakingIndex ? 'now' : 'next';
  };
  const first = words.length === 0;
  return (
    <p className="message" aria-live="polite" ref={para}>
      {words.map((word, i) => {
        const text = displayWord(word.text, i === 0);
        const fresh = lastDecoded && lastDecoded.index === i ? lastDecoded : null;
        const coloured = (wordColours || fresh) && word.source === 'decoded';
        return (
          <Fragment key={fresh ? `w${i}-${fresh.key}` : `w${i}`}>
            {i > 0 && ' '}
            {text.split(/\s+/).map((part, k) => (
              <Fragment key={k}>
                {k > 0 && ' '}
                <span className="word" data-spoken={spoken()}>
                  {coloured
                    ? Array.from(part).map((ch, n) => (
                      <span key={n} className={wordColours ? 'kept' : 'settle'} data-group={letterGroup(ch)}>{ch}</span>
                    ))
                    : part}
                </span>
              </Fragment>
            ))}
          </Fragment>
        );
      })}
      {glyphs.length > 0 && words.length > 0 && ' '}
      {glyphs.length > 0 && (
        <span className="in-progress">
          {glyphs.map((g, i) => {
            const group = Number(g.group.slice(1));
            const letter = g.letter && i === 0 && first ? g.letter.toUpperCase() : g.letter;
            if (!g.typed) return <span key={`g${i}-${g.letter}`} className="glyph glyph--ghost" aria-hidden="true">{letter}</span>;
            if (!letter) return <span key={`d${i}`} className="glyph glyph--dot" data-group={group} aria-hidden="true" />;
            return <span key={`t${i}-${letter}`} className="glyph glyph--typed" data-group={group} aria-hidden="true">{letter}</span>;
          })}
          <span className="visually-hidden">{`, ${glyphs.filter((g) => g.typed).length} letter groups typed`}</span>
        </span>
      )}
      {caret && <span className="caret" aria-hidden="true" />}
      {leaving?.glyphs.map((g, i) => (
        <span
          key={`${leaving.key}-${i}`}
          className={`glyph-out${g.dot ? ' glyph--dot' : ''}`}
          data-group={g.group}
          aria-hidden="true"
          style={{ left: g.left, top: g.top }}
        >
          {g.dot ? null : g.text}
        </span>
      ))}
    </p>
  );
}

export type BandState = 'listening' | 'composing' | 'speaking' | 'error' | null;

const BAND_LABEL: Record<Exclude<BandState, null>, string> = {
  listening: 'Listening',
  composing: 'Composing',
  speaking: 'Speaking',
  error: 'The voice did not play',
};

/**
 * The partner-facing state: a pill at the top edge, readable across a table. An error sits beside
 * the state rather than over it, so a live microphone is never hidden by a failure message.
 */
export function StatePill({ states }: { states: Exclude<BandState, null>[] }) {
  // A state that ends fades out over 150 ms in the same place while the next one fades in.
  const signature = states.join('+');
  const previous = useRef(states);
  const [outgoing, setOutgoing] = useState<Exclude<BandState, null>[]>([]);
  useLayoutEffect(() => {
    const gone = previous.current.filter((s) => !states.includes(s));
    previous.current = states;
    if (!gone.length) return;
    setOutgoing(gone);
    const timer = setTimeout(() => setOutgoing([]), 160);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const pill = (state: Exclude<BandState, null>, out = false) => (
    <span key={`${out ? 'out-' : ''}${state}`} className={out ? 'pill pill--out' : 'pill'} data-state={state} aria-hidden={out || undefined}>
      <i className="pill-dot" aria-hidden="true" />
      {BAND_LABEL[state]}
    </span>
  );
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="state-stack">
        {outgoing.length > 0 && <div className="pill-row">{outgoing.map((s) => pill(s, true))}</div>}
        <div className="pill-row">{states.map((s) => pill(s))}</div>
      </div>
    </div>
  );
}

/**
 * One screen at a time, swapped as one cross-fade in place (MOTION "Phase or page change"): the
 * outgoing screen is kept as an inert copy with no actions and fades out over 150 ms while the
 * incoming one fades in over 300 ms from 100 ms. Keyboard-driven changes swap instantly.
 */
export function ScreenSwap({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  const shown = useRef<string | null>(null);
  const leaving = useRef<HTMLElement | null>(null);
  // Copy the outgoing screen while it is still on the page, in the render that replaces it, so the
  // copy carries the moment of the selection (the solid ring of the card just chosen), not a frame
  // from the render before.
  if (shown.current !== null && shown.current !== screenKey && host.current && !leaving.current) {
    leaving.current = host.current.cloneNode(true) as HTMLElement;
  }
  useLayoutEffect(() => {
    const el = host.current;
    const ghost = leaving.current;
    leaving.current = null;
    const changed = shown.current !== null && shown.current !== screenKey;
    shown.current = screenKey;
    if (!el || !ghost || !changed || document.documentElement.dataset.input === 'keys') return;
    // The incoming screen enters as one fade: its labels and glyphs do not run their own entrances
    // inside it (set before the first style pass, so their @starting-style never applies).
    el.dataset.entering = '';
    setTimeout(() => { delete el.dataset.entering; }, 450);
    ghost.classList.add('screen--out');
    ghost.setAttribute('inert', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('[data-action]').forEach((n) => n.removeAttribute('data-action'));
    el.parentElement?.insertBefore(ghost, el);
    // Linear, so the outgoing screen is still there when the incoming one begins at 100 ms.
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' });
    fade.onfinish = () => ghost.remove();
  });
  return <div key={screenKey} ref={host} className="screen">{children}</div>;
}
