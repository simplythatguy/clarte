import { MODEL_VERSION } from '../core/saved-calibration';
import { buildReplayFile } from '../core/replay-file';
import type { TrainingReport } from '../core/training';
import type { Point, Viewport } from '../core/tracking';
import { cameraMessage, el } from './app';
import { cmPerCssPx, windowMetrics } from './layout';
import { FrameLog, type FrameRow, type QuickOut, type Screen } from './frames';
import { Uploader, type UploadStatus } from './uploader';
import { VideoRecorder } from './recorder';
import { DemoTracker, LiveTracker, type ShadowInit, type Tracker, type TrackerFrame } from './tracker';
import { QUICK_BLOCK, QUICK_INTRO, QUICK_TIMING, QUICK_WORKER, QuickRun, type QuickTarget } from './quick';
import { BASELINE_WORKER, DWELL_TIMING, Dwell, QUADRANT_COUNT, TRIAL_TIMING, TrialRun, calibrationTargets, decideQuadrant, quadrants, tally, trialSchedule, usablePoint, type Quadrant, type Round, type Selection, type Trial, type TrialPosition } from './simple';

/** `?tester=&diag=&demo=1&dwell=0&test=guided&rounds=&feedback=0` (dwell=0 starts free look without dwelling; rounds and feedback apply to the guided test); everything else is fixed so the tester sees only Start. */
export type SimpleQuery = { demo: boolean; tester: string; diagonalIn: number; test: 'free' | 'guided'; dwell: boolean; rounds: number; feedback: boolean; server: string };
export function readSimpleQuery(q: URLSearchParams): SimpleQuery {
  const rounds = Math.floor(Number(q.get('rounds'))), diag = Number(q.get('diag'));
  return { demo: q.get('demo') === '1', tester: q.get('tester')?.trim() || 'tester', diagonalIn: diag > 0 ? diag : 14.2, test: q.get('test') === 'guided' ? 'guided' : 'free', dwell: q.get('dwell') !== '0', rounds: rounds >= 1 && rounds <= 20 ? rounds : 3, feedback: q.get('feedback') !== '0', server: q.get('server') ?? '' };
}
export const TEST_BLOCK = 'T';
export const FREE_BLOCK = 'F';
/** The test's one-line introduction and how long it shows before the first trial. */
export const TEST_INTRO = 'Look at the dot';
export const TEST_INTRO_MS = 2000;
/** The live highlight follows the median of the candidate's estimates over this window (capture time). */
export const LIVE_WINDOW_MS = 400;
type Ui =
  | { kind: 'start'; cameraState: 'off' | 'starting'; message: string }
  | { kind: 'calibration' }
  | { kind: 'test' }
  | { kind: 'paused' }
  | { kind: 'finishing' }
  | { kind: 'result' }
  | { kind: 'error'; message: string };
type ModelRecord = { init: ShadowInit | null; trainingReport: TrainingReport | null; error: string | null; learnedSaved: boolean };
const freshModel = (): ModelRecord => ({ init: null, trainingReport: null, error: null, learnedSaved: false });
type CalibrationRecord = { startedAt: number | null; collectedAt: number | null; trainedAt: number | null; labels: { candidate: number; baseline: number }; pauses: number; candidate: ModelRecord; baseline: ModelRecord };
/** One decision per stream: the quadrant the median of its record frames selects, null without usable frames. */
type Decision = { candidate: { blend: number | null; network: number | null }; baseline: { blend: number | null; network: number | null } };
type TrialRecord = Trial & { startedAt: number | null; endedAt: number | null; shown: { quadrant: number | null; correct: boolean } | null; decision: Decision | null };
/** Free look: the dwell over the live quadrant and every selection so far; `shownAt` is when the green border appeared. */
type FreeRun = { dwell: Dwell; selections: (Selection & { index: number; shownAt: number })[]; startedAt: number; endedAt: number | null; pauses: number; dwellAtStart: boolean; toggles: { at: number; dwell: boolean }[] };
/** The four decided streams (normalized estimates): the candidate from the shadow worker, the baseline from the primary. */
type Streams = { candidateBlend: number[] | null; candidateNetwork: number[] | null; baselineBlend: number[] | null; baselineNetwork: number[] | null };
const STREAM_NAMES = ['candidateBlend', 'candidateNetwork', 'baselineBlend', 'baselineNetwork'] as const;
const streamsOfFrame = (f: TrackerFrame): Streams => ({ candidateBlend: f.shadow?.rawNormPog ?? null, candidateNetwork: f.shadow?.estimates?.network ?? null, baselineBlend: f.gaze.rawNormPog, baselineNetwork: f.gaze.estimates?.network ?? null });
const streamsOfRow = (r: FrameRow): Streams => ({ candidateBlend: r.quick?.rawNormPog ?? null, candidateNetwork: r.quick?.network ?? null, baselineBlend: r.rawNormPog, baselineNetwork: r.network });
const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
const sanitize = (s: string) => s.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tester';

