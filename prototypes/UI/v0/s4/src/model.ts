/**
 * Style 4 · Split: the whole screen as data.
 *
 * Every screen in this style has the same six actionable positions: four keys in the keypad
 * (Q1 Q2 Q5 Q6), the primary tile (Q3) and the second tile (Q4). Q7 and Q8 are always rest.
 * `layoutOf(state)` derives what each position offers from the state, so the quadrant map is
 * fixed by construction and only labels change.
 */
import {
  EMPTY_COMPOSITION,
  currentCandidate,
  messageText,
  reduce as reduceComposition,
  type Composition,
} from '../../shared/composer.ts';
import { GROUPS, type GroupId } from '../../shared/decoder.ts';

export type Settings = {
  letterDwellMs: number;
  controlDwellMs: number;
  textScale: number;
  theme: 'light' | 'dark';
  sound: boolean;
  mode: 'dwell' | 'confirm';
  wordColour: boolean;
  noise: boolean;
  repeat: 'leave' | 'redwell';
  partner: 'live' | 'script';
  overlay: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  letterDwellMs: 600,
  controlDwellMs: 900,
  textScale: 1,
  theme: 'light',
  sound: true,
  mode: 'dwell',
  wordColour: false,
  noise: false,
  repeat: 'leave',
  partner: 'live',
  overlay: false,
};

/**
 * What the conversation is doing. Composing versus idle is derived from the composition.
 * `held` freezes a state for the layout check: no microphone, speech or timer runs behind it.
 */
export type Activity =
  | { kind: 'ready' }
  | { kind: 'listening'; scripted: boolean; held?: boolean }
  /** `index` is the word being spoken, -1 before the first boundary. */
  /** `started` once the voice has begun: until then the partner sees Composing, not Speaking. */
  | { kind: 'speaking'; text: string; index: number; started?: boolean; held?: boolean }
  /** The Say again window after speaking. */
  | { kind: 'spoken'; text: string; held?: boolean };

export type MenuPage = 'root' | 'settings' | 'settings-more' | 'demo' | 'phrases' | 'phrases-more';
export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';
export type SpellLevel = { kind: 'groups' } | { kind: 'chunks'; group: GroupId } | { kind: 'letters'; chunk: string };

export type View =
  | { kind: 'talk' }
  /** "More" while composing: repair the last word, One moment, Menu, Listen. */
  | { kind: 'more' }
  | { kind: 'menu'; page: MenuPage }
  /** `from: 'word'` when opened from Q3 because the typed groups match no word: Add replaces them. */
  | { kind: 'spell'; word: string; level: SpellLevel; from: 'menu' | 'word' }
  | { kind: 'calibration'; step: CalibrationStep };

export type State = {
  view: View;
  activity: Activity;
  composition: Composition;
  /** The partner's last turn, kept visible while composing. */
  partner: string;
  /** What was last spoken; stays on screen, quiet, until a new turn starts. */
  said: string;
  /** A problem the person must see, shown in the rest zone until the next selection. */
  notice: 'speech-failed' | 'mic-unavailable' | null;
  settings: Settings;
};

export const INITIAL_STATE: State = {
  view: { kind: 'talk' },
  activity: { kind: 'ready' },
  composition: EMPTY_COMPOSITION,
  partner: '',
  said: '',
  notice: null,
  settings: DEFAULT_SETTINGS,
};

export type ConversationState = 'idle' | 'listening' | 'composing' | 'speaking';

/** The partner-visible state shown in the band. */
export function conversationState(s: State): ConversationState {
  if (s.activity.kind === 'listening') return 'listening';
  if (s.activity.kind === 'speaking') return s.activity.started || s.activity.held ? 'speaking' : 'composing';
  if ((s.view.kind === 'talk' || s.view.kind === 'more') && (s.composition.words.length || s.composition.pending.length)) return 'composing';
  return 'idle';
}

