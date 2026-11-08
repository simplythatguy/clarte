/**
 * Spelling a word the dictionary does not have (owner, 2026-11-08: "polyphiloprogenitive" showed
 * "Private" and a row of dots). The typed groups already narrow each letter to five to eight; this
 * ranks the letters of one group given the letters chosen before it and the groups still to come,
 * with a letter 4-gram over the stand-in lexicon's spellings (one count per word, so rare words
 * shape it as much as common ones) and a short look-ahead through the next groups.
 */
import { GROUPS, type GroupId } from '../../shared/decoder.ts';
import LEXICON from './lexicon.json' with { type: 'json' };

const ORDER = 4;
const LOOKAHEAD = 2;
const START = '^';
const END = '$';
const LETTERS = Object.fromEntries(GROUPS.map((g) => [g.id, [...g.letters]])) as Record<GroupId, string[]>;

type Counts = Map<string, Map<string, number>>;
let model: Counts | null = null;

function counts(): Counts {
  if (model) return model;
  model = new Map();
  for (const [word] of LEXICON as [string, number][]) {
    if (!/^[a-z]+('[a-z]+)?$/.test(word)) continue;
    const s = START.repeat(ORDER - 1) + word + END;
    for (let i = ORDER - 1; i < s.length; i++) {
      for (let n = 0; n < ORDER; n++) {
        const ctx = s.slice(i - n, i);
        let next = model.get(ctx);
        if (!next) model.set(ctx, (next = new Map()));
        next.set(s[i], (next.get(s[i]) ?? 0) + 1);
      }
    }
  }
  return model;
}

/** P(next | history) with interpolated backoff from the longest context down to letter frequency. */
function prob(history: string, next: string): number {
  const m = counts();
  const padded = START.repeat(ORDER - 1) + history;
  let p = 1 / 28;
  for (let n = 0; n < ORDER; n++) {
    const ctx = padded.slice(padded.length - n);
    const row = m.get(ctx);
    if (!row) continue;
    let total = 0;
    for (const c of row.values()) total += c;
    const lambda = total / (total + 3 * row.size);
    p = lambda * ((row.get(next) ?? 0) / total) + (1 - lambda) * p;
  }
  return p;
}

/** The best probability of spelling the rest of `groups` after `history`, `depth` letters ahead. */
function ahead(history: string, groups: readonly GroupId[], depth: number): number {
  if (!groups.length) return prob(history, END);
  if (depth === 0) return 1;
  let best = 0;
  for (const c of LETTERS[groups[0]]) best = Math.max(best, prob(history, c) * ahead(history + c, groups.slice(1), depth - 1));
  return best;
}

/** How many groups `chosen` has used: an apostrophe has no group. */
export function groupsUsed(chosen: string): number {
  return chosen.replace(/'/g, '').length;
}

/**
 * The letters of the next group, best first. After a letter an apostrophe is a choice too (it takes
 * no group: don't, y'all, Kensky's), ranked where the letter model puts it, so a contraction or a
 * possessive the dictionary lacks can still be spelled.
 */
export function rankLetters(chosen: string, groups: readonly GroupId[]): string[] {
  const at = groupsUsed(chosen);
  const group = groups[at];
  if (!group) return [];
  const rest = groups.slice(at + 1);
  const scored = LETTERS[group].map((c) => ({ c, s: prob(chosen, c) * ahead(chosen + c, rest, LOOKAHEAD) }));
  if (chosen && !chosen.endsWith("'") && !chosen.includes("'")) {
    scored.push({ c: "'", s: prob(chosen, "'") * ahead(chosen + "'", groups.slice(at), LOOKAHEAD) });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}
