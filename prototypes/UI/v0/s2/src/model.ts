/**
 * Style 2 · Corners: the app's state and what each slot offers in each state.
 *
 * Six actions on one fixed map: G1 Q1, G2 Q4, G3 Q5, G4 Q8, `primary` Q6, `second` Q7.
 * Q2 and Q3 are rest in every state. The two control slots change label with context but never
 * move; `slots()` is the single table that says what they do.
 */
import {
  EMPTY_COMPOSITION,
  currentCandidate,
  reduce,
  type Composition,
  type ComposerEvent,
} from '../../shared/composer.ts';
import { signatureOf } from '../../shared/decoder.ts';
import type { SelectionMode } from '../../shared/gaze.ts';

export type Mode = 'idle' | 'listening' | 'speaking' | 'said';

export type MenuPage = 'menu' | 'more' | 'display' | 'selection' | 'demo' | 'phrases';
export const MENU_CYCLE: readonly Exclude<MenuPage, 'phrases'>[] = ['menu', 'more', 'display', 'selection', 'demo'];

export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';

export type Screen =
  | { kind: 'conversation' }
  | { kind: 'menu'; page: MenuPage }
  | { kind: 'calibration'; step: CalibrationStep; frozen: boolean };

export type Settings = {
  letterDwell: number;
  controlDwell: number;
  textScale: number;
  theme: 'light' | 'dark';
  sound: boolean;
  mode: SelectionMode;
  wordColours: boolean;
  noise: boolean;
  repeat: 'leave' | 'redwell';
  partner: 'microphone' | 'script';
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
};

export const DWELL_STEPS = [300, 450, 600, 900, 1200, 2000];
export const SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2];

export type State = {
  screen: Screen;
  mode: Mode;
  comp: Composition;
  /** The partner's last turn, kept on screen while composing. */
  partner: string;
  /** The sentence being spoken or just said. */
  spoken: string | null;
  spokenWord: number;
  /** The floor-holder is being spoken. */
  holding: boolean;
  /** A blocked action and how to fix it, shown in the status line until the next action. */
  notice: string | null;
  settings: Settings;
};

export const INITIAL_STATE: State = {
  screen: { kind: 'conversation' },
  mode: 'idle',
  comp: EMPTY_COMPOSITION,
  partner: '',
  spoken: null,
  spokenWord: -1,
  holding: false,
  notice: null,
  settings: DEFAULT_SETTINGS,
};

export type Action =
  | { type: 'compose'; event: ComposerEvent }
  | { type: 'mode'; mode: Mode; spoken?: string | null }
  | { type: 'partner'; text: string }
  | { type: 'spokenWord'; index: number }
  | { type: 'holding'; holding: boolean }
  | { type: 'screen'; screen: Screen }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'clear' }
  | { type: 'notice'; text: string | null }
  | { type: 'restore'; comp: Composition }
  | { type: 'replace'; state: State };

