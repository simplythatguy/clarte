import { seededRandom, shuffle } from './layout';

/** One validation dot: travel+settle, then the record window while the ring shrinks. */
export const BLOCK_TIMING = { travelMs: 900, recordMs: 1600 } as const;
export type BlockKind = 'neutral' | 'shift' | 'return' | 'camera';
export type BlockDef = { id: string; title: string; instruction: string; kind: BlockKind; optional: boolean };
export const BLOCKS: readonly BlockDef[] = [
  { id: 'B1', title: 'Neutral', instruction: 'Sit as you did for calibration.', kind: 'neutral', optional: false },
  { id: 'B2', title: 'Left', instruction: 'Slide your head and body about 10 cm to your left; keep facing the screen.', kind: 'shift', optional: false },
  { id: 'B3', title: 'Right', instruction: 'Slide your head and body about 10 cm to your right; keep facing the screen.', kind: 'shift', optional: false },
  { id: 'B4', title: 'Up', instruction: 'Sit taller: raise your head about 8 cm.', kind: 'shift', optional: false },
  { id: 'B5', title: 'Down', instruction: 'Slouch: lower your head about 8 cm.', kind: 'shift', optional: false },
  { id: 'B6', title: 'Closer', instruction: 'Lean in about 10 cm.', kind: 'shift', optional: false },
  { id: 'B7', title: 'Farther', instruction: 'Lean back about 10 cm.', kind: 'shift', optional: false },
  { id: 'B8', title: 'Turn left', instruction: 'Turn your head about 15° to the left; keep your eyes on the dot.', kind: 'shift', optional: false },
  { id: 'B9', title: 'Turn right', instruction: 'Turn your head about 15° to the right; keep your eyes on the dot.', kind: 'shift', optional: false },
  { id: 'B10', title: 'Chin up', instruction: 'Tilt your chin up about 10°.', kind: 'shift', optional: false },
  { id: 'B11', title: 'Chin down', instruction: 'Tilt your chin down about 10°.', kind: 'shift', optional: false },
  { id: 'B12', title: 'Return', instruction: 'Sit normally again.', kind: 'return', optional: false },
  { id: 'B13', title: 'Lid tilt', instruction: 'Tilt the laptop screen back about 5°, then sit normally.', kind: 'camera', optional: true },
];
export const blockById = (id: string): BlockDef | undefined => BLOCKS.find(b => b.id === id);

export type Phase = 'travel' | 'record';
export type BlockState =
  | { kind: 'ready' }
  | { kind: 'running'; index: number; startedAt: number }
  | { kind: 'paused'; index: number }
  | { kind: 'complete' };
export type BlockPosition = { index: number; target: number; phase: Phase; elapsedMs: number; progress: number };

/**
 * Pure, time-driven run of one block: `order.length` dots, each travel+settle then record. Pausing
 * restarts the current dot from its travel phase on resume, so no partial record window is kept.
 */
export class BlockRun {
  readonly order: readonly number[];
  state: BlockState = { kind: 'ready' };
  /** Frame times already classified, so a frame is never counted twice. */
  private lastFrameAt = -Infinity;
  constructor(readonly block: BlockDef, targetCount: number, readonly seed: number, timing: { travelMs: number; recordMs: number } = BLOCK_TIMING) {
    this.timing = timing;
    this.order = shuffle(Array.from({ length: targetCount }, (_, i) => i), seededRandom(seed));
  }
  readonly timing: { travelMs: number; recordMs: number };
  get pointMs(): number { return this.timing.travelMs + this.timing.recordMs; }
  start(now: number): boolean {
    if (this.state.kind !== 'ready' && this.state.kind !== 'paused') return false;
    this.state = { kind: 'running', index: this.state.kind === 'paused' ? this.state.index : 0, startedAt: now };
    return true;
  }
  pause(): boolean {
    if (this.state.kind !== 'running') return false;
    this.state = { kind: 'paused', index: this.state.index };
    return true;
  }
  /** Advances to later dots as time passes; completes after the last record window. */
  tick(now: number): void {
    if (this.state.kind !== 'running') return;
    let { index, startedAt } = this.state;
    while (now - startedAt >= this.pointMs) {
      startedAt += this.pointMs; index++;
      if (index >= this.order.length) { this.state = { kind: 'complete' }; return; }
    }
    this.state = { kind: 'running', index, startedAt };
  }
  /** Where the dot is and which phase a moment `at` falls in; null when not running or before the current dot. */
  position(at: number): BlockPosition | null {
    if (this.state.kind !== 'running') return null;
    const elapsedMs = at - this.state.startedAt;
    if (elapsedMs < 0 || elapsedMs >= this.pointMs) return null;
    const record = elapsedMs - this.timing.travelMs;
    return { index: this.state.index, target: this.order[this.state.index], phase: record < 0 ? 'travel' : 'record', elapsedMs, progress: record < 0 ? 0 : Math.min(1, record / this.timing.recordMs) };
  }
  /** Classifies a camera frame captured at `at`; frames out of order or repeated are rejected. */
  classify(at: number): BlockPosition | null {
    if (!Number.isFinite(at) || at <= this.lastFrameAt) return null;
    this.lastFrameAt = at;
    return this.position(at);
  }
}

/** A seed for a block's dot order; recorded so the order can be reproduced offline. */
export function blockSeed(sessionSeed: number, blockId: string): number {
  let h = sessionSeed >>> 0;
  for (const ch of blockId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