/**
 * The default flow: Start → calibration on the 8 quadrant centres (Q8, ~20 s; the candidate trains in a shadow worker with
 * the pose rows frozen and the blend capped, the baseline in the primary worker with shipped training on the same frames)
 * → free look on the navigation quadrants: the blue quadrant follows the candidate's live estimate and a 2 s look selects
 * it (a green border for 0.4 s), until Esc or a click pauses with Finish → one result grid of selections. The Paused screen's
 * Dwell switch (or `?dwell=0`) turns dwelling off: the blue quadrant is then the live quadrant itself, at once, and nothing
 * is selected.
 * `?test=guided` runs the measured test instead: `rounds` × 8 trials with a dot, the decision shown for 0.4 s, a hit rate.
 * Recording is as in the research flow (frames, landmarks, video, eye strips; free look has no target to label a test
 * strip with, so its strips are the calibration's); nothing is asked of the tester but Start.
 */
export class SimpleApp {
  private ui: Ui = { kind: 'start', cameraState: 'off', message: '' };
  private tracker: Tracker | null = null;
  private backend = '';
  private meta: { commit: string | null; workerSha256: string | null; shippedWorkerSha256: string | null } | null = null;
  private sessionId = '';
  private seed = 0;
  private uploader: Uploader | null = null;
  private uploadStatus: UploadStatus | null = null;
  private log: FrameLog | null = null;
  private rows: FrameRow[] = [];
  private recorder: VideoRecorder | null = null;
  private videoBytes = 0;
  private videoChunks = 0;
  private sessionViewport: Viewport = viewport();
  private quadrants: Quadrant[] = [];
  private targets: QuickTarget[] = [];
  private quickRun: QuickRun | null = null;
  private calibration: CalibrationRecord = this.freshCalibration();
  private schedule: { rounds: Round[]; trials: Trial[] } = { rounds: [], trials: [] };
  private trialRun: TrialRun | null = null;
  private trials: TrialRecord[] = [];
  private free: FreeRun | null = null;
  /** Free look's Dwell switch; it stays as set for later sessions on this page. */
  private dwellOn: boolean;
  /** Candidate-blend points of the record window in progress, for the live feedback. */
  private live: { key: string; points: Point[] } = { key: '', points: [] };
  /** The candidate's recent points during the test (capture time, px), for the live "where you are looking" highlight. */
  private gazeWindow: { at: number; p: Point }[] = [];
  private liveQuadrant: number | null = null;
  /** True while the one-line test introduction is on screen, before the first trial. */
  private testIntro = false;
  private stripIndex = new Map<number, { block: string; point: number }>();
  private animation = 0;
  private lastScreen = '';
  private result: ReturnType<typeof tally> | null = null;
  /** Readiness gate before the dots: both workers warm (the first frame of each compiles shaders for seconds) and a face in view. */
  private ready: { resolve: () => void; frames: number; since: number; faceMissing: boolean } | null = null;

  constructor(private readonly root: HTMLElement, private readonly query: SimpleQuery) { this.dwellOn = query.dwell; }
  mount(): void {
    window.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    window.addEventListener('pagehide', () => this.log?.flush());
    void fetch(`${this.query.server}/api/meta`).then(r => r.json()).then(m => { this.meta = m; }).catch(() => { this.meta = null; });
    this.render();
  }
  private freshCalibration(): CalibrationRecord { return { startedAt: null, collectedAt: null, trainedAt: null, labels: { candidate: 0, baseline: 0 }, pauses: 0, candidate: freshModel(), baseline: freshModel() }; }
  private get screen(): Screen { return this.ui.kind === 'calibration' ? 'quick' : this.ui.kind === 'test' || this.ui.kind === 'paused' ? 'test' : this.ui.kind === 'result' || this.ui.kind === 'finishing' ? 'result' : 'setup'; }
  private set(ui: Ui): void { this.ui = ui; this.render(); }
  private cmPerPx(): number | null { const v = cmPerCssPx(this.query.diagonalIn, screen, window.devicePixelRatio || 1); return Number.isFinite(v) ? v : null; }

