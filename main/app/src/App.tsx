/**
 * Clarté: UI v1's conversation screen (from v0's style 8) with the mesh-gradient companion
 * (Companion.tsx), there only while the middle is blank, and a Soft or Vibrant palette (variant.ts);
 * an Options screen for every predicted word; the first run (Onboarding.tsx: Welcome, eye calibration,
 * making the person's voice in VoiceSetup.tsx); words from the prediction engine (useWords.ts); and looks from the webcam eye
 * tracker (eyes/session.ts); with keyboard and mouse (`?input=mouse`, or chosen) clicks and keys select.
 *
 * Q4 is the contextual primary slot, Q1 the contextual delete slot, Q2–Q3 a rest zone holding
 * the conversation thread, Q5–Q8 the letter groups. Every activation (a confirmed look, digit key, click,
 * Enter on a focused tile) arrives as one engine `select` event and is routed by action id.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { attachKeyboard, startTicking } from './core/gaze.ts';
import { trackActionables } from './core/overlay.ts';
import { GROUP_IDS, groupLetters, type GroupId } from './core/decoder.ts';
import { messageText } from './core/composer.ts';
import { stopSpeaking } from './core/speech.ts';
import { attachPointerStream, engine, gazeOutside, guardQuadrant, isGuarded, markIgnored, noteKeyActivation, suppressMotionBriefly, resolveQuadrant, setDwellClasses, useLooked, validateNow } from './gaze.ts';
import {
  INITIAL_STATE,
  historyOf,
  requestOf,
  owedTurn,
  phaseOf,
  primaryKey,
  reducer,
  secondKey,
  slotsFor,
  type MenuPage,
  type PrimaryFn,
  type SecondFn,
  type Settings,
  type State, type Turn,
  type VoiceStep,
} from './model.ts';
import { Tile, type SlotName, type SlotView, type Slots } from './Tile.tsx';
import { Thread, type StateName } from './Thread.tsx';
import { TITLES, backCard, menuSlots, nextValue, parentOf, trailOf, type SettingKey } from './Menu.tsx';
import { shownWord } from './words.ts';
import { useWords, wordsNow } from './useWords.ts';
import { commit, peek } from './prediction/prediction.ts';
import { Calibration } from './Calibration.tsx';
import { PHASES, makerFor, seedFor, type PhaseName } from './debug.ts';
import { listenToPartner, resetScript, type Speech } from './voice.ts';
import { configureSound, duck, play, unlockOnGesture } from './core/sound.ts';
import { longest } from './text.ts';
import { prefetchPunctuation, spokenText } from './prediction/punctuate.ts';
import { fitCards } from './fit.ts';
import { Swap } from './Swap.tsx';
import { Companion } from './Companion.tsx';
import { reactionFor, type OrbMood } from './cloud/Cloud.tsx';
import { PagedStrip, pageList, type Strip } from './Pager.tsx';
import { OptionsFace } from './OptionsFace.tsx';
import { WelcomePage, welcomeSlots, tallCard } from './Onboarding.tsx';
import { VoicePage, voiceSlots } from './VoiceSetup.tsx';
import { closeMic, makeVoice, makerNow, move, openMic, resetMaker, setMakerError, showMaker, startTake, stopTake, useMaker } from './myvoice/maker.ts';
import { refreshVoices, speakInVoice, useVoices } from './myvoice/voices.ts';
import type { Source } from './myvoice/service.ts';
import { GuideOrb } from './GuideOrb.tsx';
import { startSoundSelect, type SoundSelect } from './soundSelect.ts';
import { TeachSound, type TeachStep } from './TeachSound.tsx';
import { cancelRun, eyesDrive, eyesStatus, prepareRun, startEyes, useEyesStatus } from './eyes/session.ts';
import { Again, ArrowRight, Back, Backspace, Check, Erase, Close, Hand, MenuLines, Mic, Options, Sparkle, Speaker, StopSquare } from './icons.tsx';

const SAY_AGAIN_MS = 6000;
/** The first run's voice page: making the person's voice from today's recordings (NAT-32). */
const FIRST_VOICE = { kind: 'voice', step: 'intro', source: 'current', from: 'first-run' } as const;
/** What Hear it says in the person's voice. */
const SAMPLE = 'Hello, this is my voice.';
/** "More" walks the three settings pages in a loop. */
// Style 8 (owner, 2026-11-07): the floor-holder is "Wait!" (style 7: "One moment").
const HOLDER = "Wait! I'm answering.";
const STORE = 'clarte.v1';
const PARAMS = new URLSearchParams(location.search);
/** `?input=mouse`: keyboard and mouse, with no camera; clicks and keys select. */
const MOUSE_ONLY = PARAMS.get('input') === 'mouse';
/** Screens where a sound never selects: the eyes cannot select yet, or the person is recording. */
const SOUND_OFF = new Set<string>(['welcome', 'calibration', 'voice', 'teach']);
/** Screens where the eyes cannot select yet, so the pointer does not stand in for them. */
const EYES_NOT_READY = new Set<string>(['welcome', 'calibration']);

/**
 * Every launch opens on Welcome, then eye calibration (owner, 2026-11-08); `?onboarding=off` opens
 * straight into the app. Only the settings carry over.
 */
function loadStored(): State {
  const screen: State['screen'] = PARAMS.get('onboarding') === 'off' ? { kind: 'talk' } : INITIAL_STATE.screen;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...INITIAL_STATE, screen };
    const saved = JSON.parse(raw) as { settings?: Partial<Settings> };
    return { ...INITIAL_STATE, settings: migrate({ ...INITIAL_STATE.settings, ...saved.settings }), screen };
  } catch {
    return { ...INITIAL_STATE, screen };
  }
}