/** Sentence case for showing a decoded word: capital at the start of the message and for "I". */
export function sentenceCase(word: string, index: number): string {
  if (index === 0 || word === 'i' || word.startsWith("i'")) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

export function contextWords(s: State): string[] {
  return s.partner.toLowerCase().match(/[a-z']+/g) ?? [];
}

// ---------------------------------------------------------------------------------------------
// Commands: everything a tile can do.

export type SettingKey = 'letterDwellMs' | 'controlDwellMs' | 'textScale' | 'theme' | 'sound' | 'mode' | 'wordColour' | 'noise' | 'repeat' | 'partner' | 'overlay';

export type Command =
  | { type: 'group'; group: GroupId }
  | { type: 'listen' }
  | { type: 'stopListening' }
  | { type: 'accept' }
  | { type: 'speak' }
  | { type: 'sayAgain' }
  | { type: 'stopSpeaking' }
  | { type: 'delete' }
  | { type: 'openMore' }
  | { type: 'otherWord' }
  | { type: 'deleteWord' }
  | { type: 'clear' }
  | { type: 'oneMoment' }
  | { type: 'openMenu' }
  | { type: 'closeMenu' }
  | { type: 'page'; page: MenuPage }
  | { type: 'cycle'; setting: SettingKey }
  | { type: 'phrase'; text: string }
  | { type: 'recalibrate' }
  | { type: 'spell'; from: 'menu' | 'word' }
  | { type: 'spellPick'; level: SpellLevel; letter?: string }
  | { type: 'spellAdd' }
  | { type: 'spellBack' }
  | { type: 'start' }
  | { type: 'none' };

export type Icon = 'listen' | 'stop' | 'speak' | 'again' | 'delete' | 'moment' | 'menu' | 'back' | 'more' | 'dots' | 'recalibrate' | 'add'
  | 'swap' | 'phrases' | 'spell' | 'settings' | 'clear' | 'timer' | 'text' | 'theme' | 'sound' | 'eye' | 'colour' | 'demo' | 'noise' | 'repeat' | 'mic' | 'grid' | 'quote';

export type Slot = {
  /** The `data-action` id: stable per position so a latched selection survives a label change. */
  id: string;
  label: string;
  /** A current value shown under the label (settings), or nothing. */
  value?: string;
  icon?: Icon;
  /** Group identity for a letter key (colour, pips) and for the dwell class. */
  group?: GroupId;
  /** Letter keys dwell at the letter speed; everything else at the button speed. */
  dwell: 'letter' | 'control';
  /** A group key that prints its letters ("G H I J K L M N") with the two-circle motif. */
  letters?: boolean;
  tone: 'neutral' | 'accent' | 'word';
  enabled: boolean;
  command: Command;
};

export type Layout = { keys: [Slot, Slot, Slot, Slot]; primary: Slot; second: Slot };

const KEY_IDS = ['G1', 'G2', 'G3', 'G4'] as const;
const PRIMARY = 'primary';
const SECOND = 'delete';

function empty(index: number): Slot {
  return { id: KEY_IDS[index], label: '', dwell: 'control', tone: 'neutral', enabled: false, command: { type: 'none' } };
}

function key(index: number, label: string, command: Command, extra: Partial<Slot> = {}): Slot {
  return { id: KEY_IDS[index], label, dwell: 'control', tone: 'neutral', enabled: true, command, ...extra };
}

function tile(id: string, label: string, icon: Icon | undefined, command: Command, extra: Partial<Slot> = {}): Slot {
  return { id, label, icon, dwell: 'control', tone: 'neutral', enabled: true, command, ...extra };
}

function groupKeys(enabled: boolean): Layout['keys'] {
  return GROUPS.map((g, i) => key(i, g.label, { type: 'group', group: g.id }, { group: g.id, dwell: 'letter', letters: true, enabled })) as Layout['keys'];
}

function fill(slots: Slot[]): Layout['keys'] {
  return [0, 1, 2, 3].map((i) => slots[i] ? { ...slots[i], id: KEY_IDS[i] } : empty(i)) as Layout['keys'];
}

// ---------------------------------------------------------------------------------------------
// Values shown in settings tiles.

export const DWELL_STEPS = [300, 450, 600, 750, 900, 1200, 1500, 2000];
export const SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2];

const seconds = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;

export function nextSetting(settings: Settings, setting: SettingKey): Settings {
  const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length];
  switch (setting) {
    case 'letterDwellMs': return { ...settings, letterDwellMs: cycle(DWELL_STEPS, settings.letterDwellMs) };
    case 'controlDwellMs': return { ...settings, controlDwellMs: cycle(DWELL_STEPS, settings.controlDwellMs) };
    case 'textScale': return { ...settings, textScale: cycle(SCALE_STEPS, settings.textScale) };
    case 'theme': return { ...settings, theme: settings.theme === 'light' ? 'dark' : 'light' };
    case 'sound': return { ...settings, sound: !settings.sound };
    case 'mode': return { ...settings, mode: settings.mode === 'dwell' ? 'confirm' : 'dwell' };
    case 'wordColour': return { ...settings, wordColour: !settings.wordColour };
    case 'noise': return { ...settings, noise: !settings.noise };
    case 'repeat': return { ...settings, repeat: settings.repeat === 'leave' ? 'redwell' : 'leave' };
    case 'partner': return { ...settings, partner: settings.partner === 'live' ? 'script' : 'live' };
    case 'overlay': return { ...settings, overlay: !settings.overlay };
  }
}

const onOff = (on: boolean) => (on ? 'On' : 'Off');

function settingKey(index: number, label: string, setting: SettingKey, value: string, icon: Icon): Slot {
  return key(index, label, { type: 'cycle', setting }, { value, icon });
}

export const PHRASES: Record<'phrases' | 'phrases-more', string[]> = {
  phrases: ['Yes please', 'No thank you', 'I need a minute', 'Can you say that again?'],
  'phrases-more': ['I’m tired', 'I’m in pain', 'Thank you', 'I love you'],
};

export const PAGE_TITLES: Record<MenuPage, string> = {
  root: 'Menu',
  settings: 'Settings',
  'settings-more': 'Settings',
  demo: 'Demo',
  phrases: 'Phrases',
  'phrases-more': 'Phrases',
};

const PAGE_PARENT: Record<MenuPage, MenuPage | null> = {
  root: null,
  settings: 'root',
  'settings-more': 'root',
  demo: 'root',
  phrases: 'root',
  'phrases-more': 'root',
};

/** Menu pages reuse the six positions: four items in the keypad, Q3 forward, Q4 back (as everywhere). */
function menuLayout(page: MenuPage, st: State): Layout {
  const s = st.settings;
  const parent = PAGE_PARENT[page];
  const back = tile(SECOND, parent ? 'Back' : 'Close', 'back', parent ? { type: 'page', page: parent } : { type: 'closeMenu' });
  const hasMessage = st.composition.words.length > 0 || st.composition.pending.length > 0;
  switch (page) {
    case 'root':
      return {
        keys: fill([
          key(0, 'Phrases', { type: 'page', page: 'phrases' }, { icon: 'phrases' }),
          key(1, 'Spell', { type: 'spell', from: 'menu' }, { icon: 'spell' }),
          key(2, 'Settings', { type: 'page', page: 'settings' }, { icon: 'settings' }),
          // Clear exists only when there is something to clear.
          // Clear is inert, in place, when there is nothing to clear.
          key(3, 'Clear message', { type: 'clear' }, { icon: 'clear', enabled: hasMessage }),
        ]),
        primary: tile(PRIMARY, 'Recalibrate', 'recalibrate', { type: 'recalibrate' }),
        second: back,
      };
    case 'settings':
    case 'settings-more': {
      const first = page === 'settings';
      return {
        keys: fill(first
          ? [
              settingKey(0, 'Letter dwell', 'letterDwellMs', seconds(s.letterDwellMs), 'timer'),
              settingKey(1, 'Button dwell', 'controlDwellMs', seconds(s.controlDwellMs), 'timer'),
              settingKey(2, 'Text size', 'textScale', `${Math.round(s.textScale * 100)}%`, 'text'),
              settingKey(3, 'Theme', 'theme', s.theme === 'light' ? 'Light' : 'Dark', 'theme'),
            ]
          : [
              settingKey(0, 'Sound', 'sound', onOff(s.sound), 'sound'),
              settingKey(1, 'Selection', 'mode', s.mode === 'dwell' ? 'Dwell' : 'Dwell + key', 'eye'),
              settingKey(2, 'Word colour', 'wordColour', onOff(s.wordColour), 'colour'),
              settingKey(3, 'Repeat', 'repeat', s.repeat === 'leave' ? 'Look away' : 'Keep looking', 'repeat'),
            ]),
        primary: tile(PRIMARY, 'Next', 'more', { type: 'page', page: first ? 'settings-more' : 'demo' }, { value: first ? '1 of 3' : '2 of 3' }),
        second: back,
      };
    }
    case 'demo':
      return {
        keys: fill([
          settingKey(0, 'Gaze noise', 'noise', onOff(s.noise), 'noise'),
          settingKey(1, 'Partner', 'partner', s.partner === 'live' ? 'Microphone' : 'Script', 'mic'),
          settingKey(2, 'Overlay', 'overlay', onOff(s.overlay), 'grid'),
        ]),
        // Demo is the third settings page.
        primary: tile(PRIMARY, 'Next', 'more', { type: 'page', page: 'settings' }, { value: '3 of 3' }),
        second: back,
      };
    case 'phrases':
    case 'phrases-more': {
      const first = page === 'phrases';
      return {
        keys: fill(PHRASES[page].map((text, i) => key(i, text, { type: 'phrase', text }, { icon: 'quote' }))),
        primary: tile(PRIMARY, 'Next', 'more', { type: 'page', page: first ? 'phrases-more' : 'phrases' }, { value: first ? '1 of 2' : '2 of 2' }),
        second: back,
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Spell: letter-exact typing for names, three looks per letter (group, pair, letter).

export function spellChunks(group: GroupId): string[] {
  const letters = GROUPS.find((g) => g.id === group)!.letters;
  const out: string[] = [];
  for (let i = 0; i < letters.length; i += 2) out.push(letters.slice(i, i + 2));
  return out;
}

const upper = (s: string) => s.toUpperCase();

function spellLayout(word: string, level: SpellLevel): Layout {
  // Q4 steps back: a level, then a letter, then out of Spell.
  let keys: Layout['keys'];
  if (level.kind === 'groups') {
    keys = GROUPS.map((g, i) => key(i, g.label, { type: 'spellPick', level: { kind: 'chunks', group: g.id } }, { group: g.id, dwell: 'letter', letters: true })) as Layout['keys'];
  } else if (level.kind === 'chunks') {
    keys = fill(spellChunks(level.group).map((chunk, i) =>
      chunk.length === 1
        ? key(i, upper(chunk), { type: 'spellPick', level: { kind: 'groups' }, letter: chunk }, { group: level.group, dwell: 'letter' })
        : key(i, upper(chunk.split('').join(' ')), { type: 'spellPick', level: { kind: 'letters', chunk } }, { group: level.group, dwell: 'letter' })));
  } else {
    keys = fill(level.chunk.split('').map((letter, i) => key(i, upper(letter), { type: 'spellPick', level: { kind: 'groups' }, letter }, { dwell: 'letter' })));
  }
  const atStart = level.kind === 'groups';
  return {
    keys,
    primary: tile(PRIMARY, 'Add', 'add', { type: 'spellAdd' }, { tone: 'accent', enabled: word.length > 0 }),
    second: atStart && !word
      ? tile(SECOND, 'Back', 'back', { type: 'spellBack' })
      : tile(SECOND, atStart ? 'Delete' : 'Back', atStart ? 'delete' : 'back', { type: 'spellBack' }),
  };
}

// ---------------------------------------------------------------------------------------------
// The conversation screen.

function talkLayout(s: State): Layout {
  const { activity, composition: c } = s;
  const keysOn = activity.kind === 'ready' || activity.kind === 'spoken';
  // Q4 is Delete while a word is being typed, and More everywhere else in the conversation.
  const more = tile(SECOND, 'More', 'dots', { type: 'openMore' });
  let primary: Slot;
  let second: Slot;

  switch (activity.kind) {
    case 'listening':
      primary = tile(PRIMARY, 'Stop', 'stop', { type: 'stopListening' });
      second = more;
      break;
    case 'speaking':
      primary = tile(PRIMARY, 'Stop', 'stop', { type: 'stopSpeaking' });
      second = { ...more, enabled: false };
      break;
    case 'spoken':
      primary = tile(PRIMARY, 'Say again', 'again', { type: 'sayAgain' });
      second = more;
      break;
    case 'ready':
      if (c.pending.length) {
        const candidate = currentCandidate(c, contextWords(s));
        // No word matches: the way forward is to spell it, never to accept raw groups.
        primary = candidate
          ? tile(PRIMARY, sentenceCase(candidate.word, c.words.length), 'add', { type: 'accept' }, { tone: 'word' })
          : tile(PRIMARY, 'Spell', 'spell', { type: 'spell', from: 'word' }, { value: 'No word' });
      } else if (c.words.length) {
        primary = tile(PRIMARY, 'Speak', 'speak', { type: 'speak' }, { tone: 'accent' });
      } else {
        primary = tile(PRIMARY, 'Listen', 'listen', { type: 'listen' });
      }
      second = c.pending.length ? tile(SECOND, 'Delete', 'delete', { type: 'delete' }) : more;
      break;
  }
  return { keys: groupKeys(keysOn), primary, second };
}

// ---------------------------------------------------------------------------------------------
// More, while composing with nothing pending: everything that matters mid-message, one look away.

/** What "Other word" would put in place of the last word: its next decode candidate. */
export function otherWord(c: Composition, context: readonly string[]): string | null {
  const last = c.words[c.words.length - 1];
  if (!last || last.source !== 'decoded' || c.pending.length) return null;
  const reopened = reduceComposition(c, { type: 'delete' }, context);
  const next = currentCandidate(reopened, context);
  return next && next.word !== last.text ? next.word : null;
}

export function lastWordRemoved(c: Composition, context: readonly string[]): Composition {
  const last = c.words[c.words.length - 1];
  if (!last) return c;
  const once = reduceComposition(c, { type: 'delete' }, context);
  return last.source === 'decoded' ? reduceComposition(once, { type: 'delete' }, context) : once;
}

/**
 * More: one look from every conversation state except mid-word. Each function here has one home:
 * Other word Q1, Delete word Q2, One moment Q5, Menu Q6, Listen/Stop Q3 (as on the main screen),
 * Back Q4. Positions with nothing to offer stay empty.
 */
function moreLayout(s: State): Layout {
  const next = otherWord(s.composition, contextWords(s));
  const listening = s.activity.kind === 'listening';
  return {
    keys: fill([
      // With no word to change, Other word and Delete word stay in place, inert.
      next
        ? key(0, sentenceCase(next, s.composition.words.length - 1), { type: 'otherWord' }, { value: 'Other word', tone: 'word', icon: 'swap' })
        : key(0, 'Other word', { type: 'none' }, { icon: 'swap', enabled: false }),
      key(1, 'Delete word', { type: 'deleteWord' }, { icon: 'delete', enabled: s.composition.words.length > 0 }),
      key(2, 'One moment', { type: 'oneMoment' }, { icon: 'moment' }),
      key(3, 'Menu', { type: 'openMenu' }, { icon: 'menu' }),
    ]),
    primary: listening ? tile(PRIMARY, 'Stop', 'stop', { type: 'stopListening' }) : tile(PRIMARY, 'Listen', 'listen', { type: 'listen' }),
    second: tile(SECOND, 'Back', 'back', { type: 'closeMenu' }),
  };
}

export function layoutOf(s: State): Layout | null {
  switch (s.view.kind) {
    case 'talk': return talkLayout(s);
    case 'more': return moreLayout(s);
    case 'menu': return menuLayout(s.view.page, s);
    case 'spell': return spellLayout(s.view.word, s.view.level);
    case 'calibration':
      return s.view.step === 'ready'
        ? {
            keys: fill([]),
            primary: tile(PRIMARY, 'Start', undefined, { type: 'start' }, { tone: 'accent' }),
            second: { ...tile(SECOND, '', undefined, { type: 'none' }), enabled: false },
          }
        : null;
  }
}

// ---------------------------------------------------------------------------------------------
// The reducer. Side effects (listening, speech, sounds) live in the app and follow the state.

export type Event =
  | Command
  | { type: 'transcript'; text: string }
  | { type: 'scripted' }
  | { type: 'spokenWord'; index: number }
  | { type: 'speechEnded' }
  | { type: 'speechFailed' }
  | { type: 'speechStarted' }
  | { type: 'micUnavailable' }
  | { type: 'sayAgainExpired' }
  | { type: 'calibration'; step: CalibrationStep }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'replace'; state: State };

const INTERNAL_EVENTS = new Set<Event['type']>(['transcript', 'scripted', 'micUnavailable', 'spokenWord', 'speechStarted', 'speechEnded', 'speechFailed', 'sayAgainExpired', 'calibration', 'settings', 'replace']);

/** A notice stays until the person's next selection. */
export function reduce(s: State, e: Event): State {
  const next = reduceEvent(s, e);
  return next.notice && !INTERNAL_EVENTS.has(e.type) && e.type !== 'none' ? { ...next, notice: null } : next;
}

function reduceEvent(s: State, e: Event): State {
  const ctx = contextWords(s);
  const talk: View = { kind: 'talk' };
  switch (e.type) {
    case 'group': {
      const composition = reduceComposition(s.activity.kind === 'spoken' ? EMPTY_COMPOSITION : s.composition, e, ctx);
      return { ...s, composition, activity: { kind: 'ready' }, said: '' };
    }
    case 'accept':
    case 'delete':
      return { ...s, composition: reduceComposition(s.composition, e, ctx) };
    case 'listen':
      return { ...s, view: talk, activity: { kind: 'listening', scripted: s.settings.partner === 'script' }, partner: '', said: '' };
    case 'scripted':
      return s.activity.kind === 'listening' ? { ...s, activity: { ...s.activity, scripted: true } } : s;
    case 'transcript':
      return s.activity.kind === 'listening' ? { ...s, partner: e.text } : s;
    case 'stopListening':
      return { ...s, activity: { kind: 'ready' } };
    case 'speak': {
      const text = messageText(s.composition);
      return text ? { ...s, activity: { kind: 'speaking', text, index: -1 } } : s;
    }
    case 'sayAgain':
      return s.activity.kind === 'spoken' ? { ...s, activity: { kind: 'speaking', text: s.activity.text, index: -1 } } : s;
    case 'spokenWord':
      return s.activity.kind === 'speaking' ? { ...s, activity: { ...s.activity, index: e.index } } : s;
    case 'speechEnded':
      // The message has been said: it leaves the composer and stays on screen for Say again.
      return s.activity.kind === 'speaking'
        ? { ...s, activity: { kind: 'spoken', text: s.activity.text }, composition: EMPTY_COMPOSITION, said: s.activity.text }
        : s;
    case 'stopSpeaking':
      // Stopped part-way: the draft stays, ready to edit or speak again.
      return s.activity.kind === 'speaking' ? { ...s, activity: { kind: 'ready' } } : s;
    case 'speechStarted':
      return s.activity.kind === 'speaking' ? { ...s, activity: { ...s.activity, started: true } } : s;
    case 'micUnavailable':
      // The microphone cannot be used: listening ends visibly and nothing is made up in its place.
      return s.activity.kind === 'listening' ? { ...s, activity: { kind: 'ready' }, notice: 'mic-unavailable' } : s;
    case 'speechFailed':
      return s.activity.kind === 'speaking' ? { ...s, activity: { kind: 'ready' }, notice: 'speech-failed' } : s;
    case 'sayAgainExpired':
      return s.activity.kind === 'spoken' ? { ...s, activity: { kind: 'ready' } } : s;
    case 'oneMoment':
      return s;
    case 'openMore':
      return { ...s, view: { kind: 'more' } };
    case 'otherWord': {
      const reopened = reduceComposition(s.composition, { type: 'delete' }, ctx);
      return { ...s, view: talk, composition: reduceComposition(reopened, { type: 'accept' }, ctx) };
    }
    case 'deleteWord':
      return { ...s, view: talk, composition: lastWordRemoved(s.composition, ctx) };
    case 'clear':
      return { ...s, view: talk, composition: EMPTY_COMPOSITION };
    case 'openMenu':
      // Listening carries on behind the menu; only the Say again window closes.
      return { ...s, view: { kind: 'menu', page: 'root' }, activity: s.activity.kind === 'spoken' ? { kind: 'ready' } : s.activity };
    case 'closeMenu':
      return { ...s, view: talk };
    case 'page':
      return { ...s, view: { kind: 'menu', page: e.page } };
    case 'cycle':
      return { ...s, settings: nextSetting(s.settings, e.setting) };
    case 'phrase':
      return { ...s, view: talk, composition: reduceComposition(s.composition, e, ctx), said: '' };
    case 'recalibrate':
      // The microphone never stays on behind a screen that does not show it.
      return { ...s, view: { kind: 'calibration', step: 'position' }, activity: s.activity.kind === 'listening' ? { kind: 'ready' } : s.activity };
    case 'calibration':
      return { ...s, view: { kind: 'calibration', step: e.step } };
    case 'start':
      return { ...s, view: talk };
    case 'spell':
      return { ...s, view: { kind: 'spell', word: '', level: { kind: 'groups' }, from: e.from } };
    case 'spellPick': {
      if (s.view.kind !== 'spell') return s;
      const letter = e.letter ? (s.view.word ? e.letter : e.letter.toUpperCase()) : '';
      return { ...s, view: { ...s.view, word: s.view.word + letter, level: e.level } };
    }
    case 'spellBack': {
      if (s.view.kind !== 'spell') return s;
      const { word, level } = s.view;
      if (level.kind === 'letters') {
        const group = GROUPS.find((g) => g.letters.includes(level.chunk))!.id;
        return { ...s, view: { ...s.view, level: { kind: 'chunks', group } } };
      }
      if (level.kind === 'chunks') return { ...s, view: { ...s.view, level: { kind: 'groups' } } };
      if (word) return { ...s, view: { ...s.view, word: word.slice(0, -1) } };
      return { ...s, view: s.view.from === 'word' ? talk : { kind: 'menu', page: 'root' } };
    }
    case 'spellAdd': {
      if (s.view.kind !== 'spell' || !s.view.word) return s;
      // Spelled from a word that matched nothing: the spelled word takes the place of its groups.
      const base = s.view.from === 'word' ? { ...s.composition, pending: [], candidateIndex: 0, reopened: false } : s.composition;
      return { ...s, view: talk, composition: reduceComposition(base, { type: 'phrase', text: s.view.word }, ctx), said: '' };
    }
    case 'settings':
      return { ...s, settings: { ...s.settings, ...e.patch } };
    case 'replace':
      return e.state;
    case 'none':
      return s;
  }
}
