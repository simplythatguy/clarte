/**
 * Style 6 · Orb (owner concept, 2026-11-07), built on style 5 · Dialogue's grid and engine, with
 * the always-on word and always-on listening (owner, 2026-11-07).
 *
 * Q1 is the predicted word (the next word with nothing typed, the completion while typing; Stop
 * while the device speaks), Q4 is whatever is most needed now (policy.ts: the second word of a
 * branch, Delete, Done, Say again or Menu), Q2–Q3 is the rest zone with the orb and the thread,
 * Q5–Q8 are the letter groups, live in every state except speaking. Done opens a page in the menu
 * geometry with Speak where Done was, and from it Other words lists every exact-length word for
 * the last word's code, four per page, to replace it. Every activation (dwell, digit key, click, Enter on a focused
 * tile) arrives as one engine `select` event and is routed by action id. The word accepted is always
 * exactly the word shown when the dwell completed: a label never changes under a resting gaze
 * (useSettled), and the activation runs the function the settled label shows (round 4: it used to
 * compare the label with the live prediction and drop the activation when a late engine answer had
 * arrived underneath, a dead dwell).
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { attachKeyboard, startTicking } from '../../shared/gaze.ts';
import { trackActionables } from '../../shared/overlay.ts';
import { GROUP_IDS, groupLetters, type GroupId } from '../../shared/decoder.ts';
import { stopSpeaking } from '../../shared/speech.ts';
import { quadrantAt, viewportOf, type QuadrantId } from '../../shared/quadrants.ts';
import { attachPointerStream, engine, gazeOutside, guardQuadrant, isGuarded, markIgnored, noteKeyActivation, suppressMotionBriefly, resolveQuadrant, setDwellClasses, useLooked, validateNow } from './gaze.ts';
import {
  CHOOSER_PAGE,
  INITIAL_STATE,
  SETUP_STEPS,
  chooserRequestOf,
  historyOf,
  owedTurn,
  phaseOf,
  prefetchOf,
  reducer,
  requestOf,
  slotsFor,
  type CalibrationStep,
  type Screen,
  type Settings,
  type State,
} from './model.ts';
import { primaryKey, secondaryKey, type PrimaryFn, type SecondaryFn } from './policy.ts';
import type { Conflict } from './conflict.ts';
import { Tile, type SlotName, type Slots } from './Tile.tsx';
import { Thread, type StateName } from './Thread.tsx';
import { TITLES, doneSlots, menuSlots, nextValue, otherSlots, type SettingKey } from './Menu.tsx';
import { Calibration } from './Calibration.tsx';
import { PHASES, seedFor, type PhaseName } from './debug.ts';
import { hearPartner, nextScript, playScript, resetScript, speakWords, wordsOf, type OnHeard, type PartnerSession, type Speech } from './voice.ts';
import { play, setSoundEnabled, unlockOnGesture } from './earcons.ts';
import { displayWord, longest, sentence, sentenceOf, type Shown } from './text.ts';
import { fitCards } from './fit.ts';
import { Swap } from './Swap.tsx';
import { Orb, type OrbMood } from './Orb.tsx';
import { Branch } from './Branch.tsx';
import { SetupReport, openVoiceApp, setupSlots, useVoiceReport } from './Setup.tsx';
import { commit, discover, engineDown, engineOrigin, fetchPrediction, keyOf, peek, seed, setEngine, subscribe, type PredictRequest, type Prediction } from './prediction.ts';
import { Again, ArrowRight, Check, Ellipsis, Erase, MenuLines, StopSquare } from './icons.tsx';

const SAY_AGAIN_MS = 6000;
const STORE = 'clarte.style6.v2';
/** The partner's live words reach the engine at most this often (a word boundary every 300 ms or so). */
const HEARING_EVERY_MS = 350;
/** While the partner speaks, a new engine word replaces the shown one only when it is this many times more likely. */
const BETTER = 1.5;
/** While the partner speaks, Q1 relabels at most this often: their sentence is unfinished, so the reply word is a guess. */
const HEARING_RELABEL_MS = 4000;
/** A key or click on a speaking action in the quadrant where a different action was just activated is ignored within this time. */
const USER_REARM_MS = 400;

function loadStored(): State {
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  const skip = new URLSearchParams(location.search).get('onboarding') === 'off';
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return skip ? { ...INITIAL_STATE, screen: { kind: 'talk' } } : INITIAL_STATE;
    const saved = JSON.parse(raw) as { settings?: Partial<Settings>; setupDone?: boolean };
    return {
      ...INITIAL_STATE,
      settings: { ...INITIAL_STATE.settings, ...saved.settings },
      screen: saved.setupDone || skip ? { kind: 'talk' } : INITIAL_STATE.screen,
    };
  } catch {
    return INITIAL_STATE;
  }
}

function store(patch: { settings?: Settings; setupDone?: boolean }): void {
  try {
    const current = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    localStorage.setItem(STORE, JSON.stringify({ ...current, ...patch }));
  } catch { /* private mode: settings last for the session */ }
}

/**
 * Keep a slot's label while gaze rests on it (DESIGN: the slot waits for gaze to leave before
 * relabelling). `force` is bumped right after the slot's own activation, so the change that
 * selection causes shows at once; every later change waits until gaze leaves the slot.
 */
