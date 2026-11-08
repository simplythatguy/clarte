/**
 * Style 6 state (built on style 5): the conversation thread, what is live right now, the message being composed,
 * and which screen is showing. One reducer owns every change; the two contextual slots (Q1 and
 * Q4) are derived from state, never stored, so a label can never disagree with what it does.
 */
import {
  EMPTY_COMPOSITION,
  currentCandidate,
  messageText,
  reduce as reduceComposition,
  type Composition,
} from '../../shared/composer.ts';
import type { GroupId } from '../../shared/decoder.ts';
import type { SoundLevel } from '../../shared/sound.ts';
import { suggestReply } from './suggest.ts';
import { conflictFor, optionsFor, type Conflict } from './conflict.ts';
import { candidates } from '../../shared/composer.ts';
import type { PartnerSource } from './voice.ts';

export type Turn = {
  id: number;
  who: 'partner' | 'me';
  text: string;
  /** A floor-holder ("Wait!…"): said aloud, kept in the record, never a reply. */
  holder?: boolean;
};

export type MenuPage = 'main' | 'settings' | 'dwell' | 'appearance' | 'sound' | 'dev-tools';
export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';
/** The first-run setup pages (owner concept: a report per step). */
export type SetupStep = 'eyes' | 'voice' | 'ready';
export const SETUP_STEPS: SetupStep[] = ['eyes', 'voice', 'ready'];

export type Screen =
  | { kind: 'talk' }
  | { kind: 'menu'; page: MenuPage; at?: number }
  /** Every whole word the typed groups spell, to choose from; `at` is the first one in view. */
  | { kind: 'options'; at: number }
  | { kind: 'calibration'; step: CalibrationStep }
  | { kind: 'setup'; step: SetupStep; sample?: boolean };

/** What the device is doing out loud right now. `token` 0 marks a static debug frame. */
export type Live =
  | { kind: 'quiet' }
  | { kind: 'listening'; transcript: string; token: number }
  | { kind: 'speaking'; text: string; word: number; turnId: number | null; holder: boolean; token: number; draft: Composition | null }
  | { kind: 'spoken'; turnId: number };

export type Settings = {
  letterDwell: number;
  controlDwell: number;
  textScale: number;
  /** Which cues play (SOUND.md): all of them, the fewer important ones, or none. */
  sound: SoundLevel;
  /** Cue volume, 0–1. */
  volume: number;
  mode: 'dwell' | 'confirm';
  wordColours: boolean;
  suggestions: boolean;
  noise: boolean;
  repeat: 'leave' | 'redwell';
  partner: PartnerSource;
  /** The companion bobs and blinks (moving) or keeps still (still). */
  orbMotion: 'moving' | 'still';
};

export const DEFAULT_SETTINGS: Settings = {
  letterDwell: 600,
  controlDwell: 900,
  textScale: 1,
  sound: 'all',
  volume: 0.75,
  mode: 'dwell',
  wordColours: false,
  suggestions: true,
  noise: false,
  repeat: 'leave',
  partner: 'microphone',
  orbMotion: 'moving',
};

export type State = {
  screen: Screen;
  live: Live;
  turns: Turn[];
  composition: Composition;
  /** The partner turn whose suggested reply was dismissed or typed over; it is not offered again. */
  dismissed: number | null;
  settings: Settings;
  nextId: number;
  /** When the simulated calibration last finished, this session. */
  calibratedAt: number | null;
};

export const INITIAL_STATE: State = {
  screen: { kind: 'setup', step: 'eyes' },
  live: { kind: 'quiet' },
  turns: [],
  composition: EMPTY_COMPOSITION,
  dismissed: null,
  settings: DEFAULT_SETTINGS,
  nextId: 1,
  calibratedAt: null,
};

export type Action =
  | { type: 'group'; group: GroupId }
  | { type: 'accept' }
  /** Accept one word of the Options screen and return to the conversation. */
  | { type: 'accept-word'; word: string }
  | { type: 'delete' }
  | { type: 'use-suggestion'; text: string }
  | { type: 'dismiss-suggestion' }
  | { type: 'listen-start'; token: number }
  | { type: 'transcript'; text: string }
  | { type: 'listen-stop' }
  | { type: 'speak-start'; text: string; turnId: number | null; holder: boolean; token: number }
  | { type: 'speak-word'; token: number; word: number }
  | { type: 'speak-end'; token: number }
  /** The person stopped the voice: a spoken message returns to the composer as a draft. */
  | { type: 'speak-cancel' }
  | { type: 'say-again-expired' }
  | { type: 'screen'; screen: Screen }
  | { type: 'calibrated'; at: number }
  | { type: 'phrase'; text: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'replace'; state: State };

