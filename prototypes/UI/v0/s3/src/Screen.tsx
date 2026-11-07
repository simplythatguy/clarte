/**
 * One layer of the stage: the rest zone and the tiles for one screen. A stage change renders the
 * outgoing layer frozen beside the incoming one so the change is a single cross-fade in place:
 * both layers 300 ms on the same curve from the same frame (DESIGN R8).
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { pendingGlyphs, type Composition } from '../../shared/composer.ts';
import { groupOf, type GroupId } from '../../shared/decoder.ts';
import type { QuadrantId } from '../../shared/quadrants.ts';
import {
  MENU_PAGES, displayWords, quadrantsOfTile, spelledWord, tilesFor,
  type CalibrationStep, type Model, type Stage, type Tile,
} from './model.ts';
import { Calibration } from './Calibration.tsx';
import { INTENT_DELAY } from './dwell.ts';
import { Icon } from './icons.tsx';

export type Problem = 'voice' | 'microphone';

export type ScreenView = {
  stage: Stage;
  model: Model;
  context: readonly string[];
  voiceWord: number;
  frozenAt?: number;
  problem: Problem | null;
};

type ScreenProps = ScreenView & {
  live: boolean;
  instant: boolean;
  locked: boolean;
  guard: readonly QuadrantId[];
  /** The tile under the look, as it was when the look arrived; shown instead of the live one. */
  armed: Tile | null;
  onPress: (id: string) => void;
  onCalibrationStep: (step: CalibrationStep) => void;
  layerRef?: Ref<HTMLElement>;
};

export function Screen(props: ScreenProps) {
  const { stage, model, context, live, instant, locked, guard, armed, onPress, layerRef } = props;
  const tiles = tilesFor({ stage, composition: model.composition, context, settings: model.settings, spelled: model.spelled })
    // A setting's new value is the feedback for selecting it, so it updates under the look.
    .map((tile) => (armed && armed.id === tile.id && armed.at === tile.at && tile.value === undefined ? armed : tile));
  return (
    <section
      ref={layerRef}
      className={locked ? 'layer is-locked' : 'layer'}
      data-stage={stage.kind}
      data-live={live || undefined}
      data-leaving={live ? undefined : ''}
      data-instant={instant || undefined}
      inert={!live || locked || undefined}
      aria-hidden={live ? undefined : true}
    >
      <Rest {...props} />
      {/* In quadrant order, keyed by quadrant: a tile that changes in place keeps its node and its
          position among its siblings, so its face and label transitions run (Spell). */}
      {[...tiles].sort((x, y) => x.at.localeCompare(y.at)).map((tile) => (
        <TileButton
          key={tile.at}
          tile={tile}
          guarded={quadrantsOfTile(tile).some((q) => guard.includes(q))}
          onPress={onPress}
        />
      ))}
    </section>
  );
}

/* ——— Tiles ——— */

const GROUP_COUNT: Record<GroupId, number> = { G1: 1, G2: 2, G3: 3, G4: 4 };

/** The accent arc: two half-ring blades in clipped halves, rotated by `arc.ts` on the compositor. */
export function Arc() {
  return (
    <span className="arc" aria-hidden="true">
      <span className="arc-half arc-half--right"><span className="arc-blade" /></span>
      <span className="arc-half arc-half--left"><span className="arc-blade" /></span>
    </span>
  );
}

/** The dwell instrument: a 1.5 px track that is always there, a 3 px accent arc, and the bloom. */
function Ring() {
  return (
    <span className="ring-wrap">
      <svg className="ring" viewBox="0 0 52 52" aria-hidden="true" focusable="false">
        <circle className="ring__track" cx="26" cy="26" r="24.5" />
      </svg>
      <Arc />
      <span className="ring-bloom" aria-hidden="true" />
    </span>
  );
}

