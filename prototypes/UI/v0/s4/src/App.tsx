import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { DEMO_UTTERANCES, listen } from '../../shared/speech.ts';
import { GazeEngine, attachKeyboard, startTicking } from '../../shared/gaze.ts';
import { mountOverlay, trackActionables } from '../../shared/overlay.ts';
import { actionIn, collectActionables, viewportOf, type QuadrantId } from '../../shared/quadrants.ts';
import { Calibration } from './Calibration.tsx';
import { Rest, Strip, sentence } from './Conversation.tsx';
import { installDebug } from './debug.ts';
import { attachGazeVisuals, clearStale, isStale, markStale } from './gazeVisuals.ts';
import { attachPointerStream } from './pointerStream.ts';
import {
  INITIAL_STATE, conversationState, layoutOf, reduce,
  type CalibrationStep, type Command, type Layout, type Slot, type State,
} from './model.ts';
import { play, setSound, unlockAudio } from './sound.ts';
import { Tile, type Position } from './Tile.tsx';
import { listenLive, recognitionAvailable, sayFloorHolder, speakWords } from './voice.ts';

/**
 * The shared overlay redraws its cells (textContent) on every layout report, and its layer sits
 * inside <body>, which the same layout tracker observes: once visible, each redraw triggers the
 * next and the page stops responding. Re-parenting the layer to <html> keeps it out of the
 * observed subtree. Proposed as a shared fix in REPORT.md.
 */
function mountOverlayOutsideBody(engine: GazeEngine): () => void {
  const unmount = mountOverlay(engine, { visible: false });
  const layer = document.body.querySelector('.cq-overlay');
  if (layer) document.documentElement.append(layer);
  return unmount;
}

/** The scene a card belongs to: a change of scene is a phase cross-fade, anything else is quick. */
function sceneOf(s: State): string {
  const v = s.view;
  return v.kind === 'menu' ? `menu:${v.page}` : v.kind === 'spell' ? `spell:${v.level.kind}` : v.kind === 'talk' ? `talk:${s.activity.kind === 'spoken' ? 'ready' : s.activity.kind}` : v.kind;
}

const CALIBRATED_KEY = 'clarte.style4.calibrated';
const SAY_AGAIN_MS = 6000;

function firstRunState(): State {
  let calibrated = false;
  try { calibrated = localStorage.getItem(CALIBRATED_KEY) === '1'; } catch { /* private mode */ }
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  if (new URLSearchParams(location.search).get('onboarding') === 'off') calibrated = true;
  // `?partner=script` starts with the scripted partner (demos without a microphone).
  const scripted = new URLSearchParams(location.search).get('partner') === 'script';
  const base: State = scripted ? { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, partner: 'script' } } : INITIAL_STATE;
  return calibrated ? base : { ...base, view: { kind: 'calibration', step: 'position' } };
}

function markCalibrated() {
  try { localStorage.setItem(CALIBRATED_KEY, '1'); } catch { /* private mode */ }
}

const KEY_POSITIONS: Position[] = ['q1', 'q2', 'q5', 'q6'];

/**
 * Entering or leaving calibration replaces the whole stage. Under gaze or pointer input the
 * outgoing scene stays as an inert, unanimated copy that fades out over 150 ms while the incoming
 * scene fades in, so the change is one cross-fade instead of a cut (MOTION.md acceptance 5). The
 * copy carries no `data-action`, so the engine and the layout check never see it.
 */
function fadeOutStage() {
  if (document.documentElement.dataset.input === 'keyboard') return;
  const stage = document.querySelector<HTMLElement>('.stage');
  if (!stage) return;
  const ghost = stage.cloneNode(true) as HTMLElement;
  ghost.className = 'stage stage-out';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  for (const el of ghost.querySelectorAll('[data-action], [id], [role], [aria-live]')) {
    for (const name of ['data-action', 'id', 'role', 'aria-live']) el.removeAttribute(name);
  }
  stage.after(ghost);
  const remove = () => ghost.remove();
  ghost.addEventListener('animationend', (e) => { if (e.target === ghost) remove(); });
  setTimeout(remove, 600);
}

