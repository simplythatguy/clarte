/**
 * Style 6 state: the conversation thread, what the partner is saying right now, what the device
 * is doing out loud, the message being composed, and which screen is showing. One reducer owns
 * every change; the two contextual cards (Q1 and Q4) are derived from state and the current
 * prediction by `policy.ts`, never stored, so a label can never disagree with what it does.
 *
 * Listening is always on (owner, 2026-11-07): there is no Listen state. `hearing` is the partner's
 * words as they arrive; a pause or a final result commits them as a partner turn.
 */
import {
  EMPTY_COMPOSITION,
  acceptWord,
  messageText,
  reduce as reduceComposition,
  type Composition,
  type Word,
} from '../../shared/composer.ts';
import { signatureOf, type GroupId } from '../../shared/decoder.ts';
import type { Conflict } from './conflict.ts';
import { conflictOf, primaryFor, secondaryFor, type PrimaryFn, type SecondaryFn } from './policy.ts';
import type { PredictRequest, Prediction, Role } from './prediction.ts';
import type { PartnerSource } from './voice.ts';

export type Turn = {
  id: number;
  who: 'partner' | 'me';
  text: string;
};

export type MenuPage = 'main' | 'settings' | 'settings-2' | 'demo';
export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';
/** The first-run setup pages (owner concept: a report per step). */
export type SetupStep = 'eyes' | 'voice' | 'ready';
export const SETUP_STEPS: SetupStep[] = ['eyes', 'voice', 'ready'];

export type Screen =
  | { kind: 'talk' }
  /** The page Done opens: the message to review, Speak where Done was, and the message's actions. */
  | { kind: 'done' }
  /** Other words: every exact-length word for the last word's code, four per page, to replace it. */
  | { kind: 'other'; page: number }
  /** `origin` is where Back returns to from a settings page opened from the Done page. */
  | { kind: 'menu'; page: MenuPage; origin?: 'done' }
  /** `from` is the screen calibration returns to, by Start, Back or Escape: the conversation or the Done page it was opened from, or the setup report on the first run. */
  | { kind: 'calibration'; step: CalibrationStep; from: Screen }
  | { kind: 'setup'; step: SetupStep; sample?: boolean };

/** What the device is doing out loud right now. `token` 0 marks a static debug frame. */
export type Live =
  | { kind: 'quiet' }
  | { kind: 'speaking'; text: string; word: number; turnId: number | null; token: number; draft: Composition | null }
  | { kind: 'spoken'; turnId: number };

export type Settings = {
  letterDwell: number;
  controlDwell: number;
  textScale: number;
  theme: 'light' | 'dark';
  sound: boolean;
  mode: 'dwell' | 'confirm';
  wordColours: boolean;
  noise: boolean;
  repeat: 'leave' | 'redwell';
  partner: PartnerSource;
  /** The orb drifts while gaze rests (moving) or keeps one shape (still). */
  orbMotion: 'moving' | 'still';
};

export const DEFAULT_SETTINGS: Settings = {
  letterDwell: 600,
  controlDwell: 900,
  textScale: 1,
  theme: 'light',
  sound: true,
  mode: 'dwell',
  wordColours: false,
  noise: false,
  repeat: 'leave',
  partner: 'microphone',
  orbMotion: 'moving',
};

export type State = {
  screen: Screen;
  live: Live;
  /** The partner's words as they are being heard; empty when nothing is being said. */
  hearing: string;
  turns: Turn[];
  composition: Composition;
  settings: Settings;
  nextId: number;
  /** When the simulated calibration last finished, this session. */
  calibratedAt: number | null;
};

export const INITIAL_STATE: State = {
  screen: { kind: 'setup', step: 'eyes' },
  live: { kind: 'quiet' },
  hearing: '',
  turns: [],
  composition: EMPTY_COMPOSITION,
  settings: DEFAULT_SETTINGS,
  nextId: 1,
  calibratedAt: null,
};

export type Action =
  | { type: 'group'; group: GroupId }
  /** Accept the word that was shown. `rank` is its place in the engine's ranking, kept for Delete word; `display` its written form when the engine sent one. */
  | { type: 'accept'; word: string; rank: number; display?: string }
  /** The last pending group; with nothing pending, the last word (reopened at its next candidate). */
  | { type: 'delete' }
  /** Other words: the last word gives way to `word` (its place in the chooser's ranking is `rank`). */
  | { type: 'replace-word'; word: string; rank: number; display?: string }
  | { type: 'clear' }
  /** The partner's words so far (interim). */
  | { type: 'hearing'; text: string }
  /** A pause or a final result: the words become a partner turn. */
  | { type: 'heard'; text: string }
  /** The microphone stopped (speaking, a setting): whatever was being heard becomes a turn. */
  | { type: 'hearing-ended' }
  | { type: 'speak-start'; text: string; turnId: number | null; token: number }
  | { type: 'speak-word'; token: number; word: number }
  | { type: 'speak-end'; token: number }
  /** The person stopped the voice: a spoken message returns to the composer as a draft. */
  | { type: 'speak-cancel' }
  | { type: 'say-again-expired' }
  | { type: 'screen'; screen: Screen }
  | { type: 'calibrated'; at: number }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'replace'; state: State };