function TileButton({ tile, guarded, onPress }: { tile: Tile; guarded: boolean; onPress: (id: string) => void }) {
  const n = Number(tile.at.slice(1));
  const row = n > 4 ? 2 : 1;
  const col = ((n - 1) % 4) + 1;
  const single = tile.group && tile.label.length === 1;
  return (
    <button
      type="button"
      // The class flips with `inert` so the shared tracker (which watches class, not inert) re-reads
      // the layout at once instead of on its 500 ms timer.
      className={guarded ? 'tile is-guarded' : 'tile'}
      data-action={tile.id}
      data-kind={tile.kind}
      data-group={tile.group}
      data-span={tile.span}
      data-at={tile.at}
      data-dwell="idle"
      data-single={single || undefined}
      aria-disabled={tile.disabled || undefined}
      aria-label={tile.name}
      inert={guarded || undefined}
      style={{ gridRow: row, gridColumn: `${col} / span ${tile.span}` }}
      onClick={() => { if (!tile.disabled) onPress(tile.id); }}
    >
      <span className="tile__mark" aria-hidden="true">
        {tile.group && <span className="motif-dot" />}
        <span className="mark">
          <Ring />
          {tile.icon && <Icon name={tile.icon} />}
        </span>
      </span>
      <span className="tile__text">
        {tile.value !== undefined && <span className="tile__name" style={{ ['--chars' as string]: tile.label.length }}>{`${tile.label} `}</span>}
        {tile.group && !single
          ? <LabelSwap id={`${tile.group} ${tile.label}`} render={() => (
              <>
                <LetterRows letters={tile.label} />
                <span className="tile__count" aria-hidden="true">
                  {Array.from({ length: GROUP_COUNT[tile.group!] }, (_, i) => <i key={i} />)}
                </span>
              </>
            )} />
          : <LabelSwap id={tile.value ?? tile.label} render={(text) => <span className="tile__label" style={{ ['--chars' as string]: longestWord(text) }}>{text}</span>} />}
      </span>
    </button>
  );
}

/**
 * A group's letters as two halves: one tracked row at normal sizes, two rows of at most four at
 * large text (BRIEF "Letter groups show their letters"). The text reads as the letters in order.
 */
function LetterRows({ letters }: { letters: string }) {
  const all = letters.split(' ');
  const cut = Math.ceil(all.length / 2);
  return (
    <span className="tile__label tile__letters">
      <span className="letter-row">{all.slice(0, cut).join(' ')}</span>{' '}
      <span className="letter-row">{all.slice(cut).join(' ')}</span>
    </span>
  );
}

/** The longest word, in characters: a label never breaks inside a word, so it sizes to fit it. */
const longestWord = (text: string) => Math.max(1, ...text.split(/\s+/).map((w) => w.length));

/**
 * A label that cross-fades in place when it changes (150 ms, opacity only, one curve for both):
 * the old content fades out on top of the new one fading in, in the same grid cell, so the tile
 * never shows a blank frame. `id` identifies the content (a label's text, or a group's letters);
 * `render` draws it.
 */
function LabelSwap({ id, render }: { id: string; render: (id: string) => ReactNode }) {
  const [previous, setPrevious] = useState<{ id: string; key: number } | null>(null);
  const last = useRef(id);
  useLayoutEffect(() => {
    if (last.current === id) return;
    // Keyboard and click actions get no motion (MOTION "Choreography"): swap at once.
    if (document.documentElement.dataset.input !== 'key') setPrevious({ id: last.current, key: Date.now() });
    last.current = id;
  }, [id]);
  return (
    <span className="label-stack">
      {previous && (
        <span
          key={previous.key}
          className="swap swap--leaving"
          aria-hidden="true"
          ref={(el) => {
            if (!el || el.dataset.fading) return;
            el.dataset.fading = '1';
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' })
              .finished.then(() => setPrevious((p) => (p?.key === previous.key ? null : p)), () => {});
          }}
        >
          {render(previous.id)}
        </span>
      )}
      <span key={id} className="swap">{render(id)}</span>
    </span>
  );
}

/* ——— Rest zones: text only, never actionable ——— */

const PROBLEM_TEXT: Record<Problem, string> = {
  voice: 'Speech did not play. Check the sound, then try again.',
  microphone: 'The microphone is not listening. Allow it in the browser, or choose Script under Display and sound.',
};

function ProblemLine({ problem }: { problem: Problem | null }) {
  return problem ? <p className="problem" role="alert">{PROBLEM_TEXT[problem]}</p> : null;
}

