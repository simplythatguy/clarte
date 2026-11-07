/**
 * The rest zone: backend quadrants Q2 and Q3. Nothing here is actionable, so reading never arms a
 * selection. It holds one major thing per state: the partner's words while listening, the message
 * while composing, the spoken sentence while speaking.
 */
import { Fragment, useLayoutEffect, useRef } from 'react';
import { pendingGlyphs, type Composition, type Word } from '../../shared/composer.ts';
import { groupOf, type GroupId } from '../../shared/decoder.ts';
import { contextWords, displayWord, phaseOf, type State } from './model.ts';
import { CrossFade } from './parts.tsx';

export function statusOf(state: State): { tone: 'ready' | 'listening' | 'composing' | 'speaking' | 'error'; text: string } {
  if (state.notice) return { tone: 'error', text: state.notice };
  if (state.mode === 'speaking' || state.holding) return { tone: 'speaking', text: 'Speaking' };
  if (state.mode === 'listening') return { tone: 'listening', text: state.settings.partner === 'script' ? 'Listening to the script' : 'Listening' };
  if (state.comp.words.length || state.comp.pending.length) return { tone: 'composing', text: 'Writing a reply' };
  return { tone: 'ready', text: 'Ready' };
}

const gclass = (g: GroupId | null) => (g ? g.toLowerCase() : '');

/** An accepted word. It settles from group ink to plain ink once, on the frame it is accepted. */
function AcceptedWord({ word, index, colours, settling }: { word: Word; index: number; colours: boolean; settling: boolean }) {
  const text = displayWord(word.text, index);
  const tinted = word.source === 'decoded' && (colours || settling);
  if (word.source === 'phrase') {
    // A phrase is several words: one span each, so whole-line clipping works per word.
    return <>{text.split(/\s+/).map((w, i) => <Fragment key={i}>{i > 0 && ' '}<span className="word">{w}</span></Fragment>)}</>;
  }
  return (
    <span className={`word${settling && !colours ? ' word--settle' : ''}`}>
      {tinted ? Array.from(text, (ch, i) => <span key={i} className={`gl ${gclass(groupOf(ch))}`}>{ch}</span>) : text}
    </span>
  );
}

/**
 * The word in progress (BRIEF "The word in progress"): one glyph per typed group, the candidate's
 * letter in that group's ink, then the predicted rest as ghost letters in tertiary ink. Without a
 * candidate, one dot per typed group. Each glyph keeps its key, so a new one fades in and the
 * others never move; the ghost cross-fades when the candidate changes.
 */
function WordInProgress({ comp, context }: { comp: Composition; context: readonly string[] }) {
  const glyphs = pendingGlyphs(comp, context);
  const typed = glyphs.filter((g) => g.typed);
  const ghost = glyphs.filter((g) => !g.typed).map((g) => g.letter).join('');
  const first = comp.words.length === 0;
  return (
    <span className="wip" role="group" aria-label={`Typing ${typed.length} letters${ghost || typed.some((g) => g.letter) ? `, ${typed.map((g) => g.letter ?? '').join('')}${ghost}` : ''}`}>
      {typed.map((g, i) => (
        g.letter
          ? <span key={`t${i}`} className={`gl gl--typed ${gclass(g.group)}`}>{first && i === 0 ? g.letter.toUpperCase() : g.letter}</span>
          : <span key={`t${i}`} className={`gl gl--dot ${gclass(g.group)}`} />
      ))}
      {ghost && <span key={`ghost-${typed.map((g) => g.letter).join('')}${ghost}`} className="gl--ghost">{ghost}</span>}
    </span>
  );
}

function Message({ comp, context, colours }: { comp: Composition; context: readonly string[]; colours: boolean }) {
  // The word accepted on this render settles from group ink to ink (180 ms, colour only).
  const prev = useRef({ count: comp.words.length, pending: comp.pending.length });
  const settleIndex = comp.words.length === prev.current.count + 1 && prev.current.pending > 0 && comp.pending.length === 0 ? comp.words.length - 1 : -1;
  const settle = useRef<{ index: number; text: string } | null>(null);
  if (settleIndex >= 0) settle.current = { index: settleIndex, text: comp.words[settleIndex].text };
  else if (comp.words.length !== prev.current.count || comp.pending.length) settle.current = null;
  prev.current = { count: comp.words.length, pending: comp.pending.length };

  return (
    <p className="message">
      {comp.words.map((word, i) => (
        <Fragment key={`${i}-${word.text}`}>
          {i > 0 && ' '}
          <AcceptedWord word={word} index={i} colours={colours} settling={settle.current?.index === i && settle.current.text === word.text} />
        </Fragment>
      ))}
      {comp.pending.length > 0 && comp.words.length > 0 && ' '}
      {comp.pending.length > 0 && <WordInProgress comp={comp} context={context} />}
    </p>
  );
}

/** Plain text as one span per word, so the tail scroller can hide whole words, never half lines. */
function Words({ text }: { text: string }) {
  return <>{text.split(/\s+/).filter(Boolean).map((w, i) => <Fragment key={i}>{i > 0 && ' '}<span className="word">{w}</span></Fragment>)}</>;
}

