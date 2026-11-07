/**
 * Style 3 · Stages: the stage machine and the tile table.
 *
 * Every stage is one screen. `tilesFor` says which action owns which backend quadrant on that
 * screen; the renderer, the keyboard map and the layout check all read this one table, so a
 * quadrant can never hold two actions by accident.
 */
import type { QuadrantId } from '../../shared/quadrants.ts';
import type { GroupId } from '../../shared/decoder.ts';
import { GROUPS, groupLetters } from '../../shared/decoder.ts';
import type { IconName } from './icons.tsx';
import { currentCandidate, type Composition } from '../../shared/composer.ts';

export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';
export type MenuFrom = 'compose' | 'speak' | 'spoken';
export type MenuPage = 'menu' | 'message' | 'selection' | 'display';

export type Stage =
  | { kind: 'calibrate'; step: CalibrationStep }
  | { kind: 'listen' }
  | { kind: 'compose' }
  | { kind: 'speak' }
  | { kind: 'speaking' }
  | { kind: 'spoken' }
  | { kind: 'menu'; page: MenuPage; from: MenuFrom }
  /** Letter-exact typing for names: pick a group, then a letter. `half` pages groups of 5+ letters. */
  | { kind: 'spell'; group: GroupId | null; half: 0 | 1 };

export type Settings = {
  letterMs: number;
  controlMs: number;
  textScale: number;
  theme: 'light' | 'dark';
  sound: boolean;
  mode: 'dwell' | 'confirm';
  wordColours: boolean;
  noise: boolean;
  repeat: 'leave' | 'redwell';
  /** Where the partner's words come from: Web Speech, or the scripted demo partner. */
  partner: 'microphone' | 'script';
};

export const DEFAULT_SETTINGS: Settings = {
  letterMs: 600,
  controlMs: 900,
  textScale: 1,
  theme: 'light',
  sound: true,
  mode: 'dwell',
  wordColours: false,
  noise: false,
  repeat: 'leave',
  partner: 'script',
};

export const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2];

export type TileKind = 'group' | 'control' | 'primary';

export type Tile = {
  id: string;
  /** First backend quadrant the tile owns. */
  at: QuadrantId;
  /** How many quadrants it spans to the right. */
  span: 1 | 2 | 4;
  kind: TileKind;
  label: string;
  /** Second line, used by settings to show their current value. */
  value?: string;
  group?: GroupId;
  disabled?: boolean;
  /** Spoken name when the visible label is not enough. */
  name?: string;
  /** The outline icon inside the dwell ring (controls). Groups draw the two-circle motif instead. */
  icon?: IconName;
};

export type ConversationState = 'listening' | 'paused' | 'composing' | 'speaking' | 'ready';

export type MenuItem = {
  id: string;
  label: string;
  icon?: IconName;
  value?: (s: Settings) => string;
  disabled?: boolean;
};

/** Dwell steps per class, shown as speeds rather than milliseconds (R-1 §3, R-6 §15). */
export const LETTER_STEPS = [
  { ms: 300, label: 'Fastest' }, { ms: 450, label: 'Fast' }, { ms: 600, label: 'Normal' },
  { ms: 900, label: 'Slow' }, { ms: 1300, label: 'Slower' }, { ms: 2000, label: 'Slowest' },
];
export const CONTROL_STEPS = [
  { ms: 300, label: 'Fastest' }, { ms: 600, label: 'Fast' }, { ms: 900, label: 'Normal' },
  { ms: 1300, label: 'Slow' }, { ms: 1600, label: 'Slower' }, { ms: 2000, label: 'Slowest' },
];
const speed = (steps: typeof LETTER_STEPS, ms: number) => steps.find((x) => x.ms === ms)?.label ?? `${ms} ms`;

export const PHRASES: Record<string, string> = {
  'phrase-yes': 'Yes, please.',
  'phrase-no': 'No, thank you.',
  'phrase-help': 'I need help.',
};

