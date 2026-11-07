/**
 * How calibration adapts the gaze head to one person. The image encoder is frozen; only the small
 * head (six tensors) trains, on the person's own labelled calibration frames, on their device.
 *
 * Safety: one sample per dot is held out and training keeps the best held-out weights, stopping
 * when they stop improving. If no step beats the pretrained head, the pretrained head is kept, so
 * training can never leave a person worse off than the affine-only calibration it replaces.
 */
export type TrainingOptions = {
  /** Maximum Adam steps on the gaze head. 0 keeps the pretrained head (affine correction only). */
  steps: number;
  lr: number;
  /** L2 pull of every head weight toward its pretrained value; keeps 42 samples from overfitting. */
  l2: number;
  /** Hold out one sample per dot for early stopping (needs at least six dots with two samples each). */
  holdout: boolean;
  evalEvery: number;
  /** Evaluations without improvement before stopping. */
  patience: number;
};
/**
 * Chosen on a real replay set (one person, 13 dots, 333 check frames, 2026-11-07; see
 * docs/ACCURACY-LOG.md): affine only 141 px median / 39% correct cell; 60 steps @1e-3 with L2 1e-2
 * 139 px / 53%; 200 steps @3e-3 without L2 85 px / 86%. Higher rates or 400+ steps overfit.
 * To be re-checked on the other testers' recordings.
 */
export const TRAINING_DEFAULTS: TrainingOptions = { steps: 200, lr: 3e-3, l2: 0, holdout: true, evalEvery: 10, patience: 6 };
export type TrainingReport = {
  samples: number; heldOut: number; stepsUsed: number; bestStep: number;
  /** Held-out mean squared error in normalized screen units before and after training (NaN without holdout). */
  heldOutBefore: number; heldOutAfter: number;
  options: TrainingOptions;
  /** The geometric (iris and lid) estimator fitted alongside, and how much of the blend it gets; null when it could not be fitted. */
  geometric?: { samples: number; targets: number; outliers: number; heldOutMse: number | null; weight: number } | null;
};
const bounded = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback);

/** Fills in defaults and bounds every value; unknown input yields the defaults. */
export function readTrainingOptions(v: unknown): TrainingOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof TrainingOptions, unknown>>;
  const d = TRAINING_DEFAULTS;
  return {
    steps: Math.round(bounded(o.steps, 0, 1000, d.steps)), lr: bounded(o.lr, 0, .1, d.lr), l2: bounded(o.l2, 0, 1, d.l2),
    holdout: typeof o.holdout === 'boolean' ? o.holdout : d.holdout,
    evalEvery: Math.round(bounded(o.evalEvery, 1, 100, d.evalEvery)), patience: Math.round(bounded(o.patience, 1, 100, d.patience)),
  };
}