function Spoken({ text, current, live, past }: { text: string; current: number; live: boolean; past: boolean }) {
  return (
    <p className={`message message--spoken${past ? ' message--past' : ''}`}>
      {text.split(/\s+/).map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className={`word${live ? (i === current ? ' is-current' : i > current ? ' is-ahead' : '') : ''}`}>{displayWord(w, i)}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Keeps the newest line in view when the content outgrows its box (long messages, 200% text):
 *  1. the message first shrinks from the chosen text size toward 100% to fit (never below 100%);
 *  2. only then does the box follow its tail by whole lines, hiding any word that would be cut;
 *  3. while speaking, it follows the word being said rather than the end.
 */
function useTail<T extends HTMLElement>(dep: unknown, fit: boolean, scale: number) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (fit) {
      // Shrink toward 100% in steps until the content fits.
      let s = scale;
      el.style.setProperty('--msg-scale', String(s));
      const slack = () => parseFloat(getComputedStyle(el).lineHeight) || 0;
      // Fits when no line overflows the height and no word is wider than the box (round 4: a long
      // accepted word at 200% ran past the right edge).
      const tooWide = () => Math.max(0, ...Array.from(el.querySelectorAll<HTMLElement>('.message > .word'), (w) => w.getBoundingClientRect().width)) > el.clientWidth + 1;
      while (s > 1 && (el.scrollHeight - slack() > el.clientHeight + 1 || tooWide())) {
        s = Math.max(1, Math.round((s - 0.125) * 1000) / 1000);
        el.style.setProperty('--msg-scale', String(s));
      }
    }
    const style = getComputedStyle(el);
    const lh = parseFloat(style.lineHeight) || 1;
    const items = el.querySelectorAll<HTMLElement>('.message > .word, .message > .wip, :scope > .word');
    if (!items.length) {
      const slack = getComputedStyle(el, '::after').content === 'none' ? 0 : lh;
      const overflow = el.scrollHeight - slack - el.clientHeight;
      el.scrollTop = overflow > 0.5 ? Math.ceil((overflow - 0.5) / lh) * lh : 0;
      return;
    }
    const origin = el.getBoundingClientRect().top - el.scrollTop;
    const rects = Array.from(items, (item) => item.getBoundingClientRect());
    const bottom = Math.max(...rects.map((r) => r.bottom - origin));
    const tops: number[] = [];
    for (const r of rects.map((x) => x.top - origin).sort((a, b) => a - b)) if (!tops.length || r - tops[tops.length - 1] > lh / 2) tops.push(r);
    let first = tops.find((t) => bottom - t <= el.clientHeight) ?? tops[tops.length - 1];
    const current = el.querySelector<HTMLElement>('.is-current');
    if (current) {
      const top = current.getBoundingClientRect().top - origin;
      const line = [...tops].reverse().find((t) => t <= top + lh / 2) ?? tops[0];
      if (line < first) first = line;
    }
    el.scrollTop = first <= tops[0] ? 0 : first;
    const box = el.getBoundingClientRect();
    let hiddenBefore = false;
    let marked = false;
    items.forEach((item) => {
      const r = item.getBoundingClientRect();
      // Inline glyph boxes overhang a tight line box by a few pixels; only a real cut counts.
      const slack = r.height * 0.25;
      const clipped = r.top < box.top - slack || r.bottom > box.bottom + slack;
      item.classList.toggle('is-clipped', clipped);
      // The first word shown after hidden ones carries a leading "…", so a tail never reads as a
      // fragment (round 3).
      const tail = !clipped && hiddenBefore && !marked;
      item.classList.toggle('is-tail', tail);
      if (tail) marked = true;
      if (clipped) hiddenBefore = true;
    });
  }, [dep, fit, scale]);
  return ref;
}

export function Rest({ state }: { state: State }) {
  const phase = phaseOf(state);
  const status = statusOf(state);
  const listening = state.mode === 'listening';
  const speaking = state.mode === 'speaking';
  const showSpoken = state.spoken !== null && !state.comp.words.length && !state.comp.pending.length && !listening;
  const scale = state.settings.textScale;
  const tailKey = `${state.partner}|${state.comp.words.length}|${state.comp.pending.join('')}|${state.comp.candidateIndex}|${scale}|${phase}|${state.spokenWord}`;
  const partnerRef = useTail<HTMLDivElement>(tailKey, false, scale);
  const messageRef = useTail<HTMLDivElement>(tailKey, true, scale);
  const context = contextWords(state);

  return (
    <section className="rest" aria-label="Conversation">
      <p className={`status status--${status.tone}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        {status.text}
      </p>
      <CrossFade id={listening ? 'listening' : 'composing'} className="rest-body" phase>
        {listening ? (
          <div ref={partnerRef} className="partner partner--major" aria-live="polite"><Words text={state.partner} /></div>
        ) : (
          <>
            {state.partner && <div ref={partnerRef} className="partner" role="group" aria-label="They said"><Words text={state.partner} /></div>}
            {state.partner && <hr className="rule" />}
            <div ref={messageRef} className="message-box" aria-live="polite">
              {showSpoken
                ? <Spoken text={state.spoken!} current={state.spokenWord} live={speaking} past={state.mode === 'idle'} />
                : <Message comp={state.comp} context={context} colours={state.settings.wordColours} />}
            </div>
          </>
        )}
      </CrossFade>
    </section>
  );
}
