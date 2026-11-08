/**
 * Letter groups and a stand-in decoder.
 *
 * Clarte types with four letter groups (an ambiguous keyboard). A sequence of groups is decoded
 * into the most likely word by a language model that a teammate is building. Until it lands, this
 * module decodes against a small built-in vocabulary so the UIs behave realistically.
 *
 * Replace `decode` with the real model behind the same signature. Keep the group definitions:
 * the UIs, the composer and the docs all name them G1..G4.
 */
import { VOCABULARY } from './vocabulary.ts';

export const GROUPS = [
  { id: 'G1', letters: 'abcdef', label: 'A–F' },
  { id: 'G2', letters: 'ghijklmn', label: 'G–N' },
  { id: 'G3', letters: 'opqrs', label: 'O–S' },
  { id: 'G4', letters: 'tuvwxyz', label: 'T–Z' },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];
export const GROUP_IDS: readonly GroupId[] = GROUPS.map((g) => g.id);

const groupByLetter = new Map<string, GroupId>();
for (const group of GROUPS) for (const letter of group.letters) groupByLetter.set(letter, group.id);

export function groupOf(letter: string): GroupId | null {
  return groupByLetter.get(letter.toLowerCase()) ?? null;
}

export function groupLabel(id: GroupId): string {
  return GROUPS.find((g) => g.id === id)!.label;
}

/**
 * The letters of a group as the tile shows them: "A B C D E F". Tiles print every letter so
 * nobody has to work out which range a letter falls in; the range label is for prose and
 * accessible names.
 */
export function groupLetters(id: GroupId, separator = ' '): string {
  return GROUPS.find((g) => g.id === id)!.letters.toUpperCase().split('').join(separator);
}

/** The group sequence a word types as, e.g. "hello" → ["G2","G1","G2","G2","G3"]. Non-letters are skipped. */
export function signatureOf(word: string): GroupId[] {
  const out: GroupId[] = [];
  for (const ch of word.toLowerCase()) { const g = groupOf(ch); if (g) out.push(g); }
  return out;
}

export type Candidate = {
  word: string;
  /** True when the word's signature equals the typed sequence; false for a longer completion. */
  complete: boolean;
  /** Higher is better. Only comparable within one decode call. */
  score: number;
};

export type DecodeOptions = {
  /** Maximum candidates to return. */
  limit?: number;
  /** Recent conversation words (yours and the partner's); matching words rank higher. */
  context?: readonly string[];
};

type Entry = { word: string; key: string; rank: number };
const entries: Entry[] = VOCABULARY.map((word, rank) => ({ word, key: signatureOf(word).join(''), rank }));

function toKey(groups: readonly GroupId[]): string { return groups.join(''); }

/**
 * Candidates for a typed group sequence: exact-length matches first, then completions, each by
 * frequency, with a boost for words that already appeared in the conversation.
 */
export function decode(groups: readonly GroupId[], options: DecodeOptions = {}): Candidate[] {
  const limit = options.limit ?? 5;
  if (groups.length === 0) return [];
  const key = toKey(groups);
  const context = new Set((options.context ?? []).map((w) => w.toLowerCase()));
  const scored: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.key.startsWith(key)) continue;
    const complete = entry.key.length === key.length;
    const extra = entry.key.length - key.length;
    let score = 100000 - entry.rank;
    if (complete) score += 50000;
    else score -= extra * 400;
    if (context.has(entry.word)) score += 20000;
    scored.push({ word: entry.word, complete, score });
  }
  scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  return scored.slice(0, limit);
}

/** Words the vocabulary knows. Exposed so a UI can show coverage or seed demos. */
export function vocabularySize(): number { return entries.length; }
