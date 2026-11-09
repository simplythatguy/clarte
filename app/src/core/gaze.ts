/**
 * Gaze engine for the UI prototypes.
 *
 * Turns a stream of gaze points (real tracker, or the mouse in the simulator) into backend
 * quadrants, then into the single action in that quadrant, then into selections through a dwell
 * state machine. Framework-free: wrap `subscribe` in a hook or store for your UI.
 *
 * Selection modes:
 *  - 'dwell': a steady look at an action for `dwellMs` selects it.
 *  - 'confirm': a steady look previews the action; `confirm()` (blink, key, switch) selects it.
 *
 * Switching cards. The card the engine is on changes only when the eyes have settled on another
 * one: over the last `holdMs`, the new card (or rest zone) must hold at least `holdShare` of the
 * time. A clean look moves after holdShare × holdMs; a noisy one takes longer, and a look that
 * keeps straying to a neighbour never moves there. The card it is on still needs the eyes: a dwell
 * or preview starts only while the latest sample is on it, and ends when they have been off it for
 * `graceMs`, so the line never runs on a card the eyes have left.
 *
 * After a selection the action stays `selected` (latched) until gaze has been off it for
 * `rearmMs`, so one long look never fires twice.
 */
import { BACKEND_COLS, BACKEND_ROWS, actionIn, quadrantAt, type Actionable, type QuadrantId, type Viewport } from './quadrants.ts';

export type SelectionMode = 'dwell' | 'confirm';

export type GazeSettings = {
  mode: SelectionMode;
  /** These actions preview in either mode and only sound (or direct input) can select them. */
  soundActions: readonly string[];
  /** Steady look needed to select (dwell) or preview (confirm). */
  dwellMs: number;
  /**
   * The window over which another card must win before the engine moves to it. 0 moves at the
   * first sample.
   */
  holdMs: number;
  /** The share of the last `holdMs` the other card must hold (0..1). */
  holdShare: number;
  /** Gaze must stay off a selected action this long before it can fire again. */
  rearmMs: number;
  /** No samples for this long counts as lost gaze. */
  staleMs: number;
  /**
   * A dwell or preview survives the eyes leaving its action for up to this long (micro-saccades,
   * a stray sample, a glance at a neighbouring gutter). Longer exits cancel it.
   */
  graceMs: number;
  /** Missing samples (closed eyes, lost face) shorter than this never change the quadrant. */
  blinkGraceMs: number;
  /** Simulator jitter, as a fraction of the shorter viewport side. 0 disables it. */
  noiseSigma: number;
  /** Exponential smoothing of incoming points: 1 = none, smaller = smoother. */
  smoothing: number;
  /**
   * How a selected action fires again. 'leave': gaze must leave it first (safe default, no
   * auto-repeat). 'redwell': staying on it for 1.5 × dwellMs fires it again, with progress shown,
   * which makes double letters inside one group (LL, OO) one look instead of two.
   */
  repeat: 'leave' | 'redwell';
  /**
   * Width of the band along each internal grid line, as a fraction of the shorter viewport side,
   * inside which samples do not change the current quadrant. Keeps a gaze that wanders over a
   * border from flipping between neighbours.
   */
  deadBand: number;
};

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  mode: 'dwell',
  soundActions: [],
  dwellMs: 900,
  // Tuned on recorded webcam gaze (Gaze Lab Test-1, 12 posture blocks): against the old 150 ms
  // hold, lines started on the wrong card 13 times instead of 37 and wrong cards were selected 10
  // times instead of 19. A clean look moves after 650 ms.
  holdMs: 1000,
  holdShare: 0.65,
  rearmMs: 300,
  staleMs: 600,
  graceMs: 300,
  blinkGraceMs: 200,
  noiseSigma: 0,
  smoothing: 0.5,
  repeat: 'leave',
  deadBand: 0.03,
};

export type ActionState = 'idle' | 'focused' | 'dwelling' | 'previewed' | 'selected';

export type GazeSnapshot = {
  point: { x: number; y: number } | null;
  quadrant: QuadrantId | null;
  /** The action that owns the current quadrant, or null over a rest zone. */
  looked: string | null;
  /** The action the state refers to: the one being dwelt on, previewed or latched; else `looked`. */
  action: string | null;
  state: ActionState;
  /** 0..1 while dwelling; 1 while previewed or selected; 0 otherwise. */
  progress: number;
  at: number;
};

export type GazeEvent =
  | { type: 'select'; action: string; quadrant: QuadrantId | null; at: number }
  | { type: 'preview'; action: string; at: number }
  | { type: 'cancel'; action: string; at: number };

