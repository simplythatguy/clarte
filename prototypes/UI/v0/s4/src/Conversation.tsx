import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pendingGlyphs, type Composition } from '../../shared/composer.ts';
import { signatureOf, type GroupId } from '../../shared/decoder.ts';
import { PAGE_TITLES, contextWords, conversationState, sentenceCase, type ConversationState, type State } from './model.ts';
import { wordsOf } from './voice.ts';

/** Sentence case for display and speech: the decoder works in lowercase. */
export const display = sentenceCase;
export const sentence = (text: string) => wordsOf(text).map(display).join(' ');

const STATUS: Record<ConversationState, string> = { idle: '', listening: 'Listening', composing: 'Composing', speaking: 'Speaking' };

/** The partner's cue: a 6 px strip in the state colour along the top edge. */
export function Strip({ state }: { state: ConversationState }) {
  return <div className={`strip strip--${state}`} aria-hidden="true" />;
}

function Status({ state }: { state: ConversationState }) {
  if (state === 'idle') return null;
  return (
    <p className={`status status--${state}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {STATUS[state]}
    </p>
  );
}

/** Letters of a word, each tagged with its group, so it can settle from group ink to ink. */
function Letters({ text, groups, className }: { text: string; groups: GroupId[]; className?: string }) {
  let g = 0;
  return (
    <span className={className}>
      {[...text].map((ch, i) => {
        const group = /[a-z]/i.test(ch) ? groups[g++] : undefined;
        return <span key={i} className={className === 'word-coloured' ? undefined : 'settle'} data-group={group}>{ch}</span>;
      })}
    </span>
  );
}

/**
 * The message. Accepted words in ink; the word in progress as its live best decode: one glyph
 * per typed group in that group's ink, then the predicted rest as ghost letters (BRIEF "The word
 * in progress"). Glyphs keep their place; a changed letter fades in where it stands.
 */
function Message({ state, markLast }: { state: State; markLast: boolean }) {
  const c = state.composition;
  const previous = useRef<Composition>(c);
  const [fresh, setFresh] = useState<number | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = c;
    if (c.words.length === before.words.length + 1 && before.pending.length && !c.pending.length) setFresh(c.words.length - 1);
    else if (c.words.length !== before.words.length || c.pending.length) setFresh(null);
  }, [c]);

  const glyphs = pendingGlyphs(c, contextWords(state));
  const hasCandidate = glyphs.some((g) => g.letter);
  const firstWord = c.words.length === 0;

  return (
    <>
      {c.words.map((w, i) => {
        const text = display(w.text, i);
        const groups = w.groups.length ? w.groups : signatureOf(w.text);
        return (
          <Fragment key={`${i}-${w.text}`}>
            {i > 0 && ' '}
            <span className={`m-word${markLast && i === c.words.length - 1 ? ' is-target' : ''}`}>
              {w.source === 'unresolved'
                ? w.groups.map((g, j) => <span key={j} className="glyph-dot" data-group={g} />)
                : state.settings.wordColour
                  ? <Letters text={text} groups={groups} className="word-coloured" />
                  : fresh === i ? <Letters text={text} groups={groups} /> : text}
            </span>
          </Fragment>
        );
      })}
      {c.words.length > 0 && glyphs.length > 0 && ' '}
      {glyphs.length > 0 && (
        // The word in progress changes with every group; only accepted words are announced.
        <span className={`m-word m-pending${hasCandidate ? '' : ' is-unknown'}`} aria-hidden="true">
          {glyphs.map((g, i) => (
            <span key={i} className={`glyph ${g.typed ? 'is-typed' : 'is-ghost'}`} data-group={g.group}>
              {g.letter
                ? <span key={g.letter}>{firstWord && i === 0 ? g.letter.toUpperCase() : g.letter}</span>
                : <span key="dot" className="glyph-dot" />}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

/** Keep only whole lines visible and the end of the text in view (or the spoken word). */
function snapToLines(el: HTMLElement) {
  el.style.maxHeight = 'none';
  const line = parseFloat(getComputedStyle(el).lineHeight);
  const lines = Math.max(1, Math.floor(el.clientHeight / line));
  el.style.maxHeight = `${lines * line}px`;
  const spoken = el.querySelector<HTMLElement>('.is-spoken');
  const maxLines = Math.round((el.scrollHeight - el.clientHeight) / line);
  // While speaking, the spoken word's line is the last visible line; otherwise show the end.
  const target = spoken ? Math.min(maxLines, Math.max(0, Math.round(spoken.offsetTop / line) - lines + 1)) : maxLines;
  el.scrollTop = target * line;
}

function useWholeLines(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => { if (ref.current) snapToLines(ref.current); });
  // Line metrics change when the web font arrives or the window resizes: snap again then.
  useEffect(() => {
    const again = () => { if (ref.current) snapToLines(ref.current); };
    void document.fonts.ready.then(again);
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [ref]);
}

export function Rest({ state }: { state: State }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { view, activity, partner, said, notice } = state;
  useWholeLines(scroller);
  const conversation = conversationState(state);

  let body: React.ReactNode;
  let kind = 'message';
  // Recording state and blocking notices stay visible on every screen, not only the conversation.
  const notices = (
    <>
      {notice === 'speech-failed' && <p className="notice" role="alert">Speech didn’t play. Look at Speak to try again.</p>}
      {notice === 'mic-unavailable' && <p className="notice" role="alert">The microphone isn’t available. Listening stopped.</p>}
    </>
  );
  if (view.kind === 'menu') {
    body = <><Status state={conversation === 'listening' ? 'listening' : 'idle'} />{notices}<h1 className="rest-title">{PAGE_TITLES[view.page]}</h1></>;
    kind = 'title';
  } else if (view.kind === 'spell') {
    body = <><Status state={conversation === 'listening' ? 'listening' : 'idle'} />{notices}<p className="spell-word" aria-live="polite" style={{ '--chars': Math.max(8, view.word.length + 1) } as React.CSSProperties}>{view.word}<span className="spell-caret" aria-hidden="true" /></p></>;
    kind = 'spell';
  } else if (activity.kind === 'listening') {
    body = (
      <>
        <Status state="listening" />
        <div className="transcript" ref={scroller} aria-live="polite">{partner}</div>
      </>
    );
    kind = 'transcript';
  } else {
    const spokenText = activity.kind === 'speaking' || activity.kind === 'spoken' ? activity.text : '';
    const hasMessage = state.composition.words.length > 0 || state.composition.pending.length > 0;
    body = (
      <>
        <Status state={conversation} />
        {notices}
        {partner && <p className="partner">{partner}</p>}
        {partner && (spokenText || hasMessage || said) && <div className="rule" aria-hidden="true" />}
        <div className="message" ref={scroller} aria-live="polite">
          {spokenText
            ? wordsOf(spokenText).map((w, i) => (
                <Fragment key={i}>
                  {i > 0 && ' '}
                  <span className={`m-word${activity.kind === 'speaking' && activity.index === i ? ' is-spoken' : ''}${activity.kind === 'spoken' ? ' m-said' : ''}`}>{display(w, i)}</span>
                </Fragment>
              ))
            : hasMessage
              ? <Message state={state} markLast={view.kind === 'more'} />
              : said && <span className="m-said">{sentence(said)}</span>}
        </div>
      </>
    );
  }
  // A change of scene cross-fades in place: a still copy of the outgoing content fades out over
  // 150 ms while the new content fades in from 100 ms.
  const inner = useRef<HTMLDivElement>(null);
  const lastKind = useRef(kind);
  const lastHtml = useRef('');
  const [outgoing, setOutgoing] = useState<{ html: string; id: number } | null>(null);
  useLayoutEffect(() => {
    if (lastKind.current !== kind) setOutgoing({ html: lastHtml.current, id: Date.now() });
    lastKind.current = kind;
    lastHtml.current = inner.current?.innerHTML ?? '';
  });
  return (
    <section className={`rest rest--${kind}`} aria-label="Conversation">
      {outgoing && (
        <div key={outgoing.id} className="rest-out" aria-hidden="true" onAnimationEnd={() => setOutgoing(null)} dangerouslySetInnerHTML={{ __html: outgoing.html }} />
      )}
      <div className="rest-inner" key={kind} ref={inner}>{body}</div>
    </section>
  );
}