/** The conversation as the engine wants it: every turn, plus what is being heard as the last partner turn. */
export function historyOf(state: State): [Role, string][] {
  const history = state.turns.map((t): [Role, string] => [t.who === 'partner' ? 'partner' : 'user', t.text]);
  if (state.hearing.trim()) history.push(['partner', state.hearing.trim()]);
  return history;
}

export function groupsOf(pending: readonly string[]): string {
  return pending.map((g) => g.slice(1)).join('');
}

/** The prediction the conversation screen needs right now. */
export function requestOf(state: State): PredictRequest {
  const c = state.composition;
  return { history: historyOf(state), message: c.words.map((w) => w.text), groups: groupsOf(c.pending), offset: c.pending.length ? c.candidateIndex : 0 };
}

/** Words per page of the Other words chooser: one per letter-group quadrant. */
export const CHOOSER_PAGE = 4;

/** The code the chooser reopens: the last word's own letters, so exact-length words are its peers. */
export function chooserCode(state: State): string {
  const last = state.composition.words[state.composition.words.length - 1];
  return last ? groupsOf(signatureOf(last.text)) : '';
}

/** The Other words page: exact-length words for the last word's code, without that word in the message. */
export function chooserRequestOf(state: State, page: number): PredictRequest {
  const words = state.composition.words.map((w) => w.text);
  return { history: historyOf(state), message: words.slice(0, -1), groups: chooserCode(state), offset: page * CHOOSER_PAGE, complete: true, limit: CHOOSER_PAGE };
}

/** The request worth having ready: the next word once the shown word is accepted. */
export function prefetchOf(state: State, shown: string | null): PredictRequest | null {
  if (!shown || state.live.kind === 'speaking') return null;
  return { history: historyOf(state), message: [...state.composition.words.map((w) => w.text), shown], groups: '', offset: 0 };
}

