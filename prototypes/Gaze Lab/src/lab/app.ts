import { CalibrationRun, CALIBRATION_TIMING, type CalibrationPace } from '../core/calibration';
import { MODEL_VERSION, type LearnedCalibration } from '../core/saved-calibration';
import { buildReplayFile } from '../core/replay-file';
import type { TrainingReport } from '../core/training';
import type { Viewport } from '../core/tracking';
import type { SessionManifest } from '../core/session-file';
import { BLOCKS, BLOCK_TIMING, BlockRun, blockById, blockSeed, type BlockDef } from './protocol';
import { cmPerCssPx, validationTargets, windowMetrics, type Target, type WindowMetrics } from './layout';
import { describeOffset, headOffset, headReference, median, type HeadOffset, type HeadReference, type HeadSample } from './head';
import { FrameLog, type CandidateOut, type FrameRow, type QuickOut, type Screen } from './frames';
import { Uploader, type UploadStatus } from './uploader';
import { ClarteTimeline, VideoRecorder } from './recorder';
import { DemoTracker, LiveTracker, type ShadowInit, type Tracker, type TrackerFrame } from './tracker';
import { ESTIMATORS, QUICK_ESTIMATORS, ESTIMATOR_LABELS, estimatorLabels, fmtCm, fmtPx, summarizeBlock, type BlockSummary, type EstimatorName } from './summary';
import { evaluateCandidate, readCandidate, type Candidate } from './candidate';
import { QUICK_BLOCK, QUICK_INTRO, QUICK_TIMING, QUICK_WORKER, QuickRun, quickTargets, type QuickTarget } from './quick';

export type Query = { demo: boolean; blocks: string[] | null; tester: string; diagonal: string; server: string; quick: boolean };
export function readQuery(q: URLSearchParams): Query {
  return { demo: q.get('demo') === '1', blocks: q.get('blocks')?.split(',').filter(Boolean) ?? null, tester: q.get('tester') ?? '', diagonal: q.get('diag') ?? '', server: q.get('server') ?? '', quick: q.get('quick') === '1' };
}
type Settings = { tester: string; diagonalIn: number; cameraPosition: string; notes: string; recordVideo: boolean; recordStrips: boolean; blocks: string[]; candidate: Candidate | null; quick: boolean };
/** The quick-calibration test's bookkeeping; written to session.json only when the test is on. */
type QuickRecord = { init: ShadowInit | null; startedAt: number | null; trainedAt: number | null; labels: number; pauses: number; trainingReport: TrainingReport | null; learnedSaved: boolean; error: string | null };
const freshQuick = (): QuickRecord => ({ init: null, startedAt: null, trainedAt: null, labels: 0, pauses: 0, trainingReport: null, learnedSaved: false, error: null });
type BlockRecord = { id: string; key: string; attempt: number; title: string; instruction: string; startedAt: number | null; endedAt: number | null; order: number[]; seed: number; window: WindowMetrics | null; status: 'running' | 'complete' | 'skipped' | 'redone'; summary: BlockSummary | null };
type Ui =
  | { kind: 'setup'; cameraState: 'off' | 'starting' | 'on'; message: string }
  | { kind: 'quick' }
  | { kind: 'calibration'; message: string }
  | { kind: 'instruction'; index: number }
  | { kind: 'block'; index: number }
  | { kind: 'paused'; index: number }
  | { kind: 'finishing' }
  | { kind: 'summary' }
  | { kind: 'error'; message: string };

const PACE: CalibrationPace = 'quick';
const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
const sanitize = (s: string) => s.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tester';
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else node.setAttribute(k, v); }
  node.append(...children); return node;
};