export type GazeListener = (snapshot: GazeSnapshot, event?: GazeEvent) => void;

type Internal =
  | { kind: 'idle' }
  | { kind: 'dwelling'; action: string; since: number; awaySince: number | null }
  | { kind: 'previewed'; action: string; awaySince: number | null }
  | { kind: 'selected'; action: string; at: number; offSince: number | null };

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class GazeEngine {
  settings: GazeSettings;
  private viewport: Viewport = { width: 1, height: 1 };
  private actionables: readonly Actionable[] = [];
  private listeners = new Set<GazeListener>();
  private point: { x: number; y: number } | null = null;
  private lastSampleAt = -Infinity;
  private currentQuadrant: QuadrantId | null = null;
  /** Where the latest sample landed, before any hold: the eyes right now. */
  private rawQuadrant: QuadrantId | null = null;
  /** Recent samples' quadrants for the hold vote; null for a sample that votes for nothing. */
  private history: { at: number; quadrant: QuadrantId | null }[] = [];
  private internal: Internal = { kind: 'idle' };
  private now = 0;
  private lostSince: number | null = null;

  constructor(settings: Partial<GazeSettings> = {}) {
    this.settings = { ...DEFAULT_GAZE_SETTINGS, ...settings };
  }

  configure(settings: Partial<GazeSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.emit();
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Register the current actionables. Call after every layout change. */
  setActionables(actionables: readonly Actionable[]): void {
    this.actionables = actionables;
    this.resolve(this.now);
  }

  get snapshot(): GazeSnapshot {
    const action = this.actionFor(this.currentQuadrant);
    const s = this.internal;
    const state: ActionState =
      s.kind === 'selected' ? 'selected'
      : s.kind === 'previewed' ? 'previewed'
      : s.kind === 'dwelling' ? 'dwelling'
      : action ? 'focused' : 'idle';
    const progress =
      s.kind === 'dwelling' ? Math.min(1, (this.now - s.since) / this.settings.dwellMs)
      : s.kind === 'previewed' ? 1
      : s.kind === 'selected' ? (this.settings.repeat === 'redwell' && s.offSince === null ? Math.min(1, (this.now - s.at) / (this.settings.dwellMs * 1.5)) : 1)
      : 0;
    return {
      point: this.point,
      quadrant: this.currentQuadrant,
      looked: action?.id ?? null,
      action: s.kind === 'idle' ? action?.id ?? null : s.action,
      state,
      progress,
      at: this.now,
    };
  }

  subscribe(listener: GazeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  /** Feed a raw gaze point in viewport pixels, or null when the tracker lost the eyes. */
  sample(x: number | null, y: number | null, at: number = performance.now()): void {
    this.now = Math.max(this.now, at);
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      this.lastSampleAt = at;
      if (this.lostSince === null) this.lostSince = at;
      if (at - this.lostSince >= this.settings.blinkGraceMs) {
        this.point = null;
        this.loseQuadrant();
      }
      this.vote(at, null);
      this.resolve(at);
      return;
    }
    this.lostSince = null;
    const { noiseSigma, smoothing } = this.settings;
    const side = Math.min(this.viewport.width, this.viewport.height);
    const nx = x + (noiseSigma > 0 ? gaussian() * noiseSigma * side : 0);
    const ny = y + (noiseSigma > 0 ? gaussian() * noiseSigma * side : 0);
    this.point = this.point
      ? { x: this.point.x + (nx - this.point.x) * smoothing, y: this.point.y + (ny - this.point.y) * smoothing }
      : { x: nx, y: ny };
    this.lastSampleAt = at;
    // Inside the dead band a sample keeps where the eyes were and votes for nothing.
    const quadrant = this.inDeadBand(this.point.x, this.point.y) ? null : quadrantAt(this.point.x, this.point.y, this.viewport);
    if (quadrant) this.rawQuadrant = quadrant;
    this.vote(at, quadrant);
    this.resolve(at);
  }

  /** True when the point lies within `deadBand` of an internal grid line. */
  private inDeadBand(x: number, y: number): boolean {
    const band = this.settings.deadBand * Math.min(this.viewport.width, this.viewport.height);
    if (band <= 0) return false;
    const cellWidth = this.viewport.width / BACKEND_COLS;
    const cellHeight = this.viewport.height / BACKEND_ROWS;
    for (let c = 1; c < BACKEND_COLS; c++) if (Math.abs(x - c * cellWidth) < band) return true;
    for (let r = 1; r < BACKEND_ROWS; r++) if (Math.abs(y - r * cellHeight) < band) return true;
    return false;
  }

  /** Advance time. Call from requestAnimationFrame so dwell progress and staleness update. */
  tick(at: number = performance.now()): void {
    this.now = Math.max(this.now, at);
    if (at - this.lastSampleAt > this.settings.staleMs && this.point !== null) {
      this.point = null;
      this.loseQuadrant();
    }
    this.resolve(at);
  }

  /**
   * Confirm a preview; sound-only actions also require a completed preview and fresh tracking. In confirm mode
   * (no dwell, owner 2026-11-08) only a card whose line has closed is selected (NAT-51): a sound, Space or a
   * switch while the line is still drawing does nothing. Dwell mode keeps confirming a dwell early.
   */
  confirm(at: number = performance.now(), source: 'explicit' | 'sound' = 'explicit'): void {
    this.now = Math.max(this.now, at);
    const s = this.internal;
    if (s.kind !== 'previewed' && !(s.kind === 'dwelling' && this.settings.mode === 'dwell')) return;
    if (this.settings.soundActions.includes(s.action)) {
      if (source !== 'sound' || s.kind !== 'previewed' || this.lostSince !== null
        || !this.point || this.now - this.lastSampleAt > this.settings.staleMs
        || this.actionFor(this.currentQuadrant)?.id !== s.action
        || this.actionFor(this.rawQuadrant)?.id !== s.action) return;
    }
    this.select(s.action, at);
  }

  /** Select an action directly (mouse click, keyboard shortcut). */
  activate(actionId: string, at: number = performance.now()): void {
    this.now = Math.max(this.now, at);
    this.select(actionId, at);
  }

  /** Drop any dwell or preview in progress. A latched selection stays latched. */
  cancel(at: number = performance.now()): void {
    const s = this.internal;
    if (s.kind === 'dwelling' || s.kind === 'previewed') {
      this.internal = { kind: 'idle' };
      this.emit({ type: 'cancel', action: s.action, at });
    }
  }

  private actionFor(quadrant: QuadrantId | null): Actionable | null {
    return quadrant ? actionIn(quadrant, this.actionables, this.viewport) : null;
  }

  /** What a quadrant shows: its action, or the rest zone itself. A wide card is one target. */
  private targetOf(quadrant: QuadrantId): string {
    return this.actionFor(quadrant)?.id ?? `rest:${quadrant}`;
  }

  /** The eyes are gone (past the blink grace, or no samples): no quadrant, at once. */
  private loseQuadrant(): void {
    this.currentQuadrant = null;
    this.rawQuadrant = null;
    this.history = [];
  }

  private vote(at: number, quadrant: QuadrantId | null): void {
    this.history.push({ at, quadrant });
    const from = at - this.settings.holdMs;
    while (this.history.length > 1 && this.history[1].at <= from) this.history.shift();
  }

  /**
   * Move to the target the eyes have settled on. Inside the current target (another quadrant of a
   * wide card) the quadrant follows the eyes at once; another target must hold `holdShare` of the
   * last `holdMs`, each sample counting until the next one (at most `staleMs`).
   */
  private settle(at: number): void {
    const raw = this.rawQuadrant;
    if (!raw) return;
    const current = this.currentQuadrant ? this.targetOf(this.currentQuadrant) : null;
    const rawTarget = this.targetOf(raw);
    if (rawTarget === current || this.settings.holdMs <= 0) { this.currentQuadrant = raw; return; }
    const from = at - this.settings.holdMs;
    let held = 0;
    for (let i = 0; i < this.history.length; i++) {
      const s = this.history[i];
      if (!s.quadrant || this.targetOf(s.quadrant) !== rawTarget) continue;
      const end = Math.min(i + 1 < this.history.length ? this.history[i + 1].at : at, s.at + this.settings.staleMs);
      held += Math.max(0, end - Math.max(s.at, from));
    }
    if (held >= this.settings.holdShare * this.settings.holdMs) this.currentQuadrant = raw;
  }

  private select(actionId: string, at: number): void {
    this.internal = { kind: 'selected', action: actionId, at, offSince: null };
    this.emit({ type: 'select', action: actionId, quadrant: this.currentQuadrant, at });
  }

  private resolve(at: number): void {
    this.settle(at);
    const looked = this.actionFor(this.currentQuadrant)?.id ?? null;
    /** The action under the eyes right now; a dwell runs only while it is the one looked at. */
    const under = this.actionFor(this.rawQuadrant)?.id ?? null;
    const s = this.internal;
    let event: GazeEvent | undefined;

    if (s.kind === 'selected' && this.settings.mode === 'confirm') {
      // Confirm mode: a look never selects by itself, so nothing can fire under a resting gaze and
      // the person need not look away between selections. The card they keep looking at is ready
      // again after rearmMs (another Space, click or sound selects it again: a double letter, a
      // second Delete); a card that took its place (a new screen) starts its own look at once.
      if (looked === s.action && under === s.action) {
        if (at - s.at >= this.settings.rearmMs) this.internal = { kind: 'previewed', action: s.action, awaySince: null };
      } else {
        this.internal = { kind: 'idle' };
      }
    } else if (s.kind === 'selected') {
      if (looked === s.action) {
        this.internal = { ...s, offSince: null };
        if (!this.settings.soundActions.includes(s.action) && this.settings.repeat === 'redwell' && at - s.at >= this.settings.dwellMs * 1.5) { this.select(s.action, at); return; }
      }
      else if (s.offSince === null) this.internal = { ...s, offSince: at };
      else if (at - s.offSince >= this.settings.rearmMs) this.internal = { kind: 'idle' };
    }

    if (this.internal.kind === 'idle') {
      if (looked && under === looked) this.internal = { kind: 'dwelling', action: looked, since: at, awaySince: null };
    } else if (this.internal.kind === 'dwelling') {
      const d = this.internal;
      if (looked !== d.action || under !== d.action) {
        const awaySince = d.awaySince ?? at;
        if (at - awaySince < this.settings.graceMs) {
          this.internal = { ...d, awaySince };
        } else {
          this.internal = looked && under === looked ? { kind: 'dwelling', action: looked, since: at, awaySince: null } : { kind: 'idle' };
          event = { type: 'cancel', action: d.action, at };
        }
      } else if (d.awaySince !== null) {
        this.internal = { ...d, awaySince: null };
      } else if (at - d.since >= this.settings.dwellMs) {
        if (this.settings.mode === 'dwell' && !this.settings.soundActions.includes(d.action)) { this.select(d.action, at); return; }
        this.internal = { kind: 'previewed', action: d.action, awaySince: null };
        event = { type: 'preview', action: d.action, at };
      }
    } else if (this.internal.kind === 'previewed') {
      const p = this.internal;
      if (looked !== p.action) {
        this.internal = looked && under === looked ? { kind: 'dwelling', action: looked, since: at, awaySince: null } : { kind: 'idle' };
        event = { type: 'cancel', action: p.action, at };
      } else if (under !== p.action) {
        const awaySince = p.awaySince ?? at;
        if (at - awaySince < this.settings.graceMs) this.internal = { ...p, awaySince };
        else { this.internal = { kind: 'idle' }; event = { type: 'cancel', action: p.action, at }; }
      } else if (p.awaySince !== null) {
        this.internal = { ...p, awaySince: null };
      }
    }
    this.emit(event);
  }

  private emit(event?: GazeEvent): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot, event);
  }
}