/** Recent words of the conversation, for the setup report. */
export function contextWords(state: State): string[] {
  const recent = state.turns.slice(-6).map((t) => t.text);
  if (state.hearing) recent.push(state.hearing);
  return recent.join(' ').toLowerCase().match(/[a-z']+/g) ?? [];
}

/** The partner turn a reply is owed to: the last turn, if it is the partner's. */
export function owedTurn(state: State): Turn | null {
  const turn = state.turns[state.turns.length - 1];
  return turn && turn.who === 'partner' ? turn : null;
}

export type Slots = {
  primary: PrimaryFn;
  secondary: SecondaryFn;
  /** Letter groups take input (every talk state except speaking). */
  groups: boolean;
  conflict: Conflict | null;
};

/** What Q1 and Q4 offer, and whether the letter groups take input, for the conversation screen. */
export function slotsFor(state: State, prediction: Prediction): Slots {
  return {
    primary: primaryFor(state, prediction),
    secondary: secondaryFor(state, prediction),
    groups: state.live.kind !== 'speaking',
    conflict: conflictOf(state, prediction),
  };
}

/** A name for every distinct screen state, used by the layout check and the debug hook. */
export function phaseOf(state: State, prediction: Prediction): string {
  const { screen, composition: c } = state;
  if (screen.kind === 'calibration') return `calibrate-${screen.step}`;
  if (screen.kind === 'setup') return `setup-${screen.step}`;
  if (screen.kind === 'menu') return screen.page === 'main' ? 'menu' : `menu-${screen.page}`;
  if (screen.kind === 'done') return 'done';
  if (screen.kind === 'other') return 'other-words';
  if (state.live.kind === 'speaking') return 'speaking';
  const typing = c.words.length > 0 || c.pending.length > 0;
  if (state.hearing) return typing ? 'hearing-typing' : 'hearing';
  if (state.live.kind === 'spoken') return 'spoken';
  if (c.pending.length) {
    if (conflictOf(state, prediction)) return 'composing-branch';
    if (!prediction.words.length) return prediction.fallback ? 'composing-slip' : 'composing-nomatch';
    return c.reopened ? 'composing-reopened' : 'composing-pending';
  }
  return c.words.length ? 'composing-ready' : 'idle';
}

function addTurn(state: State, turn: Omit<Turn, 'id'>): [State, number] {
  const id = state.nextId;
  return [{ ...state, turns: [...state.turns, { ...turn, id }], nextId: id + 1 }, id];
}

function compose(state: State, event: Parameters<typeof reduceComposition>[1]): State {
  return { ...state, composition: reduceComposition(state.composition, event) };
}

/** Whatever the partner was saying becomes a turn (idempotent: nothing heard, nothing added). */
function commitHearing(state: State): State {
  const text = state.hearing.trim();
  if (!text) return state.hearing ? { ...state, hearing: '' } : state;
  return addTurn({ ...state, hearing: '' }, { who: 'partner', text })[0];
}

/**
 * Delete with nothing pending takes back the last word and reopens it one place on in the engine's
 * ranking, so Delete word then the word is "other word" and every candidate is reachable by
 * `offset`; a second Delete straight after the reopen removes the word.
 */
function deleteFrom(c: Composition): Composition {
  if (c.reopened) return { ...c, pending: [], candidateIndex: 0, reopened: false };
  if (c.pending.length) return { ...c, pending: c.pending.slice(0, -1), candidateIndex: 0 };
  const last = c.words[c.words.length - 1];
  if (!last) return c;
  const words = c.words.slice(0, -1);
  if (last.source !== 'decoded' || !last.groups.length) return { ...c, words, reopened: false };
  return { words, pending: last.groups, candidateIndex: last.candidateIndex + 1, reopened: true };
}

/** A message word with the written form the engine gave it, when any (the shared `Word` keeps the decoder's lower-case text). */
export type ShownWord = Word & { display?: string };

/** The written form of a message word, when the engine sent one. */
export function wordDisplay(word: Word): string | undefined {
  return (word as ShownWord).display;
}

function withDisplay(c: Composition, display: string | undefined): Composition {
  if (!display) return c;
  const words = [...c.words];
  const last: ShownWord = { ...words[words.length - 1], display };
  words[words.length - 1] = last;
  return { ...c, words };
}

/**
 * Accept `word` for the pending groups. A word that does not continue them (a gaze-slip correction,
 * or the best word for a prefix of what was typed) remembers its own code instead, so Delete word
 * and Other words reopen the word that was actually said.
 */
function acceptFor(c: Composition, word: string, rank: number, display?: string): Composition {
  const own = signatureOf(word);
  const continues = c.pending.every((g, i) => own[i] === g);
  if (!c.pending.length || continues) return withDisplay(acceptWord(c, word, rank), display);
  return withDisplay({ words: [...c.words, { text: word, groups: own, candidateIndex: rank, source: 'decoded' }], pending: [], candidateIndex: 0, reopened: false }, display);
}

/** Typing or accepting ends the Say again window. */
const quietAfterSpoken = (live: Live): Live => (live.kind === 'spoken' ? { kind: 'quiet' } : live);

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'group':
      return compose({ ...state, live: quietAfterSpoken(state.live) }, { type: 'group', group: action.group });
    case 'accept':
      return { ...state, live: quietAfterSpoken(state.live), composition: acceptFor(state.composition, action.word, action.rank, action.display) };
    case 'delete':
      return { ...state, composition: deleteFrom(state.composition) };
    case 'replace-word': {
      const c = state.composition;
      if (!c.words.length) return state;
      const words = [...c.words.slice(0, -1), { text: action.word, groups: signatureOf(action.word), candidateIndex: action.rank, source: 'decoded' as const }];
      return { ...state, composition: withDisplay({ ...c, words, pending: [], candidateIndex: 0, reopened: false }, action.display) };
    }
    case 'clear':
      return { ...state, composition: EMPTY_COMPOSITION };
    case 'hearing':
      return action.text === state.hearing ? state : { ...state, hearing: action.text };
    case 'heard': {
      const text = action.text.trim();
      const cleared = { ...state, hearing: '' };
      return text ? addTurn(cleared, { who: 'partner', text })[0] : cleared;
    }
    case 'hearing-ended':
      return commitHearing(state);
    case 'speak-start': {
      // Taking the turn: whatever the partner was saying becomes their turn first.
      let base = commitHearing(state);
      // Speaking a message moves it out of the composer; it joins the thread when speech ends.
      const draft = action.turnId === null ? base.composition : null;
      if (draft) base = { ...base, composition: EMPTY_COMPOSITION };
      return { ...base, screen: { kind: 'talk' }, live: { kind: 'speaking', text: action.text, word: 0, turnId: action.turnId, token: action.token, draft } };
    }
    case 'speak-word':
      return state.live.kind === 'speaking' && state.live.token === action.token ? { ...state, live: { ...state.live, word: action.word } } : state;
    case 'speak-end': {
      const live = state.live;
      if (live.kind !== 'speaking' || live.token !== action.token) return state;
      if (live.turnId !== null) return { ...state, live: { kind: 'spoken', turnId: live.turnId } };
      const [next, id] = addTurn(state, { who: 'me', text: live.text });
      return { ...next, live: { kind: 'spoken', turnId: id } };
    }
    case 'speak-cancel': {
      const live = state.live;
      if (live.kind !== 'speaking') return state;
      if (live.draft) return { ...state, live: { kind: 'quiet' }, composition: live.draft };
      return { ...state, live: live.turnId !== null ? { kind: 'spoken', turnId: live.turnId } : { kind: 'quiet' } };
    }
    case 'say-again-expired':
      return state.live.kind === 'spoken' ? { ...state, live: { kind: 'quiet' } } : state;
    case 'screen':
      return { ...state, screen: action.screen };
    case 'calibrated':
      return { ...state, calibratedAt: action.at };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'replace':
      return action.state;
  }
}

export function messageOf(state: State): string {
  return messageText(state.composition);
}