function Tiles({ layout, onActivate, keypad, scene }: { layout: Layout; onActivate: (id: string) => void; keypad: boolean; scene: string }) {
  return (
    <>
      {keypad && (
        <div className="keypad" role="group" aria-label="Keys">
          {layout.keys.map((slot, i) => <Tile key={slot.id} slot={slot} position={KEY_POSITIONS[i]} onActivate={onActivate} isKey scene={scene} />)}
        </div>
      )}
      <Tile slot={layout.primary} position="q3" onActivate={onActivate} isKey={false} scene={scene} />
      <Tile slot={layout.second} position="q4" onActivate={onActivate} isKey={false} scene={scene} />
    </>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, firstRunState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const layout = useMemo(() => layoutOf(state), [state]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const engine = useMemo(() => new GazeEngine({ mode: 'dwell', dwellMs: INITIAL_STATE.settings.letterDwellMs }), []);

  // ---- Commands -------------------------------------------------------------------------
  const run = useCallback((command: Command) => {
    switch (command.type) {
      case 'group': play('letter'); break;
      case 'delete': case 'deleteWord': case 'clear': case 'spellBack': play('delete'); break;
      case 'listen': case 'speak': case 'sayAgain': play('phaseUp'); break;
      case 'stopListening': case 'stopSpeaking': play('phaseDown'); break;
      case 'none': return;
      default: play('control');
    }
    if (command.type === 'oneMoment') sayFloorHolder();
    if (command.type === 'start') markCalibrated();
    if (command.type === 'start' || command.type === 'recalibrate') fadeOutStage();
    if (command.type === 'cycle' && command.setting === 'overlay') window.dispatchEvent(new KeyboardEvent('keydown', { key: '`' }));
    dispatch(command);
  }, []);

  const slotById = (id: string): Slot | undefined => {
    const l = layoutRef.current;
    return l ? [...l.keys, l.primary, l.second].find((s) => s.id === id) : undefined;
  };

  const activate = useCallback((id: string) => { clearStale(id); engine.activate(id); }, [engine]);
  /** When the last key went down: keyboard selections get no motion. */
  const keyboardAt = useRef(-Infinity);

  // ---- Gaze engine wiring ---------------------------------------------------------------
  useEffect(() => {
    const detach = [
      attachPointerStream(engine),
      attachKeyboard(engine, (q) => actionIn(q, collectActionables(), viewportOf())?.id ?? null),
      startTicking(engine),
      import.meta.env.DEV ? mountOverlayOutsideBody(engine) : trackActionables(engine),
      attachGazeVisuals(
        engine,
        () => ({ letterMs: stateRef.current.settings.letterDwellMs, controlMs: stateRef.current.settings.controlDwellMs, repeat: stateRef.current.settings.repeat }),
        () => keyboardAt.current,
      ),
      engine.subscribe((_, event) => {
        if (event?.type !== 'select') return;
        // A key press always acts; only a look still resting on a changed card is ignored.
        if (isStale(event.action) && performance.now() - keyboardAt.current > 80) return;
        const slot = slotById(event.action);
        if (slot?.enabled) run(slot.command);
      }),
      installDebug(engine, () => stateRef.current, dispatch),
    ];
    return () => detach.forEach((off) => off());
  }, [engine, run]);

  // ---- Settings -------------------------------------------------------------------------
  const { settings } = state;
  useEffect(() => {
    // Repeat is applied per dwell class by the gaze visuals: letter keys only, never controls.
    engine.configure({ mode: settings.mode, noiseSigma: settings.noise ? 0.06 : 0 });
    setSound(settings.sound);
  }, [engine, settings.mode, settings.noise, settings.sound]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // Theme switch without every colour transition firing at once (better-ui).
    const freeze = document.createElement('style');
    freeze.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.append(freeze);
    root.dataset.theme = settings.theme;
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
  }, [settings.theme]);

  // ---- Keyboard: Escape steps back, Enter/Space activates the focused tile ----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      keyboardAt.current = performance.now();
      if (e.isTrusted) document.documentElement.dataset.input = 'keyboard';
      if (!e.isTrusted) return;
      const s = stateRef.current;
      if (e.key === '`') { dispatch({ type: 'cycle', setting: 'overlay' }); return; }
      // A key on a card that still shows its previous label (held after a gaze selection) only
      // releases the label; the next press acts on what the card now says.
      if (/^[1-8]$/.test(e.key) || e.key === 'Enter' || e.key === ' ') {
        const id = /^[1-8]$/.test(e.key)
          ? actionIn(`Q${e.key}` as QuadrantId, collectActionables(), viewportOf())?.id
          : (document.activeElement as HTMLElement | null)?.closest('[data-action]')?.getAttribute('data-action');
        const tile = id ? document.querySelector<HTMLElement>(`[data-action="${id}"]`) : null;
        if (tile && 'held' in tile.dataset) {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.dispatchEvent(new Event('clarte:release'));
          return;
        }
      }
      if (e.key === 'Escape') {
        if (s.view.kind === 'calibration' && s.view.step !== 'ready') { markCalibrated(); dispatch({ type: 'start' }); }
        else if (s.view.kind === 'menu') dispatch(s.view.page === 'root' ? { type: 'closeMenu' } : { type: 'page', page: 'root' });
        else if (s.view.kind === 'spell') dispatch({ type: 'spellBack' });
        else if (s.view.kind === 'more') dispatch({ type: 'closeMenu' });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const focused = document.activeElement as HTMLElement | null;
        const id = focused?.closest('[data-action]')?.getAttribute('data-action');
        if (id && focused?.getAttribute('aria-disabled') !== 'true') {
          e.preventDefault();
          e.stopImmediatePropagation();
          engine.activate(id);
        }
      }
    };
    const onPointer = () => unlockAudio();
    // Motion answers the eyes and the pointer, never the keyboard: after a key, content changes
    // swap without animation until the pointer moves again.
    const onMove = (e: PointerEvent) => { if (e.isTrusted) document.documentElement.dataset.input = 'pointer'; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onMove);
    };
  }, [engine]);

  // ---- Listening: live recognition, or the scripted partner where recognition does not exist --
  const { activity } = state;
  const listening = activity.kind === 'listening' && !activity.held ? (activity.scripted || !recognitionAvailable() ? 'script' : 'live') : null;
  const scriptIndex = useRef(3);
  useEffect(() => {
    if (!listening) return;
    // One moment is spoken while the microphone is open; keep it out of the partner's words.
    const heard = (text: string) => {
      const partner = text.replace(/\bone moment,? i[’']?m answering\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
      if (partner) dispatch({ type: 'transcript', text: partner });
    };
    if (listening === 'live') {
      const session = listenLive(heard, () => dispatch({ type: 'micUnavailable' }));
      return () => session.stop();
    }
    const session = listen((text) => heard(text), { script: DEMO_UTTERANCES[scriptIndex.current++ % DEMO_UTTERANCES.length], wordMs: 300 });
    return () => session.stop();
  }, [listening]);

  // ---- Speaking: highlight each word as it is said ---------------------------------------
  const speaking = activity.kind === 'speaking' && !activity.held ? activity.text : null;
  useEffect(() => {
    if (!speaking) return;
    const handle = speakWords(
      sentence(speaking),
      (index) => dispatch({ type: 'spokenWord', index }),
      () => dispatch({ type: 'speechStarted' }),
      () => { play('phaseDown'); dispatch({ type: 'speechEnded' }); },
      () => dispatch({ type: 'speechFailed' }),
    );
    return () => handle.cancel();
  }, [speaking]);

  // ---- Say again stays offered for a few seconds, then the slot returns to Listen ---------
  const spoken = activity.kind === 'spoken' && !activity.held;
  // The window does not close under a look: while Q3 is being looked at it waits.
  useEffect(() => {
    if (!spoken) return;
    const deadline = performance.now() + SAY_AGAIN_MS;
    const timer = setInterval(() => {
      if (performance.now() >= deadline && engine.snapshot.looked !== 'primary') dispatch({ type: 'sayAgainExpired' });
    }, 100);
    return () => clearInterval(timer);
  }, [spoken, engine]);

  // A tile whose command changes without a selection (speech ended, a window closed) must not
  // complete a dwell that began on its old meaning: cancel it, and mark the card stale so the new
  // meaning needs a new look (the engine would otherwise restart the dwell under the same eyes).
  // Every card is watched, not only Q3 and Q4: a transcript can change the word More offers.
  const commandKey = (slot: Slot) => `${slot.command.type}:${slot.label}`;
  const slotKeys = layout ? JSON.stringify([...layout.keys, layout.primary, layout.second].map((slot) => [slot.id, commandKey(slot)])) : '[]';
  const lastKeys = useRef(new Map<string, string>());
  useEffect(() => {
    const before = lastKeys.current;
    const now = new Map<string, string>(JSON.parse(slotKeys));
    lastKeys.current = now;
    const snap = engine.snapshot;
    for (const [id, key] of now) {
      if (!before.has(id) || before.get(id) === key) continue;
      // Eyes resting on the card when it changes meaning, dwelling or not, must look again.
      if (snap.looked === id) markStale(id);
      if (snap.action === id && (snap.state === 'dwelling' || snap.state === 'previewed')) engine.cancel();
    }
  }, [engine, slotKeys]);

  const onCalibrationStep = useCallback((step: CalibrationStep) => dispatch({ type: 'calibration', step }), []);

  const conversation = conversationState(state);
  const calibrating = state.view.kind === 'calibration';

  return (
    <div
      className={`app view-${state.view.kind}`}
      data-conversation={conversation}
      data-large-text={settings.textScale >= 1.5 ? '' : undefined}
      // Text size is rendered in the same commit as the content, so layout effects measure the new size.
      style={{ '--scale': settings.textScale } as React.CSSProperties}
    >
      <Strip state={calibrating ? 'idle' : conversation} />
      <main className="stage">
        {state.view.kind === 'calibration' && <Calibration step={state.view.step} onStep={onCalibrationStep} />}
        {layout && <Tiles layout={layout} onActivate={activate} keypad={!calibrating} scene={sceneOf(state)} />}
        {!calibrating && <Rest state={state} />}
      </main>
    </div>
  );
}