function useSettled<T>(slot: string, key: string, value: T, looked: string | null, force: number): { key: string; value: T } {
  const shown = useRef({ key, value });
  const forced = useRef(force);
  const bySelection = forced.current !== force;
  forced.current = force;
  if (shown.current.key === key || looked !== slot || bySelection) shown.current = { key, value };
  return shown.current;
}

/**
 * A value that follows `value` at most once every `ms`, except that an empty value passes at once
 * (the partner stopped: the turn is already in the history, and a stale copy must not be sent twice).
 */
function useThrottled(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    if (!value) { last.current = 0; setShown(value); return; }
    const wait = Math.max(0, last.current + ms - performance.now());
    const t = setTimeout(() => { last.current = performance.now(); setShown(value); }, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return value ? shown : value;
}

/**
 * The prediction for the conversation as it stands. `peek` answers at once (the cache, else the
 * local decoder), so the screen always has a word; the engine's answer replaces it when it arrives
 * and is re-read here. The next word is prefetched behind the shown word, so accepting it never waits.
 *
 * While the partner speaks (round 4): their words reach the engine at most every 350 ms; the
 * engine's standing word is kept until the engine answers (never swapped for a local word while the
 * engine is healthy), and a new engine word replaces the shown one only when it is clearly better
 * (BETTER × the shown word's probability in the new answer) and at most every 4 s from the turn's start, so a card relabels once or twice per
 * partner turn rather than on every word heard. A change of message or typed groups always shows at once.
 */
function usePrediction(state: State, shown: string | null): Prediction {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((n) => n + 1)), []);
  const hearing = useThrottled(state.hearing, HEARING_EVERY_MS);
  const asked = hearing === state.hearing ? state : { ...state, hearing };
  const req = requestOf(asked);
  const fresh = peek(req);
  // The slot of the conversation this answer is for: the same message and groups, whatever was heard.
  const context = JSON.stringify([req.message, req.groups, req.offset]);
  const last = useRef<{ context: string; value: Prediction } | null>(null);
  const relabelledAt = useRef(0);
  const wasHearing = useRef(false);
  // A turn's first words say little about the reply, so the 4 s window starts when the partner does.
  if (state.hearing && !wasHearing.current) relabelledAt.current = performance.now();
  wasHearing.current = Boolean(state.hearing);
  let value = fresh;
  const standing = last.current?.context === context ? last.current.value : null;
  if (standing && standing.source === 'engine') {
    if (fresh.source === 'local' && !engineDown()) value = standing;
    else if (fresh.source === 'engine' && fresh !== standing && state.hearing) {
      const top = fresh.words[0];
      const was = standing.words[0];
      const pWas = was ? fresh.words.find((w) => w.word === was.word)?.p ?? 0 : 0;
      const changes = Boolean(top && was && top.word !== was.word);
      const now = performance.now();
      if (changes && (top.p < BETTER * pWas || now - relabelledAt.current < HEARING_RELABEL_MS)) value = standing;
      else if (changes) relabelledAt.current = now;
    }
  }
  last.current = { context, value };
  useEffect(() => {
    if (state.screen.kind !== 'talk') return;
    void fetchPrediction(req);
    const next = prefetchOf(asked, shown);
    if (next) void fetchPrediction(next);
  });
  return value;
}

/**
 * The Other words page for the chooser screen: this page's exact-length words, fetched when the
 * screen opens, with the next page prefetched so More never waits. Null on every other screen.
 */