function Rest({ stage, model, context, voiceWord, frozenAt, problem, live, onCalibrationStep }: ScreenProps) {
  const footer = <ProblemLine problem={problem} />;
  switch (stage.kind) {
    case 'calibrate':
      return <Calibration step={stage.step} onStep={onCalibrationStep} frozenAt={live ? frozenAt : (frozenAt ?? 0)} fillMs={model.settings.controlMs - INTENT_DELAY.control} />;
    case 'listen':
      return (
        <section className="rest" aria-label="Partner" aria-live="polite">
          <TextWindow dep={`${model.turn}-${model.settings.textScale}`}>
            <p className="transcript">{model.turn}</p>
          </TextWindow>
          {footer}
        </section>
      );
    case 'compose':
      return <Composer model={model} context={context} footer={footer} />;
    case 'speak':
    case 'speaking':
      return (
        <section className="rest" aria-label="Message">
          <PartnerLine turn={model.turn} />
          <TextWindow focus=".word[data-said='now']" dep={`${voiceWord}-${model.settings.textScale}`}>
            <Words words={model.composition.words} colours={model.settings.wordColours} highlight={stage.kind === 'speaking' ? voiceWord : undefined} />
          </TextWindow>
          {footer}
        </section>
      );
    case 'spoken':
      return (
        <section className="rest" aria-label="Said">
          <PartnerLine turn={model.turn} />
          <TextWindow dep={`${model.said}-${model.settings.textScale}`}>
            <p className="sentence">{model.said}</p>
          </TextWindow>
          {footer}
        </section>
      );
    case 'spell':
      return (
        <section className="rest" aria-label="Spelled">
          <p className="sentence spelled" aria-live="polite">
            {spelledWord(model.spelled)}
            <span className="caret" aria-hidden="true" />
          </p>
          {footer}
        </section>
      );
    case 'menu':
      return (
        <section className="rest">
          <h1 className="menu-title">{MENU_PAGES[stage.page].title}</h1>
          {footer}
        </section>
      );
  }
}

/**
 * Fit a reading window: a whole number of lines, the line holding `focus` (or the newest line) in
 * view. If the text does not fit with the partner's line above it, the partner line and hairline
 * give their room to the message (the same rule on Compose, Speak and Spoken).
 */
