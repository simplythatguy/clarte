import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GazeEngine, type GazeSnapshot, type GazeEvent } from '../../shared/gaze.ts';
import { mountOverlay, trackActionables } from '../../shared/overlay.ts';
import { collectActionables, validateLayout, viewportOf, type QuadrantId } from '../../shared/quadrants.ts';
import { EMPTY_COMPOSITION, reduce, type ComposerEvent } from '../../shared/composer.ts';
import type { GroupId } from '../../shared/decoder.ts';
import { DEMO_UTTERANCES, canListenLive, listen, type ListenSession } from '../../shared/speech.ts';
import {
  CONTROL_STEPS, DEFAULT_SETTINGS, LETTER_STEPS, PHRASES, STATE_LABEL, TEXT_SCALES,
  conversationState, cycle, displayWords, dwellClass, quadrantsOfTile, spelledWord, tilesFor,
  type CalibrationStep, type MenuFrom, type MenuPage, type Model, type Settings, type Stage, type Tile,
} from './model.ts';
import { createDwellPainter } from './dwell.ts';
import { earcons, say, unlockAudio, type Voice } from './voice.ts';
import { listenLive } from './listen.ts';
import { Screen, type Problem, type ScreenView } from './Screen.tsx';
import { PHASES, fixtureFor, phaseName } from './debug.ts';


const CALIBRATED_KEY = 'clarte.style3.calibrated';
const LOCKOUT_MS = 400;
/** Outgoing and incoming layers cross-fade over the same 300 ms (CSS). */
const EXIT_MS = 300;
const FLOOR_HOLDER = "One moment, I'm answering.";
const GUARD_RELEASE_MS = 200;