function useChooser(state: State): { req: PredictRequest; prediction: Prediction } | null {
  const req = state.screen.kind === 'other' ? chooserRequestOf(state, state.screen.page) : null;
  const key = req ? JSON.stringify(req) : '';
  const prediction = req ? peek(req) : null;
  const pages = prediction ? Math.ceil(prediction.total / CHOOSER_PAGE) : 0;
  useEffect(() => {
    if (!req) return;
    void fetchPrediction(req);
    if (req.offset / CHOOSER_PAGE + 1 < pages) void fetchPrediction({ ...req, offset: req.offset + CHOOSER_PAGE });
  }, [key, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  return req && prediction ? { req, prediction } : null;
}

function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  // Suppress every transition for the swap so colours do not smear (better-ui animations.md).
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.append(style);
  root.dataset.theme = theme;
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

function Cell({ q, children }: { q: string; children?: ReactNode }) {
  return <div className={`cell cell-${q}`}>{children}</div>;
}

type CardFace = { icon: ReactNode; label?: ReactNode; hint?: string; name?: string };

/** A word on a card: lower case from the engine, shown as it will read in the sentence. */
function WordLabel({ word, display, index }: { word: string; display?: string; index: number }) {
  const text = displayWord(word, index, display);
  return <span className="card-label is-word" style={{ ['--len' as string]: text.length }}>{text}</span>;
}

/** What the primary card (Q1, ink) shows for each function. */
function primaryFace(fn: PrimaryFn, index: number): CardFace {
  switch (fn.kind) {
    case 'word': return { icon: <Check />, label: <WordLabel word={fn.word} display={fn.display} index={index} /> };
    case 'no-match': return { icon: <Check />, label: 'No word' };
    case 'options': return { icon: <Ellipsis />, label: 'Options' };
    case 'stop-speaking': return { icon: <StopSquare />, label: 'Stop' };
  }
}

/** What the secondary card (Q4, white) shows for each function. */
function secondaryFace(fn: SecondaryFn, index: number): CardFace {
  switch (fn.kind) {
    case 'second': return { icon: <Check />, label: <WordLabel word={fn.word} display={fn.display} index={index} /> };
    case 'delete': return fn.word ? { icon: <Erase />, label: 'Delete word' } : { icon: <Erase />, label: 'Delete' };
    case 'done': return { icon: <ArrowRight />, label: 'Done' };
    case 'say-again': return { icon: <Again />, label: 'Say again' };
    case 'menu': return { icon: <MenuLines />, label: 'Menu' };
    // While speaking nothing is needed here; the card shows what it returns to, dimmed. Its name
    // is its visible text; `aria-disabled` says it is unavailable.
    case 'unavailable': return { icon: <MenuLines />, label: 'Menu' };
  }
}

function FaceBody({ face }: { face: CardFace }) {
  return (
    <>
      {typeof face.label === 'string' ? <span className="card-label" style={longest(face.label)}>{face.label}</span> : face.label}
      {face.hint && <span className="card-hint">{face.hint}</span>}
    </>
  );
}

/** A letter row as two halves, so large text can wrap it into two rows (G H I J / K L M N). */
function halves(letters: string): string[] {
  const cut = Math.ceil(letters.length / 2);
  return [letters.slice(0, cut), letters.slice(cut)];
}

const GROUP_QUADRANT: Record<GroupId, SlotName> = { G1: 'q5', G2: 'q6', G3: 'q7', G4: 'q8' };

/** Actions that make sound: a key or click on one of these needs the quadrant to have been left, or a pause. */
const SPEAKING_ACTIONS = new Set(['speak', 'secondary']);

/**
 * Calibration and the app are separate stages. A change between them cross-fades two layers
 * that each paint the canvas and blend with `plus-lighter`, at the same duration and easing, so
 * the sum is exactly linear and luminance never dips. The outgoing layer is inert.
 */
function Stage({ id, surface = 'talk', children }: { id: string; surface?: 'talk' | 'report'; children: ReactNode }) {
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);
  useLayoutEffect(() => {
    if (last.current.id !== id) setLeaving(last.current);
    last.current = { id, node: children };
  });
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), 320); // the outgoing layer's full 300 ms fade
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div className="stage">
      {leaving && <div key={`leaving-${leaving.id}`} className="layer layer-leaving" inert aria-hidden="true">{leaving.node}</div>}
      <main key={id} className="layer" data-surface={surface}>{children}</main>
    </div>
  );
}

