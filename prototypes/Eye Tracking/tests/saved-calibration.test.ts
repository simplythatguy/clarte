import { describe, expect, it } from 'vitest';
import { SavedCalibrationStore, calibrationCompatibility, ESTIMATOR_SHAPES, MAX_SAVED_BYTES, MODEL_VERSION, readSavedCalibration, readLearnedCalibration, SAVED_CALIBRATION_KEY } from '../src/core/saved-calibration';
const geometry = { viewport: { width: 1280, height: 800 }, pixelRatio: 2, camera: { deviceId: 'fixture', width: 640, height: 480, facingMode: 'user' } };
const learned = () => ({ weights: ESTIMATOR_SHAPES.map(shape => Array<number>(shape.reduce((a,b) => a*b,1)).fill(.01)), affine: [1,0,0,0,1,0], faceWidthCm: 15 });
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: () => null, length: 0 };
  return { values, storage, store: new SavedCalibrationStore(() => storage) };
}
describe('minimum local learned calibration', () => {
  it('round trips only estimator weights, affine/normalization and bounded geometry', () => {
    const f = fixture(), model = learned();
    expect(f.store.save(model, geometry, f.store.lease)?.learned).toEqual(model);
    expect(f.store.load()?.model).toBe(MODEL_VERSION);
    const raw = f.values.get(SAVED_CALIBRATION_KEY) ?? '';
    expect(raw.length).toBeLessThan(MAX_SAVED_BYTES);
    expect(raw).not.toMatch(/eyePatch|landmark|gazeHistory|support|trainingFeatures|video/);
    expect(f.values.size).toBe(1);
  });
  it('revokes in-flight saves on delete/reset and cannot resurrect the deleted record', () => {
    const f = fixture(), oldLease = f.store.lease;
    f.store.save(learned(), geometry, oldLease); f.store.delete();
    expect(f.store.save(learned(), geometry, oldLease)).toBeNull(); expect(f.store.load()).toBeNull();
    const lease = f.store.lease; f.store.invalidate();
    expect(f.store.save(learned(), geometry, lease)).toBeNull(); expect(f.values.size).toBe(0);
    expect(f.store.save(learned(), geometry, f.store.lease)).not.toBeNull();
  });
  it('rejects schema/source drift, extra sensitive fields, malformed shapes, nonfinite and excessive values', () => {
    const f = fixture(), saved = f.store.save(learned(), geometry, f.store.lease);
    expect(() => readSavedCalibration({ ...saved, schema: 2 })).toThrow(/incompatible/);
    expect(() => readSavedCalibration({ ...saved, model: 'other-model' })).toThrow(/incompatible/);
    expect(() => readSavedCalibration({ ...saved, rawVideo: [] })).toThrow();
    expect(() => readLearnedCalibration({ ...learned(), eyePatch: [] })).toThrow();
    const bad = learned(); bad.weights[0].pop(); expect(() => readLearnedCalibration(bad)).toThrow();
    const infinite = learned(); infinite.weights[0][0] = Infinity; expect(() => readLearnedCalibration(infinite)).toThrow();
    expect(() => readLearnedCalibration({ ...learned(), affine: [1e30,0,0,0,1,0] })).toThrow();
    f.values.set(SAVED_CALIBRATION_KEY, 'x'.repeat(MAX_SAVED_BYTES + 1)); expect(() => f.store.load()).toThrow(/too large/);
    f.values.set(SAVED_CALIBRATION_KEY, '{bad'); expect(() => f.store.load()).toThrow();
  });
  it('surfaces unavailable storage, quota and deletion failures without accepting a stale save', () => {
    const f = fixture(), lease = f.store.lease;
    f.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => f.store.save(learned(), geometry, lease)).toThrow('Quota');
    f.storage.removeItem = () => { throw new Error('SecurityError'); };
    expect(() => f.store.delete()).toThrow('SecurityError');
    expect(f.store.save(learned(), geometry, lease)).toBeNull(); expect(f.store.load()).toBeNull();
    const unavailable = new SavedCalibrationStore(() => { throw new Error('Blocked'); });
    expect(() => unavailable.load()).toThrow('Blocked');
  });
  it('allows modest viewport changes and warns about posture, but rejects a changed camera or large layout', () => {
    expect(calibrationCompatibility(geometry, { ...geometry, viewport: { width: 1280, height: 750 } })).toMatchObject({ compatible: true, message: expect.stringContaining('lighting') });
    expect(calibrationCompatibility(geometry, { ...geometry, camera: { ...geometry.camera, deviceId: 'different' } }).compatible).toBe(false);
    expect(calibrationCompatibility(geometry, { ...geometry, viewport: { width: 390, height: 844 } }).compatible).toBe(false);
    expect(calibrationCompatibility(geometry, { ...geometry, camera: { ...geometry.camera, width: 1920, height: 1080 } }).compatible).toBe(false);
  });
});

it('cannot overwrite an unseen cross-tab delete/save, and accepts a new record after an external event', () => {
  const values = new Map<string,string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key,value);}, removeItem: (key:string) => {values.delete(key);}, clear:()=>values.clear(), key:()=>null, length:0 };
  const a = new SavedCalibrationStore(()=>storage), b = new SavedCalibrationStore(()=>storage);
  a.load(); const lease = a.lease; b.save(learned(), geometry, b.lease);
  expect(a.save(learned(),geometry,lease)).toBeNull();
  a.externalChange(); expect(a.load()).not.toBeNull(); const second=a.lease;
  b.delete(); expect(a.save(learned(),geometry,second)).toBeNull();
  a.delete(); b.externalChange(); b.load(); b.save(learned(),geometry,b.lease);
  a.externalChange(); expect(a.load()).not.toBeNull();
});