/** Recent words of the conversation, passed to the decoder so they rank higher. */
export function contextWords(state: State): string[] {
  const recent = state.turns.slice(-6).map((t) => t.text);
  if (state.live.kind === 'listening') recent.push(state.live.transcript);
  return recent.join(' ').toLowerCase().match(/[a-z']+/g) ?? [];
}

/** The partner turn a reply is owed to: the last turn, if it is the partner's (floor-holders skipped). */
export function owedTurn(state: State): Turn | null {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const turn = state.turns[i];
    if (turn.holder) continue;
    return turn.who === 'partner' ? turn : null;
  }
  return null;
}

export function suggestionFor(state: State): string | null {
  if (!state.settings.suggestions || state.live.kind !== 'quiet') return null;
  const c = state.composition;
  if (c.words.length || c.pending.length) return null;
  const turn = owedTurn(state);
  if (!turn || state.dismissed === turn.id) return null;
  return suggestReply(turn.text);
}

export type PrimaryFn =
  | { kind: 'listen' }
  | { kind: 'stop-listening' }
  | { kind: 'suggestion'; text: string }
  | { kind: 'candidate'; word: string }
  | { kind: 'no-match'; groups: number }
  | { kind: 'speak' }
  | { kind: 'stop-speaking' }
  | { kind: 'say-again'; turnId: number }
  /** Several whole words fit about equally well: open the Options screen to choose. `top` is the
   *  three most likely, shown on the card; `more` says whether the list goes on past them. */
  | { kind: 'options'; top: string[]; more: boolean };

export type SecondFn =
  | { kind: 'delete'; word: boolean }
  | { kind: 'one-moment' }
  | { kind: 'menu' }
  | { kind: 'dismiss' }
  | { kind: 'none' };

export type Slots = { primary: PrimaryFn; second: SecondFn; groups: boolean };

/** The current word conflict, if the screen should offer Options. Only on the decoder's first ranking. */
export function conflictOf(state: State): Conflict | null {
  const c = state.composition;
  if (state.screen.kind !== 'talk' || state.live.kind === 'listening' || state.live.kind === 'speaking') return null;
  if (!c.pending.length || c.candidateIndex !== 0) return null;
  return conflictFor(c, contextWords(state));
}

/** What Q1 and Q4 offer, and whether the letter groups take input, for the conversation screen. */
export function slotsFor(state: State): Slots {
  const { live, composition: c } = state;
  if (live.kind === 'listening') return { primary: { kind: 'stop-listening' }, second: { kind: 'one-moment' }, groups: false };
  if (live.kind === 'speaking') return { primary: { kind: 'stop-speaking' }, second: { kind: 'none' }, groups: false };
  if (c.pending.length) {
    const conflict = conflictOf(state);
    if (conflict) {
      const words = optionsFor(state.composition, contextWords(state));
      return { primary: { kind: 'options', top: words.slice(0, 3), more: words.length > 3 }, second: { kind: 'delete', word: c.reopened }, groups: true };
    }
    const candidate = currentCandidate(c, contextWords(state));
    return {
      primary: candidate ? { kind: 'candidate', word: candidate.word } : { kind: 'no-match', groups: c.pending.length },
      second: { kind: 'delete', word: c.reopened },
      groups: true,
    };
  }
  if (c.words.length) return { primary: { kind: 'speak' }, second: { kind: 'delete', word: false }, groups: true };
  if (live.kind === 'spoken') return { primary: { kind: 'say-again', turnId: live.turnId }, second: { kind: 'menu' }, groups: true };
  const suggestion = suggestionFor(state);
  if (suggestion) return { primary: { kind: 'suggestion', text: suggestion }, second: { kind: 'dismiss' }, groups: true };
  return { primary: { kind: 'listen' }, second: { kind: 'menu' }, groups: true };
}

export function primaryKey(fn: PrimaryFn): string {
  switch (fn.kind) {
    case 'suggestion': return `suggestion:${fn.text}`;
    case 'candidate': return `candidate:${fn.word}`;
    case 'say-again': return `say-again:${fn.turnId}`;
    default: return fn.kind;
  }
}

export function secondKey(fn: SecondFn): string {
  return fn.kind === 'delete' ? `delete:${fn.word}` : fn.kind;
}

/** A name for every distinct screen state, used by the layout check and the debug hook. */
export function phaseOf(state: State): string {
  const { screen } = state;
  if (screen.kind === 'calibration') return `calibrate-${screen.step}`;
  if (screen.kind === 'setup') return `setup-${screen.step}`;
  if (screen.kind === 'menu') return screen.page === 'main' ? 'menu' : `menu-${screen.page}`;
  if (screen.kind === 'options') return 'options';
  const { primary, second } = slotsFor(state);
  switch (primary.kind) {
    case 'stop-listening': return 'listening';
    case 'stop-speaking': return 'speaking';
    case 'say-again': return 'spoken';
    case 'suggestion': return 'suggested';
    case 'speak': return 'composing-ready';
    case 'no-match': return 'composing-nomatch';
    case 'options': return 'composing-options';
    case 'candidate': return second.kind === 'delete' && second.word ? 'composing-reopened' : 'composing-pending';
    case 'listen': return 'idle';
  }
}

function addTurn(state: State, turn: Omit<Turn, 'id'>): [State, number] {
  const id = state.nextId;
  return [{ ...state, turns: [...state.turns, { ...turn, id }], nextId: id + 1 }, id];
}

function compose(state: State, event: Parameters<typeof reduceComposition>[1]): State {
  return { ...state, composition: reduceComposition(state.composition, event, contextWords(state)) };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'group': {
      // Typing over a suggestion dismisses it for this partner turn; typing ends the Say again window.
      const owed = owedTurn(state);
      const next = compose({ ...state, live: state.live.kind === 'spoken' ? { kind: 'quiet' } : state.live }, { type: 'group', group: action.group });
      return { ...next, dismissed: owed ? owed.id : state.dismissed };
    }
    case 'accept':
      return compose(state, { type: 'accept' });
    case 'accept-word': {
      const context = contextWords(state);
      const index = candidates(state.composition, context).findIndex((x) => x.word === action.word);
      if (index >= 0) return { ...compose({ ...state, composition: { ...state.composition, candidateIndex: index } }, { type: 'accept' }), screen: { kind: 'talk' } };
      // A word beyond the composer's short list is still a decode of the same groups, so Delete can reopen it.
      const c = state.composition;
      const word = { text: action.word, groups: c.pending, candidateIndex: 0, source: 'decoded' as const };
      return { ...state, composition: { words: [...c.words, word], pending: [], candidateIndex: 0, reopened: false }, screen: { kind: 'talk' } };
    }
    case 'delete':
      return compose(state, { type: 'delete' });
    case 'use-suggestion': {
      const owed = owedTurn(state);
      return { ...compose(state, { type: 'phrase', text: action.text }), dismissed: owed ? owed.id : state.dismissed };
    }
    case 'dismiss-suggestion': {
      const owed = owedTurn(state);
      return owed ? { ...state, dismissed: owed.id } : state;
    }
    case 'listen-start':
      return { ...state, live: { kind: 'listening', transcript: '', token: action.token } };
    case 'transcript':
      return state.live.kind === 'listening' ? { ...state, live: { ...state.live, transcript: action.text } } : state;
    case 'listen-stop': {
      if (state.live.kind !== 'listening') return state;
      const text = state.live.transcript.trim();
      const quiet = { ...state, live: { kind: 'quiet' } as Live };
      return text ? addTurn(quiet, { who: 'partner', text })[0] : quiet;
    }
    case 'speak-start': {
      // A listening session ends when the person takes the turn ("One moment").
      let base = state;
      if (state.live.kind === 'listening') base = reducer(state, { type: 'listen-stop' });
      // Speaking a message moves it out of the composer; it joins the thread when speech ends.
      const draft = action.turnId === null && !action.holder ? base.composition : null;
      if (draft) base = { ...base, composition: EMPTY_COMPOSITION };
      return { ...base, live: { kind: 'speaking', text: action.text, word: 0, turnId: action.turnId, holder: action.holder, token: action.token, draft } };
    }
    case 'speak-word':
      return state.live.kind === 'speaking' && state.live.token === action.token ? { ...state, live: { ...state.live, word: action.word } } : state;
    case 'speak-end': {
      const live = state.live;
      if (live.kind !== 'speaking' || live.token !== action.token) return state;
      if (live.turnId !== null) return { ...state, live: { kind: 'spoken', turnId: live.turnId } };
      const [next, id] = addTurn(state, { who: 'me', text: live.text, holder: live.holder || undefined });
      return { ...next, live: live.holder ? { kind: 'quiet' } : { kind: 'spoken', turnId: id } };
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
    case 'phrase':
      return { ...compose(state, { type: 'phrase', text: action.text }), screen: { kind: 'talk' }, live: state.live.kind === 'spoken' ? { kind: 'quiet' } : state.live };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'replace':
      return action.state;
  }
}

export function messageOf(state: State): string {
  return messageText(state.composition);
}
