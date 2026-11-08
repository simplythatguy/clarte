/**
 * The conversation, drawn in the Q2–Q3 rest zone.
 *
 * Top: the state pill (Listening, Replying, Speaking), readable from across the table.
 * Above the hairline: what has been said. Partner turns left in secondary ink, the person's turns
 * right in ink, no bubbles. Below it: the live line, in a fixed-height slot so nothing above it
 * ever moves: the partner's words as heard, the word in progress, or the sentence being spoken.
 *
 * Motion (MOTION.md choreography): a finished live line becomes a thread turn by a cross-fade in
 * place (the line fades out over 150 ms, the turn fades in over 300 ms from 100 ms); nothing
 * slides. Glyphs appear by opacity, accepted words settle from group ink to ink over 180 ms.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { glyphsForWord, type Composition, type Glyph, type Word } from '../../shared/composer.ts';
import { groupOf } from '../../shared/decoder.ts';
import { wordDisplay, type Live, type Turn } from './model.ts';
import { wordsOf } from './voice.ts';
import { displayWord } from './text.ts';
import { Mic, Speaker } from './icons.tsx';

export type StateName = 'listening' | 'composing' | 'speaking';
const STATE_LABEL: Record<StateName, string> = { listening: 'Listening', composing: 'Replying', speaking: 'Speaking' };

type Props = {
  state: StateName | null;
  turns: Turn[];
  live: Live;
  /** The partner's words as they are being heard (listening is always on). */
  hearing: string;
  composition: Composition;
  /** The word the engine shows for the pending groups (Q1), drawn as the word in progress. */
  candidate: string | null;
  /** Other words: the last word is the selected object (it is about to give way). */
  marked?: boolean;
  wordColours: boolean;
};

function Spoken({ text, word }: { text: string; word: number }) {
  return (
    <>
      {wordsOf(text).map((w, i) => (
        <span key={i}><span className="w" data-spoken={i === word || undefined}>{w}</span>{' '}</span>
      ))}
    </>
  );
}

/** An accepted word: its letters start in their group ink and settle to ink (or keep colour). */
function AcceptedWord({ word, index, marked = false }: { word: Word; index: number; marked?: boolean }) {
  const text = word.source === 'phrase' ? word.text : displayWord(word.text, index, wordDisplay(word));
  const cls = marked ? 'word selected' : 'word';
  if (word.source === 'unresolved') return <span className={`${cls} word-unresolved`}>{'•'.repeat(word.groups.length)}</span>;
  if (word.source !== 'decoded') return <span className={cls}>{text}</span>;
  return (
    <span className={cls}>
      {[...text].map((ch, i) => <span key={i} className="settle" data-group={groupOf(ch) ?? undefined}>{ch}</span>)}
    </span>
  );
}

type Slot = Glyph & { leaving?: boolean };

/**
 * The word in progress: one glyph per typed group in that group's ink, then the predicted rest
 * as ghost letters. Slots are keyed by position, so a new glyph fades in where it lands and
 * nothing slides; a removed trailing glyph lingers 120 ms while it fades out.
 */
function WordInProgress({ glyphs, first }: { glyphs: Glyph[]; first: boolean }) {
  // The current glyphs render in this commit (so the live line's fit measures them); only a
  // removed trailing glyph is added back for its fade, one commit later.
  const [tail, setTail] = useState<Slot[]>([]);
  const previous = useRef<Glyph[]>(glyphs);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = glyphs;
    if (glyphs.length >= before.length) { setTail((t) => (t.length ? [] : t)); return; }
    setTail(before.slice(glyphs.length).map((g) => ({ ...g, leaving: true })));
    const t = setTimeout(() => setTail([]), 130);
    return () => clearTimeout(t);
  }, [glyphs]);
  const slots: Slot[] = [...glyphs, ...tail];
  const hasLetters = glyphs.some((g) => g.letter !== null);
  // Dots after the letters (groups typed past the word the screen can offer) may wrap; the letters never break.
  const dotted = glyphs.some((g) => g.letter === null);
  return (
    <span className={`word in-progress${hasLetters ? '' : ' dots'}${hasLetters && dotted ? ' tail' : ''}`}>
      <span className="sr-only">{hasLetters ? glyphs.map((g) => g.letter ?? '').join('') : `${glyphs.length} letters typed`}</span>
      {slots.map((g, i) => {
        const letter = g.letter === null ? null : first && i === 0 ? g.letter.toUpperCase() : g.letter;
        // A letter from another group than the one typed at its place (a gaze-slip correction)
        // takes its own group's colour, so the colour tells where the look went astray.
        const own = g.typed && g.letter ? groupOf(g.letter) : null;
        const slip = own !== null && own !== g.group;
        const cls = `glyph ${g.typed ? 'typed' : 'ghost'}${letter === null ? ' dot' : ''}${slip ? ' slip' : ''}${g.leaving ? ' leaving' : ''}`;
        return (
          <span key={i} className={cls} data-group={slip ? own : g.group} aria-hidden="true">
            <span key={letter ?? 'dot'}>{letter ?? ''}</span>
          </span>
        );
      })}
    </span>
  );
}

