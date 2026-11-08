/**
 * Saving the person's sound profile on this browser, and loading the shipped bank of other
 * people's sounds (`public/listen/bank.json`, built by `scripts/build-listen-bank.ts` from CNVVE,
 * CC BY 4.0). Templates are stored as 16-bit values, 0.01 apart, base64 encoded.
 */
import type { Profile, Template } from './matcher.ts';

const KEY = 'clarte.listen.profile';
const SCALE = 100;

type StoredTemplate = { n: number; d: string; s: Template['stats']; k?: number };

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeTemplate(t: Template): StoredTemplate {
  const dims = t.seq[0]?.length ?? 0;
  const values = new Int16Array(t.seq.length * dims);
  t.seq.forEach((v, i) => v.forEach((x, k) => { values[i * dims + k] = Math.max(-32768, Math.min(32767, Math.round(x * SCALE))); }));
  return { n: t.seq.length, d: toBase64(new Uint8Array(values.buffer)), s: t.stats, ...(t.take !== undefined ? { k: t.take } : {}) };
}

export function decodeTemplate(t: StoredTemplate): Template {
  const bytes = fromBase64(t.d);
  const values = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const dims = t.n ? values.length / t.n : 0;
  const seq = Array.from({ length: t.n }, (_, i) => Float32Array.from(values.subarray(i * dims, (i + 1) * dims), (x) => x / SCALE));
  return { seq, stats: t.s, take: t.k };
}

type StoredProfile = Omit<Profile, 'positives' | 'negatives'> & { positives: StoredTemplate[]; negatives: StoredTemplate[]; bank: number };

const listeners = new Set<() => void>();
/** Called whenever the saved profile changes (taught again, or forgotten). */
export function onProfileChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
const changed = () => { for (const f of listeners) f(); };

/** This session's profile, so it works even where storage is blocked or full. */
let current: Profile | null = null;

/**
 * Save the profile. The bank is not stored with it (it ships with the app): `bankSize` is how many
 * of the profile's negatives, at the end, came from the bank.
 */
export function saveProfile(profile: Profile, bankSize: number): void {
  current = profile;
  const own = profile.negatives.slice(0, profile.negatives.length - bankSize);
  const stored: StoredProfile = { ...profile, positives: profile.positives.map(encodeTemplate), negatives: own.map(encodeTemplate), bank: bankSize };
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* storage full or blocked: this session keeps it */ }
  changed();
}

export function loadProfile(bank: Template[]): Profile | null {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredProfile;
    if (stored.version !== 1) return null;
    const { bank: _bank, ...rest } = stored;
    current = { ...rest, positives: stored.positives.map(decodeTemplate), negatives: [...stored.negatives.map(decodeTemplate), ...bank] };
    return current;
  } catch {
    return null;
  }
}

export function hasProfile(): boolean {
  if (current) return true;
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}

export function forgetProfile(): void {
  current = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  changed();
}

let bankPromise: Promise<Template[]> | null = null;

/** The shipped bank of other people's sounds; empty when it cannot be loaded. */
export function loadBank(): Promise<Template[]> {
  bankPromise ??= fetch(`${import.meta.env.BASE_URL}listen/bank.json`)
    .then((r) => (r.ok ? r.json() : { templates: [] }))
    .then((b: { templates: StoredTemplate[] }) => b.templates.map(decodeTemplate))
    .catch(() => []);
  return bankPromise;
}
