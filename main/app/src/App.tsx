/**
 * Style 8: style 7's grid with the owner's mesh-gradient companion (Companion.tsx) in place of the
 * Cloud, there only while the middle is blank, and a Soft or Vibrant palette (variant.ts).
 * Style 6's notes follow.
 *
 * Style 6 · Orb (owner concept, 2026-11-07), built on style 5 · Dialogue's grid and engine.
 *
 * The conversation screen keeps style 5's quadrants and adds the companion (Companion.tsx) behind the thread
 * in the Q2–Q3 rest zone, an Options screen for word conflicts, and a report-style
 * first-run setup (Setup.tsx).
 *
 * Q1 is the contextual primary slot, Q4 the contextual delete slot, Q2–Q3 a rest zone holding
 * the conversation thread, Q5–Q8 the letter groups. Every activation (dwell, digit key, click,
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
  type CalibrationStep,
  type MenuPage,
  type PrimaryFn,
  type SecondFn,
  type Settings,
  type State,
} from './model.ts';
import { Tile, type SlotName, type SlotView, type Slots } from './Tile.tsx';
import { Thread, type StateName } from './Thread.tsx';
import { TITLES, backCard, menuSlots, nextValue, parentOf, trailOf, type SettingKey } from './Menu.tsx';
import { shownWord } from './words.ts';
import { useWords, wordsNow } from './useWords.ts';
import { commit, peek } from './prediction/prediction.ts';
import { Calibration } from './Calibration.tsx';
import { PHASES, seedFor, type PhaseName } from './debug.ts';
import { listenToPartner, resetScript, speakWords, type Speech } from './voice.ts';
import { configureSound, duck, play, unlockOnGesture } from './core/sound.ts';
import { longest, sentence } from './text.ts';
import { fitCards } from './fit.ts';
import { Swap } from './Swap.tsx';
import { Companion } from './Companion.tsx';
import { PagedStrip, pageList, type Strip } from './Pager.tsx';
import { OptionsFace } from './OptionsFace.tsx';
import { SetupReport, openVoiceApp, setupSlots, useVoiceReport } from './Setup.tsx';
import { SETUP_STEPS } from './model.ts';
import { Again, Backspace, Check, Erase, Close, Hand, MenuLines, Mic, Options, Sparkle, Speaker, StopSquare } from './icons.tsx';

const SAY_AGAIN_MS = 6000;
/** "More" walks the three settings pages in a loop. */
// Style 8 (owner, 2026-11-07): the floor-holder is "Wait!" (style 7: "One moment").
const HOLDER = "Wait! I'm answering.";
const STORE = 'clarte.style8.v1';

function loadStored(): State {
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  const skip = new URLSearchParams(location.search).get('onboarding') === 'off';
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return skip ? { ...INITIAL_STATE, screen: { kind: 'talk' } } : INITIAL_STATE;
    const saved = JSON.parse(raw) as { settings?: Partial<Settings>; setupDone?: boolean };
    return {
      ...INITIAL_STATE,
      settings: migrate({ ...INITIAL_STATE.settings, ...saved.settings }),
      screen: saved.setupDone || skip ? { kind: 'talk' } : INITIAL_STATE.screen,
    };
  } catch {
    return INITIAL_STATE;
  }
}

/** Settings saved before NAT-24 stored `sound` as on/off. */
function migrate(settings: Settings): Settings {
  const sound = settings.sound as Settings['sound'] | boolean;
  if (sound === true) return { ...settings, sound: 'all' };
  if (sound === false) return { ...settings, sound: 'off' };
  return settings;
}

