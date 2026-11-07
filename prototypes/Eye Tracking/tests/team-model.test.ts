import { describe, expect, it, vi } from 'vitest';
import { readTeamModel, teamHelps, TEAM_MODEL_FORMAT, TEAM_MODEL_PATH } from '../src/core/team-model';
import { ESTIMATOR_SHAPES, MODEL_VERSION } from '../src/core/saved-calibration';
import { isLocalModelGet } from '../src/core/network';
import { CalibrationEngine, type Observation, type TrackerCore } from '../src/core/worker-engine';

const weights = () => ESTIMATOR_SHAPES.map(shape => Array<number>(shape.reduce((a, b) => a * b, 1)).fill(.01));
const person = (label: string, pretrainedPx: number, teamPx: number) => ({ label, frames: 300, pretrainedPx, teamPx });
const file = (perPerson = [person('Person 1', 100, 80), person('Person 2', 90, 85)]) => ({
  format: TEAM_MODEL_FORMAT, base: MODEL_VERSION, createdAt: 1, people: perPerson.length, frames: 600, config: { steps: 300, lr: 1e-3, l2: 1e-2 },
  evaluation: { perPerson, meanPretrainedPx: 95, meanTeamPx: 82.5, improves: true }, weights: weights(),
});

describe('team model file', () => {
  it('accepts a valid file and recomputes the verdict instead of trusting it', () => {
    expect(readTeamModel(file()).evaluation.improves).toBe(true);
    const worse = file([person('Person 1', 100, 70), person('Person 2', 90, 110)]);
    expect(readTeamModel(worse).evaluation.improves).toBe(false);
  });
  it('rejects other formats, base models, shapes and broken numbers', () => {
    expect(() => readTeamModel({ ...file(), format: 'x' })).toThrow('Not a team model');
    expect(() => readTeamModel({ ...file(), base: 'other' })).toThrow('different base model');
    expect(() => readTeamModel({ ...file(), weights: weights().slice(1) })).toThrow('weights');
    expect(() => readTeamModel({ ...file(), weights: [[NaN], ...weights().slice(1)] })).toThrow('weights');
    expect(() => readTeamModel({ ...file(), people: 1 })).toThrow('metadata');
  });
  it('helps only on a 5% average gain with nobody more than 10% worse', () => {
    expect(teamHelps([person('a', 100, 90), person('b', 100, 96)])).toBe(true);
    expect(teamHelps([person('a', 100, 98), person('b', 100, 97)])).toBe(false);
    expect(teamHelps([person('a', 100, 60), person('b', 100, 112)])).toBe(false);
    expect(teamHelps([person('a', 100, 50)])).toBe(false);
  });
  it('is the one extra local file the network guard allows', () => {
    const origin = 'http://localhost:4318';
    expect(isLocalModelGet(TEAM_MODEL_PATH, 'GET', origin)).toBe(true);
    expect(isLocalModelGet(TEAM_MODEL_PATH, 'POST', origin)).toBe(false);
    expect(isLocalModelGet(`https://example.com${TEAM_MODEL_PATH}`, 'GET', origin)).toBe(false);
    expect(isLocalModelGet('/team/other.json', 'GET', origin)).toBe(false);
  });
});

describe('starting estimator in the calibration engine', () => {
  const observation = (): Observation => ({ eyePatch: { width: 512, height: 128, data: new Uint8ClampedArray(512 * 128 * 4), colorSpace: 'srgb' }, headVector: [0, 0, 1], faceOrigin3D: [0, 0, 60], gazeState: 'open', eyeState: 'open', rawNormPog: [0, 0], normPog: [0, 0], facialLandmarks: Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 })) });
  it('sets validated weights before calibration only', async () => {
    const sample = observation(), setBase = vi.fn();
    const core: TrackerCore = { step: vi.fn(async () => sample), adapt: vi.fn(async () => {}), dispose: vi.fn(), setBaseEstimator: setBase };
    const engine = new CalibrationEngine(core, () => 1000);
    expect(() => engine.setBaseEstimator(weights().slice(1))).toThrow();
    expect(engine.setBaseEstimator(weights())).toBe(true);
    expect(setBase).toHaveBeenCalledOnce();
    await engine.step(sample.eyePatch, 1, 1000); engine.collect(1, 0, 0);
    expect(() => engine.setBaseEstimator(weights())).toThrow('before calibrating');
  });
});