type SettledSlot = 'primary' | 'secondary' | 'other';

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadStored);
  const stateRef = useRef(state);
  stateRef.current = state;
  const looked = useLooked();
  const token = useRef(1);
  const speech = useRef<Speech | null>(null);
  /** The scripted partner line playing, if any (Demo page, debug hook). */
  const script = useRef<PartnerSession | null>(null);
  /** The action a key or click just activated, so its select event is not mistaken for a dwell. */
  const userActivation = useRef<{ action: string; quadrant: QuadrantId | null; at: number } | null>(null);
  /** The last activation by key or click, per quadrant: a different, speaking action there must wait (round 4). */
  const lastUser = useRef<{ action: string; quadrant: QuadrantId | null; at: number } | null>(null);

  const { settings, screen, live } = state;
  // Bumped when a slot's own activation changed its label, so that label catches up at once.
  const [syncs, setSyncs] = useState<Record<SettledSlot, number>>({ primary: 0, secondary: 0, other: 0 });
  const resync = useCallback((slot: SettledSlot) => setSyncs((s) => ({ ...s, [slot]: s[slot] + 1 })), []);
  // The word shown is the one whose next word is prefetched; it is read from the settled label.
  const shownWord = useRef<string | null>(null);
  const prediction = usePrediction(state, shownWord.current);
  const slots = slotsFor(state, prediction);
  const voiceReport = useVoiceReport(screen.kind === 'setup' && screen.step === 'voice', screen.kind === 'setup' && Boolean(screen.sample));
  // A held label keeps the word's place in the sentence too, so its capital never flips under gaze.
  const wordIndex = state.composition.words.length;
  const primary = useSettled('primary', primaryKey(slots.primary), { fn: slots.primary, index: wordIndex }, looked, syncs.primary);
  const secondary = useSettled('secondary', secondaryKey(slots.secondary), { fn: slots.secondary, index: wordIndex }, looked, syncs.secondary);
  shownWord.current = primary.value.fn.kind === 'word' ? primary.value.fn.word : null;
  // The chooser's page holds while gaze rests on any of its four word cards (one settled unit).
  const chooser = useChooser(state);
  const chooserPage: { words: Shown[]; total: number; offset: number } = chooser
    ? { words: chooser.prediction.words.map((w) => (w.display ? { text: w.word, display: w.display } : { text: w.word })), total: chooser.prediction.total, offset: chooser.prediction.offset }
    : { words: [], total: 0, offset: 0 };
  const otherShown = useSettled('other', JSON.stringify(chooserPage), chooserPage, looked && /^other-\d$/.test(looked) ? 'other' : looked, syncs.other);
  // The branch is drawn from the labels as they stand, so its lines never point at a card that still reads Delete.
  const shownConflict: Conflict | null = primary.value.fn.kind === 'word' && secondary.value.fn.kind === 'second' && slots.conflict
    ? { first: primary.value.fn.word, second: secondary.value.fn.word }
    : null;

  // Settings → engine, document and audio (before paint, so a new text size never shows unfitted).
  useLayoutEffect(() => {
    engine.configure({ mode: settings.mode, noiseSigma: settings.noise ? 0.06 : 0 });
    setDwellClasses(settings.letterDwell, settings.controlDwell, screen.kind === 'talk', settings.repeat);
    document.documentElement.style.setProperty('--scale', String(settings.textScale));
    document.documentElement.toggleAttribute('data-large', settings.textScale > 1);
    applyTheme(settings.theme);
    setSoundEnabled(settings.sound);
    store({ settings });
  }, [settings, screen.kind]);

  // Card text fits its card after every render (cheap when nothing changed), on resize and once
  // the webfont arrives.
  useLayoutEffect(() => fitCards());
  useEffect(() => {
    const refit = () => fitCards();
    window.addEventListener('resize', refit);
    document.fonts.addEventListener('loadingdone', refit);
    void document.fonts.ready.then(refit);
    return () => { window.removeEventListener('resize', refit); document.fonts.removeEventListener('loadingdone', refit); };
  }, []);

  // The engine is looked for from the start, and again whenever it stops answering.
  useEffect(() => discover(), []);

  // Gaze sources and the per-frame clock.
  useEffect(() => {
    const detach = [
      attachPointerStream(engine),
      startTicking(engine),
      unlockOnGesture(),
      // In development the overlay tracks actionables itself (main.tsx); here for production builds.
      import.meta.env.DEV ? () => {} : trackActionables(engine),
    ];
    const byUser = (action: string, quadrant: QuadrantId | null) => { userActivation.current = { action, quadrant, at: performance.now() }; };
    // Enter or Space on a focused tile activates that tile; elsewhere they confirm a preview.
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Confirming a preview by key is a keyboard action: no bloom, no transitions.
      if (engine.snapshot.state === 'previewed') { noteKeyActivation(true); suppressMotionBriefly(); }
      const el = e.target as HTMLElement | null;
      const tile = el?.closest?.('[data-action]');
      const action = tile?.getAttribute('data-action');
      // A keyboard-focused tile takes the key; a preview waiting for confirmation always wins,
      // and a tile that merely kept focus after a click does not steal the confirm.
      if (action && tile?.matches(':focus-visible') && engine.snapshot.state !== 'previewed') {
        e.preventDefault();
        e.stopPropagation();
        byUser(action, engine.snapshot.quadrant);
        noteKeyActivation(true);
        suppressMotionBriefly();
        engine.activate(action, e.timeStamp);
      }
    };
    window.addEventListener('keydown', onKeyCapture, true);
    const detachKeys = attachKeyboard(engine, (q) => {
      const action = resolveQuadrant(q);
      if (action) byUser(action, q);
      noteKeyActivation(action !== null);
      if (action) suppressMotionBriefly();
      return action;
    });
    return () => { detach.forEach((d) => d()); detachKeys(); window.removeEventListener('keydown', onKeyCapture, true); };
  }, []);

  // What the partner says arrives as interim words, then as a turn.
  const onHeard = useCallback<OnHeard>((text, final) => dispatch(final ? { type: 'heard', text } : { type: 'hearing', text }), []);

  // Always listening (owner, 2026-11-07): the microphone runs on every conversation screen whenever
  // the device is not speaking (it is paused while speaking, so the device never captions itself,
  // and restarted after). Nothing stops it on a timer. `micLive` feeds the state pill.
  const [micLive, setMicLive] = useState(false);
  const speaking = live.kind === 'speaking';
  const conversing = screen.kind === 'talk' || screen.kind === 'done' || screen.kind === 'other' || screen.kind === 'menu';
  const micWanted = settings.partner === 'microphone' && conversing && !speaking;
  useEffect(() => {
    if (!micWanted) return;
    const session = hearPartner(onHeard, setMicLive);
    return () => { session.stop(); dispatch({ type: 'hearing-ended' }); };
  }, [micWanted, onHeard]);

  /** A scripted partner line (Demo page, debug): one at a time. */
  const hearLine = useCallback((text = nextScript()) => {
    script.current?.stop();
    script.current = playScript(text, onHeard);
  }, [onHeard]);

  // Speaking: one utterance per speak-start token, with the spoken word highlighted.
  const speakToken = live.kind === 'speaking' ? live.token : 0;
  const speakText = live.kind === 'speaking' ? live.text : '';
  useEffect(() => {
    if (!speakToken) return;
    play('rise');
    const s = speakWords(speakText, (word) => dispatch({ type: 'speak-word', token: speakToken, word }));
    speech.current = s;
    void s.done.then(() => { dispatch({ type: 'speak-end', token: speakToken }); play('fall'); });
    return () => s.cancel();
  }, [speakToken, speakText]);

  // Say again stays offered for a few seconds, and never relabels under the gaze.
  const spokenTurn = live.kind === 'spoken' ? live.turnId : 0;
  useEffect(() => {
    if (!spokenTurn) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      if (engine.snapshot.looked === 'secondary') timer = setTimeout(expire, 250);
      else dispatch({ type: 'say-again-expired' });
    };
    timer = setTimeout(expire, SAY_AGAIN_MS);
    return () => clearTimeout(timer);
  }, [spokenTurn]);

  const startSpeaking = useCallback((text: string, turnId: number | null) => {
    // Nothing to say is nothing to do: an empty message never becomes an empty turn.
    if (!wordsOf(text).length) return;
    // Taking the turn: a scripted partner line stops; the reducer keeps what was heard as a turn.
    script.current?.stop();
    token.current += 1;
    dispatch({ type: 'speak-start', text, turnId, token: token.current });
  }, []);

  /** Accept a shown word: it joins the message (in its written form) and the engine hears of it. */
  const accept = useCallback((shown: string, rank: number, display?: string) => {
    const s = stateRef.current;
    dispatch({ type: 'accept', word: shown, rank, display });
    commit(shown, historyOf(s), s.composition.words.map((w) => w.text));
    play('commit');
  }, []);

  const stopSpeakingNow = useCallback(() => {
    // Stopping is a repair: the draft comes back to the composer and nothing joins the thread.
    dispatch({ type: 'speak-cancel' });
    speech.current?.cancel(); // its end plays the falling earcon once
    stopSpeaking();
  }, []);

  const runPrimary = useCallback((fn: PrimaryFn) => {
    switch (fn.kind) {
      case 'word': accept(fn.word, fn.rank, fn.display); return;
      case 'no-match': return;
      case 'options': dispatch({ type: 'screen', screen: { kind: 'other', page: 0, pending: true } }); play('control'); return;
      case 'stop-speaking': stopSpeakingNow(); return;
    }
  }, [accept, stopSpeakingNow]);

  const runSecondary = useCallback((fn: SecondaryFn) => {
    const s = stateRef.current;
    switch (fn.kind) {
      case 'second': accept(fn.word, fn.rank, fn.display); return;
      case 'delete': dispatch({ type: 'delete' }); play('delete'); return;
      case 'done': dispatch({ type: 'screen', screen: { kind: 'done' } }); play('control'); return;
      case 'say-again': {
        const turn = s.turns.find((t) => t.id === fn.turnId);
        if (turn) startSpeaking(turn.text, turn.id);
        return;
      }
      case 'menu': dispatch({ type: 'screen', screen: { kind: 'menu', page: 'main' } }); play('control'); return;
      case 'unavailable': return;
    }
  }, [accept, startSpeaking]);

  // Calibration returns to the screen it was opened from (round 4): the conversation or the Done
  // page, with the message as it was, or the setup report on the first run. Start marks it done;
  // Back and Escape only leave.
  const leaveCalibration = useCallback((done: boolean) => {
    const s = stateRef.current;
    if (s.screen.kind !== 'calibration') return;
    if (done) dispatch({ type: 'calibrated', at: Date.now() });
    dispatch({ type: 'screen', screen: s.screen.from });
  }, []);
  const finishCalibration = useCallback(() => leaveCalibration(true), [leaveCalibration]);
  const exitCalibration = useCallback(() => leaveCalibration(false), [leaveCalibration]);
  const calibrationStep = useCallback((step: CalibrationStep) => {
    const s = stateRef.current;
    if (s.screen.kind === 'calibration') dispatch({ type: 'screen', screen: { ...s.screen, step } });
  }, []);
  const calibrate = useCallback((from: Screen): Screen => ({ kind: 'calibration', step: 'position', from }), []);

  /** Other words: the chosen word takes the last word's place and the engine hears of it. */
  const replaceWord = useCallback((word: Shown, rank: number) => {
    const s = stateRef.current;
    dispatch({ type: 'replace-word', word: word.text, rank, display: word.display });
    dispatch({ type: 'screen', screen: { kind: 'talk' } });
    commit(word.text, historyOf(s), s.composition.words.slice(0, -1).map((w) => w.text));
    play('commit');
  }, []);

  // The latest labels, read by the select handler without re-subscribing every render.
  const shownRef = useRef({ primary, secondary, slots, other: otherShown });
  shownRef.current = { primary, secondary, slots, other: otherShown };

  const onSelect = useCallback((action: string) => {
    const s = stateRef.current;
    const go = (screen: State['screen']) => { dispatch({ type: 'screen', screen }); play('control'); };
    const setting = (key: SettingKey) => { dispatch({ type: 'settings', patch: { [key]: nextValue(key, s.settings) } }); play('control'); };
    if (s.screen.kind === 'calibration') {
      if (action === 'start') { play('control'); finishCalibration(); }
      else if (action === 'back') { play('control'); exitCalibration(); }
      return;
    }
    if (s.screen.kind === 'setup') {
      const at = SETUP_STEPS.indexOf(s.screen.step);
      const step = (i: number) => go({ kind: 'setup', step: SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, Math.max(0, i))] });
      if (action === 'setup-back') step(at - 1);
      else if (action === 'setup-next') step(at + 1);
      else if (action === 'setup-calibrate') go(calibrate(s.screen));
      else if (action === 'setup-voice-app') { play('control'); openVoiceApp(); }
      else if (action === 'setup-start') { store({ setupDone: true }); go({ kind: 'talk' }); }
      else if (action.startsWith('set-')) setting(action.slice(4) as SettingKey);
      return;
    }
    if (s.screen.kind === 'done') {
      if (action === 'back') go({ kind: 'talk' });
      else if (action === 'speak') startSpeaking(sentenceOf(s.composition.words), null);
      else if (action === 'delete-word') { dispatch({ type: 'delete' }); play('delete'); dispatch({ type: 'screen', screen: { kind: 'talk' } }); }
      else if (action === 'clear') { dispatch({ type: 'clear' }); play('delete'); dispatch({ type: 'screen', screen: { kind: 'talk' } }); }
      else if (action === 'other-words') go({ kind: 'other', page: 0 });
      else if (action === 'recalibrate') go(calibrate(s.screen));
      return;
    }
    if (s.screen.kind === 'other') {
      const { words, total } = shownRef.current.other.value;
      const pages = Math.max(1, Math.ceil(total / CHOOSER_PAGE));
      const pending = Boolean(s.screen.pending);
      if (action === 'back') go({ kind: 'talk' });
      // More was chosen: the new page shows at once, under the gaze that chose it.
      else if (action === 'more' && s.screen.page + 1 < pages) { go({ kind: 'other', page: s.screen.page + 1, pending }); resync('other'); }
      else if (/^other-[0-3]$/.test(action)) {
        const i = Number(action.slice(-1));
        const rank = s.screen.page * CHOOSER_PAGE + i;
        if (words[i] && pending) { accept(words[i].text, rank, words[i].display); dispatch({ type: 'screen', screen: { kind: 'talk' } }); resync('primary'); }
        else if (words[i]) replaceWord(words[i], rank);
      }
      return;
    }
    if (s.screen.kind === 'menu') {
      const { page, origin } = s.screen;
      if (action === 'back') go(page === 'main' ? { kind: 'talk' } : origin === 'done' ? { kind: 'done' } : { kind: 'menu', page: 'main' });
      else if (action === 'settings' || action === 'demo') go({ kind: 'menu', page: action, origin });
      else if (action === 'more') go({ kind: 'menu', page: page === 'settings' ? 'settings-2' : 'settings', origin });
      else if (action === 'recalibrate') go(calibrate({ kind: 'talk' }));
      else if (action === 'partner-speaks') { go({ kind: 'talk' }); hearLine(); }
      else if (action.startsWith('set-')) setting(action.slice(4) as SettingKey);
      return;
    }
    const { primary: shownPrimary, secondary: shownSecondary, slots: intended } = shownRef.current;
    // An activation (dwell, key or click) runs what its card showed when it fired: the person acts
    // on what they saw. A word is accepted from the label itself, so what was shown is what joins
    // the message, whatever the engine has answered underneath since.
    if (action === 'primary') {
      runPrimary(shownPrimary.value.fn);
      // Stop shows its result at once; after accepting a word, the next word appears only once
      // gaze has left (MOTION.md "Word accepted").
      if (shownPrimary.value.fn.kind !== 'word') resync('primary');
    } else if (action === 'secondary') {
      runSecondary(shownSecondary.value.fn);
      if (shownSecondary.value.fn.kind !== 'second') resync('secondary');
    } else if (/^G[1-4]$/.test(action) && intended.groups) {
      dispatch({ type: 'group', group: action as GroupId });
      play('commit');
    }
  }, [accept, calibrate, exitCalibration, finishCalibration, hearLine, replaceWord, resync, runPrimary, runSecondary, startSpeaking]);

  useEffect(() => engine.subscribe((_snapshot, event) => {
    if (event?.type !== 'select') return;
    const user = userActivation.current?.action === event.action ? userActivation.current : null;
    userActivation.current = null;
    // Tiles (subscribed earlier) have read the key flag for this event; clear it after.
    queueMicrotask(() => noteKeyActivation(false));
    if (!user && (isGuarded(event.action) || gazeOutside())) { markIgnored(event.action); return; }
    if (user) {
      // A key or click gets the dwell's leave-and-return guard too (round 4): a speaking action
      // in the quadrant where a different action was just activated waits for the pointer to leave
      // that quadrant (a click is a look), or for a pause (a key), so three quick presses on Q4
      // never go Delete → Done → Speak and talk.
      const before = lastUser.current;
      lastUser.current = user;
      const sameQuadrant = before && user.quadrant !== null && before.quadrant === user.quadrant && before.action !== event.action;
      const speaks = SPEAKING_ACTIONS.has(event.action) && (event.action !== 'secondary' || shownRef.current.secondary.value.fn.kind === 'say-again');
      if (speaks && sameQuadrant && (isGuarded(event.action) || user.at - before.at < USER_REARM_MS)) { markIgnored(event.action); return; }
    }
    markIgnored(null);
    // The guard belongs to the quadrant that was selected: the pointer's for a dwell or a click, the
    // key's for a key (a key is not a look, so it must not block the quadrant the pointer rests in).
    guardQuadrant(user ? user.quadrant : engine.snapshot.quadrant, event.action);
    onSelect(event.action);
  }), [onSelect]);

  // A click's quadrant is the card's, read from its geometry: the pointer's own quadrant lags a
  // fresh pointer position by the engine's hold, so a quick click after a move would be filed under
  // the quadrant the pointer came from.
  const activate = useCallback((action: string) => {
    const el = document.querySelector(`[data-action="${CSS.escape(action)}"]`);
    const r = el?.getBoundingClientRect();
    const quadrant = r ? quadrantAt(r.left + r.width / 2, r.top + r.height / 2, viewportOf()) : engine.snapshot.quadrant;
    userActivation.current = { action, quadrant, at: performance.now() };
    engine.activate(action);
  }, []);

  // Debug hook for check-layout.mjs and for demos.
  useEffect(() => {
    window.clarteDebug = {
      phases: [...PHASES],
      phase: () => phaseOf(stateRef.current, peek(requestOf(stateRef.current))),
      setPhase: (name: string) => {
        if (!(PHASES as readonly string[]).includes(name)) throw new Error(`unknown phase ${name}`);
        speech.current?.cancel();
        script.current?.stop();
        resetScript();
        dispatch({ type: 'replace', state: seedFor(name as PhaseName, stateRef.current) });
      },
      validate: validateNow,
      engine,
      prediction: () => peek(requestOf(stateRef.current)),
      shown: () => shownRef.current.slots,
      chooser: () => { const s = stateRef.current; return s.screen.kind === 'other' ? peek(chooserRequestOf(s, s.screen.page)) : null; },
      seed,
      keyOf,
      engineDown,
      engineOrigin,
      setEngine,
      state: () => stateRef.current,
      /** An empty conversation on the talk screen, settings kept (checks and captures). */
      reset: () => { speech.current?.cancel(); script.current?.stop(); dispatch({ type: 'replace', state: { ...INITIAL_STATE, settings: stateRef.current.settings, screen: { kind: 'talk' } } }); },
      settings: (patch) => dispatch({ type: 'settings', patch }),
      partner: (text?: string) => hearLine(text),
      heard: (text: string) => dispatch({ type: 'heard', text }),
      speak: (text: string) => startSpeaking(sentence(text), null),
    };
    // `#phase=<name>` opens a phase directly, for demos and fresh-browser checks.
    const linked = /^#phase=([\w-]+)$/.exec(location.hash)?.[1];
    if (linked && (PHASES as readonly string[]).includes(linked)) window.clarteDebug.setPhase(linked);
  }, [hearLine, startSpeaking]);

  if (screen.kind === 'calibration') {
    // Keyed by step: each step starts from its own first point (the point list changes length).
    return (
      <Stage id={`calibration-${screen.step === 'ready' ? 'ready' : 'run'}`}>
        <Calibration key={screen.step} step={screen.step} onStep={calibrationStep} onExit={exitCalibration} activate={activate} />
      </Stage>
    );
  }

  // The state the partner reads across the table: Speaking; Listening while their words arrive;
  // "Replying" as soon as a reply is owed (the partner spoke last) or a draft exists, so they see a
  // reply is coming before the first letter (BRIEF "Partner awareness"); Listening again when the
  // microphone is on and nothing else is happening.
  const typing = state.composition.words.length > 0 || state.composition.pending.length > 0;
  const status: StateName | null = screen.kind === 'setup' ? null
    : speaking ? 'speaking'
    : state.hearing ? 'listening'
    : typing || (live.kind === 'quiet' && owedTurn(state)) ? 'composing'
    : micLive ? 'listening'
    : null;
  // The word in progress draws the shown word's letters (in its written form), so the glyphs and the
  // card agree. With nothing typed the next word stays on its card only: the message shows what was said, not a guess.
  const candidate = state.composition.pending.length && primary.value.fn.kind === 'word' ? primary.value.fn.display ?? primary.value.fn.word : null;
  const thread = (shown: StateName | null, marked = false) => <Thread state={shown} turns={state.turns} live={live} hearing={state.hearing} composition={state.composition} candidate={candidate} marked={marked} wordColours={settings.wordColours} />;

  let slotViews: Slots;
  let rest: ReactNode;
  let restKey: string;
  let boardKey: string;
  if (screen.kind === 'setup') {
    const ctx = { step: screen.step, settings, calibratedAt: state.calibratedAt, voice: voiceReport };
    slotViews = setupSlots(ctx);
    restKey = boardKey = `setup-${screen.step}`;
    rest = <SetupReport ctx={ctx} />;
  } else if (screen.kind === 'menu') {
    slotViews = menuSlots(screen.page, settings);
    restKey = boardKey = `title-${TITLES[screen.page]}`;
    // The menu opens over the conversation, which stays in place, blurred (glass-tiles reference).
    rest = (
      <>
        <div className="thread-behind" inert aria-hidden="true">{thread(null)}</div>
        <section className="thread thread-title" aria-label={TITLES[screen.page]}>
          <h1 className="page-title">{TITLES[screen.page]}</h1>
        </section>
      </>
    );
  } else if (screen.kind === 'done') {
    // The message stays where it was, to be read before it is spoken; only the cards change.
    slotViews = doneSlots();
    restKey = 'thread';
    boardKey = 'done';
    rest = thread(status);
  } else if (screen.kind === 'other') {
    // The message stays, with the word about to give way marked as the selected object.
    const { words, total } = otherShown.value;
    const at = screen.pending ? state.composition.words.length : Math.max(0, state.composition.words.length - 1);
    slotViews = otherSlots(words, at, screen.page, Math.max(1, Math.ceil(total / CHOOSER_PAGE)));
    restKey = 'thread';
    boardKey = `other-${screen.pending ? 'options' : 'words'}-${screen.page}`;
    rest = thread(status, !screen.pending);
  } else {
    const pFace = primaryFace(primary.value.fn, primary.value.index);
    const sFace = secondaryFace(secondary.value.fn, secondary.value.index);
    slotViews = {
      q1: { action: 'primary', tone: 'ink', icon: pFace.icon, label: pFace.name, disabled: primary.value.fn.kind === 'no-match', bodyKey: primary.key, body: <FaceBody face={pFace} /> },
      q4: { action: 'secondary', tone: 'surface', icon: sFace.icon, label: sFace.name, disabled: secondary.value.fn.kind === 'unavailable', bodyKey: secondary.key, body: <FaceBody face={sFace} /> },
    };
    for (const id of GROUP_IDS) {
      slotViews[GROUP_QUADRANT[id]] = {
        action: id, tone: 'group', group: id, disabled: !slots.groups, bodyKey: id,
        body: <>
          <span className="letters">{halves(groupLetters(id, '')).map((h, i) => <span key={i}>{h}</span>)}</span>
        </>,
      };
    }
    restKey = 'thread';
    boardKey = 'talk';
    rest = thread(status);
  }

  // The orb takes the conversation's state as its mood, and pulses on each word heard or spoken.
  const mood: OrbMood = screen.kind !== 'talk' && screen.kind !== 'done' && screen.kind !== 'other' ? 'idle' : status ?? 'idle';
  const pulse = speaking ? live.word + 1 : (state.hearing.match(/\S+/g)?.length ?? 0);

  return (
    <Stage id="app" surface={screen.kind === 'setup' ? 'report' : 'talk'}>
      {screen.kind !== 'setup' && <Orb mood={mood} pulse={pulse} still={settings.orbMotion === 'still'} theme={settings.theme} />}
      <Board slots={slotViews} screen={boardKey} activate={activate} />
      <RestZone id={restKey}>{rest}</RestZone>
      {screen.kind === 'talk' && <Branch conflict={shownConflict} />}
    </Stage>
  );
}