/**
 * Menu: a root page whose entries open category pages directly (no serial paging). Q2–Q3 rest
 * with the page title, Q4 is Back (to the root, or out of Menu from the root). One moment is the
 * root's first entry, in Q1, where it also sits on the Speak stage.
 */
export const MENU_SLOTS = ['Q1', 'Q5', 'Q6', 'Q7', 'Q8'] as const;

export const MENU_PAGES: Record<MenuPage, { title: string; items: (MenuItem | null)[] }> = {
  menu: {
    title: 'Menu',
    items: [
      { id: 'moment', label: 'One moment', icon: 'moment' },
      { id: 'recalibrate', label: 'Recalibrate', icon: 'target' },
      { id: 'page-message', label: 'Message', icon: 'text' },
      { id: 'page-selection', label: 'Selection', icon: 'eye' },
      { id: 'page-display', label: 'Display and sound', icon: 'sun' },
    ],
  },
  message: {
    title: 'Message',
    items: [
      { id: 'spell', label: 'Spell', icon: 'spell' },
      { id: 'clear', label: 'Clear message', icon: 'clear' },
      ...Object.entries(PHRASES).slice(0, 3).map(([id, label]) => ({ id, label, icon: 'quote' as const })),
    ],
  },
  selection: {
    title: 'Selection',
    items: [
      { id: 'letter-speed', label: 'Letters', icon: 'gaugeLetter', value: (s) => speed(LETTER_STEPS, s.letterMs) },
      { id: 'control-speed', label: 'Controls', icon: 'gauge', value: (s) => speed(CONTROL_STEPS, s.controlMs) },
      { id: 'mode', label: 'Select by', icon: 'eye', value: (s) => (s.mode === 'dwell' ? 'Looking' : 'Look + key') },
      { id: 'repeat', label: 'Letter repeat', icon: 'again', value: (s) => (s.repeat === 'leave' ? 'Look away' : 'Keep looking') },
      { id: 'noise', label: 'Gaze noise', icon: 'wave', value: (s) => (s.noise ? 'On' : 'Off') },
    ],
  },
  display: {
    title: 'Display and sound',
    items: [
      { id: 'text-size', label: 'Text size', icon: 'size', value: (s) => `${Math.round(s.textScale * 100)}%` },
      { id: 'theme', label: 'Theme', icon: 'sun', value: (s) => (s.theme === 'light' ? 'Light' : 'Dark') },
      { id: 'sound', label: 'Sound', icon: 'speak', value: (s) => (s.sound ? 'On' : 'Off') },
      { id: 'word-colours', label: 'Word colours', icon: 'drop', value: (s) => (s.wordColours ? 'On' : 'Off') },
      { id: 'partner', label: 'Partner', icon: 'mic', value: (s) => (s.partner === 'microphone' ? 'Microphone' : 'Script') },
    ],
  },
};
export const MENU_PAGE_IDS = Object.keys(MENU_PAGES) as MenuPage[];

export type ViewState = {
  stage: Stage;
  composition: Composition;
  context: readonly string[];
  settings: Settings;
  /** Letters spelled so far in the Spell stage. */
  spelled: string;
};

/** A group's letters in pages of at most four, one letter per bottom quadrant. */
export function letterPages(group: GroupId): string[][] {
  const letters = Array.from(GROUPS.find((g) => g.id === group)!.letters);
  return letters.length > 4 ? [letters.slice(0, 4), letters.slice(4)] : [letters];
}

/** Group tiles print every letter of their group, never the range (BRIEF "Letter groups show their letters"). */
const groupTiles = (): Tile[] =>
  GROUPS.map((g, i) => ({
    id: g.id,
    at: (['Q5', 'Q6', 'Q7', 'Q8'] as const)[i],
    span: 1,
    kind: 'group',
    label: groupLetters(g.id),
    group: g.id,
  }));

