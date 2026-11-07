import type { HeadPose } from './head-position';
import type { GazeFrame, Point, Viewport } from './tracking';
import type { TargetRect } from './gaze';
import { SelectionLearning } from './selection-learning';

/**
 * Head-pose–conditioned correction. The learned screen correction depends on where the head is:
 * turned, tilted, nearer or farther. One global correction is always kept (today's behaviour);
 * on top, the bank learns a separate correction per head-pose cell and uses it once that cell
 * has enough confirmed selections. Returning to a pose you have used before therefore reuses what
 * was learned there, instead of dragging the global fit back and forth.
 */
export const POSTURE = {
  /** Cell width for the nose offset ratios (yaw, pitch). */
  turnStep: .08,
  /** Cell width for distance, in log(span). ln(1.15) ≈ one step per 15% closer or farther. */
  distanceStep: Math.log(1.15),
  /** Confirmed selections a cell needs before its own correction is used instead of the global one. */
  minimumSelections: 4,
  /** Distinct targets a cell needs before its own correction is used. */
  minimumTargets: 2,
  /** Cells kept; the least recently used is dropped. */
  capacity: 24,
};

export function postureKey(pose: HeadPose): string {
  return [Math.round(pose.yawRatio / POSTURE.turnStep), Math.round(pose.pitchRatio / POSTURE.turnStep), Math.round(Math.log(pose.span) / POSTURE.distanceStep)].join(':');
}

type Cell = { learning: SelectionLearning; selections: number; targets: Set<string>; usedAt: number };

export class PostureBank {
  readonly global = new SelectionLearning();
  private cells = new Map<string, Cell>();
  private tick = 0;

  reset(): void { this.global.reset(); this.cells.clear(); }
  get cellCount(): number { return this.cells.size; }

  private cell(pose: HeadPose): Cell {
    const key = postureKey(pose);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { learning: new SelectionLearning(), selections: 0, targets: new Set(), usedAt: 0 };
      this.cells.set(key, cell);
      if (this.cells.size > POSTURE.capacity) {
        const oldest = [...this.cells.entries()].reduce((a, b) => (b[1].usedAt < a[1].usedAt ? b : a));
        this.cells.delete(oldest[0]);
      }
    }
    cell.usedAt = ++this.tick;
    return cell;
  }

  /** The correction in force for this pose: the cell's own once it has learned enough, else the global one. */
  active(pose: HeadPose | null | undefined): SelectionLearning {
    if (!pose) return this.global;
    const cell = this.cells.get(postureKey(pose));
    if (cell && cell.selections >= POSTURE.minimumSelections && cell.targets.size >= POSTURE.minimumTargets) { cell.usedAt = ++this.tick; return cell.learning; }
    return this.global;
  }

  correct(frame: GazeFrame, viewport: Viewport): GazeFrame { return this.active(frame.pose).correct(frame, viewport); }
  apply(point: Point, pose: HeadPose | null | undefined, viewport: Viewport): Point { return this.active(pose).apply(point, viewport); }

  /** A confirmed selection teaches the global correction and the cell for the pose it was made in. */
  learn(estimates: Point[], target: TargetRect, viewport: Viewport, pose: HeadPose | null | undefined): boolean {
    const learned = this.global.learn(estimates, target, viewport);
    if (!learned || !pose) return learned;
    const cell = this.cell(pose);
    if (cell.learning.learn(estimates, target, viewport)) { cell.selections++; cell.targets.add(target.id); }
    return learned;
  }

  /** A measured check seeds the global correction and, at its pose, a cell that counts as trusted. */
  seed(pairs: { estimate: Point; target: Point }[], viewport: Viewport, pose: HeadPose | null | undefined): number {
    const seeded = this.global.seed(pairs, viewport);
    if (seeded && pose) {
      const cell = this.cell(pose);
      cell.learning.seed(pairs, viewport);
      cell.selections = Math.max(cell.selections, POSTURE.minimumSelections);
      pairs.forEach((_, i) => cell.targets.add(`check-${i}`));
    }
    return seeded;
  }
}