  // ---- start / camera ----
  /** Start: full screen (best effort, needs the click), camera + both workers, then straight into calibration. */
  private async start(): Promise<void> {
    if (this.ui.kind !== 'start' || this.ui.cameraState !== 'off') return;
    void document.documentElement.requestFullscreen?.().catch(() => {});
    this.set({ kind: 'start', cameraState: 'starting', message: '' });
    if (!(await this.startCamera())) return;
    await this.beginSession();
  }
  private async startCamera(): Promise<boolean> {
    const tracker: Tracker = this.query.demo ? new DemoTracker() : new LiveTracker();
    this.tracker = tracker;
    try { this.backend = await tracker.start(f => this.onFrame(f), error => this.fail(error), { ...BASELINE_WORKER }); return true; }
    catch (error) { this.tracker = null; this.set({ kind: 'start', cameraState: 'off', message: cameraMessage(error) }); return false; }
  }
  private fail(error: unknown): void {
    cancelAnimationFrame(this.animation);
    this.tracker?.stop(); this.tracker = null;
    this.log?.flush();
    this.set({ kind: 'error', message: cameraMessage(error) });
  }
  /** A new session on the running tracker: ids, recording, the quadrant geometry, the trial schedule, the candidate's shadow worker, then Q8. */
  private async beginSession(): Promise<void> {
    const tracker = this.tracker;
    if (!tracker) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionId = `${stamp}-${sanitize(this.query.tester)}${this.query.demo ? '-demo' : ''}`;
    this.seed = (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0;
    const uploader = new Uploader(this.query.server, this.sessionId, s => { if (this.uploader === uploader) this.uploadStatus = s; });
    this.uploader = uploader;
    this.uploadStatus = null; this.rows = []; this.videoBytes = 0; this.videoChunks = 0; this.result = null; this.trialRun = null; this.trials = []; this.free = null;
    this.log = new FrameLog((jsonl, landmarks) => { if (jsonl) uploader.enqueue('frames', jsonl); if (landmarks) uploader.enqueue('landmarks', landmarks); });
    const stream = tracker.mediaStream();
    this.recorder = stream && typeof MediaRecorder !== 'undefined' ? new VideoRecorder(stream, chunk => { if (this.uploader !== uploader) return; this.videoBytes += chunk.size; this.videoChunks++; uploader.enqueue('video', chunk); }) : null;
    this.sessionViewport = viewport();
    this.quadrants = quadrants(this.sessionViewport);
    this.targets = calibrationTargets(this.quadrants, this.sessionViewport);
    this.schedule = this.query.test === 'guided' ? trialSchedule(this.query.rounds, this.seed) : { rounds: [], trials: [] };
    this.calibration = this.freshCalibration();
    this.calibration.baseline.init = tracker.primaryInit;
    await tracker.setRecording(true);
    try { this.calibration.candidate.init = await tracker.startShadow({ ...QUICK_WORKER }); }
    catch (error) { this.fail(error); return; }
    const run = new QuickRun(this.targets, QUICK_TIMING);
    this.quickRun = run;
    this.lastScreen = '';
    this.saveSession();
    this.set({ kind: 'calibration' });
    await this.awaitReady();
    if (this.quickRun !== run || this.ui.kind !== 'calibration') return;
    this.startQuick();
  }
  /** Resolves after three consecutive frames that carry both workers' results and a face; after 3 s without one, the screen says so. */
  private awaitReady(): Promise<void> {
    return new Promise(resolve => { this.ready = { resolve, frames: 0, since: performance.now(), faceMissing: false }; });
  }
  private gate(f: TrackerFrame): void {
    const r = this.ready;
    if (!r) return;
    if (f.shadow && f.gaze.facePresent) { if (++r.frames >= 3) { this.ready = null; if (r.faceMissing) this.render(); r.resolve(); } return; }
    r.frames = 0;
    if (!r.faceMissing && f.shadow && performance.now() - r.since > 3000) { r.faceMissing = true; this.render(); }
  }

  // ---- frames ----
  private async onFrame(f: TrackerFrame): Promise<void> {
    if (!this.log) return;
    this.gate(f);
    let block: string | null = null, point: number | null = null, phase: string | null = null, target: FrameRow['target'] = null, trial: FrameRow['trial'] = null;
    if (this.ui.kind === 'calibration' && this.quickRun) {
      block = QUICK_BLOCK;
      const pos = this.quickRun.classify(f.at);
      if (pos) {
        phase = pos.phase;
        if (pos.phase !== 'intro') {
          const t = this.targets[pos.index];
          point = t.index; target = { x: t.x, y: t.y, nx: t.nx, ny: t.ny };
          // Both workers are offered the same frame as a label; the row's phase follows the candidate.
          if (pos.phase === 'collect' && f.gaze.face) {
            const [candidate, baseline] = await Promise.all([this.tracker!.shadowCollect([t.nx, t.ny], f.at), this.tracker!.collect([t.nx, t.ny], f.at)]);
            if (candidate) { this.calibration.labels.candidate++; phase = 'quick:label'; }
            if (baseline) this.calibration.labels.baseline++;
          }
        }
      } else phase = this.quickRun.state.kind === 'training' ? 'training' : this.quickRun.state.kind === 'paused' ? 'paused' : null;
    } else if ((this.ui.kind === 'test' || this.ui.kind === 'paused') && this.trialRun) {
      block = TEST_BLOCK;
      if (this.ui.kind === 'test' && !this.testIntro) this.updateLiveQuadrant(f);
      const pos = this.trialRun.classify(f.at);
      if (pos) {
        const q = this.quadrants[pos.trial.quadrant];
        point = q.id; phase = pos.phase; trial = { index: pos.index, round: pos.trial.round, attempt: pos.attempt };
        target = { x: q.centre.x, y: q.centre.y, nx: q.centre.x / this.sessionViewport.width - .5, ny: q.centre.y / this.sessionViewport.height - .5 };
        if (pos.phase === 'record') {
          if (f.gaze.face) { this.stripIndex.set(f.at, { block: TEST_BLOCK, point: q.id }); await this.tracker!.record([target.nx, target.ny], f.at).catch(() => false); } // awaited: the worker rejects a frame while it is still encoding the previous strip
          const key = `${pos.index}:${pos.attempt}`;
          if (this.live.key !== key) this.live = { key, points: [] };
          const p = usablePoint(f.gaze, streamsOfFrame(f).candidateBlend, this.sessionViewport);
          if (p) this.live.points.push(p);
        }
      } else phase = this.ui.kind === 'paused' ? 'paused' : null;
    } else if ((this.ui.kind === 'test' || this.ui.kind === 'paused') && this.free) {
      block = FREE_BLOCK;
      if (this.ui.kind === 'test') {
        this.updateLiveQuadrant(f);
        const free = this.free;
        if (this.dwellOn) {
          const selected = free.dwell.step(f.at, this.liveQuadrant);
          if (selected) free.selections.push({ index: free.selections.length, ...selected, shownAt: performance.now() });
          point = free.dwell.quadrant; phase = selected ? 'select' : free.dwell.state.kind;
        } else { point = this.liveQuadrant; phase = 'look'; }
      } else phase = 'paused';
    }
    const d = f.debug;
    const row = this.log.add({
      t: f.at, videoT: this.recorder ? this.recorder.time(f.at) : null, screen: this.screen, block, point, phase, target,
      rawNormPog: f.gaze.rawNormPog, network: f.gaze.estimates?.network ?? null, geometric: f.gaze.estimates?.geometric ?? null, normPog: f.gaze.face ? f.gaze.normPog : null,
      pointer: f.frame.point ? [f.frame.point.x, f.frame.point.y] : null,
      facePresent: f.gaze.facePresent, face: f.gaze.face, eyeState: f.gaze.eyeState, pose: f.gaze.pose ?? null, camera: f.gaze.camera ?? null,
      headVector: d?.headVector ?? null, faceOrigin3D: d && f.gaze.facePresent ? d.faceOrigin3D : null, faceRt: d?.faceRt ?? null, features12: d?.featureVector ?? null, gaze: d?.features ?? null,
      timings: d?.timings ?? null, candidate: null, viewport: f.viewport, quick: this.quickFor(f), trial,
    }, d && f.gaze.facePresent ? d.landmarks : null);
    this.rows.push(row);
  }
  /**
   * The quadrant the candidate says the person is looking at right now: the per-axis median of its usable estimates over
   * the last LIVE_WINDOW_MS (capture time), mapped like a decision. Free look dwells on it; the guided test only shows it
   * (its decisions use the record window).
   */
  private updateLiveQuadrant(f: TrackerFrame): void {
    const p = usablePoint(f.gaze, streamsOfFrame(f).candidateBlend, this.sessionViewport);
    if (p) this.gazeWindow.push({ at: f.at, p });
    this.gazeWindow = this.gazeWindow.filter(g => f.at - g.at <= LIVE_WINDOW_MS);
    this.liveQuadrant = this.gazeWindow.length ? decideQuadrant(this.gazeWindow.map(g => g.p), this.quadrants) : null;
  }
  /** The candidate (shadow worker) stream for this frame: blend at the capped share, network, geometric. */
  private quickFor(f: TrackerFrame): QuickOut | null {
    const s = f.shadow;
    return s && s.face ? { rawNormPog: s.rawNormPog, network: s.estimates?.network ?? null, geometric: s.estimates?.geometric ?? null } : null;
  }

  // ---- calibration (Q8, both models) ----
  private startQuick(): void {
    const run = this.quickRun;
    if (!run || this.ui.kind !== 'calibration' || !run.start(performance.now())) return;
    this.calibration.startedAt ??= performance.now();
    this.render();
    this.animateQuick();
  }
  private animateQuick(): void {
    cancelAnimationFrame(this.animation);
    const step = () => {
      const run = this.quickRun;
      if (!run || this.ui.kind !== 'calibration') return;
      run.tick(performance.now());
      if (run.state.kind === 'collected') { void this.train(); return; }
      this.renderQuick();
      this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }
  /** Trains both models on the Q8 labels at once; a failure on either side ends the session with its reason. */
  private async train(): Promise<void> {
    const run = this.quickRun, tracker = this.tracker;
    if (!run || !tracker || !run.beginTraining()) return;
    this.calibration.collectedAt = performance.now();
    this.render();
    const { primary, shadow } = await tracker.trainBoth();
    this.calibration.trainedAt = performance.now();
    const take = (r: PromiseSettledResult<TrainingReport | null>, m: ModelRecord) => { if (r.status === 'fulfilled') m.trainingReport = r.value; else m.error = r.reason instanceof Error ? r.reason.message : String(r.reason); };
    take(primary, this.calibration.baseline); take(shadow, this.calibration.candidate);
    if (this.calibration.candidate.error || this.calibration.baseline.error) {
      run.fail(this.calibration.candidate.error ?? this.calibration.baseline.error ?? 'training failed');
      this.log?.flush(); this.saveSession(); this.render();
      return;
    }
    run.finishTraining();
    const learnedBaseline = await tracker.exportCalibration(), learnedCandidate = await tracker.shadowExportCalibration(); // one model command at a time
    if (learnedBaseline) { this.calibration.baseline.learnedSaved = true; this.uploader?.enqueue('calibration', JSON.stringify({ format: 'GAZE-LAB-CALIBRATION-1', model: MODEL_VERSION, learned: learnedBaseline, trainingReport: this.calibration.baseline.trainingReport, baseline: BASELINE_WORKER })); }
    if (learnedCandidate) { this.calibration.candidate.learnedSaved = true; this.uploader?.enqueue('quickcalibration', JSON.stringify({ format: 'GAZE-LAB-CALIBRATION-1', model: MODEL_VERSION, learned: learnedCandidate, trainingReport: this.calibration.candidate.trainingReport, quick: QUICK_WORKER })); }
    await this.exportStrips();
    this.log?.flush();
    this.saveSession();
    this.startTest();
  }
  private renderQuick(): void {
    const run = this.quickRun;
    if (!run || this.ui.kind !== 'calibration') return;
    const pos = run.position(performance.now());
    const screen = !pos ? run.state.kind : pos.phase === 'intro' ? 'intro' : 'dot';
    if (screen !== this.lastScreen) { this.lastScreen = screen; this.render(); }
    const dot = document.getElementById('dot');
    if (!pos || pos.phase === 'intro' || !dot) return;
    const t = this.targets[pos.index];
    dot.style.left = `${t.x}px`; dot.style.top = `${t.y}px`;
    dot.className = `validation-dot is-${pos.phase === 'collect' ? 'record' : 'travel'}`;
    dot.style.setProperty('--ring', `${Math.round((1 - (pos.phase === 'collect' ? pos.progress : 0)) * 60)}px`);
  }

  // ---- test ----
  /** Free look straight away; the guided test shows one line ("Look at the dot") for TEST_INTRO_MS, then the trials. */
  private startTest(): void {
    this.lastScreen = '';
    this.gazeWindow = []; this.liveQuadrant = null;
    if (this.query.test === 'free') {
      this.free = { dwell: new Dwell(), selections: [], startedAt: performance.now(), endedAt: null, pauses: 0, dwellAtStart: this.dwellOn, toggles: [] };
      this.set({ kind: 'test' });
      if (document.hidden) this.pause(); else this.animateFree();
      return;
    }
    const run = new TrialRun(this.schedule.trials, TRIAL_TIMING, this.query.feedback);
    this.trialRun = run;
    this.trials = this.schedule.trials.map(t => ({ ...t, startedAt: null, endedAt: null, shown: null, decision: null }));
    this.testIntro = true;
    this.set({ kind: 'test' });
    window.setTimeout(() => {
      if (this.trialRun !== run || this.ui.kind !== 'test' || run.state.kind !== 'ready') return;
      this.testIntro = false;
      // Hidden meanwhile: wait behind Paused; Continue starts the first trial.
      if (document.hidden) { this.set({ kind: 'paused' }); return; }
      this.render();
      run.start(performance.now());
      this.trials[0].startedAt = performance.now();
      this.animateTest();
    }, TEST_INTRO_MS);
  }
  private lastTrialKey = '';
  private animateTest(): void {
    cancelAnimationFrame(this.animation);
    const step = () => {
      const run = this.trialRun;
      if (!run || this.ui.kind !== 'test') return;
      const now = performance.now();
      run.tick(now);
      if (run.state.kind === 'complete') { this.closeRecording(now); void this.finish(); return; }
      const pos = run.position(now);
      if (pos) {
        const key = `${pos.index}:${pos.attempt}:${pos.phase}`;
        if (key !== this.lastTrialKey) {
          this.closeRecording(now);
          this.trials[pos.index].startedAt ??= now;
          this.lastTrialKey = key;
        }
        this.renderTrial(pos);
      }
      this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }
  private animateFree(): void {
    cancelAnimationFrame(this.animation);
    const step = () => {
      if (!this.free || this.ui.kind !== 'test') return;
      this.renderFree(performance.now());
      this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }
  /**
   * Dwell on: the blue quadrant is the dwell's, filling over the dwell, and a selection shows as the green border for
   * feedbackMs, alone. Dwell off: the blue quadrant is the live quadrant itself, with no fill.
   */
  private renderFree(now: number): void {
    const free = this.free!, last = free.selections[free.selections.length - 1];
    const selected = this.dwellOn && last && now - last.shownAt < DWELL_TIMING.feedbackMs ? last.quadrant : null;
    const gaze = selected !== null ? null : this.dwellOn ? free.dwell.quadrant : this.liveQuadrant;
    // The selection waits for the next camera frame; a full cell that has not selected yet would look stuck.
    const progress = this.dwellOn ? Math.min(.96, free.dwell.progress(now)) : 0;
    for (let id = 0; id < QUADRANT_COUNT; id++) {
      const cell = document.getElementById(`q${id}`);
      if (!cell) continue;
      cell.classList.toggle('is-gaze', id === gaze);
      cell.classList.toggle('is-selected', id === selected);
      if (id === gaze && progress > 0) cell.style.setProperty('--dwell', progress.toFixed(3)); else cell.style.removeProperty('--dwell');
    }
  }
  /** If the last rendered phase was a record window, it is over now: decide from the candidate's frames and remember what the feedback shows. */
  private closeRecording(now: number): void {
    const [index, attempt, phase] = this.lastTrialKey.split(':');
    const record = this.trials[Number(index)];
    if (phase !== 'record' || !record) return;
    const quadrant = this.live.key === `${index}:${attempt}` ? decideQuadrant(this.live.points, this.quadrants) : null;
    record.shown = { quadrant, correct: quadrant === record.quadrant };
    record.endedAt = now;
  }
  private pause(): void {
    const now = performance.now();
    if (this.ui.kind === 'test' && this.free) { this.free.pauses++; cancelAnimationFrame(this.animation); this.set({ kind: 'paused' }); }
    else if (this.ui.kind === 'test' && this.trialRun && this.trialRun.pause()) { cancelAnimationFrame(this.animation); this.set({ kind: 'paused' }); }
    else if (this.ui.kind === 'calibration' && this.quickRun && this.quickRun.pause(now)) { this.calibration.pauses++; cancelAnimationFrame(this.animation); this.render(); }
  }
  /** Free look resumes with a fresh dwell, so no look from before the pause can select. */
  private resume(): void {
    if (this.ui.kind !== 'paused') return;
    if (this.free) { this.free.dwell = new Dwell(); this.gazeWindow = []; this.liveQuadrant = null; this.set({ kind: 'test' }); this.animateFree(); return; }
    if (!this.trialRun) return;
    this.lastTrialKey = '';
    if (!this.trialRun.start(performance.now())) { void this.finish(); return; }
    this.set({ kind: 'test' });
    this.animateTest();
  }
  private redoTrial(): void { if (this.ui.kind === 'paused' && this.trialRun) { this.trialRun.back(); this.resume(); } }
  private async exportStrips(): Promise<void> {
    const tracker = this.tracker;
    if (!tracker) return;
    try {
      const exported = await tracker.exportReplay();
      if (exported && exported.entries.length) {
        const entries = exported.entries.map(e => ({ ...e, ...(e.kind === 'calibration' ? { block: QUICK_BLOCK, point: null } : this.stripIndex.get(e.at) ?? { block: null, point: null }) }));
        const geometry = tracker.geometry();
        const blob = buildReplayFile({ createdAt: Date.now(), model: MODEL_VERSION, viewport: this.sessionViewport, pixelRatio: window.devicePixelRatio || 1, camera: geometry ? { width: geometry.width, height: geometry.height } : null, crop: 'upstream' }, entries, exported.images);
        this.uploader?.enqueue('replay', blob);
      }
      this.stripIndex.clear();
      await tracker.setRecording(false); await tracker.setRecording(true);
    } catch { /* strips are optional; the frames and video still record */ }
  }

  // ---- finish ----
  /** Decisions for every trial's final attempt from the recorded frames (the same rule as the live feedback, on all frames). */
  private decide(): void {
    const run = this.trialRun;
    if (!run) return;
    for (const record of this.trials) {
      const attempt = run.attempts[record.index];
      const rows = this.rows.filter(r => r.screen === 'test' && r.phase === 'record' && r.trial?.index === record.index && r.trial.attempt === attempt);
      const pick = (name: keyof Streams) => decideQuadrant(rows.flatMap(r => { const p = usablePoint(r, streamsOfRow(r)[name], this.sessionViewport); return p ? [p] : []; }), this.quadrants);
      record.decision = attempt > 0 ? { candidate: { blend: pick('candidateBlend'), network: pick('candidateNetwork') }, baseline: { blend: pick('baselineBlend'), network: pick('baselineNetwork') } } : null;
    }
    const done = this.trials.filter(t => t.decision);
    this.result = tally(done, done.map(t => t.decision!.candidate.blend));
  }
  private async finish(): Promise<void> {
    cancelAnimationFrame(this.animation);
    if (this.free) this.free.endedAt ??= performance.now();
    this.set({ kind: 'finishing' });
    await this.exportStrips();
    if (this.recorder) await this.recorder.stop();
    this.tracker?.stop(); this.tracker = null;
    this.log?.flush();
    this.decide();
    this.uploader?.enqueue('summary', JSON.stringify(this.summaryJson(), null, 1));
    this.saveSession(true);
    await this.uploader?.flush();
    this.set({ kind: 'result' });
  }
  /** Again: the same tester, a new session, straight back into calibration (fresh workers, so both models train from scratch). */
  private async again(): Promise<void> {
    if (this.ui.kind !== 'result' && this.ui.kind !== 'calibration') return;
    if (this.ui.kind === 'calibration' && this.quickRun?.state.kind !== 'failed') return;
    cancelAnimationFrame(this.animation);
    this.tracker?.stop(); this.tracker = null; this.quickRun = null; this.log = null; this.recorder = null; this.ready = null;
    this.set({ kind: 'calibration' });
    if (!(await this.startCamera())) return;
    await this.beginSession();
  }
  private calibrationJson() {
    const c = this.calibration;
    return { block: QUICK_BLOCK, timing: QUICK_TIMING, targets: this.targets, startedAt: c.startedAt, collectedAt: c.collectedAt, trainedAt: c.trainedAt,
      wallMs: c.startedAt !== null && c.trainedAt !== null ? c.trainedAt - c.startedAt : null, labels: c.labels, pauses: c.pauses,
      candidate: { worker: QUICK_WORKER, ...c.candidate, geometric: c.candidate.trainingReport?.geometric ?? null, blendWeight: c.candidate.trainingReport?.geometric?.weight ?? null },
      baseline: { worker: BASELINE_WORKER, ...c.baseline, geometric: c.baseline.trainingReport?.geometric ?? null, blendWeight: c.baseline.trainingReport?.geometric?.weight ?? null } };
  }
  private trialsJson() {
    return this.trials.map(t => ({ ...t, centre: this.quadrants[t.quadrant].centre, attempts: this.trialRun?.attempts[t.index] ?? 0 }));
  }
  /** Free look: selections per quadrant. */
  private freeResult(): { selections: number[]; total: number } | null {
    const free = this.free;
    return free && { selections: Array.from({ length: QUADRANT_COUNT }, (_, q) => free.selections.filter(s => s.quadrant === q).length), total: free.selections.length };
  }
  private freeJson() {
    const free = this.free;
    return free && { dwell: DWELL_TIMING, liveWindowMs: LIVE_WINDOW_MS, dwellAtStart: free.dwellAtStart, toggles: free.toggles, startedAt: free.startedAt, endedAt: free.endedAt, pauses: free.pauses, selections: free.selections };
  }
  private summaryJson() {
    return { format: 'GAZE-LAB-SIMPLE-SUMMARY-1', session: this.sessionId, tester: this.query.tester, demo: this.query.demo, test: this.query.test, viewport: this.sessionViewport, cmPerCssPx: this.cmPerPx(),
      frameFilter: this.free ? 'free look: the candidate blend of frames with a face present and eyes open, per-axis median over the last 400 ms, dwelt on (see free.dwell)' : 'record-phase frames with a face present and eyes open, final attempt per trial; decision = quadrant nearest the per-axis median', streams: STREAM_NAMES,
      calibration: this.calibrationJson(), trials: this.trialsJson(), free: this.freeJson(), result: this.free ? this.freeResult() : this.result };
  }
  private saveSession(complete = false): void {
    if (!this.uploader) return;
    const geometry = this.tracker?.geometry() ?? null;
    const session = {
      format: 'GAZE-LAB-SESSION-1', mode: 'simple', id: this.sessionId, createdAt: new Date().toISOString(), tester: this.query.tester, notes: '', cameraPosition: 'built-in top-centre', demo: this.query.demo,
      screen: { diagonalIn: this.query.diagonalIn, width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio || 1, cmPerCssPx: this.cmPerPx() },
      viewport: this.sessionViewport, window: windowMetrics(), camera: geometry, backend: this.backend, userAgent: navigator.userAgent,
      source: { commit: this.meta?.commit ?? null, workerSha256: this.meta?.workerSha256 ?? null, shippedWorkerSha256: this.meta?.shippedWorkerSha256 ?? null, model: MODEL_VERSION },
      settings: { recordVideo: this.recorder !== null, recordStrips: true, test: this.query.test, rounds: this.query.rounds, feedback: this.query.feedback, seed: this.seed, timing: TRIAL_TIMING, calibrationTiming: QUICK_TIMING, candidate: QUICK_WORKER, baseline: BASELINE_WORKER },
      quadrants: this.quadrants, targets: this.targets, calibration: this.calibrationJson(), rounds: this.schedule.rounds, trials: this.trialsJson(), free: this.freeJson(), result: this.free ? this.freeResult() : this.result,
      blocks: [], video: this.recorder ? { mimeType: this.recorder.actualMimeType, chunks: this.videoChunks, bytes: this.videoBytes } : null, frames: this.rows.length, complete,
    };
    this.uploader.enqueue('session', JSON.stringify(session, null, 1));
  }

  // ---- input ----
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); this.pause(); return; }
    if (e.target instanceof HTMLElement && e.target.closest('button, label, input')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.primary(); }
  }
  private primary(): void {
    switch (this.ui.kind) {
      case 'start': void this.start(); break;
      case 'calibration': if (this.quickRun?.state.kind === 'paused') this.startQuick(); else if (this.quickRun?.state.kind === 'failed') void this.again(); break;
      case 'paused': this.resume(); break;
      case 'result': void this.again(); break;
      default: break;
    }
  }

  // ---- rendering ----
  private render(): void {
    const root = this.root; root.replaceChildren();
    switch (this.ui.kind) {
      case 'start': root.append(this.renderStart(this.ui)); break;
      case 'calibration': root.append(this.renderCalibration()); break;
      case 'test': root.append(this.free ? this.renderGrid('free') : this.testIntro ? this.stage(TEST_INTRO, [], []) : this.renderGrid('guided')); break;
      case 'paused': root.append(this.stage('Paused', [], [this.button('Continue', () => this.resume(), true), ...(this.free ? [this.dwellSwitch()] : [this.button('Redo trial', () => this.redoTrial())]), this.button('Finish', () => void this.finish())])); break;
      case 'finishing': root.append(this.stage('Saving', [], [])); break;
      case 'result': root.append(this.renderResult()); break;
      case 'error': root.append(this.stage('Camera stopped', [el('p', { class: 'readout is-alert', text: this.ui.message })], [this.button('Retry', () => location.reload(), true)])); break;
    }
    if (this.query.demo) root.append(el('p', { class: 'demo-badge', text: 'Demo · no camera' }));
  }
  private stage(title: string, body: Node[], actions: Node[]): HTMLElement {
    const section = el('section', { class: 'stage' }, el('h1', { text: title }), ...body);
    if (actions.length) section.append(el('div', { class: 'actions' }, ...actions));
    return section;
  }
  /** Free look's Dwell switch: off shows the live quadrant at once and selects nothing. */
  private dwellSwitch(): HTMLLabelElement {
    const input = el('input', { type: 'checkbox' });
    input.checked = this.dwellOn;
    input.addEventListener('change', () => { this.dwellOn = input.checked; this.free?.toggles.push({ at: performance.now(), dwell: input.checked }); });
    return el('label', { class: 'switch' }, input, 'Dwell');
  }
  private button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el('button', { type: 'button', text: label, ...(primary ? { class: 'primary' } : {}) });
    b.addEventListener('click', onClick); return b;
  }
  private renderStart(ui: Ui & { kind: 'start' }): HTMLElement {
    const section = el('section', { class: 'stage' });
    if (ui.message) section.append(el('p', { class: 'readout is-alert', text: ui.message }));
    const button = this.button(ui.message ? 'Retry' : 'Start', () => void this.start(), true);
    if (ui.cameraState === 'starting') button.disabled = true;
    section.append(el('div', { class: 'actions' }, button));
    return section;
  }
  private renderCalibration(): HTMLElement {
    const run = this.quickRun, s = run?.state;
    if (!run || !s) return this.stage(QUICK_INTRO, [], []); // the camera is starting again (Again)
    if (s.kind === 'running') {
      const pos = run.position(performance.now());
      if (!pos || pos.phase === 'intro') return this.stage(QUICK_INTRO, [], []);
      return el('section', { class: 'dot-stage', 'aria-label': 'Calibration: look at the dot' }, el('div', { class: 'validation-dot is-travel', id: 'dot' }));
    }
    if (s.kind === 'ready') return this.stage(this.ready?.faceMissing ? 'Face not found' : QUICK_INTRO, [], []);
    if (s.kind === 'collected' || s.kind === 'training' || s.kind === 'complete') return this.stage('Calibrating', [], []);
    if (s.kind === 'failed') return this.stage('Calibration failed', [el('p', { class: 'readout is-alert', text: s.reason })], [this.button('Again', () => void this.again(), true)]);
    return this.stage('Paused', [], [this.button('Continue', () => this.startQuick(), true)]);
  }
  /**
   * The 2 × 4 navigation quadrants, placed at the recorded geometry; the guided test adds the dot, the result the counts
   * (hits of shown, or selections, blank for none). A click on a test grid pauses it, as Esc does.
   */
  private renderGrid(mode: 'guided' | 'free' | 'result'): HTMLElement {
    const test = mode !== 'result', free = this.freeResult();
    const stage = el('section', { class: test ? `quadrants is-test is-${mode}` : 'quadrants is-result', 'aria-label': mode === 'guided' ? 'Test: look at the dot in the highlighted quadrant' : mode === 'free' ? 'Look at a quadrant for 2 seconds to select it' : 'Result' });
    for (const q of this.quadrants) {
      const cell = el('div', { class: 'quadrant', id: `q${q.id}`, role: 'img', 'aria-label': `Quadrant ${q.id + 1}` });
      if (test) { cell.style.left = `${q.rect.x}px`; cell.style.top = `${q.rect.y}px`; cell.style.width = `${q.rect.width}px`; cell.style.height = `${q.rect.height}px`; }
      else if (free) { const n = free.selections[q.id]; cell.textContent = n ? String(n) : ''; cell.setAttribute('aria-label', `Quadrant ${q.id + 1}: ${n} selection${n === 1 ? '' : 's'}`); }
      else if (this.result) { cell.textContent = `${this.result.hits[q.id]}/${this.result.shown[q.id]}`; cell.setAttribute('aria-label', `Quadrant ${q.id + 1}: ${this.result.hits[q.id]} of ${this.result.shown[q.id]}`); }
      stage.append(cell);
    }
    if (mode === 'guided') stage.append(el('div', { class: 'validation-dot is-travel', id: 'dot' }));
    if (test) stage.addEventListener('click', () => this.pause());
    return stage;
  }
  private renderTrial(pos: TrialPosition): void {
    const dot = document.getElementById('dot');
    if (!dot) return;
    const q = this.quadrants[pos.trial.quadrant];
    dot.style.left = `${q.centre.x}px`; dot.style.top = `${q.centre.y}px`;
    dot.className = `validation-dot is-${pos.phase === 'record' ? 'record' : 'travel'}`;
    dot.style.setProperty('--ring', `${Math.round((1 - (pos.phase === 'record' ? pos.progress : 0)) * 60)}px`);
    // The dark dot says where to look; the blue square shows where the tracker thinks the person is looking (live), and
    // during feedback the border says whether the trial's decision matched the dot (green) or which quadrant it chose (red).
    const shown = pos.phase === 'feedback' ? this.trials[pos.index].shown : null;
    const gaze = shown === null ? this.liveQuadrant : null;
    for (let id = 0; id < QUADRANT_COUNT; id++) {
      const cell = document.getElementById(`q${id}`);
      if (!cell) continue;
      cell.classList.toggle('is-target', id === q.id);
      cell.classList.toggle('is-gaze', id === gaze);
      cell.classList.toggle('is-hit', shown !== null && shown.correct && id === q.id);
      cell.classList.toggle('is-miss', shown !== null && !shown.correct && id === shown.quadrant);
    }
  }
  private renderResult(): HTMLElement {
    const r = this.result, c = this.calibration, free = this.freeResult();
    const rate = free ? (free.total ? `${free.total} selection${free.total === 1 ? '' : 's'} · ` : '') : `${r && r.total ? `${Math.round(100 * r.correct / r.total)} %` : '—'} · `;
    // Dots and training are shown apart: training here runs two models at once (the hidden baseline comparison), so it is
    // longer than the single training the app would run.
    const secs = (a: number | null, b: number | null) => (a !== null && b !== null ? `${Math.round((b - a) / 1000)} s` : '—');
    const dots = secs(c.startedAt, c.collectedAt), training = secs(c.collectedAt, c.trainedAt);
    const status = this.uploadStatus;
    const failed = status && status.failed > 0 ? ` · not saved${status.lastError ? `: ${status.lastError}` : ''}` : '';
    const wrap = el('section', { class: 'result' }, this.renderGrid('result'),
      el('p', { class: `readout result-line${failed ? ' is-alert' : ''}`, text: `${rate}calibration ${dots} + training ${training}${failed}` }),
      el('div', { class: 'actions' }, this.button('Again', () => void this.again(), true)));
    return wrap;
  }
}
