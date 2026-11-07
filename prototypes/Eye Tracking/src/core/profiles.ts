import { MAX_SAVED_BYTES, SAVED_CALIBRATION_KEY, SavedCalibrationStore, readSavedCalibration, type CalibrationGeometry, type LearnedCalibration, type SavedCalibration } from './saved-calibration';

/**
 * Named user profiles, so several people can share one device and each keep their own saved
 * calibration (gaze head, affine, geometric estimator and blend weight). A person's live session
 * state (learned corrections, blink thresholds) is never stored; only the same bounded calibration
 * record as before, one per profile.
 *
 * Layout: the active profile's record stays at the single saved-calibration key, exactly as before,
 * so every existing guarantee (bounded size, validated schema, cross-tab change detection, lease-
 * revoked saves) is unchanged. A directory under a second key names the profiles and holds the
 * records of the profiles that are not active. With one unnamed profile nothing extra is written.
 */
export const PROFILES_KEY = 'still.local-profiles.v1';
export const MAX_PROFILES = 6;
export const MAX_PROFILE_NAME = 40;
export const DEFAULT_PROFILE = { id: 'default', name: 'Default' } as const;
export type Profile = { id: string; name: string; createdAt: number };
type Directory = { schema: 1; active: string; profiles: Profile[]; saved: Record<string, SavedCalibration> };

const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_PROFILE_NAME) : '');
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);

export function readDirectory(v: unknown): Directory {
  const o = v as Partial<Directory> | null;
  if (!o || typeof o !== 'object' || o.schema !== 1 || !validId(o.active) || !Array.isArray(o.profiles) || o.profiles.length > MAX_PROFILES || !o.saved || typeof o.saved !== 'object' || Array.isArray(o.saved)) throw new Error('Saved profiles are invalid');
  const profiles: Profile[] = o.profiles.map(p => {
    if (!p || typeof p !== 'object' || !validId(p.id) || !cleanName(p.name) || typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) throw new Error('Saved profiles are invalid');
    return { id: p.id, name: cleanName(p.name), createdAt: p.createdAt };
  });
  if (new Set(profiles.map(p => p.id)).size !== profiles.length || !profiles.some(p => p.id === o.active)) throw new Error('Saved profiles are invalid');
  const saved: Record<string, SavedCalibration> = {};
  for (const [id, record] of Object.entries(o.saved)) {
    if (!validId(id) || !profiles.some(p => p.id === id) || id === o.active) throw new Error('Saved profiles are invalid');
    saved[id] = readSavedCalibration(record);
  }
  return { schema: 1, active: o.active, profiles, saved };
}

/**
 * The saved-calibration store, per named profile. Everything about the active profile's record
 * (load, save, delete, leases, cross-tab checks) is the single-record store's behaviour.
 */
export class ProfileStore {
  readonly calibration: SavedCalibrationStore;
  private directory: Directory | null = null;
  constructor(private readonly storage = () => window.localStorage) { this.calibration = new SavedCalibrationStore(storage); }

  get lease() { return this.calibration.lease; }
  invalidate() { this.calibration.invalidate(); }
  externalChange() { this.calibration.externalChange(); this.directory = null; }
  load(): SavedCalibration | null { return this.calibration.load(); }
  isCurrent(saved: SavedCalibration): boolean { return this.calibration.isCurrent(saved); }
  save(learned: LearnedCalibration, geometry: CalibrationGeometry, lease: number): SavedCalibration | null { return this.calibration.save(learned, geometry, lease); }
  delete(): void { this.calibration.delete(); }

