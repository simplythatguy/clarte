import * as tf from '@tensorflow/tfjs';
import { fitAffine, fitCorrection, fitRansacAffine, fromUnits, toUnits, type Correction, type CorrectionModel, type CorrectionPair } from '../src/core/calibration-models';
import type { ReplayFile } from '../src/core/replay-file';
import type { ReplayEntry } from '../src/core/worker-engine';
import type { Point, Viewport } from '../src/core/tracking';

/**
 * Offline personalization experiments on a recorded replay set, run through the shipped
 * BlazeGaze model in the browser. Development only: nothing here runs in the app.
 */
export type Frame = { entry: ReplayEntry; features: Float32Array };
export type Experiment = {
  name: string;
  /** Gradient steps on the gaze head; 0 keeps the pretrained head. */
  steps: number; lr: number;
  /** L2 pull of each head weight toward its pretrained value. */
  l2: number;
  /** Screen-space correction fitted after the head, on per-dot medians unless `perSample`. */
  correction: CorrectionModel; perSample?: boolean;
  /** Fit the affine before fine-tuning and train through it (the production order). */
  affineFirst?: boolean;
};
export type Score = { name: string; fitMedianPx: number; lodoMedianPx: number | null; lodoP90Px: number | null; checkMedianPx: number | null; checkP90Px: number | null; /** Share of check frames landing in the same 4×2 navigation cell as the target. */ checkCell: number | null; checkOffsets: { x: number; y: number; dx: number; dy: number }[] };

export const EXPERIMENTS: Experiment[] = [
  { name: 'none (pretrained head, no correction)', steps: 0, lr: 0, l2: 0, correction: 'none' },
  { name: 'production: affine on all samples + 1 step @1e-5', steps: 1, lr: 1e-5, l2: 0, correction: 'affine', perSample: true, affineFirst: true },
  { name: 'affine on per-dot medians', steps: 0, lr: 0, l2: 0, correction: 'affine' },
  { name: 'robust affine on per-dot medians', steps: 0, lr: 0, l2: 0, correction: 'ransac-affine' },
  ...[50, 100, 200, 400].flatMap(steps => [1e-3, 3e-3, 1e-2].flatMap(lr => [0, 1e-3].map(l2 => ({ name: `fine-tune ${steps} steps @${lr}${l2 ? ` l2 ${l2}` : ''} + affine`, steps, lr, l2, correction: 'affine' as const })))),
  { name: 'fine-tune 200 steps @3e-3 + robust affine', steps: 200, lr: 3e-3, l2: 0, correction: 'ransac-affine' },
];

export class Harness {
  private model!: tf.LayersModel;
  private encoder!: tf.LayersModel;
  private head!: tf.LayersModel;
  private initial: tf.Tensor[] = [];
  constructor(readonly viewport: Viewport) {}

  async load(url = '/vendor/webeyetrack/web/model.json'): Promise<void> {
    this.model = await tf.loadLayersModel(url);
    this.encoder = this.model.getLayer('cnn_encoder') as unknown as tf.LayersModel;
    this.head = this.model.getLayer('gaze_mlp') as unknown as tf.LayersModel;
    this.encoder.trainable = false;
    this.initial = this.head.getWeights().map(w => w.clone());
  }

  /** Encoder features for every frame; the encoder is frozen so these never change. */
  async encode(replay: ReplayFile, onProgress?: (done: number, total: number) => void): Promise<Frame[]> {
    const frames: Frame[] = [];
    const batch = 8;
    for (let start = 0; start < replay.manifest.entries.length; start += batch) {
      const slice = replay.manifest.entries.slice(start, start + batch);
      const bitmaps = await Promise.all(replay.images.slice(start, start + batch).map(image => createImageBitmap(image)));
      const features = tf.tidy(() => {
        const images = tf.stack(bitmaps.map(bitmap => tf.browser.fromPixels(bitmap))).toFloat().div(255);
        return this.encoder.predict(images) as tf.Tensor2D;
      });
      const rows = await features.array();
      features.dispose(); bitmaps.forEach(b => b.close());
      slice.forEach((entry, i) => frames.push({ entry, features: Float32Array.from(rows[i]) }));
      onProgress?.(Math.min(start + batch, replay.manifest.entries.length), replay.manifest.entries.length);
      await tf.nextFrame();
    }
    return frames;
  }