function setupDone(): boolean {
  try { return Boolean(JSON.parse(localStorage.getItem(STORE) ?? '{}').setupDone); } catch { return false; }
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
    case 'candidate': return { icon: <Check />, label: <span className="card-label is-word" style={{ ['--len' as string]: fn.word.length }}>{fn.word}</span>, hint: 'Accept' };
    case 'no-match': return { icon: <Check />, label: 'No word' };
    case 'speak': return { icon: <Speaker />, label: 'Speak' };
    case 'stop-speaking': return { icon: <StopSquare />, label: 'Stop' };
    case 'say-again': return { icon: <Again />, label: 'Say again' };
    // Owner, 2026-11-08: "Options" at the bottom, the three most likely words above it, reordering
    // like a live leaderboard as typing changes them (OptionsFace.tsx).
    case 'options': return {
      icon: <Options />,
      name: `Options: ${fn.top.join(', ')}${fn.more ? ', and more' : ''}`,
      label: <OptionsFace top={fn.top} more={fn.more} />,
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

const GROUP_QUADRANT: Record<GroupId, SlotName> = { G1: 'q5', G2: 'q6', G3: 'q7', G4: 'q8' };

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
  const words = useWords(state);
  const slots = slotsFor(state, words);
  const shown = shownWord(state.composition, words.prediction)?.word ?? null;
  const voiceReport = useVoiceReport(screen.kind === 'setup' && screen.step === 'voice', screen.kind === 'setup' && Boolean(screen.sample));
  // Bumped when an activation landed on a stale label, so the label catches up at once.
  const [syncs, setSyncs] = useState(0);
  const resync = useCallback(() => setSyncs((n) => n + 1), []);
  const primary = useSettled('primary', primaryKey(slots.primary), slots.primary, looked, syncs);

  // No word fits the groups typed so far: a soft "not yet", a second late, and only if it lasts.
  const noMatch = slots.primary.kind === 'no-match';
  useEffect(() => {
    if (!noMatch) return;
    const timer = setTimeout(() => play('unsure'), 1000);
    return () => clearTimeout(timer);
  }, [noMatch]);
  const second = useSettled('delete', secondKey(slots.second), slots.second, looked, syncs);

  // Settings → engine, document and audio (before paint, so a new text size never shows unfitted).
  useLayoutEffect(() => {
    engine.configure({ mode: settings.mode, noiseSigma: settings.noise ? 0.06 : 0 });
    setDwellClasses(settings.letterDwell, settings.controlDwell, screen.kind === 'talk', settings.repeat);
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
      attachPointerStream(engine),
      startTicking(engine),
      unlockOnGesture(),
      // In development the overlay tracks actionables itself (main.tsx); here for production builds.
      import.meta.env.DEV ? () => {} : trackActionables(engine),
    ];
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
        userActivation.current = action;
        noteKeyActivation(true);
        suppressMotionBriefly();
        engine.activate(action, e.timeStamp);
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
    const s = speakWords(speakText, (word) => dispatch({ type: 'speak-word', token: speakToken, word }));
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

  const startSpeaking = useCallback((text: string, turnId: number | null, holder: boolean) => {
    token.current += 1;
    dispatch({ type: 'speak-start', text, turnId, holder, token: token.current });
  }, []);

  const runPrimary = useCallback((fn: PrimaryFn) => {
    const s = stateRef.current;
    switch (fn.kind) {
      case 'listen': token.current += 1; dispatch({ type: 'listen-start', token: token.current }); play('listen-start'); return;
      case 'stop-listening': dispatch({ type: 'listen-stop' }); play('listen-stop'); return;
      case 'suggestion': dispatch({ type: 'use-suggestion', text: fn.text }); play('word'); return;
      case 'candidate':
        commit(fn.word, historyOf(s), s.composition.words.map((w) => w.text));
        dispatch({ type: 'accept', word: fn.word, rank: fn.rank });
        play('word');
        return;
      case 'options': dispatch({ type: 'screen', screen: { kind: 'options', at: 0 } }); play('control'); return;
      case 'no-match': return;
      case 'speak': startSpeaking(sentence(messageText(s.composition)), null, false); return;
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

  // Calibration returns to the setup report until setup is finished, then to the conversation.
  const finishCalibration = useCallback(() => {
    play('calibrated');
    dispatch({ type: 'calibrated', at: Date.now() });
    dispatch({ type: 'screen', screen: setupDone() ? { kind: 'talk' } : { kind: 'setup', step: 'eyes' } });
  }, []);
  const calibrationStep = useCallback((step: CalibrationStep) => dispatch({ type: 'screen', screen: { kind: 'calibration', step } }), []);

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
    if (s.screen.kind === 'calibration') { if (action === 'start') finishCalibration(); return; }
    if (s.screen.kind === 'setup') {
      const at = SETUP_STEPS.indexOf(s.screen.step);
      const go = (i: number) => { dispatch({ type: 'screen', screen: { kind: 'setup', step: SETUP_STEPS[i] } }); play('control'); };
      if (action === 'setup-back') { go(Math.max(0, at - 1)); return; }
      if (action === 'setup-next') { go(Math.min(SETUP_STEPS.length - 1, at + 1)); return; }
      if (action === 'setup-calibrate') { play('control'); dispatch({ type: 'screen', screen: { kind: 'calibration', step: 'position' } }); return; }
      if (action === 'setup-voice-app') { play('control'); openVoiceApp(); return; }
      if (action === 'setup-start') { play('control'); store({ setupDone: true }); dispatch({ type: 'screen', screen: { kind: 'talk' } }); return; }
      if (action.startsWith('set-')) changeSetting(action.slice(4) as SettingKey);
      return;
    }
    if (s.screen.kind === 'options') {
      if (action === 'back') { dispatch({ type: 'screen', screen: { kind: 'talk' } }); play('control'); return; }
      if (action === 'page-prev' || action === 'page-next') {
        dispatch({ type: 'screen', screen: { kind: 'options', at: s.screen.at + (action === 'page-next' ? 1 : -1) } });
        play('control');
        return;
      }
      const word = action.startsWith('pick-') ? wordsNow(s).options[Number(action.slice(5))] : undefined;
      if (word) {
        // Its rank in the word card's ranking, so Delete reopens the word at the one after it.
        const rank = Math.max(0, peek(requestOf(s)).words.findIndex((w) => w.word === word));
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
      if (action.startsWith('open-')) { page(action.slice(5) as MenuPage); return; }
      if (action === 'page-prev' || action === 'page-next') {
        dispatch({ type: 'screen', screen: { ...s.screen, at: (s.screen.at ?? 0) + (action === 'page-next' ? 1 : -1) } });
        play('control');
        return;
      }
      if (action === 'recalibrate') { play('control'); dispatch({ type: 'screen', screen: { kind: 'calibration', step: 'position' } }); return; }
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
      if (intended.primary.kind !== 'candidate' && intended.primary.kind !== 'suggestion') resync();
    } else if (action === 'delete') {
      if (shownSecond.key !== secondKey(intended.second)) { markIgnored(action); resync(); return; }
      runSecond(intended.second);
      resync();
    } else if (/^G[1-4]$/.test(action) && intended.groups) {
      // Choosing a letter group is silent (owner, 2026-11-07: a note per letter was distracting).
      dispatch({ type: 'group', group: action as GroupId });
    }
  }, [finishCalibration, resync, runPrimary, runSecond, startSpeaking]);

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
        dispatch({ type: 'replace', state: seedFor(name as PhaseName, stateRef.current) });
      },
      validate: validateNow,
      engine,
    };
    // `#phase=<name>` opens a phase directly, for demos and fresh-browser checks.
    const linked = /^#phase=([\w-]+)$/.exec(location.hash)?.[1];
    if (linked && (PHASES as readonly string[]).includes(linked)) window.clarteDebug.setPhase(linked);
  }, []);

  if (screen.kind === 'calibration') {
    // Keyed by step: each step starts from its own first point (the point list changes length).
    return (
      <Stage id={`calibration-${screen.step === 'ready' ? 'ready' : 'run'}`}>
        <Calibration key={screen.step} step={screen.step} onStep={calibrationStep} onDone={finishCalibration} activate={activate} />
      </Stage>
    );
  }

  // "Replying" shows as soon as a reply is owed (the partner spoke last) or a draft exists, so the
  // partner sees a reply is coming before the first letter (BRIEF "Partner awareness").
  const status: StateName | null = live.kind === 'listening' ? 'listening'
    : live.kind === 'speaking' ? 'speaking'
    : screen.kind === 'talk' && (state.composition.words.length || state.composition.pending.length || (live.kind === 'quiet' && owedTurn(state))) ? 'composing'
    : null;

  let slotViews: Slots;
  let strip: Strip | null = null;
  let rest: ReactNode;
  let restKey: string;
  if (screen.kind === 'setup') {
    const ctx = { step: screen.step, settings, calibratedAt: state.calibratedAt, voice: voiceReport };
    slotViews = setupSlots(ctx);
    restKey = `setup-${screen.step}`;
    rest = <SetupReport ctx={ctx} />;
  } else if (screen.kind === 'menu' || screen.kind === 'options') {
    // The menu and Options open over the conversation, which stays in place, blurred.
    let title: string;
    let trail: string[] = [];
    if (screen.kind === 'menu') {
      const paged = menuSlots(screen.page, settings, screen.at);
      slotViews = paged.slots;
      strip = paged.strip;
      title = TITLES[screen.page];
      trail = trailOf(screen.page);
    } else {
      // Options (owner, 2026-11-08): the most likely word in Q5, then Q6, Q7, Q8, and a fifth in Q4.
      const views = words.options.map((word, i): SlotView => ({
        action: `pick-${i}`, tone: 'surface', icon: <Check />, label: `Accept ${word}`, bodyKey: `pick-${i}:${word}`,
        body: <span className="card-label is-word" style={{ ['--len' as string]: word.length }}>{word}</span>,
      }));
      const paged = pageList(views, screen.at, ['q5', 'q6', 'q7', 'q8', 'q4']);
      slotViews = { q1: backCard('Home'), ...paged.slots };
      strip = paged.strip;
      title = 'Options';
    }
    restKey = `title-${title}`;
    rest = (
      <>
        <div className="thread-behind" inert aria-hidden="true">
          <Thread state={null} turns={state.turns} live={live} composition={state.composition} word={shown} wordColours={settings.wordColours} />
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
    rest = <Thread state={status} turns={state.turns} live={live} composition={state.composition} word={shown} wordColours={settings.wordColours} />;
  }

  // The companion (owner, 2026-11-08) floats at the centre only while the middle holds no text at
  // all: no history, no words heard, no message typed, nothing spoken, no menu title. Any text sends
  // it to dock at Q2's top-left.
  const composing = state.composition.words.length > 0 || state.composition.pending.length > 0;
  const liveText = (live.kind === 'listening' && live.transcript.trim() !== '') || live.kind === 'speaking' || composing;
  const blank = screen.kind === 'talk' && !liveText && state.turns.length === 0;
  const still = settings.orbMotion === 'still';

  return (
    <Stage id="app" surface={screen.kind === 'setup' ? 'report' : 'talk'}>
      {screen.kind !== 'setup' && <Companion visible={blank} still={still} />}
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
              <Tile action={view.action} tone={view.tone} group={view.group} icon={view.icon} label={view.label} disabled={view.disabled} gone={!slots[q]} fast={fast} onActivate={activate} className={`${slots[q]?.span ? 'card-span' : ''} ${slots[q]?.className ?? ''}`}>
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
    };
  }
}