/** Settings saved before NAT-24 stored `sound` as on/off. */
function migrate(saved: Settings): Settings {
  // Only today's settings carry over: the dwell settings (mode, letterDwell, controlDwell) are gone.
  const settings = Object.fromEntries(Object.keys(INITIAL_STATE.settings).map((k) => [k, saved[k as keyof Settings]])) as Settings;
  const sound = settings.sound as Settings['sound'] | boolean;
  if (sound === true) return { ...settings, sound: 'all' };
  if (sound === false) return { ...settings, sound: 'off' };
  return settings;
}

/**
 * Whether the person has finished the first run's voice pages (Continue after making a voice, or
 * Not now); later launches then go from calibration straight to the conversation. A store saved
 * before this, when the whole first run happened once, says `setupDone` instead.
 */
function voiceDone(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { voiceDone?: boolean; setupDone?: boolean };
    return Boolean(saved.voiceDone || saved.setupDone);
  } catch { return false; }
}

function store(patch: { settings?: Settings; voiceDone?: boolean }): void {
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


function Cell({ q, children }: { q: string; children?: ReactNode }) {
  return <div className={`cell cell-${q}`}>{children}</div>;
}

type CardFace = { icon: ReactNode; label?: ReactNode; hint?: string; name?: string };

/** What the primary card (ink, Q4) shows for each function. */
function primaryFace(fn: PrimaryFn): CardFace {
  switch (fn.kind) {
    case 'listen': return { icon: <Mic />, label: 'Listen' };
    case 'stop-listening': return { icon: <StopSquare />, label: 'Stop' };
    case 'suggestion': return { icon: <Sparkle />, label: <span className="card-label is-quote" style={longest(fn.text)}>“{fn.text}”</span>, hint: 'Suggested' };
    case 'no-match': return { icon: <Check />, label: 'No word' };
    case 'speak': return { icon: <Speaker />, label: 'Speak' };
    case 'stop-speaking': return { icon: <StopSquare />, label: 'Stop' };
    case 'say-again': return { icon: <Again />, label: 'Say again' };
    // Owner, 2026-11-08: "Options" at the bottom, the three most likely words above it, reordering
    // like a live leaderboard as typing changes them (OptionsFace.tsx).
    case 'options': return {
      icon: <Options />,
      name: `Options: ${fn.words.slice(0, 3).join(', ')}${fn.words.length > 3 ? ', and more' : ''}`,
      label: <OptionsFace top={fn.words.slice(0, 3)} more={fn.words.length > 3} />,
    };
  }
}

/** What the second card (light, Q1) shows for each function. */
function secondFace(fn: SecondFn, pending: number): CardFace {
  switch (fn.kind) {
    case 'delete': return fn.word ? { icon: <Erase />, label: 'Delete word' } : { icon: <Erase />, label: 'Delete', hint: pending ? 'Last group' : 'Last word' };
    case 'one-moment': return { icon: <Hand />, label: 'Wait!' };
    case 'menu': return { icon: <MenuLines />, label: 'Menu' };
    case 'dismiss': return { icon: <Close />, label: 'Not now' };
    // While speaking nothing can be deleted; the slot shows what it returns to, dimmed.
    case 'none': return { icon: <Backspace />, label: 'Delete', name: 'Delete, unavailable while speaking' };
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

const AUTO_START_S = 20;

/**
 * No dwell (owner, 2026-11-08): a look never selects. A steady look this long closes the line round a
 * card and waits; Space or Enter, a click or a switch selects it. Not a setting any more.
 */
const LOOK_MS = { letter: 600, control: 900 };

/**
 * Seconds left before `onDone` runs by itself, counting down while `active`; null once a key, a
 * click or a mouse movement shows the person can select without their eyes (then it never runs).
 */
function useAutoStart(active: boolean, onDone: () => void): number | null {
  const [left, setLeft] = useState(AUTO_START_S);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (!active || cancelled) return;
    setLeft(AUTO_START_S);
    const started = performance.now();
    const timer = window.setInterval(() => {
      const remaining = AUTO_START_S - Math.floor((performance.now() - started) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { window.clearInterval(timer); onDone(); }
    }, 250);
    const origin = { x: NaN, y: NaN };
    const cancel = () => setCancelled(true);
    const move = (e: PointerEvent) => {
      if (Number.isNaN(origin.x)) { origin.x = e.clientX; origin.y = e.clientY; return; }
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 24) cancel();
    };
    window.addEventListener('keydown', cancel);
    window.addEventListener('pointerdown', cancel);
    window.addEventListener('pointermove', move);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('pointerdown', cancel);
      window.removeEventListener('pointermove', move);
    };
  }, [active, cancelled, onDone]);
  return active && !cancelled ? left : null;
}

const GROUP_QUADRANT: Record<GroupId, SlotName> = { G1: 'q5', G2: 'q6', G3: 'q7', G4: 'q8' };

/**
 * Calibration and the app are separate stages. A change between them cross-fades two layers
 * that each paint the canvas and blend with `plus-lighter`, at the same duration and easing, so
 * the sum is exactly linear and luminance never dips. The outgoing layer is inert.
 */