  private resetHead(): void { this.head.setWeights(this.initial.map(w => w.clone())); }
  private variables(): tf.Variable[] { return this.head.trainableWeights.map(w => w.read() as tf.Variable); }
  private inputs(frames: Frame[]): [tf.Tensor2D, tf.Tensor2D, tf.Tensor2D] {
    return [tf.tensor2d(frames.map(f => Array.from(f.features))), tf.tensor2d(frames.map(f => f.entry.headVector), [frames.length, 3]), tf.tensor2d(frames.map(f => f.entry.faceOrigin3D), [frames.length, 3])];
  }
  private predict(frames: Frame[]): Point[] {
    return tf.tidy(() => {
      const [f, h, o] = this.inputs(frames);
      const out = (this.head.predict([f, h, o]) as tf.Tensor2D).arraySync();
      return out.map(([x, y]) => ({ x, y }));
    });
  }
  private toPx(p: Point): Point { return { x: (p.x + .5) * this.viewport.width, y: (p.y + .5) * this.viewport.height }; }
  private labelPx(entry: ReplayEntry): Point { return this.toPx({ x: entry.label[0], y: entry.label[1] }); }

  /** Pairs for a screen-space correction, in isotropic units: one per dot (median) or one per sample. */
  private pairs(frames: Frame[], predictions: Point[], perSample: boolean): CorrectionPair[] {
    const v = this.viewport;
    if (perSample) return frames.map((f, i) => ({ estimate: toUnits(this.toPx(predictions[i]), v), target: toUnits(this.labelPx(f.entry), v) }));
    const groups = new Map<string, { estimates: Point[]; target: Point }>();
    frames.forEach((f, i) => { const key = f.entry.label.join(','); const g = groups.get(key) ?? { estimates: [], target: this.labelPx(f.entry) }; g.estimates.push(this.toPx(predictions[i])); groups.set(key, g); });
    const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return [...groups.values()].map(g => ({ estimate: toUnits({ x: median(g.estimates.map(p => p.x)), y: median(g.estimates.map(p => p.y)) }, v), target: toUnits(g.target, v) }));
  }

  /** Fits one experiment on `train` and returns a function from frames to corrected screen points. */
  private fit(experiment: Experiment, train: Frame[]): (frames: Frame[]) => Point[] {
    this.resetHead();
    const v = this.viewport;
    let affine: number[][] | null = null;
    if (experiment.affineFirst) {
      const pairs = this.pairs(train, this.predict(train), true);
      const fitted = fitAffine(pairs);
      affine = fitted ? affineMatrix(fitted) : null;
    }
    if (experiment.steps > 0) {
      const optimizer = tf.train.adam(experiment.lr, .85, .9, 1e-8);
      const variables = this.variables();
      const [f, h, o] = this.inputs(train);
      const labels = tf.tensor2d(train.map(t => t.entry.label), [train.length, 2]);
      const A = affine ? tf.tensor2d(affine, [2, 3]) : null;
      for (let step = 0; step < experiment.steps; step++) {
        optimizer.minimize(() => tf.tidy(() => {
          let prediction = this.head.predict([f, h, o]) as tf.Tensor2D;
          if (A) prediction = applyAffine(A, prediction);
          let loss = tf.losses.meanSquaredError(labels, prediction).asScalar();
          if (experiment.l2 > 0) loss = loss.add(tf.addN(variables.map((w, i) => w.sub(this.initial[i]).square().sum())).mul(experiment.l2));
          return loss;
        }), false, variables);
      }
      tf.dispose([f, h, o, labels]); A?.dispose(); optimizer.dispose();
    }
    // Screen-space correction after the head, fitted on the training frames as the app would.
    const predictions = this.predict(train).map(p => (affine ? applyAffinePoint(affine, p) : p));
    const correction: Correction | null = experiment.correction === 'none' ? null : fitCorrection(experiment.correction, this.pairs(train, predictions, experiment.perSample ?? false)) ?? fitRansacAffine(this.pairs(train, predictions, false));
    const weights = this.head.getWeights().map(w => w.clone());
    return (frames: Frame[]) => {
      this.head.setWeights(weights.map(w => w.clone()));
      return this.predict(frames).map(p => {
        const q = affine ? applyAffinePoint(affine, p) : p;
        const px = this.toPx(q);
        return correction ? fromUnits(correction(toUnits(px, v)), v) : px;
      });
    };
  }