function Message({ composition, candidate, marked, wordColours }: { composition: Composition; candidate: string | null; marked: boolean; wordColours: boolean }) {
  const glyphs = glyphsForWord(composition.pending, candidate);
  const { words } = composition;
  return (
    <span className={wordColours ? 'keep-colour' : undefined}>
      {words.map((w, i) => <span key={i}><AcceptedWord word={w} index={i} marked={marked && i === words.length - 1} />{' '}</span>)}
      {glyphs.length > 0 && <WordInProgress glyphs={glyphs} first={words.length === 0} />}
    </span>
  );
}

/** Keep the last live line for one 150 ms fade when it ends, without moving anything. */
function useLeaving(key: string, node: ReactNode): ReactNode {
  const last = useRef<{ key: string; node: ReactNode }>({ key, node });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  useLayoutEffect(() => {
    if (last.current.key !== key && last.current.node) setLeaving(last.current);
    last.current = { key, node };
  }, [key, node]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), 170);
    return () => clearTimeout(t);
  }, [leaving]);
  return leaving ? <span className="now-leaving" aria-hidden="true">{leaving.node}</span> : null;
}

export function Thread({ state, turns, live, hearing, composition, candidate, marked = false, wordColours }: Props) {
  const nowRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const highlight = live.kind === 'speaking' && live.turnId !== null ? live : null;

  // The pill changes width with its label on a short ease-out, like the morphing toolbar in the
  // owner's reference (a state change, a few times a minute; never under reduced motion).
  const pillRef = useRef<HTMLSpanElement>(null);
  const pillWidth = useRef(0);
  useLayoutEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const from = pillWidth.current;
    const to = el.offsetWidth;
    pillWidth.current = to;
    if (!from || Math.abs(from - to) < 1 || !state || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [state]);

  let nowKey = 'empty';
  let nowClass = 'now';
  let now: ReactNode = null;
  // The partner's words are the live line while the message is empty. Once the person types,
  // the message is the live line and the words being heard join the history as the newest turn.
  const typing = Boolean(composition.words.length || composition.pending.length);
  const heard = typing && hearing ? hearing : null;
  if (live.kind === 'speaking' && live.turnId === null) {
    // A spoken message stays the same element it was while composing: only the highlight changes.
    nowKey = 'compose';
    now = <span className="now-text"><Spoken text={live.text} word={live.word} /></span>;
  } else if (typing) {
    nowKey = 'compose';
    now = <span className="now-text"><Message composition={composition} candidate={candidate} marked={marked} wordColours={wordColours} /></span>;
  } else if (hearing) {
    nowKey = 'hearing';
    nowClass += ' now-partner';
    now = <span className="now-text">{hearing}</span>;
  }
  const leaving = useLeaving(nowKey, now);
  // Fit: when the live line is taller than its room (long messages, large text) or wider than it
  // (one long unbreakable word), step its type down to a floor of 75% at 100% scale and 50% at
  // 200% (the 100% size), so the whole message stays visible; past the floor it is marked
  // overflowing and keeps its latest words, whole lines only: the earlier lines are hidden above
  // the room, never half-erased (round 4: the first visible line used to sit under a fade).
  // History shows whole lines only. Turns cut by the top edge are hidden, not half-erased. The
  // newest turn keeps its head (a question starts there): when it alone does not fit, it is
  // anchored to its first line and clamped to the whole lines that fit.
  const fit = useRef(() => {});
  fit.current = () => {
    const el = nowRef.current;
    if (!el) return;
    const inner = el.querySelector<HTMLElement>(':scope > span > .now-text');
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    const floor = Math.max(0.5, 0.75 / scale);
    // One word wider than the room (a 28-letter word at 200%) is never cut: the type goes on down
    // for width alone, to 20 px at the least, since a word the person may speak must stay whole.
    const base = parseFloat(getComputedStyle(el).fontSize) / (parseFloat(el.style.getPropertyValue('--fit')) || 1);
    const wideFloor = Math.max(0.2, 20 / base);
    const history = historyRef.current;
    const tall = () => Boolean(inner && inner.offsetHeight > el.clientHeight + 1);
    const wide = () => Boolean(inner && inner.scrollWidth > el.clientWidth + 1);
    const over = () => tall() || wide();
    const step = () => {
      let f = 1;
      el.style.setProperty('--fit', '1');
      el.style.removeProperty('--now-clip');
      // Height stops stepping at `floor`; width alone may go on down to `wideFloor`.
      while (f > wideFloor && ((tall() && f > floor) || wide())) {
        f = Math.max(wideFloor, f - 0.05);
        el.style.setProperty('--fit', f.toFixed(2));
      }
    };
    // The message comes before history: past its floor, history gives up its second line.
    history?.removeAttribute('data-yield');
    step();
    if (over() && history) { history.setAttribute('data-yield', ''); step(); }
    el.toggleAttribute('data-overflow', over());
    if (tall() && inner) {
      // The room is anchored to the text's last line; clip its top to whole lines, so the first line
      // in view is never cut through (at least one line always shows).
      const lineHeight = parseFloat(getComputedStyle(inner).lineHeight) || 1;
      const whole = Math.max(1, Math.floor(el.clientHeight / lineHeight));
      const cut = Math.max(0, el.clientHeight - whole * lineHeight);
      if (cut > 1) el.style.setProperty('--now-clip', `${cut.toFixed(1)}px`);
    }
    if (history) {
      const turns = [...history.children] as HTMLElement[];
      const newest = turns[turns.length - 1];
      // The clamp goes on a turn's text, not the turn, so its icon is never clipped.
      const textOf = (t: HTMLElement) => t.querySelector<HTMLElement>(':scope > .turn-text') ?? t;
      for (const t of turns) { const x = textOf(t); x.style.removeProperty('-webkit-line-clamp'); x.classList.remove('clamped'); t.removeAttribute('data-cut'); }
      const newestFirst = Boolean(newest && newest.scrollHeight > history.clientHeight + 1);
      history.toggleAttribute('data-newest-first', newestFirst);
      if (newestFirst && newest) {
        const text = textOf(newest);
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        text.style.setProperty('-webkit-line-clamp', String(Math.max(1, Math.floor(history.clientHeight / lineHeight))));
        text.classList.add('clamped');
      } else {
        const top = history.getBoundingClientRect().top;
        for (const t of turns) if (t.getBoundingClientRect().top < top - 1) t.setAttribute('data-cut', '');
      }
    }
  };
  // When its inputs change, and whenever the thread's room or the live text's size changes for any
  // other reason (text size applied by the parent, the webfont arriving, a resize).
  useLayoutEffect(() => fit.current(), [state, turns, live, hearing, composition, candidate, marked, wordColours]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => fit.current());
    const watch = () => {
      ro.disconnect();
      for (const el of [nowRef.current, historyRef.current, nowRef.current?.querySelector(':scope > span > .now-text')]) if (el) ro.observe(el);
    };
    watch();
    const mo = new MutationObserver(watch);
    if (nowRef.current) mo.observe(nowRef.current, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  return (
    <section className="thread" aria-label="Conversation">
      <div className="state-row" role="status" aria-live="polite">
        <span ref={pillRef} className="state" data-state={state ?? 'idle'} aria-hidden={state ? undefined : true}><i aria-hidden="true" />{state ? STATE_LABEL[state] : STATE_LABEL.composing}</span>
      </div>
      <div ref={historyRef} className="history">
        {turns.map((turn) => (
          <p key={turn.id} className={`turn turn-${turn.who}`}>
            {/* Heard turns carry a microphone on their left, spoken replies a speaker on their right. */}
            <span className="turn-icon" aria-hidden="true">{turn.who === 'partner' ? <Mic /> : <Speaker />}</span>
            <span className="sr-only">{turn.who === 'partner' ? 'Heard: ' : 'Said: '}</span>
            <span className="turn-text">
              {highlight && highlight.turnId === turn.id ? <Spoken text={turn.text} word={highlight.word} /> : turn.text}
            </span>
          </p>
        ))}
        {heard && (
          <p key="heard" className="turn turn-partner">
            <span className="turn-icon" aria-hidden="true"><Mic /></span>
            <span className="sr-only">Hearing: </span>
            <span className="turn-text">{heard}</span>
          </p>
        )}
      </div>
      <div className="rule" aria-hidden="true" />
      <div ref={nowRef} className={nowClass} aria-live="polite">
        {leaving}
        {now && <span key={nowKey} style={{ display: 'contents' }}>{now}</span>}
      </div>
    </section>
  );
}
