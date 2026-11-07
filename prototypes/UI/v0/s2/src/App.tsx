import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { currentCandidate, messageText, type Composition } from '../../shared/composer.ts';
import { GROUPS, groupLetters, type GroupId } from '../../shared/decoder.ts';
import { attachKeyboard, startTicking } from '../../shared/gaze.ts';
import { mountOverlay, trackActionables } from '../../shared/overlay.ts';
import { collectActionables, validateLayout, viewportOf } from '../../shared/quadrants.ts';
import { DEMO_UTTERANCES, listen, stopSpeaking, type ListenSession } from '../../shared/speech.ts';
import { Calibration } from './Calibration.tsx';
import { play, prepareAudio, unlockAudio, type Earcon } from './earcons.ts';
import { attachPointerStream, commitCue, engine, isGroup, resolveQuadrant, startDwellPainter } from './gaze.ts';
import {
  DEFAULT_SETTINGS, DWELL_STEPS, INITIAL_STATE, MENU_CYCLE, PHASES, PRIMARY_LABEL, SCALE_STEPS, SECOND_LABEL,
  contextWords, fixture, phaseOf, reducer, slots, type CalibrationStep, type MenuPage, type Phase, type Settings, type Slots, type State,
} from './model.ts';
import {
  CandidateContent, ControlContent, CrossFade, GroupContent, PhraseContent, QUADRANT_ORDER, SettingContent, Tile, type Quadrant, type TileSpec,
} from './parts.tsx';
import { startMic, type MicSession } from './mic.ts';
import { speakAlong, type ReadAlong } from './readAlong.ts';
import { Rest, statusOf } from './Rest.tsx';

const SETTINGS_KEY = 'clarte-style2-settings';
const CALIBRATED_KEY = 'clarte-style2-calibrated';
const SAY_AGAIN_MS = 6000;
const ONE_MOMENT = "One moment, I'm answering.";
const PHRASES = ['Yes', 'No', 'Thank you', 'Can you say that again?'];
const GROUP_QUADRANT: Record<GroupId, Quadrant> = { G1: 'q1', G2: 'q4', G3: 'q5', G4: 'q8' };

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: settings last for this session */ }
}
function calibrated(): boolean {
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  if (new URLSearchParams(location.search).get('onboarding') === 'off') return true;
  try { return localStorage.getItem(CALIBRATED_KEY) === '1'; } catch { return true; }
}

/** The action the gaze point is on, so contextual slots can hold their label while looked at. */
function useGazeOn(): string | null {
  const [on, setOn] = useState<string | null>(null);
  useEffect(() => engine.subscribe((s) => {
    const next = s.looked;
    setOn((prev) => (prev === next ? prev : next));
  }), []);
  return on;
}

const fmtSeconds = (ms: number) => `${Number((ms / 1000).toFixed(2))} s`;
const next = <T,>(list: readonly T[], value: T) => list[(list.indexOf(value) + 1) % list.length];

/** Keyboard input gets no motion at all (MOTION.md, review-animations): transitions and animations
 *  are cut to zero for the frames that follow a key. */