  private errors(frames: Frame[], points: Point[]): number[] {
    return frames.map((f, i) => { const t = this.labelPx(f.entry); return Math.hypot(points[i].x - t.x, points[i].y - t.y); }).sort((a, b) => a - b);
  }

  async run(experiment: Experiment, frames: Frame[]): Promise<Score> {
    const calibration = frames.filter(f => f.entry.kind === 'calibration'), check = frames.filter(f => f.entry.kind === 'check');
    const median = (e: number[]) => (e.length ? e[Math.floor(e.length / 2)] : NaN), p90 = (e: number[]) => (e.length ? e[Math.ceil(.9 * e.length) - 1] : NaN);
    const full = this.fit(experiment, calibration);
    const fitMedianPx = median(this.errors(calibration, full(calibration)));
    let checkMedianPx: number | null = null, checkP90Px: number | null = null, checkCell: number | null = null, checkOffsets: Score['checkOffsets'] = [];
    if (check.length) {
      const points = full(check), e = this.errors(check, points);
      checkMedianPx = median(e); checkP90Px = p90(e);
      const cell = (p: Point) => `${Math.min(3, Math.max(0, Math.floor(p.x / this.viewport.width * 4)))}:${Math.min(1, Math.max(0, Math.floor(p.y / this.viewport.height * 2)))}`;
      checkCell = check.filter((f, i) => cell(points[i]) === cell(this.labelPx(f.entry))).length / check.length;
      const groups = new Map<string, { x: number; y: number; dx: number[]; dy: number[] }>();
      check.forEach((f, i) => { const t = this.labelPx(f.entry), key = f.entry.label.join(','); const g = groups.get(key) ?? { x: t.x, y: t.y, dx: [], dy: [] }; g.dx.push(points[i].x - t.x); g.dy.push(points[i].y - t.y); groups.set(key, g); });
      const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
      checkOffsets = [...groups.values()].map(g => ({ x: g.x, y: g.y, dx: med(g.dx), dy: med(g.dy) }));
    }
    // Leave-one-dot-out on the calibration set: honest when the check set is small or missing.
    const dots = [...new Set(calibration.map(f => f.entry.label.join(',')))];
    const lodo: number[] = [];
    if (dots.length >= 4) {
      for (const dot of dots) {
        const held = calibration.filter(f => f.entry.label.join(',') === dot), rest = calibration.filter(f => f.entry.label.join(',') !== dot);
        lodo.push(...this.errors(held, this.fit(experiment, rest)(held)));
        await tf.nextFrame();
      }
      lodo.sort((a, b) => a - b);
    }
    this.resetHead();
    return { name: experiment.name, fitMedianPx, lodoMedianPx: lodo.length ? median(lodo) : null, lodoP90Px: lodo.length ? p90(lodo) : null, checkMedianPx, checkP90Px, checkCell, checkOffsets };
  }
}

function affineMatrix(fit: Correction): number[][] {
  // Recover the 2×3 matrix in normalized units from the fitted function.
  const o = fit({ x: 0, y: 0 }), ex = fit({ x: 1, y: 0 }), ey = fit({ x: 0, y: 1 });
  return [[ex.x - o.x, ey.x - o.x, o.x], [ex.y - o.y, ey.y - o.y, o.y]];
}
function applyAffine(A: tf.Tensor2D, V: tf.Tensor2D): tf.Tensor2D {
  const ones = tf.ones([V.shape[0], 1]);
  return tf.concat([V, ones], 1).matMul(A.transpose()) as tf.Tensor2D;
}
function applyAffinePoint(A: number[][], p: Point): Point {
  return { x: A[0][0] * p.x + A[0][1] * p.y + A[0][2], y: A[1][0] * p.x + A[1][1] * p.y + A[1][2] };
}
