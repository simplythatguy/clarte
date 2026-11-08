import { ESTIMATOR_SHAPES, MODEL_VERSION } from './saved-calibration';

/**
 * A shared starting estimator trained offline on several people's replay recordings
 * (`/dev/team.html`). It only replaces the six gaze-head tensors; each person still calibrates.
 * The file is a static same-origin asset the team chooses to place; the app never writes it.
 */
export const TEAM_MODEL_PATH = '/team/team-estimator.json';
export const TEAM_MODEL_FORMAT = 'clarte-team-estimator-1';
export type TeamEvaluation = {
  /** Held-out median error (px) for each person: the pretrained head versus a model trained without them. */
  perPerson: { label: string; frames: number; pretrainedPx: number; teamPx: number }[];
  meanPretrainedPx: number; meanTeamPx: number;
  /** True when the team model helps people it was not trained on (see `teamHelps`). */
  improves: boolean;
};
export type TeamModel = {
  format: typeof TEAM_MODEL_FORMAT; base: string; createdAt: number; people: number; frames: number;
  config: { steps: number; lr: number; l2: number };
  evaluation: TeamEvaluation; weights: number[][];
};

/** Helps on average by at least 5%, and makes no single held-out person more than 10% worse. */
export function teamHelps(perPerson: TeamEvaluation['perPerson']): boolean {
  if (perPerson.length < 2) return false;
  const mean = (k: 'pretrainedPx' | 'teamPx') => perPerson.reduce((s, p) => s + p[k], 0) / perPerson.length;
  return mean('teamPx') <= mean('pretrainedPx') * .95 && perPerson.every(p => p.teamPx <= p.pretrainedPx * 1.1);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function readTeamModel(v: unknown): TeamModel {
  const o = v as Partial<TeamModel> | null;
  if (!o || typeof o !== 'object' || o.format !== TEAM_MODEL_FORMAT) throw new Error('Not a team model file');
  if (o.base !== MODEL_VERSION) throw new Error('Team model was trained for a different base model');
  if (!finite(o.createdAt) || !finite(o.people) || o.people < 2 || !finite(o.frames)) throw new Error('Team model metadata is invalid');
  const c = o.config;
  if (!c || !finite(c.steps) || !finite(c.lr) || !finite(c.l2)) throw new Error('Team model config is invalid');
  const w = o.weights;
  if (!Array.isArray(w) || w.length !== ESTIMATOR_SHAPES.length || !w.every((t, i) => Array.isArray(t) && t.length === ESTIMATOR_SHAPES[i].reduce((a, b) => a * b, 1) && t.every(finite))) throw new Error('Team model weights are invalid');
  const e = o.evaluation;
  if (!e || !Array.isArray(e.perPerson) || !e.perPerson.every(p => p && typeof p.label === 'string' && finite(p.frames) && finite(p.pretrainedPx) && finite(p.teamPx)) || !finite(e.meanPretrainedPx) || !finite(e.meanTeamPx)) throw new Error('Team model evaluation is invalid');
  // The stored verdict is recomputed, never trusted.
  return { format: TEAM_MODEL_FORMAT, base: o.base, createdAt: o.createdAt, people: o.people, frames: o.frames, config: { steps: c.steps, lr: c.lr, l2: c.l2 }, evaluation: { ...e, improves: teamHelps(e.perPerson) }, weights: w };
}

/** Loads the team model if one has been placed; a missing or invalid file is simply no team model. */
export async function loadTeamModel(): Promise<TeamModel | null> {
  try {
    const response = await fetch(TEAM_MODEL_PATH);
    if (!response.ok) return null;
    return readTeamModel(JSON.parse(await response.text()));
  } catch { return null; }
}