function instantFrames(): void {
  const root = document.documentElement;
  root.dataset.instant = '';
  window.clearTimeout(Number(root.dataset.instantTimer ?? 0));
  root.dataset.instantTimer = String(window.setTimeout(() => { delete root.dataset.instant; }, 450));
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({
    ...INITIAL_STATE,
    settings: load<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS),
    screen: calibrated() ? { kind: 'conversation' } : { kind: 'calibration', step: 'position', frozen: false },
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const gazeOn = useGazeOn();
  const [overlayShown, setOverlayShown] = useState(false);

  // Contextual slots never relabel while the gaze point rests on them; the change waits until gaze
  // leaves. A key press or click acts on the current function, never on a held label.
  const desired = slots(state);
  const shown = useRef<Slots>(desired);
  shown.current = {
    primary: gazeOn === 'primary' ? shown.current.primary : desired.primary,
    second: gazeOn === 'second' ? shown.current.second : desired.second,
    groupsEnabled: desired.groupsEnabled,
  };
  const direct = useRef(0);
  const markDirect = useCallback(() => { direct.current = performance.now(); }, []);
  const [held, setHeld] = useState<{ q: string; action: string } | null>(null);

  // ---- side effects owned outside the reducer -------------------------------------------------
  const listenSession = useRef<ListenSession | MicSession | null>(null);
  const listenToken = useRef(0);
  const scriptIndex = useRef(0);
  const speech = useRef<ReadAlong | null>(null);
  const speechToken = useRef(0);
  const saidTimer = useRef(0);

  const sound = useCallback((earcon: Earcon) => { if (stateRef.current.settings.sound) play(earcon); }, []);

  const stopListening = useCallback(() => {
    listenSession.current?.stop();
    listenSession.current = null;
  }, []);

  const startListening = useCallback(() => {
    stopListening();
    window.clearTimeout(saidTimer.current);
    dispatch({ type: 'partner', text: '' });
    dispatch({ type: 'mode', mode: 'listening', spoken: null });
    const token = ++listenToken.current;
    const onText = (text: string) => { if (listenToken.current === token) dispatch({ type: 'partner', text }); };
    // The scripted partner is always disclosed: the setting reads Script and the status says
    // "Listening to the script".
    const scripted = () => {
      dispatch({ type: 'settings', patch: { partner: 'script' } });
      const script = DEMO_UTTERANCES[scriptIndex.current++ % DEMO_UTTERANCES.length];
      listenSession.current = listen(onText, { script });
    };
    if (stateRef.current.settings.partner !== 'microphone') { scripted(); return; }
    // The microphone. Silence is not failure; sessions that end restart. Only a fatal error (no
    // permission, no device, no network) switches to the script, and says so.
    const mic = startMic(onText, () => { if (listenToken.current === token && stateRef.current.mode === 'listening') scripted(); });
    if (mic) listenSession.current = mic;
    else scripted();
  }, [stopListening]);

  const enterSaid = useCallback(() => {
    dispatch({ type: 'mode', mode: 'said' });
    window.clearTimeout(saidTimer.current);
    saidTimer.current = window.setTimeout(() => { if (stateRef.current.mode === 'said') dispatch({ type: 'mode', mode: 'idle' }); }, SAY_AGAIN_MS);
  }, []);

  const stopSpeech = useCallback(() => {
    speechToken.current++;
    speech.current?.cancel();
    speech.current = null;
    window.clearTimeout(saidTimer.current);
  }, []);

  const startSpeaking = useCallback((text: string) => {
    stopSpeech();
    const token = speechToken.current;
    const before: Composition = stateRef.current.comp;
    const wasSaid = stateRef.current.mode === 'said' || stateRef.current.spoken !== null;
    dispatch({ type: 'notice', text: null });
    dispatch({ type: 'compose', event: { type: 'clear' } });
    dispatch({ type: 'mode', mode: 'speaking', spoken: text });
    speech.current = speakAlong(
      text,
      (index) => { if (speechToken.current === token) dispatch({ type: 'spokenWord', index }); },
      (outcome) => {
        if (speechToken.current !== token) return;
        speech.current = null;
        if (outcome.ok) { sound('phase'); enterSaid(); return; }
        // Nothing was heard: keep the message, say what is blocked and how to fix it, and play the
        // error tone about a second later (BRIEF "Selection").
        if (wasSaid && !before.words.length) enterSaid();
        else dispatch({ type: 'restore', comp: before });
        dispatch({ type: 'notice', text: outcome.reason === 'not-allowed'
          ? 'Speech is blocked until this page is clicked once.'
          : 'Speech did not start. Look at Speak to try again.' });
        window.setTimeout(() => sound('error'), 1000);
      },
    );
  }, [enterSaid, sound, stopSpeech]);

  const stopAll = useCallback(() => {
    listenToken.current++;
    stopListening();
    stopSpeech();
    stopSpeaking();
  }, [stopListening, stopSpeech]);

  const oneMoment = useCallback(() => {
    // Pause the microphone while the device speaks, so the floor-holder is not transcribed. Speech
    // goes through the same outcome handling as Speak: holding is always released, the microphone
    // always resumes, and a blocked attempt says so (round 3).
    const session = listenSession.current;
    if (session && 'pause' in session) session.pause();
    dispatch({ type: 'holding', holding: true });
    speakAlong(ONE_MOMENT, () => {}, (outcome) => {
      window.setTimeout(() => {
        dispatch({ type: 'holding', holding: false });
        if (session && 'resume' in session && listenSession.current === session) session.resume();
      }, outcome.ok ? 600 : 0);
      if (!outcome.ok) {
        dispatch({ type: 'notice', text: outcome.reason === 'not-allowed'
          ? 'Speech is blocked until this page is clicked once.'
          : 'One moment was not spoken. Try it again.' });
        window.setTimeout(() => sound('error'), 1000);
      }
    });
  }, [sound]);

  const setStep = useCallback((step: CalibrationStep) => dispatch({ type: 'screen', screen: { kind: 'calibration', step, frozen: false } }), []);
  const finishCalibration = useCallback(() => {
    try { localStorage.setItem(CALIBRATED_KEY, '1'); } catch { /* ignore */ }
    dispatch({ type: 'screen', screen: { kind: 'conversation' } });
  }, []);

  const toggleOverlay = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`' }));
  }, []);

  const changeSettings = useCallback((patch: Partial<Settings>) => dispatch({ type: 'settings', patch }), []);
  const toConversation = useCallback(() => dispatch({ type: 'screen', screen: { kind: 'conversation' } }), []);

  // ---- what a selection does ----------------------------------------------------------------
  // Every branch that does something calls `done(earcon)`, which plays the click and the commit cue
  // on the same frame. A selection that would do nothing returns before it: no sound, no cue.
  const onSelect = useCallback((action: string) => {
    const s = stateRef.current;
    const byKey = performance.now() - direct.current < 120;
    const slot = byKey ? slots(s) : shown.current;
    const done = (earcon: Earcon) => { sound(earcon); commitCue(action, !byKey); if (stateRef.current.notice) dispatch({ type: 'notice', text: null }); };
    if (s.screen.kind === 'conversation') {
      if (isGroup(action)) {
        if (!slot.groupsEnabled) return;
        window.clearTimeout(saidTimer.current);
        done('group');
        dispatch({ type: 'compose', event: { type: 'group', group: action as GroupId } });
        return;
      }
      if (action === 'primary') {
        if (!slot.primary.enabled) return;
        switch (slot.primary.kind) {
          case 'listen': done('phase'); startListening(); return;
          case 'stop-listening': done('phase'); stopListening(); dispatch({ type: 'mode', mode: 'idle' }); return;
          case 'accept': {
            // Accept only the word the slot shows: if the composition changed under an armed look
            // (a key typed meanwhile), the held label is stale and nothing is committed.
            const candidate = currentCandidate(s.comp, contextWords(s));
            if (!candidate || (slot.primary.word && candidate.word !== slot.primary.word)) return;
            done('control'); dispatch({ type: 'compose', event: { type: 'accept' } }); return;
          }
          case 'speak': if (!s.comp.words.length) return; done('phase'); startSpeaking(messageText(s.comp)); return;
          case 'stop-speaking': done('phase'); stopSpeech(); stopSpeaking(); enterSaid(); return;
          case 'say-again': if (!s.spoken) return; done('phase'); startSpeaking(s.spoken); return;
        }
      }
      if (action === 'second') {
        if (!slot.second.enabled) return;
        switch (slot.second.kind) {
          case 'delete': if (!s.comp.pending.length) return; done('delete'); dispatch({ type: 'compose', event: { type: 'delete' } }); return;
          case 'one-moment': done('control'); oneMoment(); return;
          case 'menu': done('phase'); window.clearTimeout(saidTimer.current); dispatch({ type: 'screen', screen: { kind: 'menu', page: 'menu' } }); return;
        }
      }
      return;
    }
    if (s.screen.kind === 'calibration') {
      if (action === 'start') { done('phase'); finishCalibration(); }
      if (action === 'again') { done('control'); setStep('position'); }
      return;
    }
    const page = s.screen.page;
    const set = s.settings;
    const lastWord = s.comp.words[s.comp.words.length - 1];
    switch (action) {
      case 'done': done('phase'); toConversation(); return;
      case 'next': done('phase'); dispatch({ type: 'screen', screen: { kind: 'menu', page: page === 'phrases' ? 'menu' : next(MENU_CYCLE, page) } }); return;
      case 'recalibrate': done('phase'); dispatch({ type: 'screen', screen: { kind: 'calibration', step: 'position', frozen: false } }); return;
      case 'other-word':
        if (!lastWord || s.comp.pending.length) return;
        // A decoded word reopens at its next candidate; a phrase or unresolved word is deleted.
        done('delete'); dispatch({ type: 'compose', event: { type: 'delete' } }); toConversation(); return;
      case 'one-moment': done('control'); oneMoment(); toConversation(); return;
      case 'listen': done('phase'); toConversation(); startListening(); return;
      case 'phrases': done('phase'); dispatch({ type: 'screen', screen: { kind: 'menu', page: 'phrases' } }); return;
      case 'clear': done('delete'); dispatch({ type: 'clear' }); toConversation(); return;
      case 'text-size': done('control'); changeSettings({ textScale: next(SCALE_STEPS, set.textScale) }); return;
      case 'theme': done('control'); changeSettings({ theme: set.theme === 'light' ? 'dark' : 'light' }); return;
      case 'sound': changeSettings({ sound: !set.sound }); if (!set.sound) play('control'); commitCue(action, !byKey); return;
      case 'word-colours': done('control'); changeSettings({ wordColours: !set.wordColours }); return;
      case 'letter-dwell': done('control'); changeSettings({ letterDwell: next(DWELL_STEPS, set.letterDwell) }); return;
      case 'control-dwell': done('control'); changeSettings({ controlDwell: next(DWELL_STEPS, set.controlDwell) }); return;
      case 'selection': done('control'); changeSettings({ mode: set.mode === 'dwell' ? 'confirm' : 'dwell' }); return;
      case 'repeat': done('control'); changeSettings({ repeat: set.repeat === 'leave' ? 'redwell' : 'leave' }); return;
      case 'noise': done('control'); changeSettings({ noise: !set.noise }); return;
      case 'partner': done('control'); changeSettings({ partner: set.partner === 'microphone' ? 'script' : 'microphone' }); return;
      case 'grid': done('control'); toggleOverlay(); return;
    }
    if (action.startsWith('phrase-')) {
      done('control');
      dispatch({ type: 'compose', event: { type: 'phrase', text: PHRASES[Number(action.slice(7))] } });
      toConversation();
    }
  }, [changeSettings, enterSaid, finishCalibration, oneMoment, setStep, sound, startListening, startSpeaking, stopListening, stopSpeech, toConversation, toggleOverlay]);

  // ---- engine lifecycle -----------------------------------------------------------------------
  useEffect(() => {
    prepareAudio();
    const cleanups = [
      attachPointerStream(),
      attachKeyboard(engine, resolveQuadrant),
      startTicking(engine),
      startDwellPainter(() => {
        const set = stateRef.current.settings;
        return { letter: set.letterDwell, control: set.controlDwell, repeat: set.repeat };
      }),
      import.meta.env.DEV ? mountOverlay(engine, { visible: false }) : trackActionables(engine),
    ];
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (e.key === '`') setOverlayShown((v) => !v);
      // Digits are direct input (act on the slot's current function). Space and Enter confirm the
      // gaze preview, so they act on the label held under the gaze (round 4). A focused card marks
      // itself through activate().
      if (/^[1-8]$/.test(e.key)) markDirect();
      if (/^[1-8]$/.test(e.key) || e.key === 'Enter' || e.key === ' ') instantFrames();
      // A focused tile handles Enter and Space itself (a click); keep the engine's confirm out of it.
      if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement | null)?.closest?.('[data-action]')) e.stopPropagation();
      if (e.key === 'Escape' && stateRef.current.screen.kind === 'calibration' && stateRef.current.screen.step !== 'ready') finishCalibration();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', unlockAudio);
    return () => { cleanups.forEach((c) => c()); window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', unlockAudio); };
  }, [finishCalibration, markDirect]);

  useEffect(() => engine.subscribe((s, event) => {
    if (event?.type === 'select') {
      const byGaze = performance.now() - direct.current >= 120;
      onSelect(event.action);
      // Hold the quadrant of a control chosen by gaze until the gaze leaves it (no chaining).
      if (byGaze && !isGroup(event.action) && event.quadrant) setHeld({ q: event.quadrant.toLowerCase(), action: event.action });
      return;
    }
    setHeld((h) => (h && s.quadrant?.toLowerCase() !== h.q ? null : h));
  }), [onSelect]);

  const activate = useCallback((id: string) => { markDirect(); engine.activate(id); }, [markDirect]);

  // Settings reach the engine, the document and storage. The repeat rule is set per action by the
  // dwell painter (letter groups only).
  const { settings } = state;
  useEffect(() => {
    engine.configure({ mode: settings.mode, noiseSigma: settings.noise ? 0.06 : 0 });
    save(SETTINGS_KEY, settings);
  }, [settings]);
  useEffect(() => { document.documentElement.style.setProperty('--text-scale', String(settings.textScale)); }, [settings.textScale]);
  useEffect(() => {
    // Swap the theme with transitions suspended, so colours do not smear (better-ui).
    const freeze = document.createElement('style');
    freeze.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.append(freeze);
    document.documentElement.dataset.theme = settings.theme;
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
  }, [settings.theme]);

  // ---- debug hook for the layout check ---------------------------------------------------------
  useEffect(() => {
    window.clarteDebug = {
      phases: [...PHASES],
      phase: () => phaseOf(stateRef.current),
      setPhase: (name: string) => {
        if (!(PHASES as readonly string[]).includes(name)) throw new Error(`unknown phase ${name}`);
        stopAll();
        engine.cancel();
        dispatch({ type: 'replace', state: fixture(name as Phase, stateRef.current.settings) });
      },
      validate: () => validateLayout(collectActionables(), viewportOf()),
      engine,
    };
  }, [stopAll]);

  // Same-role labels share one size on a screen: after each card fits its own label, every control
  // label takes the smallest fitted size (round 4: 40 to 80 px side by side at 200%).
  useLayoutEffect(() => {
    const labels = Array.from(document.querySelectorAll<HTMLElement>('.tile .xf-layer:not(.xf-out) .clabel'));
    if (labels.length < 2) return;
    const sizes = labels.map((el) => parseFloat(getComputedStyle(el).fontSize));
    const min = Math.min(...sizes);
    labels.forEach((el, i) => { if (sizes[i] > min + 0.5) el.style.fontSize = `${min}px`; });
  });

  // ?phase=<name> opens a phase directly (reviews, Lint Apple, screenshots).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('phase');
    if (requested && (PHASES as readonly string[]).includes(requested)) window.clarteDebug.setPhase(requested);
  }, []);

  // ---- render ---------------------------------------------------------------------------------
  const status = statusOf(state);
  const tiles = tileSpecs(state, shown.current, overlayShown);
  const screen = state.screen;
  const phaseKey = screen.kind === 'menu' ? `menu:${screen.page}` : screen.kind === 'calibration' ? `calib:${screen.step}` : 'conversation';
  return (
    <main className={`app screen--${screen.kind}`} data-phase={phaseOf(state)}>
      {screen.kind !== 'calibration' && <div className={`band band--${status.tone}`} aria-hidden="true" />}
      {/* Conversation and menu share the rest zone: one phase cross-fade between them. */}
      {screen.kind !== 'calibration' && (
        <CrossFade id={screen.kind === 'menu' ? `menu:${screen.page}` : 'conversation'} className="restswap" phase>
          {screen.kind === 'conversation' ? <Rest state={state} /> : (
            <section className="rest rest--menu" aria-label="Menu">
              <h1 className="menu-title">{MENU_TITLE[screen.kind === 'menu' ? screen.page : 'menu']}</h1>
            </section>
          )}
        </CrossFade>
      )}
      {screen.kind === 'calibration' && <Calibration step={screen.step} frozen={screen.frozen} onStep={setStep} />}
      {QUADRANT_ORDER.map((q) => {
        const spec = tiles.find((t) => t.q === q);
        // Held only when a different action now occupies the quadrant; the same action is latched by the engine.
        return spec ? <Tile key={q} spec={spec} held={held?.q === q && held.action !== spec.id} phaseKey={phaseKey} onActivate={activate} /> : null;
      })}
    </main>
  );
}