/** The actions on screen for a stage, each with the backend quadrants it owns. */
export function tilesFor(view: ViewState): Tile[] {
  const { stage, composition: c } = view;
  switch (stage.kind) {
    case 'calibrate':
      return stage.step === 'ready' ? [{ id: 'start', at: 'Q5', span: 4, kind: 'primary', label: 'Start', icon: 'arrow' }] : [];
    case 'listen':
      return [{ id: 'done-listening', at: 'Q5', span: 4, kind: 'primary', label: 'Done', name: 'Done listening', icon: 'check' }];
    case 'compose': {
      const candidate = currentCandidate(c, view.context);
      const accept: Tile = c.pending.length
        ? candidate
          ? { id: 'accept', at: 'Q1', span: 1, kind: 'primary', label: displayWord(candidate.word, c.words.length === 0), name: `Use ${candidate.word}`, icon: 'check' }
          : { id: 'accept', at: 'Q1', span: 1, kind: 'primary', label: '', name: 'No word yet', disabled: true, icon: 'check' }
        : c.words.length
          ? { id: 'accept', at: 'Q1', span: 1, kind: 'primary', label: 'Done', name: 'Done composing', icon: 'check' }
          : { id: 'accept', at: 'Q1', span: 1, kind: 'primary', label: 'Listen', icon: 'mic' };
      const canDelete = c.pending.length > 0 || c.words.length > 0;
      const del: Tile = canDelete
        ? { id: 'delete', at: 'Q4', span: 1, kind: 'control', label: 'Delete', icon: 'delete' }
        : { id: 'delete', at: 'Q4', span: 1, kind: 'control', label: 'Menu', icon: 'menu' };
      return [accept, del, ...groupTiles()];
    }
    // Speak, Speaking and Spoken keep one layout: the sentence rests in Q2–Q3, Q1 is the forward
    // action, Q4 Menu, Q5 back to Compose, Q7–Q8 the voice (Speak, Stop, Say again).
    case 'speak':
      return [
        { id: 'moment', at: 'Q1', span: 1, kind: 'control', label: 'One moment', icon: 'moment' },
        { id: 'menu', at: 'Q4', span: 1, kind: 'control', label: 'Menu', icon: 'menu' },
        { id: 'edit', at: 'Q5', span: 1, kind: 'control', label: 'Edit', icon: 'edit' },
        { id: 'speak', at: 'Q7', span: 2, kind: 'primary', label: 'Speak', icon: 'speak' },
      ];
    case 'speaking':
      return [{ id: 'stop', at: 'Q7', span: 2, kind: 'primary', label: 'Stop', icon: 'stop' }];
    case 'spoken':
      return [
        { id: 'listen', at: 'Q1', span: 1, kind: 'primary', label: 'Listen', icon: 'mic' },
        { id: 'menu', at: 'Q4', span: 1, kind: 'control', label: 'Menu', icon: 'menu' },
        { id: 'more', at: 'Q5', span: 1, kind: 'control', label: 'Add more', icon: 'plus' },
        { id: 'again', at: 'Q7', span: 2, kind: 'control', label: 'Say again', icon: 'again' },
      ];
    case 'spell': {
      if (!stage.group) {
        const tiles: Tile[] = [];
        if (view.spelled) tiles.push({ id: 'spell-add', at: 'Q1', span: 1, kind: 'primary', label: spelledWord(view.spelled), name: `Add ${view.spelled}`, icon: 'check' });
        tiles.push(view.spelled
          ? { id: 'spell-delete', at: 'Q4', span: 1, kind: 'control', label: 'Delete', icon: 'delete' }
          : { id: 'spell-delete', at: 'Q4', span: 1, kind: 'control', label: 'Back', icon: 'back' });
        return [...tiles, ...groupTiles()];
      }
      const pages = letterPages(stage.group);
      const letters = pages[stage.half] ?? pages[0];
      const tiles: Tile[] = letters.map((letter, i) => ({
        id: `letter-${letter}`,
        at: (['Q5', 'Q6', 'Q7', 'Q8'] as const)[i],
        span: 1,
        kind: 'group',
        label: letter.toUpperCase(),
        group: stage.group!,
      }));
      if (pages.length > 1) {
        const other = pages[1 - stage.half];
        tiles.push({ id: 'spell-other', at: 'Q1', span: 1, kind: 'group', group: stage.group, label: other.map((l) => l.toUpperCase()).join(' ') });
      }
      tiles.push({ id: 'spell-back', at: 'Q4', span: 1, kind: 'control', label: 'Back', icon: 'back' });
      return tiles;
    }
    case 'menu': {
      const page = MENU_PAGES[stage.page];
      const tiles: Tile[] = [];
      page.items.forEach((item, i) => {
        if (!item) return;
        tiles.push({ id: item.id, at: MENU_SLOTS[i], span: 1, kind: 'control', label: item.label, value: item.value?.(view.settings), disabled: item.disabled, icon: item.icon ?? 'dot' });
      });
      tiles.push({ id: 'back', at: 'Q4', span: 1, kind: 'primary', label: 'Back', icon: 'back' });
      return tiles;
    }
  }
}

