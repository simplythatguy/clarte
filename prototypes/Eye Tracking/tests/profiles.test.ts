import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, MAX_PROFILES, PROFILES_KEY, ProfileStore, readDirectory } from '../src/core/profiles';
import { ESTIMATOR_SHAPES, SAVED_CALIBRATION_KEY } from '../src/core/saved-calibration';

const geometry = { viewport: { width: 1280, height: 800 }, pixelRatio: 2, camera: { deviceId: 'fixture', width: 640, height: 480, facingMode: 'user' } };
const learned = (value = .01) => ({ weights: ESTIMATOR_SHAPES.map(shape => Array<number>(shape.reduce((a, b) => a * b, 1)).fill(value)), affine: [1, 0, 0, 0, 1, 0], faceWidthCm: 15 });
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: () => null, length: 0 };
  return { values, store: new ProfileStore(() => storage as unknown as Storage) };
}

describe('named profiles', () => {
  it('starts with an implicit default profile and writes nothing extra for it', () => {
    const f = fixture();
    expect(f.store.active()).toMatchObject(DEFAULT_PROFILE); expect(f.store.profiles()).toHaveLength(1);
    expect(f.store.save(learned(), geometry, f.store.lease)).not.toBeNull();
    expect([...f.values.keys()]).toEqual([SAVED_CALIBRATION_KEY]);
    f.store.delete(); expect(f.values.size).toBe(0);
  });
  it('keeps one calibration per profile and swaps the active record when switching', () => {
    const f = fixture();
    f.store.save(learned(.01), geometry, f.store.lease);
    const omer = f.store.create('Omer', 5);
    expect(f.store.profiles().map(p => p.name)).toEqual(['Default', 'Omer']);
    expect(f.store.hasSaved(omer.id)).toBe(false);
    expect(f.store.select(omer.id)).toBeNull();
    expect(f.values.get(SAVED_CALIBRATION_KEY)).toBeUndefined();
    expect(f.store.hasSaved(DEFAULT_PROFILE.id)).toBe(true);
    f.store.save(learned(.02), geometry, f.store.lease);
    expect(f.store.select(DEFAULT_PROFILE.id)?.learned.weights[1][0]).toBe(.01);
    expect(f.store.select(omer.id)?.learned.weights[1][0]).toBe(.02);
    // Reloading from storage reproduces the same directory.
    const again = new ProfileStore(() => ({ getItem: (k: string) => f.values.get(k) ?? null, setItem: (k: string, v: string) => f.values.set(k, v), removeItem: (k: string) => f.values.delete(k) } as unknown as Storage));
    expect(again.active().id).toBe(omer.id); expect(again.load()?.learned.weights[1][0]).toBe(.02); expect(again.hasSaved(DEFAULT_PROFILE.id)).toBe(true);
    const raw = f.values.get(PROFILES_KEY) ?? '';
    expect(raw).not.toMatch(/eyePatch|landmark|gazeHistory|video/);
  });
  it('renames, limits, rejects duplicates and removes profiles, falling back to the default', () => {
    const f = fixture();
    const a = f.store.create('Ana', 1);
    expect(() => f.store.create(' ana ', 2)).toThrow(/already/);
    expect(() => f.store.create('', 2)).toThrow(/name/);
    f.store.rename(a.id, 'Anna'); expect(f.store.profiles()[1].name).toBe('Anna');
    for (let i = f.store.profiles().length; i < MAX_PROFILES; i++) f.store.create(`P${i}`, i);
    expect(() => f.store.create('one more', 9)).toThrow(/At most/);
    f.store.select(a.id); f.store.save(learned(.03), geometry, f.store.lease);
    expect(f.store.remove(a.id).id).toBe(DEFAULT_PROFILE.id);
    expect(f.store.load()).toBeNull(); expect(f.store.profiles().some(p => p.id === a.id)).toBe(false);
    for (const p of f.store.profiles()) if (p.id !== DEFAULT_PROFILE.id) f.store.remove(p.id);
    expect(f.values.has(PROFILES_KEY)).toBe(false);
    // Removing the last profile leaves the implicit default.
    expect(f.store.remove(DEFAULT_PROFILE.id)).toMatchObject(DEFAULT_PROFILE);
  });
  it('a selected profile with a calibration restores it under the single key and revokes stale leases', () => {
    const f = fixture();
    const lease = f.store.lease;
    const b = f.store.create('Bo', 1);
    f.store.save(learned(.04), geometry, f.store.lease);
    f.store.select(b.id);
    expect(f.store.save(learned(.05), geometry, lease)).toBeNull(); // the lease from before the switch is void
    f.store.select(DEFAULT_PROFILE.id);
    expect(JSON.parse(f.values.get(SAVED_CALIBRATION_KEY)!).learned.weights[1][0]).toBe(.04);
  });
  it('rejects malformed directories and an unreadable one falls back safely', () => {
    expect(() => readDirectory({ schema: 1, active: 'x', profiles: [], saved: {} })).toThrow();
    expect(() => readDirectory({ schema: 1, active: 'a', profiles: [{ id: 'a', name: 'A', createdAt: 1 }], saved: { a: {} } })).toThrow();
    expect(() => readDirectory({ schema: 1, active: 'a', profiles: [{ id: 'a', name: 'A', createdAt: 1 }, { id: 'a', name: 'B', createdAt: 1 }], saved: {} })).toThrow();
    const f = fixture(); f.values.set(PROFILES_KEY, '{broken');
    expect(f.store.active()).toMatchObject(DEFAULT_PROFILE);
  });
});