const MENU_TITLE: Record<MenuPage, string> = { menu: 'Menu', more: 'More', display: 'Display', selection: 'Selection', demo: 'Demo', phrases: 'Phrases' };
const NEXT_TITLE = (page: MenuPage) => MENU_TITLE[page === 'phrases' ? 'menu' : next(MENU_CYCLE, page)];

function groupTiles(enabled: boolean): TileSpec[] {
  return GROUPS.map((g) => ({
    q: GROUP_QUADRANT[g.id],
    id: g.id,
    kind: 'group' as const,
    group: g.id,
    label: `${groupLetters(g.id)}, group ${g.label.replace('–', ' to ')}`,
    enabled,
    contentKey: g.id,
    content: <GroupContent group={g.id} letters={groupLetters(g.id)} />,
  }));
}

function control(q: Quadrant, id: string, icon: Parameters<typeof ControlContent>[0]['icon'], label: string, name = label, enabled = true): TileSpec {
  return { q, id, kind: 'control', label: name, enabled, contentKey: id, content: <ControlContent icon={icon} label={label} /> };
}

function setting(q: Quadrant, id: string, name: string, value: string): TileSpec {
  return { q, id, kind: 'setting', label: `${name} ${value}`, enabled: true, contentKey: `${id}:${value}`, content: <SettingContent name={name} value={value} /> };
}

