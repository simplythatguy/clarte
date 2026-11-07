/**
 * Style 1 · Rails. Owns the conversation state, the settings, and the effects that a state
 * implies: the microphone while listening, the voice while speaking, the earcons on state
 * changes, and the debug hooks the layout checker drives.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DEMO_UTTERANCES, canListenLive, listen, type ListenSession } from '../../shared/speech.ts';
import { collectActionables, validateLayout, viewportOf } from '../../shared/quadrants.ts';
import { mountOverlay } from '../../shared/overlay.ts';
import { Calibration } from './calibration.tsx';
import { earcon, setSound, unlockAudio } from './earcons.ts';
import { applySettings, attachGaze, engine, selectDirectly } from './gaze.ts';
import { screenFor } from './screens.tsx';
import { cycle, loadSettings, markCalibrated, saveSettings, wasCalibrated, type SettingKey, type Settings } from './settings.ts';
import { INITIAL_STATE, PHASES, phaseOf, presetFor, reducer, type AppState, type CalibrationStep } from './state.ts';
import { Rail, ScreenSwap, StatePill, type BandState } from './ui.tsx';
import { speakWords } from './voice.ts';

declare global {
  interface Window {
    clarteDebug?: {
      phases: string[];
      phase(): string;
      setPhase(name: string): void;
      validate(): ReturnType<typeof validateLayout>;
      engine: typeof engine;
    };
  }
}

/** `?partner=script` forces the scripted partner even where live recognition exists. */
const forceScript = new URLSearchParams(location.search).get('partner') === 'script';

function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  // Swap without every colour transition firing at once (better-ui animations.md).
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.append(style);
  root.dataset.theme = theme;
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