function Stage({ id, children }: { id: string; children: ReactNode }) {
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
      <main key={id} className="layer">{children}</main>
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadStored);
  const stateRef = useRef(state);
  stateRef.current = state;
  const looked = useLooked();
  const token = useRef(1);
  const speech = useRef<Speech | null>(null);
  /** The action a key or click just activated, so its select event is not mistaken for a dwell. */
  const userActivation = useRef<string | null>(null);

  const { settings, screen, live } = state;
  const maker = useMaker();
  const voices = useVoices();
  /** A voice page's word about a blocked action (the file list needs a click), or null. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const words = useWords(state);
  const slots = slotsFor(state, words);
  const shown = shownWord(state.composition, words.prediction)?.word ?? null;
  /** Keyboard and mouse for the rest of the session, with no selection by dwell (`?input=mouse`, Keyboard and mouse on Welcome, or Use the mouse after a camera failure). */
  const mouseOnly = useRef(MOUSE_ONLY);
  // Bumped when an activation landed on a stale label, so the label catches up at once.
  const [syncs, setSyncs] = useState(0);
  const resync = useCallback(() => setSyncs((n) => n + 1), []);
  const primary = useSettled('primary', primaryKey(slots.primary), slots.primary, looked, syncs);
  // The typed letters spell the word the card shows, which holds still while gaze rests on it.
  const typedWord = primary.value.kind === 'options' ? primary.value.words[0] ?? shown : shown;

  // No word fits the groups typed so far: a soft "not yet", a second late, and only if it lasts.
  const noMatch = slots.primary.kind === 'no-match';
  useEffect(() => {
    if (!noMatch) return;
    const timer = setTimeout(() => play('unsure'), 1000);
    return () => clearTimeout(timer);
  }, [noMatch]);
  const second = useSettled('delete', secondKey(slots.second), slots.second, looked, syncs);

  // Look + sound (owner, 2026-11-08; DEC-128): a look closes the line round a card and the person's
  // sound ("yeah", taught under Menu › Settings › My sound) selects it, like Space or a switch. A
  // sound counts only where it can mean a selection: not while the partner is heard or Clarté
  // speaks (it could be theirs or its own), not on the voice pages (the person is recording their
  // voice there), and not before the eyes are calibrated. Keyboard and mouse opens no microphone.
  useEffect(() => {
    if (MOUSE_ONLY) return;
    let sound: SoundSelect | null = null;
    let stopped = false;
    const onSound = () => { noteKeyActivation(false); engine.confirm(); };
    const enabled = () => {
      const s = stateRef.current;
      return s.live.kind !== 'listening' && s.live.kind !== 'speaking' && !SOUND_OFF.has(s.screen.kind);
    };
    startSoundSelect(onSound, enabled).then((s) => { if (stopped) s.stop(); else sound = s; }, () => {});
    return () => { stopped = true; sound?.stop(); };
  }, []);
  const [teachStep, setTeachStep] = useState<TeachStep>('room');
  const [teachRun, setTeachRun] = useState(0);

  // Settings → engine, document and audio (before paint, so a new text size never shows unfitted).
  useLayoutEffect(() => {
    engine.configure({ mode: 'confirm', noiseSigma: settings.noise ? 0.06 : 0 });
    setDwellClasses(LOOK_MS.letter, LOOK_MS.control, screen.kind === 'talk', settings.repeat);
    document.documentElement.style.setProperty('--scale', String(settings.textScale));
    document.documentElement.toggleAttribute('data-large', settings.textScale > 1);
    configureSound({ level: settings.sound, volume: settings.volume });
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

  // Gaze sources and the per-frame clock.
  useEffect(() => {
    const detach = [
      // The pointer stands in for the eyes only while the eyes are expected but not driving, and
      // never on Welcome or calibration, where the eyes cannot select yet. With keyboard and mouse
      // nothing selects by dwell (owner): a click or keys 1–8 select, and hovering never does.
      attachPointerStream(engine, () => !mouseOnly.current && !eyesDrive() && !EYES_NOT_READY.has(stateRef.current.screen.kind)),
      startTicking(engine),
      unlockOnGesture(),
      // In development the overlay tracks actionables itself (main.tsx); here for production builds.
      import.meta.env.DEV ? () => {} : trackActionables(engine),
    ];
    // Enter or Space on a focused tile activates that tile; elsewhere they confirm a preview.
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, [contenteditable="true"], .turn-replay')) return;
      // A held key is not a second deliberate confirmation after the screen changes.
      if (e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
      // Confirming a preview by key is a keyboard action: no bloom, no transitions.
      if (engine.snapshot.state === 'previewed') { noteKeyActivation(true); suppressMotionBriefly(); }
      const tile = el?.closest?.('[data-action]');
      const action = tile?.getAttribute('data-action');
      const pinned = stateRef.current.screen.kind === 'options'
        && engine.snapshot.quadrant === 'Q4' && engine.snapshot.looked === 'pick-0';
      // A keyboard-focused tile takes the key; a preview waiting for confirmation always wins,
      // and a tile that merely kept focus after a click does not steal the confirm.
      const confirmed = action && tile?.matches(':focus-visible') && engine.snapshot.state !== 'previewed'
        ? action : pinned ? 'pick-0' : null;
      if (confirmed) {
        e.preventDefault();
        e.stopPropagation();
        userActivation.current = confirmed;
        noteKeyActivation(true);
        suppressMotionBriefly();
        engine.activate(confirmed, e.timeStamp);
      }
    };
    window.addEventListener('keydown', onKeyCapture, true);
    const detachKeys = attachKeyboard(engine, (q) => {
      const action = resolveQuadrant(q);
      userActivation.current = action;
      noteKeyActivation(action !== null);
      if (action) suppressMotionBriefly();
      return action;
    });
    return () => { detach.forEach((d) => d()); detachKeys(); window.removeEventListener('keydown', onKeyCapture, true); };
  }, []);

  // Listening: a session per listen-start token. Token 0 is a static debug frame.
  const listenToken = live.kind === 'listening' ? live.token : 0;
  useEffect(() => {
    if (!listenToken) return;
    const session = listenToPartner(stateRef.current.settings.partner, (text) => dispatch({ type: 'transcript', text }));
    return () => session.stop();
  }, [listenToken]);

  // Speaking: one utterance per speak-start token, with the spoken word highlighted.
  const speakToken = live.kind === 'speaking' ? live.token : 0;
  const speakText = live.kind === 'speaking' ? live.text : '';
  useEffect(() => {
    if (!speakToken) return;
    // A short breath in, then every cue ducks under the voice until it ends (SOUND.md).
    play('speak-start');
    duck(true);
    // In the person's own voice when one is chosen (Menu › My voice), else the system voice.
    const { voiceId, pacing } = stateRef.current.settings;
    const s = speakInVoice(speakText, (word) => dispatch({ type: 'speak-word', token: speakToken, word }), voiceId, pacing);
    speech.current = s;
    void s.done.then(() => { duck(false); dispatch({ type: 'speak-end', token: speakToken }); play('speak-end'); });
    return () => { s.cancel(); duck(false); };
  }, [speakToken, speakText]);

  // Say again stays offered for a few seconds, and never relabels under the gaze.
  const spokenTurn = live.kind === 'spoken' ? live.turnId : 0;
  useEffect(() => {
    if (!spokenTurn) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      if (engine.snapshot.looked === 'primary') timer = setTimeout(expire, 250);
      else dispatch({ type: 'say-again-expired' });
    };
    timer = setTimeout(expire, SAY_AGAIN_MS);
    return () => clearTimeout(timer);
  }, [spokenTurn]);

  // Punctuation for the message as it stands is asked ahead, while it is ready to speak (NAT-38).
  const punctuating = useRef(false);
  const readyMessage = state.screen.kind === 'talk' && !state.composition.pending.length && state.live.kind !== 'listening' && state.live.kind !== 'speaking'
    ? state.composition.words.map((w) => w.text) : [];
  const readyKey = JSON.stringify(readyMessage);
  useEffect(() => {
    if (readyMessage.length) prefetchPunctuation(historyOf(stateRef.current), readyMessage);
  }, [readyKey, state.turns.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSpeaking = useCallback((text: string, turnId: number | null, holder: boolean) => {
    token.current += 1;
    dispatch({ type: 'speak-start', text, turnId, holder, token: token.current });
  }, []);

  const replayTurn = useCallback((turn: Turn) => {
    const s = stateRef.current;
    if (s.screen.kind !== 'talk' || s.live.kind === 'speaking' || punctuating.current) return;
    startSpeaking(turn.text, turn.id, false);
  }, [startSpeaking]);

  const runPrimary = useCallback((fn: PrimaryFn) => {
    const s = stateRef.current;
    switch (fn.kind) {
      case 'listen': token.current += 1; dispatch({ type: 'listen-start', token: token.current }); play('listen-start'); return;
      case 'stop-listening': dispatch({ type: 'listen-stop' }); play('listen-stop'); return;
      case 'suggestion': dispatch({ type: 'use-suggestion', text: fn.text }); play('word'); return;
      case 'options': dispatch({ type: 'open-options', words: fn.words }); play('control'); return;
      case 'no-match': return;
      case 'speak': {
        // The message is spoken as the engine punctuates it (NAT-38), so the voice asks a question
        // as one. The answer is usually cached already; a late one holds the voice at most 700 ms.
        if (punctuating.current) return;
        const message = s.composition.words.map((w) => w.text);
        const asked = messageText(s.composition);
        punctuating.current = true;
        void spokenText(historyOf(s), message).then((text) => {
          punctuating.current = false;
          const now = stateRef.current;
          // Nothing else may have happened meanwhile: the same message, still not spoken.
          if (messageText(now.composition) !== asked || now.composition.pending.length || now.live.kind === 'speaking') return;
          startSpeaking(text, null, false);
        });
        return;
      }
      case 'stop-speaking':
        // Stopping is a repair: the draft comes back to the composer and nothing joins the thread.
        dispatch({ type: 'speak-cancel' });
        speech.current?.cancel(); // its end plays the speak-end cue once
        stopSpeaking();
        return;
      case 'say-again': {
        const turn = s.turns.find((t) => t.id === fn.turnId);
        if (turn) startSpeaking(turn.text, turn.id, false);
        return;
      }
    }
  }, [startSpeaking]);

  const runSecond = useCallback((fn: SecondFn) => {
    switch (fn.kind) {
      case 'delete': dispatch({ type: 'delete' }); play('delete'); return;
      case 'one-moment': startSpeaking(HOLDER, null, true); return;
      case 'menu': dispatch({ type: 'screen', screen: { kind: 'menu', page: 'main' } }); play('control'); return;
      case 'dismiss': dispatch({ type: 'dismiss-suggestion' }); play('delete'); return;
      case 'none': return;
    }
  }, [startSpeaking]);

  // Calibration leads on to making the person's voice on the first run, else back to the conversation.
  const afterCalibration = useCallback(() => {
    const s = stateRef.current;
    dispatch({ type: 'screen', screen: s.screen.kind === 'calibration' && s.screen.then === 'voice' ? FIRST_VOICE : { kind: 'talk' } });
  }, []);
  /** Leave calibration without a new calibration: the one in use before, if any, stays in use. */
  const leaveCalibration = useCallback((mouse: boolean) => {
    if (mouse) mouseOnly.current = true;
    void cancelRun();
    afterCalibration();
  }, [afterCalibration]);

  /** Welcome leads to calibration, then the voice pages until they are done, then the conversation. */
  const getStarted = useCallback(() => {
    if (stateRef.current.screen.kind !== 'welcome') return;
    play('control');
    const done = voiceDone();
    dispatch({ type: 'screen', screen: mouseOnly.current ? (done ? { kind: 'talk' } : FIRST_VOICE) : { kind: 'calibration', then: done ? 'talk' : 'voice' } });
  }, []);
  /** Keyboard and mouse: no camera and no calibration; clicks and keys select for the session. */
  const chooseKeyboardAndMouse = useCallback(() => {
    if (stateRef.current.screen.kind !== 'welcome') return;
    mouseOnly.current = true;
    getStarted();
  }, [getStarted]);
  // Before calibration the eyes cannot select yet, so Get started starts by itself after 20 s,
  // unless the person shows they can use the keyboard or the mouse.
  const autoStart = useAutoStart(screen.kind === 'welcome' && !mouseOnly.current, getStarted);

  // The calibration flow: start the camera, arm a run in a fresh worker once it runs (over the
  // calibration in use, for a recalibration), and leave once a new calibration is in use. Escape
  // leaves a run, except while it trains.
  const eyes = useEyesStatus();
  const calibrating = screen.kind === 'calibration';
  /** Set when this calibration screen armed its run: the `calibratedAt` in use then, or 0 for none. */
  const armedWith = useRef<number | null>(null);
  useEffect(() => {
    if (!calibrating) { armedWith.current = null; return; }
    if (eyes.kind === 'off') { void startEyes(engine); return; }
    if (armedWith.current === null && (eyes.kind === 'tracking' || eyes.kind === 'uncalibrated')) {
      armedWith.current = eyes.kind === 'tracking' ? eyes.calibratedAt : 0;
      void prepareRun();
      return;
    }
    if (armedWith.current !== null && eyes.kind === 'tracking' && eyes.calibratedAt !== armedWith.current) { play('calibrated'); afterCalibration(); }
  }, [calibrating, eyes, afterCalibration]);
  useEffect(() => {
    if (!calibrating) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && eyesStatus().kind !== 'training') leaveCalibration(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calibrating, leaveCalibration]);
  const calibrationFailure = eyes.kind === 'failed' ? eyes.message : eyes.kind === 'run-failed' ? eyes.reason : null;

  // Every launch calibrates (Get started), over the saved calibration once the camera restores it,
  // so Escape and Keep the old one fall back to it. If the camera fails later, or the calibration
  // stops fitting, the calibration screen opens (its failure view offers Try again and Use the mouse).
  useEffect(() => {
    if (mouseOnly.current || (eyes.kind !== 'uncalibrated' && eyes.kind !== 'failed')) return;
    const kind = stateRef.current.screen.kind;
    if (kind === 'talk' || kind === 'menu' || kind === 'options') dispatch({ type: 'screen', screen: { kind: 'calibration', then: 'talk' } });
  }, [eyes]);

  // ── The person's voice (NAT-32) ──
  // Leaving the voice pages by any route closes the microphone.
  const onVoice = screen.kind === 'voice';
  useEffect(() => { if (!onVoice) { closeMic(); setVoiceNote(null); } }, [onVoice]);

  const voiceGo = useCallback((step: VoiceStep, source?: Source) => {
    const s = stateRef.current.screen;
    if (s.kind !== 'voice') return;
    setVoiceNote(null);
    dispatch({ type: 'screen', screen: { ...s, step, source: source ?? s.source } });
  }, []);

  /** Not now, or Continue: the first run goes on to the conversation, the menu back to My voice. */
  const leaveVoice = useCallback(() => {
    const s = stateRef.current.screen;
    if (s.kind !== 'voice') return;
    closeMic();
    if (s.from === 'first-run') { store({ voiceDone: true }); dispatch({ type: 'screen', screen: { kind: 'talk' } }); }
    else dispatch({ type: 'screen', screen: { kind: 'menu', page: 'voice' } });
  }, []);

  const lastFiles = useRef<File[] | undefined>(undefined);
  /** Make the voice. It is chosen once it can speak, even if the person has left the pages meanwhile. */
  const runMake = useCallback((source: Source, files?: File[]) => {
    voiceGo('making', source);
    void makeVoice(source, files).then((voice) => {
      if (voice?.status === 'ready') dispatch({ type: 'settings', patch: { voiceId: voice.id } });
      if (stateRef.current.screen.kind !== 'voice') return;
      voiceGo(!voice ? 'error' : voice.status === 'ready' ? 'ready' : 'need-more');
      play(voice?.status === 'ready' ? 'word' : 'unsure');
    });
  }, [voiceGo]);

  const sample = useRef<Speech | null>(null);
  const hear = useCallback((id: string | null) => {
    sample.current?.cancel();
    duck(true);
    const s = speakInVoice(SAMPLE, () => {}, id, stateRef.current.settings.pacing);
    sample.current = s;
    void s.done.then(() => { if (sample.current === s) duck(false); });
  }, []);

  /** The browser opens its file list only straight after a click or a key, never from a dwell. */
  const pickFiles = useCallback(() => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) { setVoiceNote('Click Choose files to open the list of files.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,video/*';
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      lastFiles.current = files;
      runMake('past', files);
    };
    input.click();
  }, [runMake]);

  const voiceAction = useCallback((action: string) => {
    const s = stateRef.current.screen;
    if (s.kind !== 'voice') return;
    switch (action) {
      case 'voice-leave': play('control'); leaveVoice(); return;
      case 'voice-check': play('control'); void refreshVoices(); return;
      case 'voice-record': play('control'); voiceGo('consent', 'current'); return;
      case 'voice-old': play('control'); voiceGo('consent', 'past'); return;
      case 'voice-agree':
        play('control');
        if (s.source === 'past') voiceGo('files');
        else { voiceGo('record'); void openMic(); }
        return;
      case 'voice-mic': play('control'); void openMic(); return;
      // No cue when a take starts, so none is recorded; Stop's cue plays once the take has ended.
      case 'voice-take':
        if (makerNow().recording !== null) void stopTake().then(() => play('control'));
        else startTake();
        return;
      case 'voice-prev': play('control'); move(-1); return;
      case 'voice-next': play('control'); move(1); return;
      case 'voice-make': play('control'); lastFiles.current = undefined; runMake('current'); return;
      case 'voice-files': play('control'); pickFiles(); return;
      case 'voice-retry': play('control'); runMake(s.source, s.source === 'past' ? lastFiles.current : undefined); return;
      case 'voice-more': play('control'); setMakerError(null); voiceGo('record', 'current'); void openMic(); return;
      case 'voice-hear': hear(makerNow().made?.id ?? null); return;
      case 'voice-done': play('control'); leaveVoice(); return;
    }
  }, [hear, leaveVoice, pickFiles, runMake, voiceGo]);

  // The latest labels, read by the select handler without re-subscribing every render.
  const shownRef = useRef({ primary, second, slots });
  shownRef.current = { primary, second, slots };

  const onSelect = useCallback((action: string) => {
    const s = stateRef.current;
    const page = (p: MenuPage) => { dispatch({ type: 'screen', screen: { kind: 'menu', page: p } }); play('control'); };
    const changeSetting = (key: SettingKey) => {
      const patch = { [key]: nextValue(key, s.settings) } as Partial<Settings>;
      // A new sound level or volume applies before the confirming cue, so the cue previews it.
      configureSound({ level: patch.sound, volume: patch.volume });
      dispatch({ type: 'settings', patch });
      play('control');
    };
    if (s.screen.kind === 'calibration') {
      if (action === 'calibrate-retry') {
        play('control');
        if (eyesStatus().kind === 'failed') { armedWith.current = null; void startEyes(engine); } else void prepareRun();
      } else if (action === 'use-mouse') { play('control'); leaveCalibration(true); }
      else if (action === 'keep-calibration') { play('control'); leaveCalibration(false); }
      return;
    }
    if (s.screen.kind === 'welcome') {
      if (action === 'get-started') getStarted();
      else if (action === 'keyboard-mouse') chooseKeyboardAndMouse();
      return;
    }
    if (s.screen.kind === 'teach') {
      if (action === 'back' || action === 'teach-done') page('settings');
      else if (action === 'teach-retry') { play('control'); setTeachStep('room'); setTeachRun((n) => n + 1); }
      return;
    }
    if (s.screen.kind === 'voice') { voiceAction(action); return; }
    if (s.screen.kind === 'options') {
      // Back, or Options itself again (Q4 keeps it), closes Options.
      if (action === 'back' || action === 'primary') { dispatch({ type: 'screen', screen: { kind: 'talk' } }); play('control'); return; }
      if (action === 'page-prev' || action === 'page-next') {
        dispatch({ type: 'screen', screen: { ...s.screen, at: s.screen.at + (action === 'page-next' ? 1 : -1) } });
        play('control');
        return;
      }
      const word = action.startsWith('pick-') ? s.screen.words[Number(action.slice(5))] : undefined;
      if (word) {
        // Its rank in the word card's ranking, so Delete reopens the word at the one after it.
        const prediction = peek(requestOf(s));
        const index = prediction.words.findIndex((w) => w.word === word);
        const rank = index < 0 ? 0 : prediction.offset + index;
        commit(word, historyOf(s), s.composition.words.map((w) => w.text));
        dispatch({ type: 'accept-word', word, rank });
        play('word');
      }
      return;
    }
    if (s.screen.kind === 'menu') {
      if (action === 'back') {
        const up = parentOf(s.screen.page);
        if (up) page(up);
        else { dispatch({ type: 'screen', screen: { kind: 'talk' } }); play('control'); }
        return;
      }
      if (action.startsWith('open-')) {
        // My voice lists what the voice service holds now.
        if (action === 'open-voice') void refreshVoices();
        page(action.slice(5) as MenuPage);
        return;
      }
      if (action === 'voice-hear') { hear(s.settings.voiceId); return; }
      if (action === 'voice-new') {
        play('control');
        resetMaker();
        void refreshVoices();
        dispatch({ type: 'screen', screen: { kind: 'voice', step: 'intro', source: 'current', from: 'menu' } });
        return;
      }
      if (action === 'page-prev' || action === 'page-next') {
        dispatch({ type: 'screen', screen: { ...s.screen, at: (s.screen.at ?? 0) + (action === 'page-next' ? 1 : -1) } });
        play('control');
        return;
      }
      if (action === 'recalibrate') { play('control'); mouseOnly.current = false; dispatch({ type: 'screen', screen: { kind: 'calibration', then: 'talk' } }); return; }
      if (action === 'teach-sound') { play('control'); setTeachStep('room'); setTeachRun((n) => n + 1); dispatch({ type: 'screen', screen: { kind: 'teach' } }); return; }
      if (action.startsWith('set-')) changeSetting(action.slice(4) as SettingKey);
      return;
    }
    const { primary: shownPrimary, second: shownSecond, slots: intended } = shownRef.current;
    if (action === 'primary') {
      // An activation (dwell, key or click) on a label that changed underneath it does nothing
      // except bring the label up to date; the person acts on what they saw.
      if (shownPrimary.key !== primaryKey(intended.primary)) { markIgnored(action); resync(); return; }
      runPrimary(intended.primary);
      // The change this selection causes shows at once (Listen → Stop, Speak → Stop), except
      // after accepting a word or a suggestion: then Speak appears only once gaze has left
      // (MOTION.md "Word accepted").
      if (intended.primary.kind !== 'suggestion') resync();
    } else if (action === 'delete') {
      if (shownSecond.key !== secondKey(intended.second)) { markIgnored(action); resync(); return; }
      runSecond(intended.second);
      resync();
    } else if (/^G[1-4]$/.test(action) && intended.groups) {
      // Choosing a letter group is silent (owner, 2026-11-07: a note per letter was distracting).
      dispatch({ type: 'group', group: action as GroupId });
    }
  }, [getStarted, hear, leaveCalibration, resync, runPrimary, runSecond, startSpeaking, chooseKeyboardAndMouse, voiceAction]);

  useEffect(() => engine.subscribe((_snapshot, event) => {
    if (event?.type !== 'select') return;
    const byUser = userActivation.current === event.action;
    userActivation.current = null;
    // Tiles (subscribed earlier) have read the key flag for this event; clear it after.
    queueMicrotask(() => noteKeyActivation(false));
    if (!byUser && (isGuarded(event.action) || gazeOutside())) { markIgnored(event.action); return; }
    markIgnored(null);
    guardQuadrant(engine.snapshot.quadrant, event.action);
    onSelect(event.action);
  }), [onSelect]);

  const activate = useCallback((action: string) => {
    userActivation.current = action;
    engine.activate(action);
  }, []);

  // Debug hook for check-layout.mjs and for demos.
  useEffect(() => {
    window.clarteDebug = {
      phases: [...PHASES],
      phase: () => phaseOf(stateRef.current, wordsNow(stateRef.current)),
      setPhase: (name: string) => {
        if (!(PHASES as readonly string[]).includes(name)) throw new Error(`unknown phase ${name}`);
        speech.current?.cancel();
        resetScript();
        closeMic();
        const shown = makerFor(name as PhaseName);
        if (shown) showMaker(shown);
        dispatch({ type: 'replace', state: seedFor(name as PhaseName, stateRef.current) });
      },
      validate: validateNow,
      engine,
      eyes: eyesStatus,
      words: () => wordsNow(stateRef.current),
    };
    // `#phase=<name>` opens a phase directly, for demos and fresh-browser checks.
    const linked = /^#phase=([\w-]+)$/.exec(location.hash)?.[1];
    if (linked && (PHASES as readonly string[]).includes(linked)) window.clarteDebug.setPhase(linked);
  }, []);

  // "Replying" shows as soon as a reply is owed (the partner spoke last) or a draft exists, so the
  // partner sees a reply is coming before the first letter (BRIEF "Partner awareness").
  const status: StateName | null = live.kind === 'listening' ? 'listening'
    : live.kind === 'speaking' ? 'speaking'
    : (screen.kind === 'talk' || screen.kind === 'options') && (state.composition.words.length || state.composition.pending.length || (live.kind === 'quiet' && owedTurn(state))) ? 'composing'
    : null;

  const replayEnabled = screen.kind === 'talk' && live.kind !== 'speaking';
  let slotViews: Slots;
  let strip: Strip | null = null;
  let rest: ReactNode;
  let restKey: string;
  if (screen.kind === 'calibration') {
    // No card while the dots run: the onboarding card slides off to the right. A failure brings
    // back Try again as the tall card, and a way out in Q1.
    slotViews = calibrationFailure ? {
      q1: eyes.kind === 'run-failed' && eyes.fallback
        ? { action: 'keep-calibration', tone: 'surface', icon: <Back />, bodyKey: 'keep', body: <span className="card-label">Keep the old one</span> }
        : { action: 'use-mouse', tone: 'surface', icon: <Back />, bodyKey: 'mouse', body: <span className="card-label">Use the mouse</span> },
      q4: tallCard('calibrate-retry', 'Try again', <ArrowRight />),
    } : {};
    restKey = calibrationFailure ? 'calibration-failure' : 'calibration';
    rest = <Calibration failure={calibrationFailure} />;
  } else if (screen.kind === 'teach') {
    // One prompt at a time in the menu's title place; Back in Q1, and Done once the sound is in use.
    slotViews = {
      q1: backCard('Settings'),
      ...(teachStep === 'ready' ? { q4: tallCard('teach-done', 'Done', <Check />) } : teachStep === 'failed' ? { q4: tallCard('teach-retry', 'Try again', <ArrowRight />) } : {}),
    };
    restKey = 'teach';
    rest = (
      <>
        <div className="thread-behind" inert aria-hidden="true">
          <Thread state={null} turns={state.turns} live={live} composition={state.composition} word={typedWord} wordColours={settings.wordColours} onReplay={replayTurn} replayEnabled={replayEnabled} />
        </div>
        <section className="thread thread-title" aria-label="My sound">
          <p className="page-trail">{[...trailOf('settings'), 'My sound'].join(' › ')}</p>
          <TeachSound key={teachRun} onStep={setTeachStep} />
        </section>
      </>
    );
  } else if (screen.kind === 'welcome') {
    slotViews = welcomeSlots(autoStart);
    restKey = 'onboarding-welcome';
    rest = <WelcomePage />;
  } else if (screen.kind === 'voice') {
    const view = { step: screen.step, source: screen.source, maker, service: voices.service, note: voiceNote };
    slotViews = voiceSlots(view);
    restKey = `voice-${screen.step}`;
    rest = <VoicePage {...view} />;
  } else if (screen.kind === 'options') {
    // Options (owner, 2026-11-08) changes only Q1 and the bottom row: Back in Q1, and the words,
    // most likely first, in Q5–Q8 (paged when there are more). Q4 keeps the very card that opened
    // Options (same key, so it does not even re-animate); selecting it again closes Options. The
    // conversation stays exactly as it is, under the same key, so nothing blurs, moves or re-renders.
    const views = screen.words.map((word, i): SlotView => ({
      action: `pick-${i}`, tone: 'surface', icon: <Check />, label: `Accept ${word}`, bodyKey: `pick-${i}:${word}`,
      body: <span className="card-label is-word" style={{ ['--len' as string]: word.length }}>{word}</span>,
    }));
    const paged = pageList(views, screen.at, ['q5', 'q6', 'q7', 'q8']);
    const pFace = primaryFace(primary.value);
    slotViews = {
      q1: backCard('Home'),
      q4: { action: 'primary', tone: 'ink', icon: pFace.icon, label: pFace.name, bodyKey: primary.key, body: <FaceBody face={pFace} /> },
      ...paged.slots,
    };
    strip = paged.strip;
    restKey = 'thread';
    rest = <Thread state={status} turns={state.turns} live={live} composition={state.composition} word={typedWord} wordColours={settings.wordColours} onReplay={replayTurn} replayEnabled={replayEnabled} />;
  } else if (screen.kind === 'menu') {
    // The menu opens over the conversation, which stays in place, blurred.
    const paged = menuSlots(screen.page, settings, screen.at);
    slotViews = paged.slots;
    strip = paged.strip;
    const title = TITLES[screen.page];
    const trail = trailOf(screen.page);
    restKey = `title-${title}`;
    rest = (
      <>
        <div className="thread-behind" inert aria-hidden="true">
          <Thread state={null} turns={state.turns} live={live} composition={state.composition} word={typedWord} wordColours={settings.wordColours} onReplay={replayTurn} replayEnabled={replayEnabled} />
        </div>
        <section className="thread thread-title" aria-label={title}>
          {/* The path above the title (owner, 2026-11-08), once there is more than the page itself. */}
          {trail.length > 1 && <p className="page-trail">{trail.join(' › ')}</p>}
          <h1 className="page-title">{title}</h1>
        </section>
      </>
    );
  } else {
    const pFace = primaryFace(primary.value);
    const sFace = secondFace(second.value, state.composition.pending.length);
    const primaryView: SlotView = { action: 'primary', tone: 'ink', icon: pFace.icon, label: pFace.name, disabled: primary.value.kind === 'no-match', bodyKey: primary.key, body: <FaceBody face={pFace} /> };
    // Menu is white (owner, 2026-11-08); every other light card stays grey glass.
    const secondView: SlotView = { action: 'delete', tone: second.value.kind === 'menu' ? 'white' : 'surface', icon: sFace.icon ?? undefined, label: sFace.name, disabled: second.value.kind === 'none', bodyKey: second.key, body: <FaceBody face={sFace} /> };
    // Owner, 2026-11-08: the primary card (Listen, Stop, Speak, the word, Options) always sits in Q4
    // and the second (Menu, Wait!, Delete) in Q1, so each action keeps one place: Listen turns into
    // Stop, and Speak into Stop, where they were; Menu opens where its Back button will be.
    slotViews = { q1: secondView, q4: primaryView };
    for (const id of GROUP_IDS) {
      slotViews[GROUP_QUADRANT[id]] = {
        action: id, tone: 'group', group: id, disabled: !slots.groups, bodyKey: id,
        body: <>
          <span className="letters">{halves(groupLetters(id, '')).map((h, i) => <span key={i}>{h}</span>)}</span>
        </>,
      };
    }
    restKey = 'thread';
    rest = <Thread state={status} turns={state.turns} live={live} composition={state.composition} word={typedWord} wordColours={settings.wordColours} onReplay={replayTurn} replayEnabled={replayEnabled} />;
  }

  // The companion (owner, 2026-11-08) floats at the centre only while the middle holds no text at
  // all: no history, no words heard, no message typed, nothing spoken, no menu title. Any text sends
  // it to dock at Q2's top-left.
  const composing = state.composition.words.length > 0 || state.composition.pending.length > 0;
  const liveText = (live.kind === 'listening' && live.transcript.trim() !== '') || live.kind === 'speaking' || composing;
  const blank = screen.kind === 'talk' && !liveText && state.turns.length === 0;
  const still = settings.orbMotion === 'still';
  // The Cloud (NAT-42) takes the conversation's state as its mood, and pulses on each word heard or spoken.
  const mood: OrbMood = screen.kind !== 'talk' && screen.kind !== 'options' ? 'idle'
    : status === 'listening' ? 'listening' : status === 'speaking' ? 'speaking' : status === 'composing' ? 'composing' : 'idle';
  const pulse = live.kind === 'listening' ? (live.transcript.match(/\S+/g)?.length ?? 0) : live.kind === 'speaking' ? live.word + 1 : 0;
  // Once a turn has joined the history, its feeling shows on the Cloud's face.
  const newest = state.turns[state.turns.length - 1];
  const finished = live.kind === 'quiet' || live.kind === 'spoken';
  const feeling = finished && newest && !newest.holder ? reactionFor(newest.text) : null;
  const reaction = feeling && newest ? { key: `reaction-${newest.id}`, kind: feeling } : null;

  return (
    <Stage id="app">
      {screen.kind === 'welcome' || screen.kind === 'voice' || screen.kind === 'calibration'
        ? <GuideOrb calibrating={screen.kind === 'calibration'} still={still} />
        : <Companion visible={blank} still={still} mood={mood} pulse={pulse} listening={live.kind === 'listening'} reaction={reaction} />}
      <Board slots={slotViews} screen={restKey} activate={activate} />
      <RestZone id={restKey}>{rest}</RestZone>
      {strip && <PagedStrip strip={strip} activate={activate} />}
    </Stage>
  );
}

const SLOT_NAMES: SlotName[] = ['q1', 'q4', 'q5', 'q6', 'q7', 'q8'];

/**
 * The six cards persist across the conversation and the menu, keyed by quadrant: a screen change
 * transitions each card in place (its face colour over 300 ms, its content by a 150 ms fade)
 * instead of cross-fading two copies, so a shared surface never passes through the canvas and
 * no bloom restarts on a copy. A quadrant with no action on this screen fades its card away.
 */
function Board({ slots, screen, activate }: { slots: Slots; screen: string; activate: (action: string) => void }) {
  const last = useRef<Slots>(slots);
  for (const q of SLOT_NAMES) if (slots[q]) last.current[q] = slots[q];
  // A face change on the same screen (the candidate while typing) is frequent: it takes the fast
  // label cross-fade. A change of screen takes the page choreography.
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
              <Tile action={view.action} tone={view.tone} group={view.group} icon={view.icon} label={view.label} disabled={view.disabled} gone={!slots[q]} fast={fast} onActivate={activate} className={`${view.span ? 'card-span' : ''} ${view.className ?? ''}`}>
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
      eyes: typeof eyesStatus;
      words(): ReturnType<typeof wordsNow>;
    };
  }
}