export class App {
  private ui: Ui = { kind: 'setup', cameraState: 'off', message: '' };
  private settings: Settings = { tester: '', diagonalIn: 0, cameraPosition: 'built-in top-centre', notes: '', recordVideo: true, recordStrips: true, blocks: BLOCKS.map(b => b.id), candidate: null, quick: false };
  private tracker: Tracker | null = null;
  private backend = '';
  private latest: TrackerFrame | null = null;
  private sessionId = '';
  private seed = 0;
  private uploader: Uploader | null = null;
  private uploadStatus: UploadStatus | null = null;
  private log: FrameLog | null = null;
  private rows: FrameRow[] = [];
  private recorder: VideoRecorder | null = null;
  private timeline: ClarteTimeline | null = null;
  private videoBytes = 0;
  private videoChunks = 0;
  private calibration: CalibrationRun | null = null;
  private calibrationViewport: Viewport = viewport();
  private calibrationStartedAt: number | null = null;
  private trainingReport: TrainingReport | null = null;
  private learned: LearnedCalibration | null = null;
  private reference: HeadReference | null = null;
  private calibrationSamples: HeadSample[] = [];
  private labels = 0;
  private targets: Target[] = [];
  private blockRun: BlockRun | null = null;
  private blocks: BlockRecord[] = [];
  private stripIndex = new Map<number, { block: string; point: number }>();
  private meta: { commit: string | null; workerSha256: string | null; shippedWorkerSha256: string | null } | null = null;
  private animation = 0;
  private candidateHeadActive = false;
  /** Quick-calibration test (Q8 before C0 in a shadow worker); null when the test is off. */
  private quickRun: QuickRun | null = null;
  private quickTargets: QuickTarget[] = [];
  private quick: QuickRecord = freshQuick();
  private calibrationTrainedAt: number | null = null;
  /** C0's head stage waits for a key press: the wait is measured so the C0 wall time can be read with and without it. */
  private headStageReadyAt: number | null = null;
  private headStageStartedAt: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly query: Query) {
    this.settings.tester = query.tester; this.settings.diagonalIn = Number(query.diagonal) || 0; this.settings.quick = query.quick;
    if (query.blocks) this.settings.blocks = query.blocks.filter(id => blockById(id));
  }
  mount(): void {
    window.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    window.addEventListener('pagehide', () => this.flushAll(true));
    void fetch(`${this.query.server}/api/meta`).then(r => r.json()).then(m => { this.meta = m; }).catch(() => { this.meta = null; });
    setInterval(() => this.tick(), 100);
    this.render();
  }

  // ---- state helpers ----
  private get screen(): Screen { return this.ui.kind === 'setup' ? 'setup' : this.ui.kind === 'quick' ? 'quick' : this.ui.kind === 'calibration' ? 'calibration' : this.ui.kind === 'instruction' ? 'instruction' : this.ui.kind === 'block' || this.ui.kind === 'paused' ? 'block' : 'summary'; }
  private estimatorNames(): readonly EstimatorName[] { return this.settings.quick ? [...ESTIMATORS, ...QUICK_ESTIMATORS] : ESTIMATORS; }
  private currentBlock(): BlockRecord | null { return this.ui.kind === 'instruction' || this.ui.kind === 'block' || this.ui.kind === 'paused' ? this.blocks[this.ui.index] ?? null : null; }
  private set(ui: Ui): void { this.ui = ui; this.render(); }
  private cmPerPx(): number | null { const v = cmPerCssPx(this.settings.diagonalIn, screen, window.devicePixelRatio || 1); return Number.isFinite(v) ? v : null; }

  // ---- camera / session start ----
  private async startCamera(): Promise<void> {
    if (this.ui.kind !== 'setup' || this.ui.cameraState !== 'off') return;
    this.set({ kind: 'setup', cameraState: 'starting', message: '' });
    const tracker: Tracker = this.query.demo ? new DemoTracker() : new LiveTracker();
    this.tracker = tracker;
    try {
      this.backend = await tracker.start(f => this.onFrame(f), error => this.fail(error));
      if (this.settings.candidate?.head && !this.settings.quick) { await tracker.setShadowHead(this.settings.candidate.head); this.candidateHeadActive = true; }
      this.set({ kind: 'setup', cameraState: 'on', message: '' });
    } catch (error) { this.tracker = null; this.set({ kind: 'setup', cameraState: 'off', message: cameraMessage(error) }); }
  }
  private fail(error: unknown): void {
    this.tracker?.stop(); this.tracker = null;
    this.flushAll(false);
    this.set({ kind: 'error', message: cameraMessage(error) });
  }
  private async begin(): Promise<void> {
    if (this.ui.kind !== 'setup' || this.ui.cameraState !== 'on' || !this.tracker) return;
    if (!(this.settings.diagonalIn > 0)) { this.set({ ...this.ui, message: 'Screen diagonal is required.' }); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionId = `${stamp}-${sanitize(this.settings.tester)}${this.query.demo ? '-demo' : ''}`;
    this.seed = (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.uploader = new Uploader(this.query.server, this.sessionId, s => { this.uploadStatus = s; });
    this.log = new FrameLog((jsonl, landmarks) => { if (jsonl) this.uploader?.enqueue('frames', jsonl); if (landmarks) this.uploader?.enqueue('landmarks', landmarks); });
    const stream = this.tracker.mediaStream();
    if (this.settings.recordVideo && stream && typeof MediaRecorder !== 'undefined') {
      this.recorder = new VideoRecorder(stream, chunk => { this.videoBytes += chunk.size; this.videoChunks++; this.uploader?.enqueue('video', chunk); });
      this.timeline = new ClarteTimeline(at => this.recorder!.time(at));
    }
    this.calibrationViewport = viewport();
    this.calibration = new CalibrationRun(this.calibrationViewport, PACE);
    this.targets = validationTargets(this.calibrationViewport);
    this.blocks = this.settings.blocks.map(id => blockById(id)!).map(def => this.blockRecord(def, 1));
    if (this.settings.recordStrips) await this.tracker.setRecording(true);
    if (this.settings.quick) {
      // Q8 first, in a shadow worker with the pose rows frozen, the caps lifted and the geometric share capped; the candidate head is not run alongside.
      this.quick = freshQuick(); this.candidateHeadActive = false;
      try { this.quick.init = await this.tracker.startShadow({ ...QUICK_WORKER }); }
      catch (error) { this.fail(error); return; }
      this.quickTargets = quickTargets(this.calibrationViewport);
      this.quickRun = new QuickRun(this.quickTargets, QUICK_TIMING);
      this.lastQuickScreen = '';
      this.saveSession();
      this.set({ kind: 'quick' });
      this.startQuick();
      return;
    }
    this.saveSession();
    this.set({ kind: 'calibration', message: '' });
  }
  private blockRecord(def: BlockDef, attempt: number): BlockRecord {
    const key = attempt === 1 ? def.id : `${def.id}#${attempt}`;
    return { id: def.id, key, attempt, title: def.title, instruction: def.instruction, startedAt: null, endedAt: null, order: [], seed: blockSeed(this.seed, key), window: null, status: 'running', summary: null };
  }

  // ---- frames ----
  private async onFrame(f: TrackerFrame): Promise<void> {
    this.latest = f;
    if (!this.log) { if (this.ui.kind === 'setup') this.renderReadout(); return; }
    const now = performance.now();
    let block: string | null = null, point: number | null = null, phase: string | null = null, target: FrameRow['target'] = null;
    const run = this.calibration;
    if (this.ui.kind === 'quick' && this.quickRun) {
      block = QUICK_BLOCK;
      const pos = this.quickRun.classify(f.at);
      if (pos) {
        phase = pos.phase;
        if (pos.phase !== 'intro') {
          const t = this.quickTargets[pos.index];
          point = t.index; target = { x: t.x, y: t.y, nx: t.nx, ny: t.ny };
          // Every fresh frame with a face and open eyes inside the collection window is a label for the shadow worker.
          if (pos.phase === 'collect' && f.gaze.face && await this.tracker!.shadowCollect([t.nx, t.ny], f.at)) { this.quick.labels++; phase = 'quick:label'; }
        }
      } else phase = this.quickRun.state.kind === 'training' ? 'training' : this.quickRun.state.kind === 'paused' ? 'paused' : null;
    } else if (this.ui.kind === 'calibration' && run) {
      block = 'C0';
      let accepted = false;
      // The label's own dot and stage, taken inside the callback: `capture` advances the state when a label completes a dot.
      const labelled: { current: { x: number; y: number; stage: 'eyes' | 'head'; step: number } | null } = { current: null };
      await run.capture(f.frame, now, async (p, at) => {
        const ok = await this.tracker!.collect([p.x / run.viewport.width - .5, p.y / run.viewport.height - .5], at);
        if (ok) { accepted = true; this.labels++; labelled.current = { x: p.x, y: p.y, stage: run.state.stage, step: run.state.step }; this.timeline?.event(at, { type: 'label', x: p.x / run.viewport.width - .5, y: p.y / run.viewport.height - .5, stage: run.state.stage }); }
        return ok;
      });
      const s = run.state, lab = labelled.current, cur = run.point;
      point = lab ? (lab.stage === 'head' ? 9 : 0) + lab.step : (s.stage === 'head' ? 9 : 0) + s.step;
      phase = lab ? `${lab.stage}:label` : `${s.stage}:${s.kind}`;
      const p = lab ?? cur; target = { x: p.x, y: p.y, nx: p.x / run.viewport.width - .5, ny: p.y / run.viewport.height - .5 };
      if (['moving', 'settling', 'sampling', 'collecting'].includes(s.kind)) this.timeline?.dot(f.at, 'calibration', `${s.stage}:${s.kind}`, cur.x / run.viewport.width - .5, cur.y / run.viewport.height - .5);
      if (accepted && f.debug) this.calibrationSamples.push({ origin: f.debug.faceOrigin3D, faceRt: f.debug.faceRt });
      this.syncCalibration();
    } else if ((this.ui.kind === 'block' || this.ui.kind === 'paused') && this.blockRun) {
      const record = this.currentBlock()!;
      block = record.key;
      const pos = this.blockRun.classify(f.at);
      if (pos) {
        const t = this.targets[pos.target];
        point = t.index; phase = pos.phase; target = { x: t.x, y: t.y, nx: t.nx, ny: t.ny };
        if (record.id === 'B1' && record.attempt === this.attemptsOf('B1')) this.timeline?.dot(f.at, 'check', pos.phase, t.nx, t.ny);
        if (pos.phase === 'record') {
          if (this.settings.recordStrips && f.gaze.face) { this.stripIndex.set(f.at, { block: record.key, point: t.index }); await this.tracker!.record([t.nx, t.ny], f.at).catch(() => false); } // awaited: the worker rejects a frame while it is still encoding the previous strip
          if (record.id === 'B1' && f.gaze.face && f.gaze.rawNormPog) this.timeline?.event(f.at, { type: 'check', x: t.nx, y: t.ny, index: t.index });
        }
      } else phase = this.ui.kind === 'paused' ? 'paused' : null;
    } else if (this.ui.kind === 'instruction') {
      block = this.currentBlock()?.key ?? null;
      this.renderReadout();
    }
    const d = f.debug;
    const candidate = this.settings.candidate ? this.candidateFor(f) : null;
    const row = this.log.add({
      t: f.at, videoT: this.recorder ? this.recorder.time(f.at) : null, screen: this.screen, block, point, phase, target,
      rawNormPog: f.gaze.rawNormPog, network: f.gaze.estimates?.network ?? null, geometric: f.gaze.estimates?.geometric ?? null, normPog: f.gaze.face ? f.gaze.normPog : null,
      pointer: f.frame.point ? [f.frame.point.x, f.frame.point.y] : null,
      facePresent: f.gaze.facePresent, face: f.gaze.face, eyeState: f.gaze.eyeState, pose: f.gaze.pose ?? null, camera: f.gaze.camera ?? null,
      headVector: d?.headVector ?? null, faceOrigin3D: d && f.gaze.facePresent ? d.faceOrigin3D : null, faceRt: d?.faceRt ?? null, features12: d?.featureVector ?? null, gaze: d?.features ?? null,
      timings: d?.timings ?? null, candidate, viewport: f.viewport,
      // The quick stream is written only in quick sessions, so default rows stay byte-identical.
      ...(this.settings.quick ? { quick: this.quickFor(f) } : {}),
    }, d && f.gaze.facePresent ? d.landmarks : null);
    this.rows.push(row);
  }
  /** The quick shadow worker's estimates for this frame: its blend (at the capped geometric share), network and geometric branches. */
  private quickFor(f: TrackerFrame): QuickOut | null {
    const s = f.shadow;
    return s && s.face ? { rawNormPog: s.rawNormPog, network: s.estimates?.network ?? null, geometric: s.estimates?.geometric ?? null } : null;
  }
  private candidateFor(f: TrackerFrame): CandidateOut | null {
    const c = this.settings.candidate;
    if (!c || !f.gaze.face) return null;
    const head: CandidateOut['head'] = this.candidateHeadActive && f.shadow && f.shadow.face ? { rawNormPog: f.shadow.rawNormPog, network: f.shadow.estimates?.network ?? null, geometric: f.shadow.estimates?.geometric ?? null } : null;
    return evaluateCandidate(c, { network: f.gaze.estimates?.network ?? null, geometric: f.gaze.estimates?.geometric ?? null }, { features: f.debug?.features ?? null, faceOrigin3D: f.debug?.faceOrigin3D ?? null, faceRt: f.debug?.faceRt ?? null }, head);
  }
  private attemptsOf(id: string): number { return this.blocks.filter(b => b.id === id).length; }

  // ---- calibration (C0) ----
  /** Start keeps trying until the app's readiness gate (five fresh face frames over 400 ms) opens; the message shows only if it stays shut. */
  private pendingStart: number | null = null;
  private startCalibration(): void {
    const run = this.calibration;
    if (!run || this.ui.kind !== 'calibration') return;
    const now = performance.now();
    if (run.state.kind !== 'ready' && run.state.kind !== 'paused') return;
    if (!run.start(now)) {
      this.pendingStart ??= now;
      if (now - this.pendingStart > 1500 && this.ui.message !== 'Face not detected') this.set({ kind: 'calibration', message: 'Face not detected' });
      return;
    }
    this.pendingStart = null;
    if (this.calibrationStartedAt === null) { this.calibrationStartedAt = now; this.timeline?.event(now, { type: 'calibration-start' }); }
    if (run.state.stage === 'head' && this.headStageStartedAt === null) this.headStageStartedAt = now;
    this.set({ kind: 'calibration', message: '' });
  }
  private syncCalibration(): void {
    const run = this.calibration;
    if (!run || this.ui.kind !== 'calibration') return;
    if (run.state.kind === 'collected') {
      if (run.state.stage === 'eyes') { run.addHeadStage(); this.headStageReadyAt ??= performance.now(); this.render(); }
      else void this.train();
      return;
    }
    this.renderCalibration();
  }
  private async train(): Promise<void> {
    const run = this.calibration;
    if (!run || !this.tracker || !run.beginTraining()) return;
    this.render();
    const at = performance.now();
    this.timeline?.event(at, { type: 'train' });
    try {
      this.trainingReport = await this.tracker.train();
      run.finishTraining();
      this.calibrationTrainedAt = performance.now();
      this.timeline?.event(this.calibrationTrainedAt, { type: 'trained' });
      this.reference = headReference(this.calibrationSamples);
      this.learned = await this.tracker.exportCalibration();
      if (this.learned) this.uploader?.enqueue('calibration', JSON.stringify({ format: 'GAZE-LAB-CALIBRATION-1', model: MODEL_VERSION, learned: this.learned, trainingReport: this.trainingReport }));
      await this.exportStrips();
      this.saveSession();
      this.log?.flush();
      this.set({ kind: 'instruction', index: 0 });
      if (!this.blocks.length) await this.finish();
    } catch (error) { this.fail(error); }
  }

  // ---- quick calibration (Q8, before C0) ----
  private startQuick(): void {
    const run = this.quickRun;
    if (!run || this.ui.kind !== 'quick') return;
    const now = performance.now();
    if (!run.start(now)) return;
    this.quick.startedAt ??= now;
    this.render();
    this.animateQuick();
  }
  private animateQuick(): void {
    cancelAnimationFrame(this.animation);
    const step = () => {
      const run = this.quickRun;
      if (!run || this.ui.kind !== 'quick') return;
      run.tick(performance.now());
      if (run.state.kind === 'collected') { void this.trainQuick(); return; }
      this.renderQuick();
      this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }
  /** Trains the shadow worker on the Q8 labels; a failure (too few labels) is recorded and the session goes on without a quick stream. */
  private async trainQuick(): Promise<void> {
    const run = this.quickRun;
    if (!run || !this.tracker || !run.beginTraining()) return;
    this.render();
    try {
      this.quick.trainingReport = await this.tracker.shadowTrain();
      run.finishTraining();
      this.quick.trainedAt = performance.now();
      const learned = await this.tracker.shadowExportCalibration();
      if (learned) { this.quick.learnedSaved = true; this.uploader?.enqueue('quickcalibration', JSON.stringify({ format: 'GAZE-LAB-CALIBRATION-1', model: MODEL_VERSION, learned, trainingReport: this.quick.trainingReport, quick: QUICK_WORKER })); }
    } catch (error) {
      this.quick.error = error instanceof Error ? error.message : String(error);
      this.quick.trainedAt = performance.now();
      run.fail(this.quick.error);
      this.tracker.stopShadow();
    }
    this.log?.flush();
    this.saveSession();
    this.set({ kind: 'calibration', message: '' });
  }
  private lastQuickScreen = '';
  /** Per animation frame: switches between the intro, the dot and the training title, and moves the dot (600 ms CSS transition, ring over the collection window). */
  private renderQuick(): void {
    const run = this.quickRun;
    if (!run || this.ui.kind !== 'quick') return;
    const pos = run.position(performance.now());
    const screen = !pos ? run.state.kind : pos.phase === 'intro' ? 'intro' : 'dot';
    if (screen !== this.lastQuickScreen) { this.lastQuickScreen = screen; this.render(); }
    const dot = document.getElementById('dot');
    if (!pos || pos.phase === 'intro' || !dot) return;
    const t = this.quickTargets[pos.index];
    dot.style.left = `${t.x}px`; dot.style.top = `${t.y}px`;
    dot.className = `validation-dot is-${pos.phase === 'collect' ? 'record' : 'travel'}`;
    dot.style.setProperty('--ring', `${Math.round((1 - (pos.phase === 'collect' ? pos.progress : 0)) * 60)}px`);
  }
  private renderQuickScreen(): HTMLElement {
    const run = this.quickRun!, s = run.state;
    if (s.kind === 'running') {
      const pos = run.position(performance.now());
      if (!pos || pos.phase === 'intro') return this.stage(QUICK_INTRO, [], []);
      return el('section', { class: 'dot-stage', 'aria-label': 'Quick calibration: look at the dot' }, el('div', { class: 'validation-dot is-travel', id: 'dot' }));
    }
    if (s.kind === 'collected' || s.kind === 'training') return this.stage('Calibrating', [], []);
    if (s.kind === 'failed') return this.stage('Quick calibration failed', [el('p', { class: 'readout is-alert', text: s.reason })], []);
    return this.stage('Quick calibration paused', [], [this.button('Continue', () => this.startQuick(), true)]);
  }

  // ---- blocks ----
  private startBlock(): void {
    const record = this.currentBlock();
    if (!record || this.ui.kind !== 'instruction') return;
    const def = blockById(record.id)!;
    this.blockRun = new BlockRun(def, this.targets.length, record.seed, BLOCK_TIMING);
    record.order = [...this.blockRun.order]; record.window = windowMetrics(); record.startedAt = performance.now(); record.status = 'running';
    this.blockRun.start(record.startedAt);
    if (record.id === 'B1') this.timeline?.event(record.startedAt, { type: 'check-start' });
    this.set({ kind: 'block', index: this.ui.index });
    this.animate();
  }
  private animate(): void {
    cancelAnimationFrame(this.animation);
    const step = () => {
      const run = this.blockRun;
      if (!run || this.ui.kind !== 'block') return;
      run.tick(performance.now());
      if (run.state.kind === 'complete') { void this.finishBlock('complete'); return; }
      this.renderDot();
      this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }
  private pause(): void {
    if (this.ui.kind === 'block' && this.blockRun) { this.blockRun.pause(); cancelAnimationFrame(this.animation); this.set({ kind: 'paused', index: this.ui.index }); }
    else if (this.ui.kind === 'calibration' && this.calibration) { this.pendingStart = null; this.calibration.pause(); this.render(); }
    else if (this.ui.kind === 'quick' && this.quickRun && this.quickRun.pause(performance.now())) { this.quick.pauses++; cancelAnimationFrame(this.animation); this.render(); }
  }
  private resume(): void {
    if (this.ui.kind !== 'paused' || !this.blockRun) return;
    this.blockRun.start(performance.now());
    this.set({ kind: 'block', index: this.ui.index });
    this.animate();
  }
  private async finishBlock(status: 'complete' | 'skipped' | 'redone'): Promise<void> {
    const record = this.currentBlock();
    if (!record || (this.ui.kind !== 'block' && this.ui.kind !== 'paused' && this.ui.kind !== 'instruction')) return;
    const index = this.ui.index;
    cancelAnimationFrame(this.animation);
    this.blockRun = null;
    record.endedAt = performance.now(); record.status = status;
    if (record.id === 'B1' && status === 'complete') this.timeline?.event(record.endedAt, { type: 'check-complete' });
    this.log?.flush();
    record.summary = summarizeBlock(record.key, this.rows, this.targets, this.calibrationViewport, this.cmPerPx(), this.reference, this.estimatorNames());
    this.set({ kind: 'finishing' });
    await this.exportStrips();
    this.saveSession();
    if (status === 'redone') { this.blocks.splice(index + 1, 0, this.blockRecord(blockById(record.id)!, record.attempt + 1)); this.set({ kind: 'instruction', index: index + 1 }); return; }
    if (index + 1 < this.blocks.length) this.set({ kind: 'instruction', index: index + 1 });
    else await this.finish();
  }
  /** Ends the session after the current block: later blocks are marked skipped and everything recorded so far is saved. */
  private async finishEarly(): Promise<void> {
    if (this.ui.kind !== 'paused' && this.ui.kind !== 'instruction') return;
    const index = this.ui.index;
    for (const b of this.blocks.slice(index + (this.ui.kind === 'paused' ? 1 : 0))) if (b.status === 'running' && b.startedAt === null) { b.status = 'skipped'; b.startedAt = b.endedAt = performance.now(); }
    if (this.ui.kind === 'paused') { this.blocks.splice(index + 1); await this.finishBlock('skipped'); }
    else { this.blocks.splice(index); await this.finish(); }
  }
  private redo(): void { if (this.ui.kind === 'block' || this.ui.kind === 'paused') void this.finishBlock('redone'); }
  private skip(): void {
    if (this.ui.kind === 'block' || this.ui.kind === 'paused') void this.finishBlock('skipped');
    else if (this.ui.kind === 'instruction') { const r = this.currentBlock()!; r.status = 'skipped'; r.startedAt = r.endedAt = performance.now(); if (this.ui.index + 1 < this.blocks.length) this.set({ kind: 'instruction', index: this.ui.index + 1 }); else void this.finish(); }
  }
  private async exportStrips(): Promise<void> {
    if (!this.settings.recordStrips || !this.tracker) return;
    try {
      const exported = await this.tracker.exportReplay();
      if (exported && exported.entries.length) {
        const entries = exported.entries.map(e => ({ ...e, ...(e.kind === 'calibration' ? { block: 'C0', point: null } : this.stripIndex.get(e.at) ?? { block: null, point: null }) }));
        const geometry = this.tracker.geometry();
        const blob = buildReplayFile({ createdAt: Date.now(), model: MODEL_VERSION, viewport: this.calibrationViewport, pixelRatio: window.devicePixelRatio || 1, camera: geometry ? { width: geometry.width, height: geometry.height } : null, crop: 'upstream' }, entries, exported.images);
        this.uploader?.enqueue('replay', blob);
      }
      this.stripIndex.clear();
      await this.tracker.setRecording(false); await this.tracker.setRecording(true);
    } catch { /* strips are optional; the frames and video still record */ }
  }

  // ---- finish ----
  private async finish(): Promise<void> {
    this.set({ kind: 'finishing' });
    const tracker = this.tracker;
    this.log?.flush();
    if (this.recorder) { await this.recorder.stop(); }
    const b1 = [...this.blocks].reverse().find(b => b.id === 'B1' && b.status === 'complete') ?? null;
    if (this.timeline && this.recorder) {
      const live: SessionManifest['live'] = b1?.summary?.estimators.blend ? { medianPx: b1.summary.estimators.blend.medianPx, p90Px: b1.summary.estimators.blend.p90Px, bins: b1.summary.estimators.blend.frames } : null;
      this.timeline.event(performance.now(), { type: 'end', reason: 'session complete' });
      const geometry = tracker?.geometry() ?? null;
      const manifest = this.timeline.manifest({ tester: this.settings.tester || 'Tester', sample: 1, model: MODEL_VERSION, viewport: this.calibrationViewport, pixelRatio: window.devicePixelRatio || 1, camera: geometry ? { width: geometry.width, height: geometry.height } : null, mimeType: this.recorder.actualMimeType, durationMs: this.recorder.durationMs(), complete: b1 !== null, live });
      this.uploader?.enqueue('clarte', JSON.stringify(manifest));
    }
    this.uploader?.enqueue('summary', JSON.stringify(this.summaryJson(), null, 1));
    this.saveSession(true);
    tracker?.stop(); this.tracker = null;
    await this.uploader?.flush();
    this.set({ kind: 'summary' });
  }
  private flushAll(keepalive: boolean): void {
    this.log?.flush();
    if (keepalive && this.uploader) { /* the queue is sequential; the browser may still cancel it on unload */ }
  }
  private summaryJson() {
    return { format: 'GAZE-LAB-SUMMARY-1', session: this.sessionId, tester: this.settings.tester, demo: this.query.demo, cmPerCssPx: this.cmPerPx(), viewport: this.calibrationViewport,
      frameFilter: 'record-phase frames with a face present and eyes open', estimators: estimatorLabels(this.estimatorNames()), trainingReport: this.trainingReport, reference: this.reference,
      blocks: this.blocks.map(b => ({ id: b.id, key: b.key, attempt: b.attempt, status: b.status, order: b.order, headShift: b.summary?.headShift ?? null, summary: b.summary })),
      ...(this.settings.quick ? { quick: this.quickJson() } : {}) };
  }
  /** Everything the quick-calibration test recorded, including the two calibration wall times (Q8 ran first, then C0). */
  private quickJson() {
    const q = this.quick, c0Start = this.calibrationStartedAt, c0End = this.calibrationTrainedAt;
    const wait = this.headStageReadyAt !== null && this.headStageStartedAt !== null ? this.headStageStartedAt - this.headStageReadyAt : null;
    return {
      block: QUICK_BLOCK, order: 'Q8 before C0', timing: QUICK_TIMING, worker: QUICK_WORKER, init: q.init, targets: this.quickTargets,
      startedAt: q.startedAt, trainedAt: q.trainedAt, wallMs: q.startedAt !== null && q.trainedAt !== null ? q.trainedAt - q.startedAt : null, labels: q.labels, pauses: q.pauses,
      trainingReport: q.trainingReport, geometric: q.trainingReport?.geometric ?? null, blendWeight: q.trainingReport?.geometric?.weight ?? null, learnedSaved: q.learnedSaved, error: q.error,
      c0: { startedAt: c0Start, trainedAt: c0End, wallMs: c0Start !== null && c0End !== null ? c0End - c0Start : null, headStageWaitMs: wait, labels: this.labels },
    };
  }
  private saveSession(complete = false): void {
    if (!this.uploader) return;
    const s = this.settings, geometry = this.tracker?.geometry() ?? null;
    const session = {
      format: 'GAZE-LAB-SESSION-1', id: this.sessionId, createdAt: new Date().toISOString(), tester: s.tester, notes: s.notes, cameraPosition: s.cameraPosition, demo: this.query.demo,
      screen: { diagonalIn: s.diagonalIn, width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio || 1, cmPerCssPx: this.cmPerPx() },
      viewport: this.calibrationViewport, window: windowMetrics(), camera: geometry, backend: this.backend, userAgent: navigator.userAgent,
      source: { commit: this.meta?.commit ?? null, workerSha256: this.meta?.workerSha256 ?? null, shippedWorkerSha256: this.meta?.shippedWorkerSha256 ?? null, model: MODEL_VERSION },
      settings: { recordVideo: s.recordVideo, recordStrips: s.recordStrips, blocks: s.blocks, candidate: s.candidate ? { name: s.candidate.name, geometric: !!s.candidate.geometric, blend: s.candidate.blend, correction: s.candidate.correction?.kind ?? null, head: this.candidateHeadActive } : null, timing: BLOCK_TIMING, pace: PACE, paceTiming: CALIBRATION_TIMING[PACE], seed: this.seed, ...(s.quick ? { quick: QUICK_WORKER } : {}) },
      calibration: { startedAt: this.calibrationStartedAt, viewport: this.calibrationViewport, labels: this.labels, trainingReport: this.trainingReport, geometric: this.trainingReport?.geometric ?? null, blendWeight: this.trainingReport?.geometric?.weight ?? null, reference: this.reference, learnedSaved: this.learned !== null },
      ...(s.quick ? { quick: this.quickJson() } : {}),
      targets: this.targets,
      blocks: this.blocks.map(b => ({ id: b.id, key: b.key, attempt: b.attempt, title: b.title, instruction: b.instruction, startedAt: b.startedAt, endedAt: b.endedAt, order: b.order, seed: b.seed, window: b.window, status: b.status, headShift: b.summary?.headShift ?? null, frames: b.summary?.frames ?? null, cameraMoved: b.summary?.cameraMoved ?? 0 })),
      video: this.recorder ? { mimeType: this.recorder.actualMimeType, chunks: this.videoChunks, bytes: this.videoBytes } : null,
      frames: this.rows.length, complete,
    };
    this.uploader.enqueue('session', JSON.stringify(session, null, 1));
  }

  // ---- input ----
  private onKey(e: KeyboardEvent): void {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const inField = target?.closest('input, select, textarea, button') !== null && target?.closest('input, select, textarea, button') !== undefined;
    const key = e.key;
    if (key === 'Escape') { e.preventDefault(); this.pause(); return; }
    if (inField) return;
    if (key === ' ' || key === 'Enter') { e.preventDefault(); this.primary(); return; }
    if (key.toLowerCase() === 'r' && !e.repeat) { this.redo(); return; }
    if (key.toLowerCase() === 's' && !e.repeat) { this.skip(); return; }
  }
  private primary(): void {
    switch (this.ui.kind) {
      case 'setup': if (this.ui.cameraState === 'on') void this.begin(); else if (this.ui.cameraState === 'off') void this.startCamera(); break;
      case 'quick': this.startQuick(); break;
      case 'calibration': this.startCalibration(); break;
      case 'instruction': this.startBlock(); break;
      case 'paused': this.resume(); break;
      default: break;
    }
  }
  private tick(): void {
    if (this.ui.kind === 'calibration' && this.calibration) {
      if (document.hidden) this.calibration.pause(); else this.calibration.tick(performance.now(), this.latest?.frame ?? { point: null, face: false, facePresent: false, eyeState: 'unknown', at: -Infinity, pose: null });
      if (this.pendingStart !== null) this.startCalibration();
      this.syncCalibration();
    }
    if (this.ui.kind === 'setup' || this.ui.kind === 'instruction') this.renderReadout();
  }

  // ---- rendering ----
  private render(): void {
    const root = this.root; root.replaceChildren();
    switch (this.ui.kind) {
      case 'setup': root.append(this.renderSetup(this.ui)); break;
      case 'quick': root.append(this.renderQuickScreen()); break;
      case 'calibration': root.append(this.renderCalibrationScreen()); break;
      case 'instruction': { const b = this.currentBlock()!; root.append(this.stage(b.title, [el('p', { class: 'instruction', text: b.instruction }), el('p', { class: 'readout', id: 'readout', text: ' ' })], [this.button('Start', () => this.startBlock(), true), this.button('Skip', () => this.skip())])); this.renderReadout(); break; }
      case 'block': { const dot = el('div', { class: 'validation-dot is-travel', id: 'dot' }); root.append(el('section', { class: 'dot-stage', 'aria-label': `${this.currentBlock()!.title}: look at the dot` }, dot)); this.renderDot(); break; }
      case 'paused': root.append(this.stage('Paused', [el('p', { class: 'readout', text: this.currentBlock()!.title })], [this.button('Continue', () => this.resume(), true), this.button('Redo block', () => this.redo()), this.button('Skip block', () => this.skip()), this.button('Finish', () => void this.finishEarly())])); break;
      case 'finishing': root.append(this.stage('Saving', [], [])); break;
      case 'summary': root.append(this.renderSummary()); break;
      case 'error': root.append(this.stage('Camera stopped', [el('p', { class: 'readout is-alert', text: this.ui.message })], [this.button('Start again', () => location.reload(), true)])); break;
    }
    if (this.query.demo) root.append(el('p', { class: 'demo-badge', text: 'Demo · no camera' }));
  }
  private stage(title: string, body: Node[], actions: Node[]): HTMLElement {
    const section = el('section', { class: 'stage' }, el('h1', { text: title }), ...body);
    if (actions.length) section.append(el('div', { class: 'actions' }, ...actions));
    return section;
  }
  private button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el('button', { type: 'button', text: label, ...(primary ? { class: 'primary' } : {}) });
    b.addEventListener('click', onClick); return b;
  }
  private renderSetup(ui: Ui & { kind: 'setup' }): HTMLElement {
    const s = this.settings;
    const field = (label: string, input: HTMLElement) => el('label', {}, el('span', { text: label }), input);
    const text = (value: string, onInput: (v: string) => void, attrs: Record<string, string> = {}) => { const i = el('input', { type: 'text', value, ...attrs }); i.addEventListener('input', () => onInput(i.value)); return i; };
    const check = (value: boolean, onChange: (v: boolean) => void) => { const i = el('input', { type: 'checkbox' }); i.checked = value; i.addEventListener('change', () => onChange(i.checked)); return i; };
    const diag = el('input', { type: 'number', step: '0.1', min: '5', max: '100', value: s.diagonalIn ? String(s.diagonalIn) : '', required: 'required', placeholder: 'e.g. 14.2' });
    diag.addEventListener('input', () => { s.diagonalIn = Number(diag.value) || 0; });
    const cameraSelect = el('select', {}, el('option', { value: 'built-in top-centre', text: 'Built-in, top centre' }), el('option', { value: 'other', text: 'Other' }));
    cameraSelect.value = s.cameraPosition === 'built-in top-centre' ? 'built-in top-centre' : 'other';
    const cameraText = text(s.cameraPosition === 'built-in top-centre' ? '' : s.cameraPosition, v => { s.cameraPosition = v || 'other'; }, { placeholder: 'where the camera is' });
    cameraText.hidden = cameraSelect.value !== 'other';
    cameraSelect.addEventListener('change', () => { cameraText.hidden = cameraSelect.value !== 'other'; s.cameraPosition = cameraSelect.value === 'other' ? (cameraText.value || 'other') : 'built-in top-centre'; });
    const blocks = el('div', { class: 'blocks' }, ...BLOCKS.map(b => { const c = check(s.blocks.includes(b.id), on => { s.blocks = BLOCKS.filter(x => (x.id === b.id ? on : s.blocks.includes(x.id))).map(x => x.id); }); return el('label', {}, c, el('span', { text: `${b.id} ${b.title}` })); }));
    const candidate = el('input', { type: 'file', accept: '.json,application/json' });
    const candidateNote = el('span', { class: 'readout', text: s.candidate ? s.candidate.name : '' });
    candidate.addEventListener('change', async () => { const f = candidate.files?.[0]; if (!f) { s.candidate = null; candidateNote.textContent = ''; return; } try { s.candidate = readCandidate(JSON.parse(await f.text())); candidateNote.textContent = s.candidate.name; } catch (e) { s.candidate = null; candidateNote.textContent = e instanceof Error ? e.message : 'invalid'; } });
    const form = el('form', { class: 'setup' },
      field('Tester', text(s.tester, v => { s.tester = v; }, { autocomplete: 'off' })),
      field('Screen diagonal (in)', diag),
      field('Camera', el('div', {}, cameraSelect, cameraText)),
      field('Notes', text(s.notes, v => { s.notes = v; })),
      field('Record video', check(s.recordVideo, v => { s.recordVideo = v; })),
      field('Record eye strips', check(s.recordStrips, v => { s.recordStrips = v; })),
      field('Blocks', blocks),
      field('Candidate', el('div', {}, candidate, candidateNote)),
      field('Quick calibration test', check(s.quick, v => { s.quick = v; })),
    );
    form.addEventListener('submit', e => e.preventDefault());
    const readout = el('p', { class: `readout${ui.message ? ' is-alert' : ''}`, id: 'readout', text: ui.message || ' ' });
    const actions = ui.cameraState === 'on'
      ? [this.button('Begin', () => void this.begin(), true), this.button('Full screen', () => void document.documentElement.requestFullscreen().catch(() => {}))]
      : ui.cameraState === 'starting' ? [el('button', { type: 'button', text: 'Starting camera…', disabled: 'disabled' })]
      : [this.button(this.query.demo ? 'Start demo' : 'Start camera', () => void this.startCamera(), true)];
    const section = el('section', { class: 'stage is-scroll' }, el('h1', { text: 'Gaze lab' }), form, readout, el('div', { class: 'actions' }, ...actions));
    return section;
  }
  private renderReadout(): void {
    const node = document.getElementById('readout');
    if (!node) return;
    const f = this.latest;
    if (this.ui.kind === 'setup') {
      if (this.ui.message) return;
      if (this.ui.cameraState !== 'on') { node.textContent = ' '; return; }
      if (!f) { node.textContent = 'waiting for frames'; return; }
      const origin = f.debug?.faceOrigin3D;
      node.textContent = `${f.gaze.facePresent ? 'face' : 'no face'} · eyes ${f.gaze.eyeState} · ${f.fps ? f.fps.toFixed(0) : '—'} fps · ${this.backend}${origin && f.gaze.facePresent ? ` · head x ${origin[0].toFixed(1)} y ${origin[1].toFixed(1)} z ${origin[2].toFixed(0)} cm` : ''}`;
      node.className = `readout${f.gaze.facePresent ? '' : ' is-alert'}`;
      return;
    }
    if (this.ui.kind === 'instruction') {
      const offset: HeadOffset | null = f && f.debug && f.gaze.facePresent && this.reference ? headOffset({ origin: f.debug.faceOrigin3D, faceRt: f.debug.faceRt }, this.reference) : null;
      node.textContent = this.reference ? describeOffset(offset) : 'no calibration reference';
      node.className = `readout${offset ? '' : ' is-alert'}`;
    }
  }
  private renderCalibrationScreen(): HTMLElement {
    const run = this.calibration!, s = run.state;
    if (['moving', 'settling', 'sampling', 'collecting'].includes(s.kind)) {
      const dot = el('div', { class: `calibration-point phase-${s.kind}`, id: 'cal-dot' });
      const stage = el('section', { class: 'dot-stage', 'aria-label': s.stage === 'eyes' ? 'Screen calibration' : 'Head movement calibration' }, dot);
      queueMicrotask(() => this.renderCalibration());
      return stage;
    }
    const message = this.ui.kind === 'calibration' ? this.ui.message : '';
    const title = s.kind === 'training' ? 'Calibrating' : s.kind === 'reading' ? `${s.stage === 'eyes' ? 'Calibrate screen dimensions' : 'Follow with your head'} · ${Math.ceil(s.remainingMs / 1000)}`
      : s.kind === 'paused' ? 'Calibration paused' : message || (s.stage === 'head' ? 'Calibrate head movement' : 'Calibrate');
    const actions = s.kind === 'reading' || s.kind === 'training' ? [] : [this.button(s.kind === 'paused' ? 'Continue' : 'Start', () => this.startCalibration(), true)];
    return this.stage(title, [], actions);
  }
  private lastCalibrationKind = '';
  private renderCalibration(): void {
    const run = this.calibration;
    if (!run || this.ui.kind !== 'calibration') return;
    const s = run.state, running = ['moving', 'settling', 'sampling', 'collecting'].includes(s.kind);
    const dot = document.getElementById('cal-dot');
    const signature = `${s.kind}:${s.stage}:${'remainingMs' in s ? Math.ceil(s.remainingMs / 1000) : ''}`;
    if (running && dot) {
      const p = run.point;
      dot.style.left = `${p.x}px`; dot.style.top = `${p.y}px`; dot.style.setProperty('--point-move', `${CALIBRATION_TIMING[PACE].moveMs}ms`);
      dot.className = `calibration-point phase-${s.kind}`;
    } else if (signature !== this.lastCalibrationKind) this.render();
    this.lastCalibrationKind = signature;
  }
  private renderDot(): void {
    const run = this.blockRun, dot = document.getElementById('dot');
    if (!run || !dot) return;
    const pos = run.position(performance.now());
    if (!pos) return;
    const t = this.targets[pos.target];
    dot.style.left = `${t.x}px`; dot.style.top = `${t.y}px`;
    dot.className = `validation-dot is-${pos.phase}`;
    dot.style.setProperty('--ring', `${Math.round((1 - pos.progress) * 60)}px`);
  }
  private renderSummary(): HTMLElement {
    const wrap = el('section', { class: 'summary' }, el('h1', { text: 'Results' }));
    const status = this.uploadStatus;
    const saved = status && status.failed === 0 ? `Saved to sessions/${this.sessionId}` : `Some uploads failed${status?.lastError ? `: ${status.lastError}` : ''}; the server may be off.`;
    wrap.append(el('p', { class: `note${status && status.failed ? ' is-alert' : ''}`, text: saved }));
    wrap.append(el('p', { class: 'note', text: 'Record-phase frames with a face present and eyes open only. Error in px and cm; bias is the median signed offset.' }));
    if (this.trainingReport) { const r = this.trainingReport; wrap.append(el('p', { class: 'note', text: `Calibration: ${r.samples} labels, held-out MSE ${r.heldOutBefore.toFixed(4)} → ${r.heldOutAfter.toFixed(4)} (${r.bestStep}/${r.stepsUsed} steps)${r.geometric ? `, geometric held-out ${r.geometric.heldOutMse?.toFixed(4) ?? '—'}, blend weight ${r.geometric.weight.toFixed(2)}` : ''}` })); }
    if (this.settings.quick) wrap.append(el('p', { class: `note${this.quick.error ? ' is-alert' : ''}`, text: this.quickLine() }));
    for (const b of this.blocks) {
      if (!b.summary || b.status === 'redone') continue;
      const sum = b.summary;
      const head = sum.headShift ? describeOffset(sum.headShift) : 'no head measurement';
      const table = el('table', {}, el('caption', { text: `${b.id} ${b.title}` }, el('span', { text: `${b.status}${b.status === 'skipped' ? '' : ` · ${sum.frames.used}/${sum.frames.record} frames · cells ${sum.cellHit.hits}/${sum.cellHit.points} · head ${head}${sum.cameraMoved ? ` · camera moved ×${sum.cameraMoved}` : ''}`}` })));
      table.append(el('thead', {}, el('tr', {}, ...['estimator', 'median px', 'cm', '|dx| px', '|dy| px', 'bias dx', 'bias dy', 'p90 px'].map(h => el('th', { text: h })))));
      const body = el('tbody');
      for (const name of this.estimatorNames()) {
        const st = sum.estimators[name];
        if (!st && (name === 'candidate' || name === 'geometric')) continue;
        body.append(el('tr', {}, el('td', { text: ESTIMATOR_LABELS[name] }), ...(st ? [fmtPx(st.medianPx), fmtCm(st.medianCm), fmtPx(st.medianAbsDxPx), fmtPx(st.medianAbsDyPx), fmtPx(st.biasDxPx), fmtPx(st.biasDyPx), fmtPx(st.p90Px)] : ['—', '—', '—', '—', '—', '—', '—']).map(v => el('td', { text: v }))));
      }
      table.append(body); wrap.append(table);
    }
    const download = this.button('Download summary', () => { const blob = new Blob([JSON.stringify(this.summaryJson(), null, 1)], { type: 'application/json' }); const a = el('a', { href: URL.createObjectURL(blob), download: `${this.sessionId}-summary.json` }); document.body.append(a); a.click(); a.remove(); });
    wrap.append(el('div', { class: 'actions' }, download, this.button('New session', () => location.reload())));
    return wrap;
  }
  /** One line with both calibration wall times; Q8 ran first, so any recency advantage went to the shipped calibration. */
  private quickLine(): string {
    const q = this.quickJson(), s = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
    const r = q.trainingReport;
    const quick = q.error ? `failed (${q.error}; ${q.labels} labels)` : `${s(q.wallMs)} · ${q.labels} labels on ${this.quickTargets.length} dots${r ? ` · held-out ${r.heldOutBefore.toFixed(4)} → ${r.heldOutAfter.toFixed(4)}${r.geometric ? ` · blend weight ${r.geometric.weight.toFixed(2)}` : ''}` : ''}`;
    return `Quick calibration (Q8, ran first): ${quick} — shipped (C0): ${s(q.c0.wallMs)}${q.c0.headStageWaitMs !== null ? ` · ${s(q.c0.headStageWaitMs)} key wait` : ''}`;
  }
}

export function cameraMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError': return 'Camera access was blocked. Allow the camera for 127.0.0.1, then try again.';
      case 'NotFoundError': return 'No camera was found.';
      case 'NotReadableError': return 'The camera is in use by another app.';
      case 'SecurityError': return 'Camera needs a secure context: open http://127.0.0.1:4330.';
    }
  }
  return error instanceof Error ? error.message : 'The tracker stopped.';
}
export { median };
