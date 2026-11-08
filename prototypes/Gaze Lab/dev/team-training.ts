import * as tf from '@tensorflow/tfjs';
import { fitAffine, fromUnits, toUnits, type Correction } from '../src/core/calibration-models';
import type { ReplayFile } from '../src/core/replay-file';
import type { Point, Viewport } from '../src/core/tracking';
import { MODEL_VERSION } from '../src/core/saved-calibration';
import { TEAM_MODEL_FORMAT, readTeamModel, teamHelps, type TeamEvaluation, type TeamModel } from '../src/core/team-model';

/**
 * Trains one shared starting estimator from several people's replay recordings. Development only.
 *
 * Only the small gaze head (the same six tensors calibration adapts) is trained; the image encoder
 * stays frozen. Every setting is judged leave-one-person-out: train on everyone else, then score the
 * left-out person exactly as the app would use the model — their own calibration fits an affine
 * correction on top, and the error is measured on their free-flow check frames.
 */
export type TeamFrame = { kind: 'calibration' | 'check'; label: [number, number]; head: number[]; origin: number[]; features: Float32Array };
export type TeamSession = { person: string; file: string; viewport: Viewport; frames: TeamFrame[] };
export type TrainConfig = { steps: number; lr: number; l2: number };
export const TEAM_CONFIGS: TrainConfig[] = [
  { steps: 100, lr: 1e-3, l2: 1e-2 },
  { steps: 300, lr: 1e-3, l2: 1e-2 },
  { steps: 300, lr: 1e-3, l2: 1e-3 },
  { steps: 600, lr: 5e-4, l2: 3e-3 },
];
export type ConfigResult = { config: TrainConfig; perPerson: TeamEvaluation['perPerson']; meanTeamPx: number };
export type TeamRun = { baseline: Map<string, number>; results: ConfigResult[]; best: ConfigResult; model: TeamModel };
type Status = (text: string) => void;

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };

export class TeamTrainer {
  private model!: tf.LayersModel;
  private encoder!: tf.LayersModel;
  private head!: tf.LayersModel;
  private initial: tf.Tensor[] = [];

  async load(url = '/vendor/webeyetrack/web/model.json'): Promise<void> {
    this.model = await tf.loadLayersModel(url);
    this.encoder = this.model.getLayer('cnn_encoder') as unknown as tf.LayersModel;
    this.head = this.model.getLayer('gaze_mlp') as unknown as tf.LayersModel;
    // Mirrors the app: the encoder is frozen, so the model's trainable weights are exactly the six head tensors.
    this.encoder.trainable = false;
    this.initial = this.variables().map(v => v.clone());
  }

  /** Encoder features for one recording; the encoder is frozen, so these are computed once. */
  async encode(replay: ReplayFile, person: string, file: string, status?: Status): Promise<TeamSession> {
    const frames: TeamFrame[] = [], entries = replay.manifest.entries, batch = 8;
    for (let start = 0; start < entries.length; start += batch) {
      const bitmaps = await Promise.all(replay.images.slice(start, start + batch).map(image => createImageBitmap(image)));
      const features = tf.tidy(() => this.encoder.predict(tf.stack(bitmaps.map(b => tf.browser.fromPixels(b))).toFloat().div(255)) as tf.Tensor2D);
      const rows = await features.array();
      features.dispose(); bitmaps.forEach(b => b.close());
      entries.slice(start, start + batch).forEach((e, i) => frames.push({ kind: e.kind, label: [e.label[0], e.label[1]], head: e.headVector, origin: e.faceOrigin3D, features: Float32Array.from(rows[i]) }));
      status?.(`Encoding ${person} · ${file}: ${Math.min(start + batch, entries.length)}/${entries.length}`);
      await tf.nextFrame();
    }
    return { person, file, viewport: replay.manifest.viewport, frames };
  }

  private variables(): tf.Variable[] { return this.model.trainableWeights.map(w => w.read() as tf.Variable); }
  private resetHead(): void { tf.tidy(() => this.variables().forEach((v, i) => v.assign(this.initial[i]))); }

  private predict(frames: TeamFrame[]): Point[] {
    if (!frames.length) return [];
    return tf.tidy(() => {
      const out = (this.head.predict([tf.tensor2d(frames.map(f => Array.from(f.features))), tf.tensor2d(frames.map(f => f.head), [frames.length, 3]), tf.tensor2d(frames.map(f => f.origin), [frames.length, 3])]) as tf.Tensor2D).arraySync();
      return out.map(([x, y]) => ({ x, y }));
    });
  }