function initialModel(): Model {
  let calibrated = false;
  try { calibrated = localStorage.getItem(CALIBRATED_KEY) === '1'; } catch { /* private window */ }
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  if (new URLSearchParams(location.search).get('onboarding') === 'off') calibrated = true;
  return {
    stage: calibrated ? { kind: 'compose' } : { kind: 'calibrate', step: 'position' },
    composition: EMPTY_COMPOSITION,
    turn: '',
    turns: 0,
    said: '',
    settings: {
      ...DEFAULT_SETTINGS,
      // ?partner=script picks the scripted partner explicitly (demos, automated walks).
      partner: new URLSearchParams(location.search).get('partner') === 'script' || !canListenLive() ? 'script' : 'microphone',
    },
    fresh: null,
    spelled: '',
  };
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z']+/).filter(Boolean);

export function App() {
  const engine = useMemo(() => new GazeEngine({ mode: 'dwell', dwellMs: DEFAULT_SETTINGS.controlMs }), []);
  const [model, setModel] = useState<Model>(initialModel);
  const modelRef = useRef(model);
  const update = (fn: (m: Model) => Model) => { modelRef.current = fn(modelRef.current); setModel(modelRef.current); };

  // The live layer shows `model.stage`; the outgoing layer is a frozen copy of the last frame.
  const shown = model.stage;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [layerKey, setLayerKey] = useState(0);
  const layerKeyRef = useRef(0);
  const [instant, setInstant] = useState(true);
  const [leaving, setLeaving] = useState<{ key: number; view: ScreenView } | null>(null);
  const lastView = useRef<ScreenView | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  /** Quadrants the deciding look covered; inert until gaze has been outside them for GUARD_RELEASE_MS. */
  const [guard, setGuard] = useState<readonly QuadrantId[]>([]);
  const guardRef = useRef<{ quadrants: readonly QuadrantId[]; outsideSince: number | null } | null>(null);
  /** How the next engine selection was made: a key or click is not a look and needs no guard. */
  const sourceRef = useRef<'gaze' | 'key'>('gaze');
  const focusQuadrant = useRef<QuadrantId | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [voiceWord, setVoiceWord] = useState(-1);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceRef = useRef<Voice | null>(null);
  const frozenRef = useRef(false);
  const [frozenAt, setFrozenAt] = useState<number | undefined>(undefined);
  const stageRef = useRef<HTMLElement>(null);
  const painterRef = useRef<ReturnType<typeof createDwellPainter> | null>(null);
  /** The tile under the look, frozen as it was when the look arrived: nothing relabels under an
      armed target (MOTION "Word accepted"; HIG "freeze the candidate under an armed dwell"). */
  const [armed, setArmed] = useState<Tile | null>(null);
  const armedRef = useRef<string | null>(null);
  const armedContext = useRef<string[] | null>(null);
  /** Which scripted partner line plays next; each listening session continues the script. */
  const scriptLine = useRef(0);
  const phaseApplied = useRef(false);
  /** A failure the person must see: speech that did not play, or a microphone that cannot listen. */
  const [problem, setProblem] = useState<Problem | null>(null);
  /** Native clicks that follow a key the keyboard handler already acted on are ignored. */
  const keyHandledAt = useRef(-Infinity);

  const context = useMemo(() => [...wordsOf(model.turn), ...model.composition.words.map((w) => w.text)], [model.turn, model.composition.words]);
  const tiles = tilesFor({ stage: shown, composition: model.composition, context, settings: model.settings, spelled: model.spelled });
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  const sound = (kind: keyof typeof earcons) => { if (modelRef.current.settings.sound) earcons[kind](); };

  const clearGuard = () => { guardRef.current = null; setGuard([]); };

  /* Stage changes: one 300 ms cross-fade of the two layers, opacity only; targets inert for 400 ms.
     A change made by a look (or by the app while the person is looking, as when speech ends) also
     guards every quadrant of the tile that look was on, until gaze has left them for
     GUARD_RELEASE_MS (D4). `inPlace` swaps tiles within the same screen (Spell: groups ⇄ letters):
     no cross-fade and no stage earcon, the tiles keep their elements and their labels cross-fade;
     the lockout and the guard still apply. */
  const go = (next: Stage, opts: { source?: 'gaze' | 'key'; instant?: boolean; keepProblem?: boolean; inPlace?: boolean } = {}) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!opts.keepProblem) setProblem(null);
    const previous = lastView.current;
    update((m) => ({ ...m, stage: next }));
    shownRef.current = next;
    engine.cancel();
    const outgoingKey = layerKeyRef.current;
    if (!opts.inPlace) {
      layerKeyRef.current += 1;
      setLayerKey(layerKeyRef.current);
    }
    if (opts.instant) {
      setInstant(true);
      setLeaving(null);
      lockedRef.current = false; setLocked(false);
      clearGuard();
      return;
    }
    setInstant(false);
    if (previous && !opts.inPlace) {
      // Same key as when it was live: React keeps the element, so its opacity transitions 1 → 0.
      const key = outgoingKey;
      setLeaving({ key, view: previous });
      timers.current.push(setTimeout(() => setLeaving((l) => (l?.key === key ? null : l)), EXIT_MS + 20));
    }
    if (!opts.inPlace) sound('stage');
    lockedRef.current = true; setLocked(true);
    const q = (opts.source ?? 'gaze') === 'gaze' ? engine.snapshot.quadrant : null;
    if (q) {
      const deciding = tilesRef.current.find((t) => quadrantsOfTile(t).includes(q));
      const quadrants = [...new Set([q, ...(deciding ? quadrantsOfTile(deciding) : [])])];
      guardRef.current = { quadrants, outsideSince: null };
      setGuard(quadrants);
    } else clearGuard();
    const active = document.activeElement as HTMLElement | null;
    focusQuadrant.current = active?.dataset.action && active.matches(':focus-visible') ? (active.dataset.at as QuadrantId) : null;
    timers.current.push(
      setTimeout(() => {
        lockedRef.current = false; setLocked(false);
        // Keyboard users keep their place: focus returns to the tile in the same quadrant.
        const q = focusQuadrant.current;
        if (q) requestAnimationFrame(() => {
          const tile = tilesRef.current.find((t) => quadrantsOfTile(t).includes(q)) ?? tilesRef.current[0];
          if (tile) stageRef.current?.querySelector<HTMLElement>(`[data-action="${tile.id}"]`)?.focus();
        });
      }, LOCKOUT_MS),
    );
  };

  const stopVoice = () => { voiceRef.current?.cancel(); voiceRef.current = null; setVoiceActive(false); };

  const voiceFailed = () => { setProblem('voice'); sound('error'); };

  /** Speak the message. On failure return to where Speak was chosen, with the problem shown. */
  const speakMessage = (text: string, back: 'speak' | 'spoken') => {
    stopVoice();
    setVoiceWord(0);
    setVoiceActive(true);
    const voice = say(text, setVoiceWord);
    voiceRef.current = voice;
    void voice.done.then((result) => {
      if (voiceRef.current !== voice) return;
      voiceRef.current = null;
      setVoiceActive(false);
      if (modelRef.current.stage.kind !== 'speaking') return;
      // The person may still be looking at Speak: the end of speech is guarded like a look.
      if (result === 'ended') go({ kind: 'spoken' }, { source: 'gaze' });
      else if (result === 'failed') { go({ kind: back }, { source: 'gaze', keepProblem: true }); voiceFailed(); }
    });
  };

  const holdFloor = () => {
    stopVoice();
    setVoiceActive(true);
    const voice = say(FLOOR_HOLDER);
    voiceRef.current = voice;
    void voice.done.then((result) => {
      if (voiceRef.current !== voice) return;
      voiceRef.current = null;
      setVoiceActive(false);
      if (result === 'failed') voiceFailed();
    });
  };

  const compose = (event: ComposerEvent) => {
    update((m) => {
      // Accept commits exactly what the frozen tile showed: the context of the moment the look arrived.
      const frozen = event.type === 'accept' && armedRef.current === 'accept' ? armedContext.current : null;
      const ctx = frozen ?? [...wordsOf(m.turn), ...m.composition.words.map((w) => w.text)];
      const before = m.composition;
      const composition = reduce(before, event, ctx);
      const accepted = event.type === 'accept' && composition.words.length > before.words.length;
      return {
        ...m,
        composition,
        fresh: accepted ? { index: composition.words.length - 1, groups: before.pending, key: Date.now() } : null,
      };
    });
    // The leaving tokens are only there for the 180 ms cross-fade.
    const key = modelRef.current.fresh?.key;
    if (key) setTimeout(() => update((m) => (m.fresh?.key === key ? { ...m, fresh: null } : m)), 240);
  };

  const setSetting = (patch: Partial<Settings>) => update((m) => ({ ...m, settings: { ...m.settings, ...patch } }));

  const select = (id: string, source: 'gaze' | 'key') => {
    if (lockedRef.current) return;
    // Motion is for looks; keyboard and click actions change state with no motion (MOTION).
    if (document.documentElement.dataset.input !== source) document.documentElement.dataset.input = source;
    const tile = tilesRef.current.find((t) => t.id === id);
    if (!tile || tile.disabled) return;
    frozenRef.current = false;
    if (!/^(G[1-4]|letter-.)$/.test(id)) setProblem(null);
    setFrozenAt(undefined);
    const gaze = source;
    const m = modelRef.current;
    const stage = shownRef.current;
    const c = m.composition;
    switch (stage.kind) {
      case 'calibrate':
        if (id === 'start') finishCalibration(source);
        return;
      case 'listen':
        if (id === 'done-listening') go({ kind: 'compose' }, { source: gaze });
        return;
      case 'compose':
        if (/^G[1-4]$/.test(id)) { compose({ type: 'group', group: id as GroupId }); sound('commit'); return; }
        if (id === 'accept') {
          if (c.pending.length) { compose({ type: 'accept' }); sound('commit'); }
          else if (c.words.length) go({ kind: 'speak' }, { source: gaze });
          else go({ kind: 'listen' }, { source: gaze });
          return;
        }
        if (id === 'delete') {
          if (c.pending.length || c.words.length) { compose({ type: 'delete' }); sound('remove'); }
          else go({ kind: 'menu', page: 'menu', from: 'compose' }, { source: gaze });
        }
        return;
      case 'speak':
        if (id === 'edit') go({ kind: 'compose' }, { source: gaze });
        else if (id === 'moment') { holdFloor(); sound('commit'); }
        else if (id === 'menu') go({ kind: 'menu', page: 'menu', from: 'speak' }, { source: gaze });
        else if (id === 'speak') {
          const text = displayWords(c.words).join(' ');
          update((x) => ({ ...x, said: text }));
          go({ kind: 'speaking' }, { source: gaze });
          speakMessage(text, 'speak');
        }
        return;
      case 'speaking':
        if (id === 'stop') { stopVoice(); go({ kind: 'spoken' }, { source: gaze }); }
        return;
      case 'spoken':
        if (id === 'listen') {
          update((x) => ({ ...x, composition: EMPTY_COMPOSITION, turn: '', turns: x.turns + 1, fresh: null }));
          go({ kind: 'listen' }, { source: gaze });
        } else if (id === 'again') { go({ kind: 'speaking' }, { source: gaze }); speakMessage(m.said, 'spoken'); }
        else if (id === 'more') go({ kind: 'compose' }, { source: gaze });
        else if (id === 'menu') go({ kind: 'menu', page: 'menu', from: 'spoken' }, { source: gaze });
        return;
      case 'spell':
        spellSelect(id, stage, gaze);
        return;
      case 'menu':
        menuSelect(id, stage.page, stage.from, gaze);
    }
  };

  const spellSelect = (id: string, stage: Extract<Stage, { kind: 'spell' }>, gaze: 'gaze' | 'key') => {
    const groups = { kind: 'spell', group: null, half: 0 } as const;
    // Groups ⇄ letters is one screen: the tiles swap in place (DESIGN "Changes after council round 4").
    const swap = (next: Stage) => go(next, { source: gaze, inPlace: true });
    if (/^G[1-4]$/.test(id)) { swap({ kind: 'spell', group: id as GroupId, half: 0 }); return; }
    if (id.startsWith('letter-')) {
      update((m) => ({ ...m, spelled: m.spelled + id.slice(7) }));
      sound('commit');
      swap(groups);
      return;
    }
    switch (id) {
      case 'spell-other': swap({ ...stage, half: stage.half === 0 ? 1 : 0 }); return;
      case 'spell-back': swap(groups); return;
      case 'spell-delete':
        if (modelRef.current.spelled) { update((m) => ({ ...m, spelled: m.spelled.slice(0, -1) })); sound('remove'); }
        else go({ kind: 'compose' }, { source: gaze });
        return;
      case 'spell-add': {
        const word = spelledWord(modelRef.current.spelled);
        update((m) => ({ ...m, spelled: '' }));
        compose({ type: 'phrase', text: word });
        go({ kind: 'compose' }, { source: gaze });
      }
    }
  };

  const menuSelect = (id: string, page: MenuPage, from: MenuFrom, gaze: 'gaze' | 'key') => {
    const s = modelRef.current.settings;
    const back = () => go({ kind: from }, { source: gaze });
    if (id.startsWith('page-')) { go({ kind: 'menu', page: id.slice(5) as MenuPage, from }, { source: gaze }); return; }
    switch (id) {
      case 'back': if (page === 'menu') back(); else go({ kind: 'menu', page: 'menu', from }, { source: gaze }); return;
      case 'moment': holdFloor(); back(); return;
      case 'recalibrate': go({ kind: 'calibrate', step: 'position' }, { source: gaze }); return;
      case 'spell': update((m) => ({ ...m, spelled: '' })); go({ kind: 'spell', group: null, half: 0 }, { source: gaze }); return;
      case 'clear': update((m) => ({ ...m, composition: EMPTY_COMPOSITION, fresh: null })); go({ kind: 'compose' }, { source: gaze }); return;
      case 'phrase-yes': case 'phrase-no': case 'phrase-help':
        // From Spoken a phrase starts a new message; elsewhere it joins the one being written.
        if (from === 'spoken') update((m) => ({ ...m, composition: EMPTY_COMPOSITION, fresh: null }));
        compose({ type: 'phrase', text: PHRASES[id] });
        go({ kind: 'compose' }, { source: gaze });
        return;
      case 'letter-speed': setSetting({ letterMs: cycle(LETTER_STEPS.map((x) => x.ms), s.letterMs) }); break;
      case 'control-speed': setSetting({ controlMs: cycle(CONTROL_STEPS.map((x) => x.ms), s.controlMs) }); break;
      case 'text-size': setSetting({ textScale: cycle(TEXT_SCALES, s.textScale) }); break;
      case 'theme': setSetting({ theme: s.theme === 'light' ? 'dark' : 'light' }); break;
      case 'sound': setSetting({ sound: !s.sound }); break;
      case 'word-colours': setSetting({ wordColours: !s.wordColours }); break;
      case 'mode': setSetting({ mode: s.mode === 'dwell' ? 'confirm' : 'dwell' }); break;
      case 'repeat': setSetting({ repeat: s.repeat === 'leave' ? 'redwell' : 'leave' }); break;
      case 'noise': setSetting({ noise: !s.noise }); break;
      case 'partner': setSetting({ partner: s.partner === 'microphone' ? 'script' : 'microphone' }); break;
      default: return;
    }
    sound('commit');
  };

  const finishCalibration = (source: 'gaze' | 'key') => {
    try { localStorage.setItem(CALIBRATED_KEY, '1'); } catch { /* private window */ }
    go({ kind: 'compose' }, { source });
  };

  const selectRef = useRef(select);
  selectRef.current = select;
  const finishRef = useRef(finishCalibration);
  finishRef.current = finishCalibration;

  /* Gaze engine: pointer as gaze, dwell painting, per-class dwell, the post-stage guard. */
  useEffect(() => {
    const painter = createDwellPainter(() => stageRef.current);
    painterRef.current = painter;
    const listener = (snap: GazeSnapshot, event?: GazeEvent) => {
      const id = snap.action;
      if (id && (snap.state === 'dwelling' || snap.state === 'selected')) {
        // Per-class dwell and repeat: letters may redwell (double letters); controls never repeat.
        const s = modelRef.current.settings;
        const letter = dwellClass(id) === 'letter';
        const dwellMs = letter ? s.letterMs : s.controlMs;
        const repeat = letter ? s.repeat : 'leave';
        if (engine.settings.dwellMs !== dwellMs || engine.settings.repeat !== repeat) engine.settings = { ...engine.settings, dwellMs, repeat };
      }
      const g = guardRef.current;
      if (g) {
        const inside = snap.quadrant !== null && g.quadrants.includes(snap.quadrant);
        if (inside) g.outsideSince = null;
        else if (g.outsideSince === null) g.outsideSince = snap.at;
        else if (snap.at - g.outsideSince >= GUARD_RELEASE_MS) clearGuard();
      }
      const looking = snap.state === 'dwelling' || snap.state === 'previewed' || (snap.state === 'selected' && snap.looked === snap.action);
      const armedId = looking ? snap.action : null;
      if (armedId !== armedRef.current) {
        armedRef.current = armedId;
        setArmed(armedId ? tilesRef.current.find((t) => t.id === armedId) ?? null : null);
        const m = modelRef.current;
        armedContext.current = armedId ? [...wordsOf(m.turn), ...m.composition.words.map((w) => w.text)] : null;
      }
      painter.paint(snap, engine);
      if (event?.type === 'select') {
        const source = sourceRef.current;
        sourceRef.current = 'gaze';
        // The bloom celebrates a look; keyboard and click actions get no motion (MOTION).
        if (source === 'gaze') { painter.commit(event.action); painter.bloom(event.action); }
        selectRef.current(event.action, source);
      }
    };
    const offs = [
      attachHeldPointer(engine),
      import.meta.env.DEV ? mountOverlay(engine, { visible: false }) : trackActionables(engine),
      engine.subscribe(listener),
    ];
    return () => offs.forEach((off) => off());
  }, [engine]);

  /* Keyboard: digits pick the action in Q1–Q8, Space/Enter confirm (or press the focused tile),
     Escape cancels a dwell or skips calibration. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const stage = shownRef.current;
      if (e.key === 'Escape' && stage.kind === 'calibrate') { finishRef.current('key'); return; }
      if (/^[1-8]$/.test(e.key)) {
        if (lockedRef.current) return;
        const q = `Q${e.key}` as QuadrantId;
        const tile = tilesRef.current.find((t) => !t.disabled && quadrantsOfTile(t).includes(q));
        if (tile) { sourceRef.current = 'key'; engine.activate(tile.id, e.timeStamp); e.preventDefault(); }
      } else if (e.key === ' ' || e.key === 'Enter') {
        keyHandledAt.current = performance.now();
        // A look being confirmed wins; otherwise press the keyboard-focused tile.
        const state = engine.snapshot.state;
        const active = document.activeElement as HTMLElement | null;
        if (state === 'previewed' || state === 'dwelling') { sourceRef.current = 'key'; engine.confirm(e.timeStamp); }
        else if (active?.dataset.action && active.matches(':focus-visible') && !lockedRef.current) {
          sourceRef.current = 'key';
          engine.activate(active.dataset.action, e.timeStamp);
        }
        e.preventDefault();
      } else if (e.key === 'Escape') {
        engine.cancel(e.timeStamp);
      }
    };
    const onDown = () => unlockAudio();
    // Motion returns as soon as the pointer (the simulated gaze) moves again.
    const onMove = () => { if (document.documentElement.dataset.input === 'key') document.documentElement.dataset.input = 'gaze'; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); };
  }, [engine]);

  /* Settings that live in the engine or on the document. */
  useEffect(() => {
    const s = model.settings;
    engine.configure({ mode: s.mode, noiseSigma: s.noise ? 0.06 : 0 });
  }, [engine, model.settings]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === model.settings.theme) return;
    // Theme switch without every colour transition firing at once (better-ui animations.md).
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.append(style);
    root.dataset.theme = model.settings.theme;
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  }, [model.settings.theme]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--scale', String(model.settings.textScale));
    // Letter rows fit one line up to 125%, then balance into two rows of four (BRIEF).
    document.documentElement.dataset.text = model.settings.textScale > 1 ? 'large' : 'normal';
    const large = model.settings.textScale >= 1.5;
    document.documentElement.style.setProperty('--letter-cols', large ? '4.3' : '7.4');
    document.documentElement.style.setProperty('--letter-wrap', large ? 'normal' : 'nowrap');
  }, [model.settings.textScale]);

  /* Listening: Web Speech when it works, the scripted partner otherwise. Never stops on a timer. */
  useEffect(() => {
    if (model.stage.kind !== 'listen' || frozenRef.current) return;
    setProblem(null);
    const base = modelRef.current.turn;
    const append = (text: string) => {
      // A late recognition result after Done must not change the context under Compose.
      if (!text || modelRef.current.stage.kind !== 'listen') return;
      update((m) => ({ ...m, turn: [base, text].filter(Boolean).join(' ') }));
    };
    const script = () => listen((t) => append(t), { script: DEMO_UTTERANCES[scriptLine.current++ % DEMO_UTTERANCES.length], wordMs: 300 });
    let session: ListenSession;
    if (modelRef.current.settings.partner === 'microphone' && canListenLive()) {
      // The microphone only: if it cannot listen the band says so and the problem is shown. Words
      // are never invented in its place; the scripted partner is a separate, explicit setting.
      const live = listenLive(append, () => setProblem('microphone'));
      return () => live.stop();
    }
    session = script();
    return () => session.stop();
  }, [model.stage.kind]);

  /* Stop speech when leaving a stage mid-utterance. */
  useEffect(() => () => voiceRef.current?.cancel(), []);

  /* window.clarteDebug: walk every screen for the layout check. */
  useEffect(() => {
    const debug = {
      phases: PHASES,
      phase: () => phaseName(shownRef.current, modelRef.current.composition),
      setPhase: (name: string) => {
        const fixture = fixtureFor(name);
        if (!fixture) throw new Error(`unknown phase ${name}`);
        stopVoice();
        frozenRef.current = true;
        setFrozenAt(fixture.frozenAt);
        setVoiceWord(fixture.voiceWord ?? -1);
        update((m) => ({ ...m, spelled: '', ...fixture.model, settings: m.settings, fresh: null }));
        go(fixture.model.stage, { instant: true });
      },
      validate: () => validateLayout(collectActionables(document), viewportOf()),
      engine,
    };
    (window as unknown as { clarteDebug: typeof debug }).clarteDebug = debug;
    // ?phase=<name> opens straight on one screen (reviews, rendered-page linters).
    const requested = new URLSearchParams(location.search).get('phase');
    if (requested && !phaseApplied.current) { phaseApplied.current = true; debug.setPhase(requested); }
  });

  const state = conversationState(model.stage, voiceActive, problem === 'microphone');
  const view: ScreenView = { stage: shown, model, context, voiceWord, frozenAt, problem };
  lastView.current = view;
  const onPress = (id: string) => {
    if (performance.now() - keyHandledAt.current < 500 || lockedRef.current) return;
    sourceRef.current = 'key';
    engine.activate(id);
  };
  const onCalibrationStep = (step: CalibrationStep) => go({ kind: 'calibrate', step });
  return (
    <div className="app">
      <Status state={state} hidden={shown.kind === 'menu'} />
      <main className="stage" aria-live="off">
        {leaving && (
          <Screen
            key={`layer-${leaving.key}`}
            {...leaving.view}
            frozenAt={leaving.view.frozenAt ?? 0}
            live={false}
            instant={false}
            locked
            guard={[]}
            armed={null}
            onPress={() => {}}
            onCalibrationStep={() => {}}
          />
        )}
        <Screen
          key={`layer-${layerKey}`}
          {...view}
          live
          instant={instant}
          locked={locked}
          guard={guard}
          armed={armed}
          onPress={onPress}
          onCalibrationStep={onCalibrationStep}
          layerRef={stageRef}
        />
      </main>
    </div>
  );
}