function tileSpecs(state: State, slot: Slots, overlayShown: boolean): TileSpec[] {
  const { screen, settings } = state;
  if (screen.kind === 'calibration') {
    if (screen.step !== 'ready') return [];
    return [
      { q: 'q6', id: 'start', kind: 'primary', label: 'Start', enabled: true, contentKey: 'start', content: <ControlContent icon="done" label="Start" /> },
      control('q7', 'again', 'calibrate', 'Again', 'Calibrate again'),
    ];
  }
  if (screen.kind === 'menu') {
    const page = screen.page;
    const done: TileSpec = { q: 'q6', id: 'done', kind: 'primary', label: 'Done, back to the conversation', enabled: true, contentKey: 'done', content: <ControlContent icon="done" label="Done" /> };
    const nextTile = control('q7', 'next', 'next', NEXT_TITLE(page), `Go to ${NEXT_TITLE(page)}`);
    nextTile.contentKey = `next:${page}`;
    const common = [done, nextTile];
    const lastWord = state.comp.words[state.comp.words.length - 1];
    switch (page) {
      case 'menu': return [
        control('q1', 'recalibrate', 'calibrate', 'Recalibrate'),
        control('q4', 'one-moment', 'hand', 'One moment', 'Say one moment'),
        lastWord && lastWord.source !== 'decoded'
          ? control('q5', 'other-word', 'delete', 'Delete word', 'Delete the last word', !state.comp.pending.length)
          : control('q5', 'other-word', 'swap', 'Other word', 'Other word for the last word', Boolean(lastWord && !state.comp.pending.length)),
        control('q8', 'listen', 'listen', 'Listen', 'Listen to my partner'),
        ...common,
      ];
      case 'more': return [
        control('q1', 'phrases', 'phrases', 'Phrases', 'Saved phrases'),
        control('q4', 'clear', 'clear', 'Clear', 'Clear the message and the screen'),
        ...common,
      ];
      case 'display': return [
        setting('q1', 'text-size', 'Text size', `${Math.round(settings.textScale * 100)}%`),
        setting('q4', 'theme', 'Theme', settings.theme === 'light' ? 'Light' : 'Dark'),
        setting('q5', 'sound', 'Sound', settings.sound ? 'On' : 'Off'),
        setting('q8', 'word-colours', 'Word colours', settings.wordColours ? 'On' : 'Off'),
        ...common,
      ];
      case 'selection': return [
        setting('q1', 'letter-dwell', 'Letter dwell', fmtSeconds(settings.letterDwell)),
        setting('q4', 'control-dwell', 'Control dwell', fmtSeconds(settings.controlDwell)),
        setting('q5', 'selection', 'Select by', settings.mode === 'dwell' ? 'Looking' : 'Look + key'),
        setting('q8', 'repeat', 'Repeat', settings.repeat === 'leave' ? 'Look away' : 'Keep looking'),
        ...common,
      ];
      case 'demo': return [
        setting('q1', 'noise', 'Gaze noise', settings.noise ? 'On' : 'Off'),
        setting('q4', 'partner', 'Partner', settings.partner === 'microphone' ? 'Microphone' : 'Script'),
        ...(import.meta.env.DEV ? [setting('q5', 'grid', 'Grid', overlayShown ? 'Shown' : 'Hidden')] : []),
        ...common,
      ];
      case 'phrases': return [
        ...(['q1', 'q4', 'q5', 'q8'] as const).map((q, i): TileSpec => ({
          q, id: `phrase-${i}`, kind: 'setting', label: `Add “${PHRASES[i]}”`, enabled: true, contentKey: `phrase-${i}`,
          content: <PhraseContent text={PHRASES[i]} />,
        })),
        ...common,
      ];
    }
  }
  const primary = slot.primary;
  const second = slot.second;
  const primaryTile: TileSpec = primary.kind === 'accept'
    ? {
      q: 'q6', id: 'primary', kind: 'primary', enabled: primary.enabled,
      label: primary.word ? `Use the word ${primary.word}` : 'No word matches these letters',
      contentKey: `accept:${primary.word ?? ''}`, content: <CandidateContent word={primary.word ?? null} />,
    }
    : {
      q: 'q6', id: 'primary', kind: 'primary', enabled: primary.enabled, contentKey: primary.kind,
      label: { listen: 'Listen to my partner', 'stop-listening': 'Stop listening', speak: 'Speak the message', 'stop-speaking': 'Stop speaking', 'say-again': 'Say again' }[primary.kind],
      content: <ControlContent icon={({ listen: 'listen', 'stop-listening': 'stop', speak: 'speak', 'stop-speaking': 'stop', 'say-again': 'again' } as const)[primary.kind]} label={PRIMARY_LABEL[primary.kind]} />,
    };
  // Straight after a reopen, Delete removes the whole word, and says so (round 4).
  const reopened = second.kind === 'delete' && state.comp.reopened;
  const secondTile = control('q7', 'second', ({ delete: 'delete', 'one-moment': 'hand', menu: 'menu' } as const)[second.kind], reopened ? 'Delete word' : SECOND_LABEL[second.kind],
    reopened ? 'Delete the word' : { delete: 'Delete the last letter group', 'one-moment': 'Say one moment', menu: 'Open the menu' }[second.kind], second.enabled);
  secondTile.contentKey = reopened ? 'delete-word' : second.kind;
  return [...groupTiles(slot.groupsEnabled), primaryTile, secondTile];
}

declare global {
  interface Window {
    clarteDebug: {
      phases: string[];
      phase(): string;
      setPhase(name: string): void;
      validate(): ReturnType<typeof validateLayout>;
      engine: typeof engine;
    };
  }
}