export function contextWords(state: Pick<State, 'partner' | 'comp'>): string[] {
  const partner = state.partner.toLowerCase().match(/[a-z']+/g) ?? [];
  return [...partner, ...state.comp.words.map((w) => w.text.toLowerCase())];
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'compose': {
      const comp = reduce(state.comp, action.event, contextWords(state));
      // Typing after a sentence was said starts a new message: the said sentence leaves the screen.
      const leavingSaid = state.mode === 'said' || (state.mode === 'idle' && state.spoken !== null);
      return { ...state, comp, notice: null, mode: state.mode === 'said' ? 'idle' : state.mode, spoken: leavingSaid ? null : state.spoken };
    }
    case 'mode':
      return {
        ...state,
        mode: action.mode,
        spoken: action.spoken !== undefined ? action.spoken : state.spoken,
        spokenWord: action.mode === 'speaking' ? 0 : -1,
      };
    case 'partner':
      return { ...state, partner: action.text };
    case 'spokenWord':
      return { ...state, spokenWord: action.index };
    case 'holding':
      return { ...state, holding: action.holding };
    case 'screen':
      return { ...state, screen: action.screen };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'clear':
      return { ...state, comp: EMPTY_COMPOSITION, partner: '', spoken: null, spokenWord: -1, mode: 'idle' };
    case 'notice':
      return { ...state, notice: action.text };
    case 'restore':
      // Speech did not start: the message comes back exactly as it was.
      return { ...state, comp: action.comp, mode: 'idle', spoken: null, spokenWord: -1 };
    case 'replace':
      return action.state;
  }
}

/** What the two contextual control slots do. Labels follow from the kind. */
export type PrimaryKind = 'listen' | 'stop-listening' | 'accept' | 'speak' | 'stop-speaking' | 'say-again';
export type SecondKind = 'delete' | 'one-moment' | 'menu';

export type Slots = {
  /** `word` is null when no word matches the typed groups: the slot is then disabled (a rest zone). */
  primary: { kind: PrimaryKind; word?: string | null; enabled: boolean };
  second: { kind: SecondKind; enabled: boolean };
  groupsEnabled: boolean;
};

/**
 * The two control slots. Q7 is Delete only while groups are pending (one look per mistyped group);
 * otherwise it is Menu, whose first page holds Other word, One moment, Listen and Recalibrate, so
 * every capability is within two looks while a message is being written.
 */
export function slots(state: State): Slots {
  const { mode, comp } = state;
  if (mode === 'listening') return { primary: { kind: 'stop-listening', enabled: true }, second: { kind: 'one-moment', enabled: !state.holding }, groupsEnabled: false };
  if (mode === 'speaking') return { primary: { kind: 'stop-speaking', enabled: true }, second: { kind: 'menu', enabled: false }, groupsEnabled: false };
  if (comp.pending.length) {
    const candidate = currentCandidate(comp, contextWords(state));
    return { primary: { kind: 'accept', word: candidate?.word ?? null, enabled: candidate !== null }, second: { kind: 'delete', enabled: true }, groupsEnabled: true };
  }
  if (comp.words.length) return { primary: { kind: 'speak', enabled: true }, second: { kind: 'menu', enabled: true }, groupsEnabled: true };
  if (mode === 'said') return { primary: { kind: 'say-again', enabled: true }, second: { kind: 'menu', enabled: true }, groupsEnabled: true };
  return { primary: { kind: 'listen', enabled: true }, second: { kind: 'menu', enabled: true }, groupsEnabled: true };
}

export const PRIMARY_LABEL: Record<PrimaryKind, string> = {
  listen: 'Listen',
  'stop-listening': 'Stop',
  accept: '',
  speak: 'Speak',
  'stop-speaking': 'Stop',
  'say-again': 'Say again',
};

export const SECOND_LABEL: Record<SecondKind, string> = {
  delete: 'Delete',
  'one-moment': 'One moment',
  menu: 'Menu',
};

/** Every distinct screen state, for clarteDebug and the layout check. */
export const PHASES = [
  'idle',
  'listening',
  'compose-pending',
  'compose-nomatch',
  'compose-words',
  'speaking',
  'said',
  'menu',
  'menu-more',
  'menu-display',
  'menu-selection',
  'menu-demo',
  'menu-phrases',
  'calib-position',
  'calib-points',
  'calib-validate',
  'calib-ready',
] as const;
export type Phase = (typeof PHASES)[number];

export function phaseOf(state: State): Phase {
  const { screen } = state;
  if (screen.kind === 'calibration') return `calib-${screen.step}`;
  if (screen.kind === 'menu') return screen.page === 'menu' ? 'menu' : `menu-${screen.page}`;
  if (state.mode === 'listening') return 'listening';
  if (state.mode === 'speaking') return 'speaking';
  if (state.comp.pending.length) return currentCandidate(state.comp, contextWords(state)) ? 'compose-pending' : 'compose-nomatch';
  if (state.comp.words.length) return 'compose-words';
  if (state.mode === 'said') return 'said';
  return 'idle';
}

export const DEMO_PARTNER = 'Do you want to go outside for a bit? It is sunny.';
export const DEMO_REPLY = ['yes', 'after', 'lunch', 'please'];

/** Type a word the way a person would: its groups, cycle to it if needed, accept. */
export function typeWord(comp: Composition, word: string, context: readonly string[]): Composition {
  let c = comp;
  for (const group of signatureOf(word)) c = reduce(c, { type: 'group', group }, context);
  for (let i = 0; i < 6 && currentCandidate(c, context)?.word !== word; i++) c = reduce(c, { type: 'next' }, context);
  return reduce(c, { type: 'accept' }, context);
}

/** A deterministic state for each phase, with real conversational content. */
export function fixture(phase: Phase, settings: Settings): State {
  const base: State = { ...INITIAL_STATE, settings };
  const context = contextWords({ partner: DEMO_PARTNER, comp: EMPTY_COMPOSITION });
  const words = (list: string[]) => list.reduce((c, w) => typeWord(c, w, context), EMPTY_COMPOSITION);
  const said = DEMO_REPLY.join(' ');
  switch (phase) {
    case 'idle': return base;
    case 'listening': return { ...base, mode: 'listening', partner: DEMO_PARTNER };
    case 'compose-pending': {
      // "outs" typed, "ide" predicted: the word in progress with its ghost remainder.
      let comp = words(['yes']);
      for (const group of signatureOf('outside').slice(0, 4)) comp = reduce(comp, { type: 'group', group }, context);
      return { ...base, partner: DEMO_PARTNER, comp };
    }
    case 'compose-nomatch': {
      let comp = words(['yes']);
      for (const group of ['G4', 'G4', 'G4'] as const) comp = reduce(comp, { type: 'group', group }, context);
      return { ...base, partner: DEMO_PARTNER, comp };
    }
    case 'compose-words': return { ...base, partner: DEMO_PARTNER, comp: words(['yes', 'after', 'lunch']) };
    case 'speaking': return { ...base, partner: DEMO_PARTNER, mode: 'speaking', spoken: said, spokenWord: 2 };
    case 'said': return { ...base, partner: DEMO_PARTNER, mode: 'said', spoken: said };
    case 'menu': return { ...base, partner: DEMO_PARTNER, comp: words(['yes', 'after']), screen: { kind: 'menu', page: 'menu' } };
    case 'menu-more': return { ...base, screen: { kind: 'menu', page: 'more' } };
    case 'menu-display': return { ...base, screen: { kind: 'menu', page: 'display' } };
    case 'menu-selection': return { ...base, screen: { kind: 'menu', page: 'selection' } };
    case 'menu-demo': return { ...base, screen: { kind: 'menu', page: 'demo' } };
    case 'menu-phrases': return { ...base, screen: { kind: 'menu', page: 'phrases' } };
    case 'calib-position': return { ...base, screen: { kind: 'calibration', step: 'position', frozen: true } };
    case 'calib-points': return { ...base, screen: { kind: 'calibration', step: 'points', frozen: true } };
    case 'calib-validate': return { ...base, screen: { kind: 'calibration', step: 'validate', frozen: true } };
    case 'calib-ready': return { ...base, screen: { kind: 'calibration', step: 'ready', frozen: true } };
  }
}

/** Display form of the message: sentence case, standalone "i" as "I". */
export function displayWord(text: string, index: number): string {
  if (text === 'i') return 'I';
  return index === 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