const SLOT_NAMES: SlotName[] = ['q1', 'q4', 'q5', 'q6', 'q7', 'q8'];

/**
 * The six cards persist across the conversation, the Done page and the menu, keyed by quadrant: a
 * screen change transitions each card in place (its face colour over 300 ms, its content by a
 * 150 ms fade) instead of cross-fading two copies, so a shared surface never passes through the
 * canvas and no bloom restarts on a copy. A quadrant with no action on this screen fades its card away.
 */
function Board({ slots, screen, activate }: { slots: Slots; screen: string; activate: (action: string) => void }) {
  const last = useRef<Slots>(slots);
  for (const q of SLOT_NAMES) if (slots[q]) last.current[q] = slots[q];
  // A face change on the same screen (the word while typing) is frequent: it takes the fast label
  // cross-fade. A change of screen takes the page choreography.
  const lastScreen = useRef(screen);
  const fast = lastScreen.current === screen;
  useLayoutEffect(() => { lastScreen.current = screen; });
  return (
    <>
      {SLOT_NAMES.map((q) => {
        const view = slots[q] ?? last.current[q];
        return (
          <Cell key={q} q={q}>
            {view && (
              <Tile action={view.action} tone={view.tone} group={view.group} icon={view.icon} label={view.label} disabled={view.disabled} gone={!slots[q]} fast={fast} onActivate={activate}>
                <Swap swapKey={view.bodyKey} className="card-swap" leavingClass="card-leaving" fast={fast}>{view.body}</Swap>
              </Tile>
            )}
          </Cell>
        );
      })}
    </>
  );
}

