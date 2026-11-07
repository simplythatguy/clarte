import { useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { Settings, type SettingsPage, type SettingsValue } from './components/Settings';
import { summarizeCheck, type CheckSummary } from './core/check-report';
import { buildReplayFile } from './core/replay-file';
import { Calibration } from './components/Calibration';
import { GazeArea, type Area } from './core/gaze-area';
import { DwellTarget, NAVIGATION_TARGETS } from './components/Targets';
import { StagePage } from './components/StagePage';
import { Validation } from './components/Validation';
import { SavedCalibrationStore, SAVED_CALIBRATION_KEY, MODEL_VERSION, calibrationCompatibility, type CalibrationGeometry, type SavedCalibration as SavedModel } from './core/saved-calibration';
import { CalibrationRun, freshFeatures, viewportChanged } from './core/calibration';
import { GazeResolver, type GazeLayout } from './core/gaze';
import { initialDwell, stepDwell, type DwellEvent, type DwellState } from './core/dwell';
import { lifecycle, type Lifecycle, type LifecycleEvent } from './core/lifecycle';
import { cameraError, createCameraSession, type GazeFrame } from './core/webeyetrack';
import { ValidationRun, type CheckCondition, type PauseReason, type ValidationState } from './core/validation';
import { BlinkSelection } from './core/blink';
import { HeadPositionGuard, allowsLearning } from './core/head-position';
import { TargetClassifier, personalizationFromCheck } from './core/target-classifier';
import { SelectionLearning } from './core/selection-learning';
import type { Point, Viewport } from './core/tracking';

const lostFrame: GazeFrame = { point: null, face: false, facePresent: false, eyeState: 'unknown', at: -Infinity, pose: null };
const defaultSettings: SettingsValue = { selection: 'blink', dwellMs: 2400, assistance: true, pointer: false, pace: 'quick', learning: true };
/** Uncorrected estimates kept per target so a confirmed selection can be learned from. */
const TRAIL_MS = 6000;
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const checkMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'smooth';

function inputLayout(): GazeLayout {
  return { viewport: viewport(), targets: Array.from(document.querySelectorAll<HTMLElement>('[data-dwell]')).flatMap(element => {
    const rect = element.getBoundingClientRect();
    const id = element.dataset.dwell;
    return id && rect.width > 0 && rect.height > 0 ? [{ id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }] : [];
  }) };
}

function targetAt(point: { x: number; y: number }): string | null {
  if (point.x < 0 || point.y < 0 || point.x >= window.innerWidth || point.y >= window.innerHeight) return null;
  const element = document.elementFromPoint(point.x, point.y)?.closest('[data-dwell]');
  return element instanceof HTMLElement ? element.dataset.dwell ?? null : null;
}

export function App() {
  const [session, setSession] = useState<Lifecycle>({ kind: 'off' });
  const sessionRef = useRef(session);
  const [camera] = useState(createCameraSession);
  const [settings, setSettings] = useState(defaultSettings);
  const settingsRef = useRef(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  const [dwell, setDwell] = useState<DwellState>(initialDwell);
  const dwellRef = useRef(dwell);
  const [blink] = useState(() => new BlinkSelection());
  const [blinkPreview, setBlinkPreview] = useState<string | null>(null);
  const simulatedClosureUntil = useRef(0);
  const [frame, setFrame] = useState<GazeFrame>(lostFrame);
  const frameRef = useRef(frame);
  const [resolver] = useState(() => new GazeResolver());
  const [classifier] = useState(() => new TargetClassifier());
  const [learning] = useState(() => new SelectionLearning());
  // Where the head was when navigation was calibrated and checked; moving away invalidates what is learned.
  const headGuard = useRef(new HeadPositionGuard());
  const trail = useRef<{ at: number; point: Point; target: string }[]>([]);
  const layoutKey = useRef('');
  const [clock, setClock] = useState(performance.now());
  const simulationPoint = useRef<{ x: number; y: number } | null>(null);
  const request = useRef(0);
  const pageFocused = useRef(true);
  const inputViewport = useRef({ ...viewport(), pixelRatio: window.devicePixelRatio || 1 });
  const [savedStore] = useState(() => new SavedCalibrationStore());
  const [savedModel, setSavedModel] = useState<SavedModel | null>(null);
  const savedModelRef = useRef<SavedModel | null>(null);
  const [savedStatus, setSavedStatus] = useState('');
  const [savedChoice, setSavedChoice] = useState(false);
  const savedChoiceRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);
  const calibrationRun = useRef(new CalibrationRun(viewport(), defaultSettings.pace));
  const trackingWasUsable = useRef(false);
  const [gazeArea] = useState(() => new GazeArea());
  const [area, setArea] = useState<Area | null>(null);
  const [calibration, setCalibration] = useState(calibrationRun.current.state);
  const calibrationViewport = useRef({ width: window.innerWidth, height: window.innerHeight });
  const validationRun = useRef<ValidationRun | null>(null);
  const [validation, setValidation] = useState<ValidationState>({ kind: 'ready' });
  const [lastCheck, setLastCheck] = useState<CheckSummary | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('settings');
  // Development replay recording: off by default, explicit per session, exported only by a button press.
  const [replay, setReplay] = useState({ recording: false, count: 0, status: '' });
  const replayRef = useRef(replay);
  // A finished free-flow check personalizes navigation before the first selection: its measured
  // offsets seed the drift correction (fixing a pointer that sits consistently above or below the
  // gaze) and its leftover error sets the target classifier's noise. Aggregates only, never samples.
  const usedCheck = useRef<object | null>(null);
  useEffect(() => {
    if (validation.kind !== 'complete' || usedCheck.current === validation.result) return;
    usedCheck.current = validation.result;
    const { result } = validation;
    setLastCheck(summarizeCheck(result, Date.now()));
    if (result.kind !== 'measured' || !result.corrections) {
      if (import.meta.env.DEV) console.info('[calibration models] check had too little data to compare models or seed navigation');
      return;
    }
    const { corrections } = result;
    const personal = personalizationFromCheck(corrections, result.viewport);
    const seeded = personal ? learning.seed(personal.pairs, result.viewport) : 0;
    if (personal) classifier.setNoise(personal.sigmaPx);
    if (!import.meta.env.DEV) return;
    console.info(`[calibration models] ${result.condition} check, ${corrections.references} references, held-out error in px`);
    console.table(Object.fromEntries(corrections.scores.map(s => [s.model, { medianPx: s.medianPx && Math.round(s.medianPx), p90Px: s.p90Px && Math.round(s.p90Px) }])));
    console.info('[calibration models] uncorrected offset at each reference (a pattern across the screen means a non-affine error)');
    console.table(corrections.offsets.map(o => ({ x: Math.round(o.target.x), y: Math.round(o.target.y), dx: Math.round(o.dx), dy: Math.round(o.dy), samples: o.samples })));
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    console.info(personal
      ? `[navigation] seeded drift correction from ${seeded} references (median offset ${Math.round(median(corrections.offsets.map(o => o.dx)))}, ${Math.round(median(corrections.offsets.map(o => o.dy)))} px; negative dy = pointer above gaze); classifier noise σ ≈ ${Math.round(personal.sigmaPx)} px`
      : '[navigation] check not used to personalize: its error is not explained by a simple correction (was the dot followed?)');
  }, [validation, learning, classifier]);
  const [selected, setSelected] = useState<{ id: string; sequence: number } | null>(null);
  const selectionSequence = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  const [fullscreenError, setFullscreenError] = useState(false);
  const [controls, setControls] = useState<string | null>(null);
  const controlsRef = useRef<string | null>(null);
  const [simulationEntry, setSimulationEntry] = useState(false);
  const [recovery, setRecovery] = useState('');
  const missingSince = useRef<number | null>(null);
  const phase = session.kind === 'camera' || session.kind === 'simulation' ? session.phase : session.kind;

  useEffect(() => {
    try { const saved = savedStore.load(); savedModelRef.current = saved; setSavedModel(saved); }
    catch { setSavedStatus('Saved calibration could not be loaded. Browser storage may be blocked or the saved model is incompatible. Recalibrate or delete it in Settings.'); }
  }, []);


  function send(event: LifecycleEvent) {
    const next = lifecycle(sessionRef.current, event);
    sessionRef.current = next;
    setSession(next);
  }

  function stopSpeech() { window.speechSynthesis?.cancel(); }

  function selectTarget(id: string, fromDwell = false, keyboard = false) {
    const current = sessionRef.current;
    if (settingsOpenRef.current || controlsRef.current || (current.kind !== 'camera' && current.kind !== 'simulation') || current.phase !== 'compose') return;
    if (fromDwell && current.kind === 'camera' && !freshFeatures(frameRef.current, performance.now())) { cancelGaze(); return; }
    if (settingsRef.current.selection === 'dwell' && !fromDwell && !keyboard && (dwellRef.current.kind === 'latched' || dwellRef.current.kind === 'rearming') && dwellRef.current.target === id) return;
    const target = NAVIGATION_TARGETS.find(item => item.id === id);
    if (!target) return;
    setSelected({ id, sequence: ++selectionSequence.current });
    if (fromDwell && current.kind === 'camera') learnFrom(id);
    setAnnouncement(`${target.label} selected.`);
    if (!fromDwell) {
      if (settingsRef.current.selection === 'blink') { blink.activate(id); setBlinkPreview(null); }
      else updateDwell({ type: 'activate', target: id });
    }
  }

  function recordTrail(point: Point | null | undefined, target: string | null, at: number) {
    if (!point || !target || !Number.isFinite(at)) return;
    trail.current = [...trail.current.filter(sample => at - sample.at <= TRAIL_MS), { at, point, target }];
  }

  /** A confirmed gaze selection pairs the estimates that settled on it with the target centre. */
  function learnFrom(id: string) {
    const latest = trail.current.at(-1)?.at ?? -Infinity;
    const estimates = trail.current.filter(sample => sample.target === id && latest - sample.at <= TRAIL_MS).map(sample => sample.point);
    trail.current = [];
    if (!settingsRef.current.learning || !allowsLearning(headGuard.current.feedback(performance.now()))) return;
    const rect = inputLayout().targets.find(target => target.id === id);
    if (rect) learning.learn(estimates, rect, viewport());
  }

  function updateDwell(event: DwellEvent) {
    const result = stepDwell(dwellRef.current, event, settingsRef.current.dwellMs);
    if (result.state !== dwellRef.current) {
      dwellRef.current = result.state;
      setDwell(result.state);
    }
    if (result.selected) selectTarget(result.selected, true);
  }

  function cancelGaze() {
    blink.reset(); setBlinkPreview(null); simulatedClosureUntil.current = 0;
    updateDwell({ type: 'reset' });
    resolver.reset(); classifier.reset(); trail.current = [];
    gazeArea.reset(); setArea(null);
    layoutKey.current = '';
  }

  function clearInput() {
    cancelGaze();
    frameRef.current = lostFrame;
    setFrame(lostFrame);
    simulationPoint.current = null;
  }

  async function onFrame(observed: GazeFrame) {
    const now = performance.now();
    const current = sessionRef.current;
    // Learned drift correction applies only to navigation, never to calibration or the frozen free-flow check.
    const next = current.kind === 'camera' && current.phase === 'compose' && settingsRef.current.learning ? learning.correct(observed, viewport()) : observed;
    frameRef.current = next;
    setFrame(next);
    setClock(now);
    if (current.kind === 'camera' && (current.phase === 'validation' || current.phase === 'compose')) {
      const guard = headGuard.current;
      guard.observe({ face: next.facePresent, at: next.at, pose: next.pose }, now);
      if (current.phase === 'compose') { const feedback = guard.feedback(now); if (feedback.kind === 'setup' && feedback.stable) guard.establishReference(now); }
    }
    if (settingsOpenRef.current || controlsRef.current || document.hidden || !pageFocused.current || (current.kind !== 'camera' && current.kind !== 'simulation')) return;
    if (freshFeatures(next, now)) setArea(gazeArea.sample(next, viewport(), now));
    else { gazeArea.reset(); setArea(null); }
    const blinkMode = settingsRef.current.selection === 'blink' && current.phase === 'compose';
    const usable = current.kind !== 'camera' || updateTracking(next, now, !blinkMode);
    if (current.kind === 'camera' && current.phase === 'calibration') {
      const run = calibrationRun.current;
      try {
        await run.capture(next, now, (point, at) => camera.collect(point, at, run.viewport));
        if (run === calibrationRun.current && sessionRef.current.kind === 'camera') {
          if (run.state.kind === 'collected' && (document.hidden || !pageFocused.current)) openControls();
          syncCalibration(); advanceCalibration();
        }
      } catch (error) { if (run === calibrationRun.current && sessionRef.current.kind === 'camera') fail(error); }
      return;
    }
    if (blinkMode) {
      // No filtered/held target survives reopening: use this frame's unfiltered estimate.
      // Camera estimates snap to the nearest target; the simulated pointer is exact.
      const point = current.kind === 'camera' ? next.rawPoint : next.point;
      if (!next.facePresent) classifier.reset();
      const target = current.kind === 'camera' ? classifier.classify(point, inputLayout(), next.at).target
        : point && Number.isFinite(point.x) && Number.isFinite(point.y) ? targetAt(point) : null;
      if (current.kind === 'camera' && next.eyeState === 'open') recordTrail(observed.rawPoint, target, next.at);
      const result = blink.sample(next, target, now);
      setBlinkPreview(blink.state.kind === 'preview' ? blink.state.target : null);
      if (result.previewed) setAnnouncement(`${NAVIGATION_TARGETS.find(p => p.id === result.previewed)?.label ?? ''} previewed.`);
      if (result.selected) selectTarget(result.selected, true);
      if (usable) { setArea(gazeArea.sample(next, viewport(), now)); }
      return;
    }
    if (current.kind === 'camera' && current.phase === 'validation') {
      const run = validationRun.current;
      const admitted = run?.admit(next, now) === true;
      if (admitted && replayRef.current.recording && run?.lastAdmitted?.at === next.at) void recordReplay(run.lastAdmitted.target, next.at, run.viewport);
      if (run) setValidation(run.state);
      return;
    }
    if (!usable || !next.point || !Number.isFinite(next.point.x) || !Number.isFinite(next.point.y) || next.point.x < 0 || next.point.y < 0 || next.point.x >= window.innerWidth || next.point.y >= window.innerHeight) { cancelGaze(); return; }
    setArea(gazeArea.sample(next, viewport(), now));
    const layout = inputLayout();
    const key = JSON.stringify(layout);
    if (key !== layoutKey.current) {
      layoutKey.current = key;
      resolver.reset();
      updateDwell({ type: 'reset' });
    }
    if (settingsRef.current.assistance) {
      const resolved = resolver.sample(next, layout, now);
      if (resolved.kind === 'target' && current.kind === 'camera') recordTrail(observed.rawPoint ?? observed.point, resolved.target, next.at);
      if (resolved.kind === 'target' || resolved.kind === 'neutral') updateDwell({ type: 'sample', target: resolved.target, at: next.at, now });
      else if (resolved.kind !== 'duplicate' && (resolved.kind !== 'hold' || dwellRef.current.kind === 'rearming')) updateDwell({ type: 'lost' });
    } else {
      const target = targetAt(next.point);
      if (current.kind === 'camera') recordTrail(observed.rawPoint ?? observed.point, target, next.at);
      updateDwell({ type: 'sample', target, at: next.at, now });
    }
  }

  function updateTracking(next: GazeFrame, now: number, cancel = true): boolean {
    const usable = freshFeatures(next, now);
    if (!usable) {
      if (cancel) cancelGaze();
      if (trackingWasUsable.current) stopSpeech();
    }
    trackingWasUsable.current = usable;
    return usable;
  }

  function fail(error: unknown) {
    closeSettings(); closeControls(); setRecovery('');
    ++request.current;
    savedStore.invalidate();
    clearValidation();
    camera.stop();
    clearInput();
    stopSpeech();
    send({ type: 'failure', message: cameraError(error) });
  }

  function resetLabels() {
    inputViewport.current = { ...viewport(), pixelRatio: window.devicePixelRatio || 1 };
    learning.reset(); classifier.setNoise(null); headGuard.current = new HeadPositionGuard();
    savedStore.invalidate(); chooseSaved(false); setRestoring(false); restoringRef.current = false;
    setSavedStatus(previous => previous.startsWith('Saving calibration') ? 'Calibration was not saved before the session ended.' : previous);
    clearValidation();
    calibrationViewport.current = viewport();
    calibrationRun.current = new CalibrationRun(calibrationViewport.current, settingsRef.current.pace);
    trackingWasUsable.current = false; missingSince.current = null; setRecovery(''); setSelected(null);
    setCalibration(calibrationRun.current.state);
  }

  async function startCamera() {
    closeSettings(); closeControls();
    stopSpeech();
    clearInput();
    resetLabels();
    setFullscreenError(false);
    const token = ++request.current;
    send({ type: 'start', request: token });
    try {
      const started = await camera.start(onFrame, fail);
      if (started && token === request.current) {
        resetLabels();
        send({ type: 'started', request: token });
        chooseSaved(savedModelRef.current !== null);
        camera.preview(false);
        if (replayRef.current.recording) void camera.setRecording(true);
      }
    } catch (error) { if (token === request.current) fail(error); }
  }

  function stopSession(pause = false) {
    closeControls(); setSimulationEntry(false);
    ++request.current;
    camera.stop();
    stopSpeech();
    clearInput();
    resetLabels();
    send({ type: pause ? 'pause' : 'stop' });
  }

  function simulate() {
    closeSettings();
    stopSession();
    setSimulationEntry(true);
    openControls('Simulation · camera off');
    send({ type: 'simulate' });
  }

  function simulateBlink() {
    if (sessionRef.current.kind !== 'simulation' || settingsRef.current.selection !== 'blink' || settingsOpenRef.current || controlsRef.current || document.hidden || !pageFocused.current || !simulationPoint.current) return;
    const now = performance.now();
    if (now < simulatedClosureUntil.current) return;
    simulatedClosureUntil.current = now + 160;
    void onFrame({ point: null, face: false, facePresent: true, eyeState: 'closed', at: now, pose: null });
  }

  async function resetCalibration() {
    chooseSaved(false);
    closeSettings(); closeControls(); stopSpeech(); clearInput(); resetLabels();
    const run = calibrationRun.current;
    run.state = { ...run.state, kind: 'resetting' }; syncCalibration();
    camera.preview(false); send({ type: 'resetCalibration' });
    try {
      const ready = await camera.resetCalibration();
      if (ready && run === calibrationRun.current && sessionRef.current.kind === 'camera') {
        // Model reload may outlast a resize, so use the current viewport again.
        resetLabels(); send({ type: 'resetCalibration' });
        if (replayRef.current.recording) void camera.setRecording(true);
      }
    } catch (error) { if (run === calibrationRun.current && sessionRef.current.kind === 'camera') fail(error); }
  }

  function syncCalibration() { setCalibration(calibrationRun.current.state); }

  async function trainCalibration() {
    const run = calibrationRun.current;
    if (run.state.stage !== 'head' || !run.beginTraining()) return;
    const saveLease = savedStore.lease;
    clearInput(); syncCalibration(); camera.preview(false);
    try {
      const trained = await camera.train();
      if (!trained && run === calibrationRun.current && sessionRef.current.kind === 'camera') throw new Error('Training did not finish');
      if (trained && run === calibrationRun.current && sessionRef.current.kind === 'camera' && sessionRef.current.phase === 'calibration' && run.finishTraining()) {
        syncCalibration(); clearInput(); camera.preview(false);
        prepareValidation();
        send({ type: 'calibrated', destination: 'validation' });
        setAnnouncement('Calibration trained locally.');
        void saveTrainedCalibration(run, saveLease);
      }
    } catch (error) { if (run === calibrationRun.current && sessionRef.current.kind === 'camera') fail(error); }
  }

  function chooseSaved(value: boolean) { savedChoiceRef.current = value; setSavedChoice(value); }

  function currentGeometry(): CalibrationGeometry | null {
    const cameraGeometry = camera.geometry();
    return cameraGeometry ? { camera: cameraGeometry, viewport: viewport(), pixelRatio: window.devicePixelRatio || 1 } : null;
  }

  async function saveTrainedCalibration(run: CalibrationRun, lease: number) {
    const token = request.current, geometry = currentGeometry();
    setSavedStatus('Saving calibration on this browser…');
    try {
      if (!geometry) throw new Error('Camera geometry unavailable');
      const learned = await camera.exportCalibration();
      if (!learned || token !== request.current || run !== calibrationRun.current) return;
      if (lease !== savedStore.lease) {
        setSavedStatus('Calibration changed in another tab. This session was not saved over it.');
        return;
      }
      const saved = savedStore.save(learned, geometry, lease);
      if (saved) { savedModelRef.current = saved; setSavedModel(saved); setSavedStatus('Calibration saved on this browser.'); }
      else setSavedStatus('Calibration changed in another tab. This session was not saved over it.');
    } catch {
      if (token === request.current && run === calibrationRun.current && lease === savedStore.lease) setSavedStatus('Calibration works this session, but could not be saved. Browser storage may be full or blocked.');
    }
  }

  async function useSavedCalibration() {
    if (sessionRef.current.kind !== 'camera' || sessionRef.current.phase !== 'calibration' || calibrationRun.current.state.kind !== 'ready' || restoringRef.current || !savedModelRef.current) return;
    const saved = savedModelRef.current, geometry = currentGeometry();
    if (!geometry || !calibrationCompatibility(saved.geometry, geometry).compatible) return;
    try {
      if (!savedStore.isCurrent(saved)) {
        savedStore.externalChange();
        const latest = savedStore.load(); savedModelRef.current = latest; setSavedModel(latest); chooseSaved(latest !== null);
        clearInput(); setSavedStatus('Saved calibration changed in another tab. Choose again or recalibrate.'); return;
      }
    } catch {
      savedStore.invalidate(); savedModelRef.current = null; setSavedModel(null); chooseSaved(false);
      clearInput(); setSavedStatus('Saved calibration could not be read. Recalibrate or delete it in Settings.'); return;
    }
    const token = request.current, run = calibrationRun.current, lease = savedStore.lease;
    restoringRef.current = true; setRestoring(true); clearInput(); stopSpeech();
    try {
      const restored = await camera.restoreCalibration(saved.learned);
      if (!restored && token === request.current && run === calibrationRun.current && lease === savedStore.lease) throw new Error('Restore failed');
      if (!restored || token !== request.current || run !== calibrationRun.current || lease !== savedStore.lease) return;
      if (!savedStore.isCurrent(saved)) {
        await resetCalibration(); setSavedStatus('Saved calibration changed during restore. Recalibrate or choose it in a new camera session.'); return;
      }
      // This completion follows the real worker weight/affine restore acknowledgement.
      run.state = { ...run.state, kind: 'complete' }; syncCalibration();
      calibrationViewport.current = viewport(); chooseSaved(false); setRestoring(false); restoringRef.current = false;
      clearInput(); camera.preview(false); send({ type: 'restored' });
    } catch {
      if (token !== request.current || run !== calibrationRun.current || lease !== savedStore.lease) return;
      await resetCalibration();
      setSavedStatus('Saved calibration could not be restored. Recalibrate or delete it in Settings.');
    }
  }

  async function deleteSavedCalibration() {
    clearInput(); stopSpeech();
    const wasRestoring = restoringRef.current;
    savedModelRef.current = null; setSavedModel(null); chooseSaved(false); setRestoring(false); restoringRef.current = false;
    try { savedStore.delete(); setSavedStatus('Saved calibration deleted.'); }
    catch { setSavedStatus('Deletion failed: browser storage is blocked. Saved calibration is disabled for this page; clear this site’s data to remove it.'); }
    if (wasRestoring) await resetCalibration();
  }

  function advanceCalibration() {
    const run = calibrationRun.current;
    if (run.state.kind !== 'collected' || controlsRef.current || settingsOpenRef.current || document.hidden || !pageFocused.current) return;
    if (run.state.stage === 'eyes') { run.addHeadStage(); syncCalibration(); clearInput(); }
    else void trainCalibration();
  }

  function pauseCalibration() {
    if (sessionRef.current.kind !== 'camera' || sessionRef.current.phase !== 'calibration') return;
    if (restoringRef.current || calibrationRun.current.state.kind === 'collecting') { controlsRef.current = 'Paused'; setControls('Paused'); }
    if (calibrationRun.current.state.kind === 'training' || calibrationRun.current.state.kind === 'resetting') { stopSession(true); return; }
    calibrationRun.current.pause();
    syncCalibration();
    camera.preview(false);
  }

  function toggleCalibration() {
    const state = calibrationRun.current.state;
    if (state.kind === 'ready' || state.kind === 'paused') {
      if (document.hidden || settingsOpenRef.current) return;
      chooseSaved(false);
      pageFocused.current = true;
      setRecovery(''); missingSince.current = null;
      if (!calibrationRun.current.start(performance.now())) {
        setRecovery('Face not detected');
        return;
      }
      trackingWasUsable.current = true;
      camera.preview(false);
      syncCalibration();
    } else pauseCalibration();
  }

  function closeControls() {
    controlsRef.current = null; setControls(null); missingSince.current = null;
  }

  function openControls(title = 'Paused') {
    pauseCalibration(); pauseValidation('manual'); clearInput(); stopSpeech();
    controlsRef.current = title; setControls(title);
  }

  function resumeControls() {
    if (document.hidden || settingsOpenRef.current) return;
    pageFocused.current = true;
    closeControls(); clearInput();
    const current = sessionRef.current;
    if (current.kind === 'camera' && current.phase === 'calibration' && calibrationRun.current.state.kind === 'paused') toggleCalibration();
    if (current.kind === 'camera' && current.phase === 'validation') resumeValidation();
    setSimulationEntry(false);
  }

  async function fullscreen() {
    try { await document.documentElement.requestFullscreen(); }
    catch { setFullscreenError(true); }
  }

  function closeSettings() {
    settingsOpenRef.current = false;
    setSettingsOpen(false); setSettingsPage('settings');
    clearInput();
  }

  function updateReplay(patch: Partial<typeof replay>) {
    const next = { ...replayRef.current, ...patch };
    replayRef.current = next; setReplay(next);
  }

  function setReplayRecording(enabled: boolean) {
    updateReplay({ recording: enabled, count: 0, status: enabled ? 'Recording calibration and check frames for this session only.' : '' });
    if (sessionRef.current.kind === 'camera') void camera.setRecording(enabled);
  }

  async function recordReplay(point: Point, at: number, box: Viewport) {
    if (await camera.record(point, at, box)) updateReplay({ count: replayRef.current.count + 1 });
  }

  /** Writes the recorded replay set to a file the person chooses to keep; nothing is stored by the app. */
  async function exportReplayFile() {
    try {
      const exported = await camera.exportReplay();
      if (!exported || !exported.entries.length) { updateReplay({ status: 'Nothing recorded yet. Turn recording on, then calibrate and run a check.' }); return; }
      const geometry = camera.geometry();
      const blob = buildReplayFile({ createdAt: Date.now(), model: MODEL_VERSION, viewport: viewport(), pixelRatio: window.devicePixelRatio || 1, camera: geometry ? { width: geometry.width, height: geometry.height } : null }, exported.entries, exported.images);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `clarte-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      updateReplay({ status: `Saved ${exported.entries.length} frames (${(blob.size / 1e6).toFixed(1)} MB).` });
    } catch (error) { updateReplay({ status: `Replay export failed: ${error instanceof Error ? error.message : 'unknown error'}` }); }
  }

  function openSettings() {
    stopSpeech();
    pauseCalibration();
    pauseValidation('settings');
    clearInput();
    settingsOpenRef.current = true;
    setSettingsOpen(true);
  }

  function changeSettings(next: SettingsValue) {
    settingsRef.current = next;
    setSettings(next);
    camera.preview(false);
    clearInput();
    if (sessionRef.current.kind === 'camera' && sessionRef.current.phase === 'calibration' && calibrationRun.current.pace !== next.pace) resetCalibration();
    stopSpeech();
  }

  function validate() {
    if (sessionRef.current.kind !== 'camera' || calibrationRun.current.state.kind !== 'complete') return;
    closeSettings(); closeControls();
    stopSpeech();
    clearInput();
    prepareValidation();
    send({ type: 'validate' });
  }

  function clearValidation() {
    validationRun.current?.cancel('session');
    validationRun.current = null;
    setValidation({ kind: 'ready' });
  }

  function prepareValidation(condition: CheckCondition = 'still') {
    validationRun.current?.cancel('restart');
    try {
      validationRun.current = new ValidationRun(viewport(), condition, checkMotion());
      setValidation(validationRun.current.state);
      camera.preview(false);
    } catch {
      validationRun.current = null;
      setValidation({ kind: 'cancelled', reason: 'viewport' });
    }
    clearInput(); stopSpeech();
  }

  function startValidation() {
    if (sessionRef.current.kind !== 'camera' || sessionRef.current.phase !== 'validation' || calibrationRun.current.state.kind !== 'complete' || document.hidden || settingsOpenRef.current) return;
    pageFocused.current = true;
    if (!validationRun.current || !['ready', 'intro', 'intro-paused'].includes(validationRun.current.state.kind) || validationRun.current.motion !== checkMotion()) prepareValidation();
    const run = validationRun.current;
    if (run?.state.kind === 'ready') { run.introduce(performance.now()); clearInput(); setValidation(run.state); return; }
    if (run?.start(performance.now())) { clearInput(); stopSpeech(); setValidation(run.state); }
  }

  function pauseValidation(reason: PauseReason) {
    const run = validationRun.current;
    run?.pause(performance.now(), reason);
    if (sessionRef.current.kind === 'camera' && sessionRef.current.phase === 'validation' && run?.state.kind === 'complete') {
      controlsRef.current = 'Paused'; setControls('Paused');
    }
    if (run) setValidation(run.state);
    clearInput();
  }

  function resumeValidation() {
    if (document.hidden || settingsOpenRef.current) return;
    pageFocused.current = true; setRecovery(''); missingSince.current = null;
    clearInput(); stopSpeech();
    const run = validationRun.current;
    if (run?.resume(performance.now())) setValidation(run.state);
  }

  function tickValidation(now: number) {
    const current = sessionRef.current, run = validationRun.current;
    if (current.kind !== 'camera' || current.phase !== 'validation' || !run) return;
    run.tick(now, !document.hidden && pageFocused.current && !settingsOpenRef.current && !controlsRef.current);
    setValidation(run.state);
    if (run.state.kind === 'complete' && !document.hidden && pageFocused.current && !settingsOpenRef.current && !controlsRef.current) openPhrases();
  }

  function openPhrases() {
    const run = validationRun.current;
    if (run && run.state.kind !== 'complete') { run.cancel('manual'); setValidation(run.state); }
    stopSpeech();
    clearInput();
    camera.preview(false);
    send({ type: 'compose' });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      setClock(now);
      const current = sessionRef.current;
      if (current.kind === 'simulation' && !settingsOpenRef.current && !controlsRef.current && !document.hidden && pageFocused.current) {
        const point = simulationPoint.current;
        if (point) {
          const closed = now < simulatedClosureUntil.current;
          void onFrame({ point: closed ? null : point, face: !closed, facePresent: true, eyeState: closed ? 'closed' : 'open', at: now, pose: null });
        } else cancelGaze();
      } else {
        updateDwell({ type: 'tick', now });
        if (current.kind === 'camera') {
          const blinkMode = current.phase === 'compose' && settingsRef.current.selection === 'blink';
          if (blinkMode) { blink.tick(now); setBlinkPreview(blink.state.kind === 'preview' ? blink.state.target : null); }
          updateTracking(frameRef.current, now, !blinkMode);
        }
        tickValidation(now);
        if (current.kind === 'camera' && current.phase === 'calibration' && !settingsOpenRef.current && !controlsRef.current) {
          if (document.hidden || !pageFocused.current) calibrationRun.current.pause();
          else calibrationRun.current.tick(now, frameRef.current);
          syncCalibration(); advanceCalibration();
        }
        recoverMissingTracking(now);
      }
    }, 100);
    const hidden = () => {
      if (!document.hidden) return;
      const current = sessionRef.current;
      if (current.kind === 'camera' && current.phase === 'validation') { pauseValidation('hidden'); stopSpeech(); }
      else if (current.kind === 'camera' && current.phase === 'calibration') { pauseCalibration(); clearInput(); stopSpeech(); }
      else if (['camera', 'starting', 'simulation'].includes(current.kind)) stopSession(true);
    };
    const leave = () => { pageFocused.current = false; pauseCalibration(); pauseValidation('focus'); clearInput(); stopSpeech(); if (sessionRef.current.kind === 'camera' && sessionRef.current.phase === 'compose' || sessionRef.current.kind === 'simulation') openControls(); };
    const focus = () => { pageFocused.current = true; };
    const pageHide = () => stopSession(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && !event.repeat && !(event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) { simulateBlink(); return; }
      const interactive = event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea');
      if ((event.key === 'Escape' || (event.code === 'Space' || event.key === ' ') && !interactive && sessionRef.current.kind === 'camera' && sessionRef.current.phase !== 'compose') && !settingsOpenRef.current) { event.preventDefault(); openControls(); }
    };
    const fullscreenChanged = () => {
      if (calibrationRun.current.state.kind !== 'resetting') pauseCalibration();
      pauseValidation('manual');
      clearInput();
    };
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionChanged = () => {
      const run = validationRun.current;
      if (!run || run.motion === checkMotion()) return;
      if (run.state.kind === 'ready' || run.state.kind === 'intro' || run.state.kind === 'intro-paused') prepareValidation();
      else if (run.state.kind === 'running' || run.state.kind === 'paused') {
        run.cancel('motion'); setValidation(run.state); clearInput();
      }
    };
    const resize = () => {
      const next = { ...viewport(), pixelRatio: window.devicePixelRatio || 1 }, previous = inputViewport.current;
      if (next.width === previous.width && next.height === previous.height && next.pixelRatio === previous.pixelRatio) return;
      inputViewport.current = next;
      clearInput();
      if (sessionRef.current.kind === 'camera' && sessionRef.current.phase === 'calibration' && calibrationRun.current.state.kind === 'ready' && savedChoiceRef.current && !restoringRef.current) { resetLabels(); chooseSaved(true); return; }
      const run = validationRun.current;
      if (run && (run.viewport.width !== window.innerWidth || run.viewport.height !== window.innerHeight)) {
        run.cancel('viewport'); setValidation(run.state);
      }
      if (sessionRef.current.kind === 'camera' && (sessionRef.current.phase === 'calibration' || viewportChanged(calibrationViewport.current, viewport()))) {
        resetCalibration();
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SAVED_CALIBRATION_KEY) return;
      savedStore.externalChange();
      clearInput();
      try { const saved = savedStore.load(); savedModelRef.current = saved; setSavedModel(saved); setSavedStatus(saved ? 'Saved calibration changed in another tab.' : 'Saved calibration removed in another tab.'); }
      catch { savedModelRef.current = null; setSavedModel(null); setSavedStatus('Saved calibration changed but could not be loaded. Recalibrate or delete it.'); }
      if (restoringRef.current) void resetCalibration();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    window.addEventListener('storage', storageChanged);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    motionQuery?.addEventListener('change', motionChanged);
    window.addEventListener('scroll', clearInput, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
      window.removeEventListener('storage', storageChanged);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      motionQuery?.removeEventListener('change', motionChanged);
      window.removeEventListener('scroll', clearInput, true);
      camera.stop();
      savedStore.invalidate();
      validationRun.current?.cancel('session');
      window.speechSynthesis?.cancel();
    };
    // Session, dwell, settings and calibration are read through their current refs by these long-lived listeners.
  }, []);

  // The same active clock drives both smooth movement and scoring; no CSS travel deadline.
  useEffect(() => {
    if (phase !== 'validation' || validation.kind !== 'running' || typeof window.requestAnimationFrame !== 'function') return;
    let id = 0;
    const animate = () => { tickValidation(performance.now()); id = window.requestAnimationFrame(animate); };
    id = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(id);
  }, [phase, validation.kind]);

  function recoverMissingTracking(now: number) {
    const current = sessionRef.current;
    const running = current.kind === 'camera' && (current.phase === 'compose' || current.phase === 'calibration' && ['moving', 'settling', 'sampling', 'collecting'].includes(calibrationRun.current.state.kind) || current.phase === 'validation' && validationRun.current?.state.kind === 'running');
    if (!running || controlsRef.current || settingsOpenRef.current || document.hidden || !pageFocused.current || freshFeatures(frameRef.current, now)) { missingSince.current = null; return; }
    missingSince.current ??= now;
    if (now - missingSince.current < 8000) return;
    const title = frameRef.current.facePresent ? 'Tracking paused' : 'Face not detected';
    setRecovery(title); openControls(title);
  }

  const active = session.kind === 'camera' || session.kind === 'simulation';
  const isCamera = session.kind === 'camera';
  const isSimulation = session.kind === 'simulation';
  const calibrationMode = isCamera && session.phase === 'calibration';
  const validationMode = isCamera && session.phase === 'validation';
  const composeMode = active && session.phase === 'compose';
  const geometry = isCamera ? currentGeometry() : null;
  const savedCompatibility = savedModel && geometry ? calibrationCompatibility(savedModel.geometry, geometry).compatible : false;
  const calibrationPaused = calibrationMode && !['moving', 'settling', 'sampling', 'collecting'].includes(calibration.kind);
  const validationPaused = validationMode && validation.kind !== 'running';
  const showDiagnostics = settings.pointer && active && !controls && !settingsOpen && !calibrationPaused && !validationPaused && !document.hidden && pageFocused.current && freshFeatures(frame, clock) && area;
  const background = (target: EventTarget) => {
    if (target instanceof HTMLElement && target.closest('button, select, input, dialog')) return;
    openControls();
  };
  return <div className={`app-shell ${settings.selection === 'blink' ? 'blink-mode' : ''}`} onPointerMove={event => {
    if (sessionRef.current.kind === 'simulation' && event.pointerType !== 'touch' && !(event.target instanceof HTMLElement && event.target.closest('button:not([data-dwell])'))) simulationPoint.current = { x: event.clientX, y: event.clientY };
  }} onPointerLeave={() => { simulationPoint.current = null; if (sessionRef.current.kind === 'simulation') clearInput(); }}>
    <main id="main" className="workspace" inert={settingsOpen} hidden={settingsOpen} aria-hidden={settingsOpen} onClick={event => background(event.target)}>
      {controls ? <StagePage title={controls} alert={Boolean(recovery)}>
        {active && <button className="primary-button" onClick={resumeControls}>{simulationEntry ? 'Start simulation' : 'Continue'}</button>}
        {isCamera && <button onClick={() => { void resetCalibration(); }}>Recalibrate</button>}
        <button onClick={openSettings}>Settings</button>
        {(active || session.kind === 'starting') ? <button onClick={() => stopSession()}>Stop</button> : <button onClick={closeControls}>Back</button>}
      </StagePage> : <>
        {!active && <StagePage title={session.kind === 'starting' ? 'Starting camera' : session.kind === 'error' ? 'Camera unavailable' : session.kind === 'paused' ? 'Paused' : 'Start camera'} alert={session.kind === 'error'}>
          {session.kind === 'starting' ? <button onClick={() => stopSession()}>Cancel</button> : <button className="primary-button" onClick={() => { if (session.kind === 'paused' && session.mode === 'simulation') simulate(); else void startCamera(); }}>{session.kind === 'error' ? 'Retry' : session.kind === 'paused' ? 'Continue' : 'Start camera'}</button>}
          {session.kind === 'error' && <button onClick={() => stopSession()}>Stop</button>}
        </StagePage>}
        {calibrationMode && <Calibration state={calibration} point={calibrationRun.current.point} viewport={calibrationRun.current.viewport} pace={settings.pace} status={savedStatus} recovery={recovery}
          saved={savedChoice && Boolean(savedModel)} compatible={savedCompatibility} busy={restoring} onUse={() => { void useSavedCalibration(); }}
          onToggle={toggleCalibration} onRestart={() => { void resetCalibration(); }} onCancel={() => stopSession()} />}
        {validationMode && <Validation state={validation} position={validationRun.current?.position ?? null} recovery={recovery} reducedMotion={checkMotion() === 'reduced'}
          onStart={startValidation} onPause={() => pauseValidation('manual')} onResume={resumeValidation} onCancel={() => stopSession()}
          onRestart={() => { prepareValidation(); startValidation(); }} onRecalibrate={() => { void resetCalibration(); }} onPhrases={openPhrases} />}
        {composeMode && <section className="navigation-grid" aria-label={isSimulation ? 'Simulation targets, camera off' : 'Navigation targets'} onClick={event => background(event.target)}>
          {NAVIGATION_TARGETS.map(target => <DwellTarget key={target.id} id={target.id} label={target.label} state={dwell} preview={blinkPreview === target.id}
            selected={selected?.id === target.id} activation={selected?.id === target.id ? selected.sequence : 0} onClick={event => selectTarget(target.id, false, event.detail === 0)} />)}
        </section>}
      </>}
    </main>
    {active && !controls && !settingsOpen && <button className="diagnostic-toggle" aria-label="Toggle gaze diagnostics" title="Toggle gaze diagnostics" aria-pressed={settings.pointer} onClick={() => { const next = { ...settingsRef.current, pointer: !settingsRef.current.pointer }; settingsRef.current = next; setSettings(next); }}><Icon name="eye" /></button>}
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    <span className="sr-only" role="status">{isCamera ? 'Camera on' : isSimulation ? 'Simulation · camera off' : 'Camera off'}</span>
    {showDiagnostics && <div className="gaze-area" style={{ left: showDiagnostics.x, top: showDiagnostics.y, width: showDiagnostics.radius * 2, height: showDiagnostics.radius * 2 }} aria-hidden="true"><i /></div>}
    {settingsOpen && <Settings value={settings} camera={isCamera} simulation={isSimulation} canValidate={isCamera && !calibrationMode && calibrationRun.current.state.kind === 'complete'}
      onChange={changeSettings} onClose={closeSettings} savedStatus={savedStatus} hasSaved={Boolean(savedModel) || Boolean(savedStatus)} fullscreenError={fullscreenError} onFullscreen={() => { void fullscreen(); }}
      check={lastCheck} page={settingsPage} onPage={setSettingsPage}
      developer={import.meta.env.DEV ? { recording: replay.recording, count: replay.count, status: replay.status, onRecording: setReplayRecording, onSave: () => { void exportReplayFile(); } } : null}
      onDeleteSaved={() => { void deleteSavedCalibration(); }} onReset={() => { void resetCalibration(); }} onValidate={validate} onSimulation={simulate} onCamera={() => { void startCamera(); }} onStop={() => { closeSettings(); stopSession(); }} />}
  </div>;
}