/** Drive the engine from the mouse. The pointer is the simulated gaze point. */
export function attachPointer(engine: GazeEngine, target: Window | HTMLElement = window): () => void {
  const move = (e: Event) => { const p = e as PointerEvent; engine.sample(p.clientX, p.clientY, e.timeStamp); };
  const leave = (e: Event) => engine.sample(null, null, e.timeStamp);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerdown', move);
  (target === window ? document : target).addEventListener('pointerleave', leave);
  return () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerdown', move);
    (target === window ? document : target).removeEventListener('pointerleave', leave);
  };
}

/**
 * Keyboard access for demos and for people who cannot use gaze right now.
 * Digits 1-8 select the action in Q1-Q8. Space or Enter confirms a preview. Escape cancels.
 */
export function attachKeyboard(engine: GazeEngine, resolveQuadrant: (q: QuadrantId) => string | null): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (/^[1-8]$/.test(e.key)) {
      const quadrant = `Q${e.key}` as QuadrantId;
      const action = resolveQuadrant(quadrant);
      if (action) { engine.activate(action, e.timeStamp); e.preventDefault(); }
    } else if (e.key === ' ' || e.key === 'Enter') {
      engine.confirm(e.timeStamp); e.preventDefault();
    } else if (e.key === 'Escape') {
      engine.cancel(e.timeStamp);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** requestAnimationFrame loop that advances dwell progress and staleness. */
export function startTicking(engine: GazeEngine): () => void {
  let frame = 0;
  const loop = (t: number) => { engine.tick(t); frame = requestAnimationFrame(loop); };
  frame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frame);
}