function fitWindow(el: HTMLElement, text: HTMLElement, focus?: string) {
  el.style.maxHeight = '';
  el.style.clipPath = '';
  const section = el.closest<HTMLElement>('.rest');
  section?.classList.remove('is-tight');
  if (section) delete section.dataset.clipped;
  const line = parseFloat(getComputedStyle(text).lineHeight);
  const box = getComputedStyle(el);
  const pad = parseFloat(box.paddingTop) + parseFloat(box.paddingBottom);
  const overflows = () => text.scrollHeight + pad > el.clientHeight + 1;
  if (overflows() && section?.querySelector('.partner')) section.classList.add('is-tight');
  if (!overflows() || !(line > 0)) { el.scrollTop = 0; return; }
  const lines = Math.max(1, Math.floor((el.clientHeight - pad) / line));
  el.style.maxHeight = `${lines * line + pad}px`;
  const target = focus ? el.querySelector<HTMLElement>(focus) : null;
  if (target) {
    const top = target.offsetTop - text.offsetTop;
    el.scrollTop = Math.max(0, Math.floor(top / line) * line - (lines - 1) * line);
    if (top < el.scrollTop) el.scrollTop = Math.floor(top / line) * line;
  } else el.scrollTop = el.scrollHeight;
  // Earlier lines are out of view: a tertiary ellipsis hangs in the margin of the first line, so
  // the person can tell the message starts above (the partner line marks its own cut the same way).
  if (section && el.scrollTop > 0) {
    // The window's top padding (room for the first visible line's accents) would show the hidden
    // line's descenders. Clip at the lowest point that line's ink reaches, unless the visible
    // line's own ink starts higher (then at the visible ink's top).
    const cs = getComputedStyle(text);
    const m = inkMetrics(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
    const baseline = (line - (m.fontAscent + m.fontDescent)) / 2 + m.fontAscent;
    const hiddenInkBottom = baseline + m.inkDescent - line;
    const visibleInkTop = baseline - m.inkAscent;
    const cut = Math.max(0, Math.min(hiddenInkBottom + 1, visibleInkTop));
    el.style.clipPath = `inset(${parseFloat(box.paddingTop) + cut}px 0 0 0)`;
    section.dataset.clipped = '';
    section.style.setProperty('--more-top', `${el.offsetTop + parseFloat(box.paddingTop)}px`);
    section.style.setProperty('--more-line', `${line}px`);
  }
}

/** Font and ink extents of a font, measured once per font string. */
const metricsCache = new Map<string, { fontAscent: number; fontDescent: number; inkAscent: number; inkDescent: number }>();
function inkMetrics(font: string) {
  let m = metricsCache.get(font);
  if (!m) {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = font;
    const up = ctx.measureText('Hbdfhkl'), down = ctx.measureText('gjpqy');
    m = { fontAscent: up.fontBoundingBoxAscent, fontDescent: up.fontBoundingBoxDescent, inkAscent: up.actualBoundingBoxAscent, inkDescent: down.actualBoundingBoxDescent };
    metricsCache.set(font, m);
  }
  return m;
}

/** The viewport size as a dependency, so reading windows refit when the window is resized. */
function useViewport(): string {
  const read = () => `${window.innerWidth}x${window.innerHeight}`;
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** A rest-zone text window for Speak and Spoken, fitted by `fitWindow`. */
function TextWindow({ children, focus, dep }: { children: ReactNode; focus?: string; dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewport = useViewport();
  useLayoutEffect(() => {
    const el = ref.current;
    const text = el?.firstElementChild as HTMLElement | null;
    if (el && text) fitWindow(el, text, focus);
  }, [dep, focus, viewport]);
  return <div className="text-window" ref={ref}>{children}</div>;
}

/** The partner's last turn above a hairline. The same on Compose, Speak and Spoken, so the
    message sits at one height across the three and a stage change never shows it twice. */
function PartnerLine({ turn }: { turn: string }) {
  const words = turn.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const tail = words.length > 18 ? `…${words.slice(-18).join(' ')}` : words.join(' ');
  return (
    <>
      <p className="partner">{tail}</p>
      <hr className="rule" />
    </>
  );
}

/** The partner's words above a hairline, the message below: the one major thing while composing. */
function Composer({ model, context, footer }: { model: Model; context: readonly string[]; footer: ReactNode }) {
  const c = model.composition;
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const viewport = useViewport();
  const glyphRects = useRef<{ glyphs: { rect: DOMRect; letter: string; group: string }[]; pending: number; words: number }>({ glyphs: [], pending: 0, words: 0 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const msg = messageRef.current;
    if (!el || !msg) return;
    // Delete: removed glyphs fade out in place over 120 ms (one glyph, or a whole reopened word on
    // the second Delete); nothing slides (MOTION).
    const before = glyphRects.current;
    if (c.pending.length < before.pending && c.words.length === before.words && document.documentElement.dataset.input !== 'key') {
      const box = msg.getBoundingClientRect();
      for (let i = c.pending.length; i < before.pending; i++) {
        const g = before.glyphs[i];
        if (!g) continue;
        const removed = msg.ownerDocument.createElement('span');
        removed.className = g.letter ? 'glyph-leaving' : 'glyph-leaving glyph--dot';
        removed.textContent = g.letter;
        if (g.group) removed.dataset.group = g.group;
        Object.assign(removed.style, { left: `${g.rect.left - box.left}px`, top: `${g.rect.top - box.top}px`, width: `${g.rect.width}px`, height: `${g.rect.height}px` });
        msg.append(removed);
        removed.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' })
          .finished.then(() => removed.remove(), () => removed.remove());
      }
    }
    const typed = Array.from(msg.querySelectorAll<HTMLElement>('.wip > .glyph-cell > [data-typed]'));
    glyphRects.current = {
      glyphs: typed.map((g) => ({ rect: g.getBoundingClientRect(), letter: g.textContent ?? '', group: g.dataset.group ?? '' })),
      pending: c.pending.length,
      words: c.words.length,
    };

    // Newest line in view; at large text the window is a whole number of lines.
    fitWindow(el, msg);
  }, [c, model.turn, model.settings.textScale, context, viewport]);

  const glyphs = c.pending.length ? pendingGlyphs(c, context) : [];
  const first = c.words.length === 0;
  return (
    <section className="rest rest--compose" aria-label="Message">
      <PartnerLine turn={model.turn} />
      <div className="text-window" ref={scrollRef}>
        <p className="message" ref={messageRef} aria-live="polite">
          {displayWords(c.words).map((text, i) => {
            const fresh = model.fresh?.index === i ? model.fresh : null;
            return (
              <span key={fresh ? `w${i}-${fresh.key}` : `w${i}`} className="word" data-fresh={fresh ? '' : undefined}>
                <WordText text={text} colours={model.settings.wordColours && c.words[i].source === 'decoded'} settle={Boolean(fresh)} typed={fresh?.groups.length} />{' '}
              </span>
            );
          })}
          {glyphs.length > 0 && (
            <span className="wip">
              {glyphs.map((g, i) => {
                const letter = g.letter ? (first && i === 0 ? g.letter.toUpperCase() : g.letter) : null;
                return <GlyphCell key={i} letter={letter} typed={g.typed} group={g.group} />;
              })}
            </span>
          )}
        </p>
      </div>
      {footer}
    </section>
  );
}

/**
 * One position of the word in progress. Keyed by position: a ghost confirmed by the next group
 * steps from tertiary to its group ink in place (colour only); when the decoder changes the letter
 * at a position, the old letter fades out on top while the new one fades in, 150 ms, so a glyph
 * never blinks (MOTION "Choreography"). Only a position that did not exist before fades in alone.
 */
function GlyphCell({ letter, typed, group }: { letter: string | null; typed: boolean; group: GroupId }) {
  const id = letter ?? '•';
  const [previous, setPrevious] = useState<{ id: string; letter: string | null; typed: boolean; group: GroupId; key: number } | null>(null);
  const last = useRef({ id, letter, typed, group });
  useLayoutEffect(() => {
    const was = last.current;
    last.current = { id, letter, typed, group };
    if (was.id === id) return;
    if (document.documentElement.dataset.input !== 'key') setPrevious({ ...was, key: Date.now() });
  }, [id, letter, typed, group]);
  const glyph = (g: { letter: string | null; typed: boolean; group: GroupId }, extra = '') =>
    !g.typed ? <span className={`glyph glyph--ghost${extra}`}>{g.letter}</span>
    : g.letter ? <span className={`glyph${extra}`} data-typed="" data-group={g.group}>{g.letter}</span>
    : <span className={`glyph glyph--dot${extra}`} data-typed="" data-group={g.group} />;
  return (
    <span className="glyph-cell">
      {previous && (
        <span
          key={previous.key}
          className="glyph-out"
          aria-hidden="true"
          ref={(el) => {
            if (!el || el.dataset.fading) return;
            el.dataset.fading = '1';
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' })
              .finished.then(() => setPrevious((p) => (p?.key === previous.key ? null : p)), () => {});
          }}
        >
          {glyph(previous)}
        </span>
      )}
      <Fragment key={id}>{glyph({ letter, typed, group })}</Fragment>
    </span>
  );
}

/** A word as letters coloured by group: settling from group ink to ink, or kept (Word colours). */
function WordText({ text, colours, settle, typed = Infinity }: { text: string; colours: boolean; settle?: boolean; typed?: number }) {
  if (!colours && !settle) return <>{text}</>;
  return (
    <>
      {Array.from(text).map((ch, i) => {
        const g = groupOf(ch);
        // Settling: letters the person typed start in their group ink; letters they never typed
        // (accepted from the prediction) start tertiary, as they were shown.
        const cls = colours ? 'letter letter--kept' : i < typed ? 'letter letter--settle' : 'letter letter--settle letter--predicted';
        return <span key={i} className={cls} data-group={g ?? undefined}>{ch}</span>;
      })}
    </>
  );
}

/**
 * The message as the voice says it: one span per spoken word (a phrase such as "Yes, please." is
 * two), numbered the way `say()` numbers its boundaries, so the highlight never drifts.
 */
function Words({ words, colours, highlight }: { words: Composition['words']; colours: boolean; highlight?: number }) {
  const texts = displayWords(words);
  let index = 0;
  return (
    <p className="sentence" data-speaking={highlight !== undefined || undefined}>
      {texts.flatMap((text, w) => text.split(/\s+/).filter(Boolean).map((part) => {
        const i = index++;
        return (
          <span key={i} className="word" data-said={highlight !== undefined ? (i < highlight ? 'past' : i === highlight ? 'now' : 'next') : undefined}>
            <WordText text={part} colours={colours && words[w].source === 'decoded'} />{' '}
          </span>
        );
      }))}
    </p>
  );
}