export function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, (s): AppState => ({ ...s, calibration: wasCalibrated() ? null : 'position' }));
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  stateRef.current = state;
  settingsRef.current = settings;

  useEffect(() => {
    applySettings(settings);
    setSound(settings.sound);
    saveSettings(settings);
    applyTheme(settings.theme);
    document.documentElement.style.setProperty('--s', String(settings.textScale));
    if (settings.textScale >= 1.5) document.documentElement.dataset.scale = 'large';
    else delete document.documentElement.dataset.scale;
  }, [settings]);

  const onSelect = useCallback((action: string) => {
    unlockAudio();
    if (action === 'delete') earcon.remove(); else earcon.commit();
    if (action.startsWith('set-')) { setSettings((s) => cycle(s, action.slice(4) as SettingKey)); return; }
    if (action === 'calib-start') markCalibrated();
    dispatch({ type: 'act', action });
  }, []);

  const onKey = useCallback((e: KeyboardEvent): boolean => {
    unlockAudio();
    if (e.key === 'Escape' && stateRef.current.calibration) {
      markCalibrated();
      dispatch({ type: 'skip-calibration' });
      return true;
    }
    const focused = document.activeElement;
    // A focused tile takes Enter or Space only while the keyboard is driving (Tab moved focus and
    // the pointer, the gaze, has not moved since). Otherwise the key is the blink: it confirms a
    // finished gaze preview and nothing else.
    const keyboard = document.documentElement.dataset.input === 'keys';
    if (keyboard && (e.key === 'Enter' || e.key === ' ') && focused instanceof HTMLElement && focused.dataset.action) {
      selectDirectly(focused.dataset.action, e.timeStamp, 'key');
      return true;
    }
    return false;
  }, []);

  // A preview being ready, or cancelled, said once to assistive technology.
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => attachGaze({
    settings: () => settingsRef.current,
    onSelect,
    bandRect: () => bandRef.current?.getBoundingClientRect() ?? null,
    onKey,
    announce: (text) => { if (liveRef.current) liveRef.current.textContent = text; },
  }), [onSelect, onKey]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // The partner's words while listening: the microphone where the browser can transcribe,
  // otherwise a scripted partner line. A recogniser that ends empty-handed within 1.5 s of
  // starting could not run at all (no permission, no network), so the script takes over;
  // silence alone never does, because recognition waits several seconds before giving up.
  useEffect(() => {
    if (state.flow !== 'listening' || state.frozen) return;
    const script = DEMO_UTTERANCES[(state.turns - 1) % DEMO_UTTERANCES.length];
    // A stopped recogniser can still deliver a late result; it must not reach the transcript.
    let active = true;
    const onText = (text: string) => { if (active && text) dispatch({ type: 'transcript', text }); };
    let heard = false;
    let session: ListenSession;
    if (canListenLive() && !forceScript) {
      const startedAt = performance.now();
      session = listen((text, final) => {
        if (text) { heard = true; onText(text); }
        else if (final && !heard && performance.now() - startedAt < 1500) { session.stop(); session = listen(onText, { script }); }
      });
    } else {
      session = listen(onText, { script });
    }
    return () => { active = false; session.stop(); };
  }, [state.flow, state.turns, state.frozen]);

  const speaking = state.speaking;
  useEffect(() => {
    if (!speaking || state.frozen || speaking.id < 0) return;
    const { id, text } = speaking;
    let active = true;
    const voice = speakWords(
      text,
      (index) => { if (active) dispatch({ type: 'speech-word', id, index }); },
      (ok) => {
        if (!active) return;
        dispatch({ type: 'speech-end', id, ok });
        // The error tone comes about a second later, after the person has seen what happened.
        if (!ok) setTimeout(() => earcon.error(), 1000);
      },
    );
    // Unmounting or replacing the utterance silences it without reporting an end.
    return () => { active = false; voice.stop(); };
    // A new utterance is a new id; word updates must not restart the voice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking?.id, state.frozen]);

  // Earcons for the partner when the conversation state changes.
  const audible = state.speaking ? 'speaking' : state.flow;
  const lastAudible = useRef(audible);
  useEffect(() => {
    if (lastAudible.current === audible) return;
    lastAudible.current = audible;
    if (stateRef.current.frozen) return;
    if (audible === 'speaking') earcon.speaking();
    else if (audible === 'listening') earcon.listening();
    else if (audible === 'paused') earcon.paused();
    else if (audible === 'composing') earcon.composing();
  }, [audible]);

  // Keep the newest words in view when the message outgrows its part of the band, and show only
  // whole lines: the visible height is the room left under the partner's turn, rounded down to
  // a whole number of message lines, so no line is ever cut through.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const band = bandRef.current;
    if (!scroller || !band) return;
    const text = scroller.firstElementChild as HTMLElement | null;
    const line = text ? parseFloat(getComputedStyle(text).lineHeight) : NaN;
    // Everything above the message (the partner's turn, the hairline) keeps its full height.
    let room = band.clientHeight;
    for (const child of Array.from(band.children) as HTMLElement[]) {
      if (child === scroller) continue;
      const cs = getComputedStyle(child);
      room -= child.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    }
    const height = Number.isFinite(line) && line > 0 ? `${Math.max(line, Math.floor(room / line) * line)}px` : '';
    if (scroller.style.maxHeight !== height) scroller.style.maxHeight = height;
    scroller.scrollTop = scroller.scrollHeight;
    if (scroller.scrollTop > 0) scroller.dataset.scrolled = ''; else delete scroller.dataset.scrolled;
  });

  useEffect(() => {
    window.clarteDebug = {
      phases: [...PHASES],
      phase: () => phaseOf(stateRef.current),
      setPhase: (name: string) => {
        engine.cancel();
        flushSync(() => dispatch({ type: 'restore', state: presetFor(name) }));
      },
      validate: () => validateLayout(collectActionables(), viewportOf()),
      engine,
    };
    return () => { delete window.clarteDebug; };
  }, []);

  useEffect(() => (import.meta.env.DEV ? mountOverlay(engine, { visible: false }) : undefined), []);

  const onStep = useCallback((step: CalibrationStep) => dispatch({ type: 'calibration-step', step }), []);

  const model = state.calibration ? null : screenFor(state, settings);
  // An error never replaces the state: a failure while listening shows both.
  const pills: Exclude<BandState, null>[] = [];
  if (state.voiceFailed) pills.push('error');
  if (model?.band && !(state.voiceFailed && model.band === 'composing')) pills.push(model.band);
  return (
    <main className="app" data-screen={state.calibration ? 'calibration' : state.screen} data-flow={state.flow} aria-label="Clarte">
      {!state.calibration && <StatePill states={pills} />}
      <p className="visually-hidden" aria-live="polite" ref={liveRef} />
      <ScreenSwap screenKey={state.calibration ? `calib-${state.calibration}-${state.frozen}` : `main-${state.screen}`}>
        {state.calibration || !model ? (
          <Calibration key={`${state.calibration}-${state.frozen}`} step={state.calibration ?? 'ready'} frozen={state.frozen} onStep={onStep} />
        ) : (
          <>
            <Rail slots={model.top} edge="top" />
            <div className="middle" ref={bandRef}>
              {model.above}
              <div className="middle-scroll" ref={scrollRef}>{model.middle}</div>
            </div>
            <Rail slots={model.bottom} edge="bottom" />
          </>
        )}
      </ScreenSwap>
    </main>
  );
}