/**
 * The mouse as gaze. `shared/gaze.ts`'s attachPointer samples only on pointer movement, so a mouse
 * held still goes stale after `staleMs` (600 ms) and a 900 ms dwell can never finish. A held mouse
 * is a steady look: re-sample its last position every frame, and tick the engine in the same loop.
 */
function attachHeldPointer(engine: GazeEngine): () => void {
  let last: { x: number; y: number } | null = null;
  // Off screen is a stream of missing samples, not silence: the engine's 200 ms blink grace then
  // expires on schedule and looking away cancels the dwell (BRIEF "Selection").
  let away = false;
  let frame = 0;
  const move = (e: PointerEvent) => {
    if (away) engine.setActionables(collectActionables(document));
    away = false; last = { x: e.clientX, y: e.clientY }; engine.sample(last.x, last.y, e.timeStamp);
  };
  // Leaving the window is looking off screen, not a blink: cancel at once and offer no target
  // until the pointer returns (the engine would otherwise hold the quadrant for its blink grace).
  const leave = (e: Event) => {
    away = true; last = null;
    engine.cancel(e.timeStamp);
    engine.setActionables([]);
    engine.sample(null, null, e.timeStamp);
  };
  const out = (e: MouseEvent) => { if (!e.relatedTarget) leave(e); };
  const loop = (t: number) => {
    if (last) engine.sample(last.x, last.y, t);
    else if (away) { engine.sample(null, null, t); engine.setActionables([]); }
    engine.tick(t);
    frame = requestAnimationFrame(loop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerdown', move);
  document.addEventListener('pointerleave', leave);
  window.addEventListener('mouseout', out);
  window.addEventListener('blur', leave);
  frame = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerdown', move);
    document.removeEventListener('pointerleave', leave);
    window.removeEventListener('mouseout', out);
    window.removeEventListener('blur', leave);
  };
}

/* ——— Status field: the conversation state, for the partner across the table ——— */

/** The band carries the state on every screen; the label sits above the reading column except on
    Menu pages, where it would sit above the page title (minimal-ui rule 4). */
function Status({ state, hidden }: { state: ReturnType<typeof conversationState>; hidden: boolean }) {
  return (
    <>
      <div className="band" data-state={state ?? 'none'} aria-hidden="true" />
      <p className="status" data-state={state ?? 'none'} data-hidden={hidden || undefined} role="status">
        <i aria-hidden="true" />
        <span>{state ? STATE_LABEL[state] : ''}</span>
      </p>
    </>
  );
}
