/**
 * The letter groups. Clarté types with four letter groups (an ambiguous keyboard); the prediction
 * engine (`src/prediction`) decodes a sequence of groups into words. The UIs, the composer, the
 * engine's group code and the docs all name them G1..G4.
 */

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