export function conversationState(stage: Stage, voiceActive: boolean, micOff = false): ConversationState | null {
  if (voiceActive || stage.kind === 'speaking') return 'speaking';
  switch (stage.kind) {
    case 'calibrate': return null;
    case 'listen': return micOff ? 'paused' : 'listening';
    case 'compose': case 'speak': case 'spell': return 'composing';
    case 'spoken': return 'ready';
    case 'menu': return stage.from === 'spoken' ? 'ready' : 'composing';
  }
}

export const STATE_LABEL: Record<ConversationState, string> = {
  listening: 'Listening',
  paused: 'Microphone off',
  composing: 'Composing',
  speaking: 'Speaking',
  ready: 'Ready',
};

/** Sentence case for display and speech: first word capitalised, the pronoun I upper case. */
export function displayWord(word: string, first: boolean): string {
  const w = /^i('|$)/.test(word) ? `I${word.slice(1)}` : word;
  return first ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/** A spelled name shows with a capital, as names usually take one. */
export function spelledWord(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function displayWords(words: readonly { text: string }[]): string[] {
  return words.map((w, i) => displayWord(w.text, i === 0));
}

/** Quadrant ids a tile owns, in reading order. */
export function quadrantsOfTile(tile: Tile): QuadrantId[] {
  const start = Number(tile.at.slice(1));
  return Array.from({ length: tile.span }, (_, i) => `Q${start + i}` as QuadrantId);
}

export function dwellClass(actionId: string): 'letter' | 'control' {
  return /^(G[1-4]|letter-[a-z])$/.test(actionId) ? 'letter' : 'control';
}

export function stageKey(stage: Stage): string {
  switch (stage.kind) {
    case 'calibrate': return `calibrate-${stage.step}`;
    case 'menu': return `menu-${stage.page}`;
    case 'spell': return `spell-${stage.group ?? 'groups'}-${stage.half}`;
    default: return stage.kind;
  }
}

export function cycle<T>(values: readonly T[], current: T): T {
  const i = values.indexOf(current);
  return values[(i + 1) % values.length];
}

/** Everything the app knows about the conversation and the person's settings. */
export type Model = {
  stage: Stage;
  composition: Composition;
  /** The partner's current turn. Reopening Listen appends to it; a new turn after speaking clears it. */
  turn: string;
  turns: number;
  /** The message as it was last spoken. */
  said: string;
  settings: Settings;
  /** The word just accepted, so its tokens can cross-fade into it. */
  fresh: { index: number; groups: GroupId[]; key: number } | null;
  /** Letters picked in the Spell stage, not yet added to the message. */
  spelled: string;
};

