/**
 * Audio helpers shared by the offline listener scripts (`listen-eval.ts`, `build-listen-bank.ts`),
 * so a bank sound is prepared the same way when it is shipped and when it is evaluated.
 */
import { readFileSync, readdirSync } from 'node:fs';

/** A WAV file (16-bit or 32-bit integer, or 32-bit float) as mono samples; only the first channel is kept. */
export function readWav(path: string): Float32Array {
  const b = readFileSync(path);
  let p = 12, fmt = 1, bits = 16, channels = 1;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(p + 8); channels = b.readUInt16LE(p + 10); bits = b.readUInt16LE(p + 22); if (fmt === 0xfffe) fmt = b.readUInt16LE(p + 32); }
    if (id === 'data') {
      const n = Math.floor(Math.min(size, b.length - p - 8) / (bits / 8) / channels), out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const o = p + 8 + i * channels * (bits / 8);
        out[i] = fmt === 3 ? b.readFloatLE(o) : bits === 16 ? b.readInt16LE(o) / 32768 : b.readInt32LE(o) / 2147483648;
      }
      return out;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** Level of the loud part of a clip (its top 30 % of 10 ms frames), in dB. */
export function activeDb(x: Float32Array): number {
  const e: number[] = [];
  for (let i = 0; i + 160 <= x.length; i += 160) { let s = 0; for (let j = 0; j < 160; j++) s += x[i + j] ** 2; e.push(s / 160); }
  e.sort((a, b) => b - a);
  const top = e.slice(0, Math.max(1, Math.round(e.length * 0.3)));
  return 10 * Math.log10(top.reduce((s, v) => s + v, 0) / top.length + 1e-12);
}

/** A bank sound as an enrolment take: the loud part at -26 dB, 0.5 s of near-silence each side. */
export function asTake(x: Float32Array): Float32Array {
  const gain = 10 ** ((-26 - activeDb(x)) / 20);
  const out = new Float32Array(x.length + 16000);
  let seed = 7;
  for (let i = 0; i < out.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = ((seed / 0x7fffffff) - 0.5) * 1e-3; }
  for (let i = 0; i < x.length; i++) out[8000 + i] += x[i] * gain;
  return out;
}

/**
 * Speech Commands speakers (Warden 2018) the shipped bank may use: an even first hex digit and
 * fewer than five takes of "yes". Everyone else is kept for evaluation (the people who teach their
 * "yes", and the neighbours), so `listen-eval.ts` can test the shipped bank without a leak.
 */
export const speechCommandsBankSide = (speaker: string, yesTakes: number) => parseInt(speaker[0], 16) % 2 === 0 && yesTakes < 5;

/** One recording of each word by each of the first `people` bank-side Speech Commands speakers. */
export function speechCommandsBankFiles(dir: string, people: number, words: string[]): string[] {
  const files = (word: string) => readdirSync(`${dir}/${word}`).filter((f) => f.endsWith('.wav')).sort();
  const yes = new Map<string, number>();
  for (const f of files('yes')) yes.set(f.split('_')[0], (yes.get(f.split('_')[0]) ?? 0) + 1);
  const byWord = new Map(words.map((w) => [w, files(w)]));
  const speakers = [...new Set(words.flatMap((w) => byWord.get(w)!.map((f) => f.split('_')[0])))].filter((s) => speechCommandsBankSide(s, yes.get(s) ?? 0)).sort().slice(0, people);
  return speakers.flatMap((s) => words.map((w) => byWord.get(w)!.find((f) => f.startsWith(`${s}_`))).map((f, i) => (f ? `${dir}/${words[i]}/${f}` : '')).filter(Boolean));
}

/**
 * Multilingual Spoken Words (Mazumder et al., NeurIPS 2021, CC BY 4.0) clips of one word in one
 * split, as `<dir>/<split>/<word>_common_voice_en_<id>.wav` with `<dir>/<split>.csv` naming each
 * clip's speaker. The shipped bank uses the dev split and the evaluation the test split, each
 * without the speakers the other split also has, so the two never share a person.
 */
export function mswcClips(dir: string, split: 'dev' | 'test', word: string): { file: string; speaker: string }[] {
  const rows = (s: string) => readFileSync(`${dir}/${s}.csv`, 'utf8').trim().split('\n').map((l) => l.split(','));
  const other = new Set(rows(split === 'dev' ? 'test' : 'dev').map((r) => r[3]));
  return rows(split).filter((r) => r[1] === word && !other.has(r[3]))
    .map((r) => ({ file: `${dir}/${split}/${word}_${r[0].split('/')[1].replace('.opus', '.wav')}`, speaker: r[3] }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** The first `n` MSWC dev-split clips of "yeah", then of "yes", for the shipped bank. */
export const mswcBankFiles = (dir: string, n: number) => [...mswcClips(dir, 'dev', 'yeah'), ...mswcClips(dir, 'dev', 'yes')].slice(0, n).map((c) => c.file);