  private read(): Directory {
    if (this.directory) return this.directory;
    const raw = this.storage().getItem(PROFILES_KEY);
    if (raw && raw.length <= MAX_PROFILES * MAX_SAVED_BYTES) {
      try { this.directory = readDirectory(JSON.parse(raw)); return this.directory; } catch { /* unreadable directory: start from the implicit default profile */ }
    }
    this.directory = { schema: 1, active: DEFAULT_PROFILE.id, profiles: [{ ...DEFAULT_PROFILE, createdAt: 0 }], saved: {} };
    return this.directory;
  }
  private write(directory: Directory): void {
    this.directory = directory;
    const implicit = directory.profiles.length === 1 && directory.profiles[0].id === DEFAULT_PROFILE.id && directory.profiles[0].name === DEFAULT_PROFILE.name && !Object.keys(directory.saved).length;
    if (implicit) { this.storage().removeItem(PROFILES_KEY); return; }
    const raw = JSON.stringify(directory);
    if (raw.length > MAX_PROFILES * MAX_SAVED_BYTES) throw new Error('Saved profiles exceed the local size limit.');
    this.storage().setItem(PROFILES_KEY, raw);
  }

  profiles(): Profile[] { return this.read().profiles.map(p => ({ ...p })); }
  active(): Profile { const d = this.read(); return { ...d.profiles.find(p => p.id === d.active)! }; }
  /** Whether a profile other than the active one has a saved calibration. */
  hasSaved(id: string): boolean { const d = this.read(); return id === d.active ? this.load() !== null : id in d.saved; }

  create(name: unknown, now = Date.now()): Profile {
    const d = this.read(), clean = cleanName(name);
    if (!clean) throw new Error('Give the profile a name.');
    if (d.profiles.length >= MAX_PROFILES) throw new Error(`At most ${MAX_PROFILES} profiles can be kept on this browser.`);
    if (d.profiles.some(p => p.name.toLowerCase() === clean.toLowerCase())) throw new Error('A profile with that name already exists.');
    let id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'profile';
    while (d.profiles.some(p => p.id === id)) id = `${id.slice(0, 20)}-${Math.floor(Math.random() * 1e3)}`;
    const profile: Profile = { id, name: clean, createdAt: now };
    this.write({ ...d, profiles: [...d.profiles, profile] });
    return profile;
  }
  rename(id: string, name: unknown): void {
    const d = this.read(), clean = cleanName(name);
    if (!clean || !d.profiles.some(p => p.id === id)) throw new Error('Give the profile a name.');
    if (d.profiles.some(p => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) throw new Error('A profile with that name already exists.');
    this.write({ ...d, profiles: d.profiles.map(p => (p.id === id ? { ...p, name: clean } : p)) });
  }
  /**
   * Makes `id` the active profile: the current record moves into the directory and the chosen
   * profile's record (if any) becomes the single saved calibration. Returns that record.
   */
  select(id: string): SavedCalibration | null {
    const d = this.read();
    if (!d.profiles.some(p => p.id === id)) throw new Error('Unknown profile');
    if (id === d.active) return this.load();
    const current = this.safeLoad();
    const saved = { ...d.saved };
    if (current) saved[d.active] = current; else delete saved[d.active];
    const next = saved[id] ?? null;
    delete saved[id];
    this.write({ ...d, active: id, saved });
    this.calibration.invalidate();
    if (next) this.storage().setItem(SAVED_CALIBRATION_KEY, JSON.stringify(next)); else this.storage().removeItem(SAVED_CALIBRATION_KEY);
    this.calibration.externalChange();
    return this.load();
  }
  /** Removes a profile and its saved calibration; removing the active one switches to the first remaining (or the default). */
  remove(id: string): Profile {
    const d = this.read();
    if (!d.profiles.some(p => p.id === id)) throw new Error('Unknown profile');
    const remaining = d.profiles.filter(p => p.id !== id);
    const saved = { ...d.saved }; delete saved[id];
    if (id !== d.active) { this.write({ ...d, profiles: remaining, saved }); return this.active(); }
    const nextActive = remaining[0] ?? { ...DEFAULT_PROFILE, createdAt: 0 };
    const record = saved[nextActive.id] ?? null; delete saved[nextActive.id];
    this.write({ schema: 1, active: nextActive.id, profiles: remaining.length ? remaining : [nextActive], saved });
    this.calibration.delete();
    if (record) { this.storage().setItem(SAVED_CALIBRATION_KEY, JSON.stringify(record)); this.calibration.externalChange(); }
    return this.active();
  }
  private safeLoad(): SavedCalibration | null { try { return this.load(); } catch { return null; } }
}