/** The rest zone's content cross-fades in place when the screen changes (text only). */
function RestZone({ id, children }: { id: string; children: ReactNode }) {
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);
  useLayoutEffect(() => {
    if (last.current.id !== id) setLeaving(last.current);
    last.current = { id, node: children };
  });
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), 170);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <>
      {leaving && <div key={`leaving-${leaving.id}`} className="rest-leaving" inert aria-hidden="true">{leaving.node}</div>}
      <div key={id} className="rest-entering">{children}</div>
    </>
  );
}

declare global {
  interface Window {
    clarteDebug?: {
      phases: string[];
      phase(): string;
      setPhase(name: string): void;
      validate(): ReturnType<typeof validateNow>;
      engine: typeof engine;
      /** The cached (or local) answer for the conversation as it stands. */
      prediction(): Prediction;
      /** What the two cards offer from the prediction in use (after the hold and the repeat guard). */
      shown(): ReturnType<typeof slotsFor>;
      /** The Other words page on screen, or null off the chooser. */
      chooser(): Prediction | null;
      seed(req: PredictRequest, value: Prediction): void;
      keyOf(req: PredictRequest): string;
      engineDown(): boolean;
      engineOrigin(): string | null;
      /** Forget the engine (null; it is probed again) or name one. */
      setEngine(origin: string | null): void;
      state(): State;
      reset(): void;
      settings(patch: Partial<Settings>): void;
      /** Play a partner line (the next scripted one by default), as the Demo page does. */
      partner(text?: string): void;
      /** A partner turn, whole and at once (checks without a microphone). */
      heard(text: string): void;
      /** Speak `text` as the person's reply (checks). */
      speak(text: string): void;
    };
  }
}