  /** Full-batch Adam on the pooled frames, with an L2 pull toward the pretrained head. */
  private async train(sessions: TeamSession[], config: TrainConfig): Promise<void> {
    this.resetHead();
    const frames = sessions.flatMap(s => s.frames);
    if (!frames.length || config.steps <= 0) return;
    const variables = this.variables();
    const features = tf.tensor2d(frames.map(f => Array.from(f.features))), heads = tf.tensor2d(frames.map(f => f.head), [frames.length, 3]);
    const origins = tf.tensor2d(frames.map(f => f.origin), [frames.length, 3]), labels = tf.tensor2d(frames.map(f => f.label), [frames.length, 2]);
    const optimizer = tf.train.adam(config.lr, .85, .9, 1e-8);
    try {
      for (let step = 0; step < config.steps; step++) {
        optimizer.minimize(() => tf.tidy(() => {
          const prediction = this.head.predict([features, heads, origins]) as tf.Tensor2D;
          const fit = tf.losses.meanSquaredError(labels, prediction).asScalar();
          return config.l2 > 0 ? fit.add(tf.addN(variables.map((v, i) => v.sub(this.initial[i]).square().sum())).mul(config.l2)) as tf.Scalar : fit;
        }), false, variables);
        if (step % 25 === 0) await tf.nextFrame();
      }
    } finally { tf.dispose([features, heads, origins, labels]); optimizer.dispose(); }
  }

  /**
   * Scores the current head on one recording as the app would: an affine correction fitted on that
   * recording's calibration frames, then pixel error on its check frames (or leave-one-dot-out on the
   * calibration frames when there is no check).
   */
  private sessionErrors(session: TeamSession): number[] {
    const v = session.viewport, px = (p: Point) => ({ x: (p.x + .5) * v.width, y: (p.y + .5) * v.height });
    const calibration = session.frames.filter(f => f.kind === 'calibration'), check = session.frames.filter(f => f.kind === 'check');
    const predictions = this.predict(calibration);
    const correctionFor = (keep: (i: number) => boolean): Correction => fitAffine(calibration.flatMap((f, i) => (keep(i) ? [{ estimate: toUnits(px(predictions[i]), v), target: toUnits(px({ x: f.label[0], y: f.label[1] }), v) }] : []))) ?? (p => p);
    const error = (f: TeamFrame, p: Point, correction: Correction) => { const q = fromUnits(correction(toUnits(px(p), v)), v), t = px({ x: f.label[0], y: f.label[1] }); return Math.hypot(q.x - t.x, q.y - t.y); };
    if (check.length) { const correction = correctionFor(() => true); return this.predict(check).map((p, i) => error(check[i], p, correction)); }
    const dots = [...new Set(calibration.map(f => f.label.join(',')))];
    return dots.flatMap(dot => { const correction = correctionFor(i => calibration[i].label.join(',') !== dot); return calibration.flatMap((f, i) => (f.label.join(',') === dot ? [error(f, predictions[i], correction)] : [])); });
  }
  private personError(sessions: TeamSession[]): number { return median(sessions.flatMap(s => this.sessionErrors(s))); }

  async run(sessions: TeamSession[], status: Status = () => {}): Promise<TeamRun> {
    const people = [...new Set(sessions.map(s => s.person))];
    if (people.length < 2) throw new Error('Load recordings from at least two different people');
    const of = (person: string) => sessions.filter(s => s.person === person), except = (person: string) => sessions.filter(s => s.person !== person);
    const frames = (person: string) => of(person).reduce((n, s) => n + s.frames.length, 0);
    this.resetHead();
    const baseline = new Map(people.map(person => [person, this.personError(of(person))]));
    const results: ConfigResult[] = [];
    for (const [c, config] of TEAM_CONFIGS.entries()) {
      const perPerson: TeamEvaluation['perPerson'] = [];
      for (const [p, person] of people.entries()) {
        status(`Setting ${c + 1}/${TEAM_CONFIGS.length}: training without ${person} (${p + 1}/${people.length})…`);
        await this.train(except(person), config);
        perPerson.push({ label: person, frames: frames(person), pretrainedPx: baseline.get(person)!, teamPx: this.personError(of(person)) });
      }
      results.push({ config, perPerson, meanTeamPx: perPerson.reduce((s, p) => s + p.teamPx, 0) / perPerson.length });
    }
    const best = results.reduce((a, b) => (b.meanTeamPx < a.meanTeamPx ? b : a));
    status('Training the final team model on everyone…');
    await this.train(sessions, best.config);
    const weights = this.variables().map(v => Array.from(v.dataSync()));
    this.resetHead();
    // People are stored as anonymous labels in the shipped file.
    const anonymous = best.perPerson.map((p, i) => ({ ...p, label: `Person ${i + 1}` }));
    const meanPretrainedPx = anonymous.reduce((s, p) => s + p.pretrainedPx, 0) / anonymous.length;
    const model = readTeamModel({
      format: TEAM_MODEL_FORMAT, base: MODEL_VERSION, createdAt: Date.now(), people: people.length, frames: sessions.reduce((n, s) => n + s.frames.length, 0),
      config: best.config, evaluation: { perPerson: anonymous, meanPretrainedPx, meanTeamPx: best.meanTeamPx, improves: teamHelps(anonymous) }, weights,
    });
    return { baseline, results, best, model };
  }
}
