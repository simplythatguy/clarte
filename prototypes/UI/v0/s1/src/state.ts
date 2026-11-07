/**
 * The conversation as one state machine.
 *
 * `flow` is the R1/R2 cycle the Q1 tile walks through (Listen → Pause → Respond → End). Speaking
 * is layered on top of the flow because the message, the page and the flow must all survive it.
 * Every change comes from a selection (`act`) or from the voice finishing; nothing advances on
 * a timer.
 */
import { EMPTY_COMPOSITION, messageText, reduce as compose, type Composition, type Word } from '../../shared/composer.ts';
import { DEMO_UTTERANCES } from '../../shared/speech.ts';
import { signatureOf, type GroupId } from '../../shared/decoder.ts';

export type Flow = 'idle' | 'listening' | 'paused' | 'composing';
export type Screen = 'main' | 'menu' | 'menu-selection' | 'menu-display' | 'menu-phrases';
export type CalibrationStep = 'position' | 'points' | 'validate' | 'ready';
export type SpeechOrigin = 'end' | 'speak' | 'again' | 'floor';

export type Speaking = { id: number; text: string; words: string[]; index: number; origin: SpeechOrigin; resumeListening: boolean };

export type AppState = {
  flow: Flow;
  page: 1 | 2;
  screen: Screen;
  calibration: CalibrationStep | null;
  composition: Composition;
  /** The partner's latest turn: live while listening, kept as context afterwards. */
  transcript: string;
  /** How many listening sessions have started; picks the next scripted partner line. */
  turns: number;
  speaking: Speaking | null;
  /** The message text as last spoken, so End does not speak the same words twice. */
  spokenText: string | null;
  /** The word that was just decoded, for the token-to-word cross-fade. */
  lastDecoded: { index: number; groups: GroupId[]; key: number } | null;
  /** The voice failed to play the last message; shown until the next selection. */
  voiceFailed: boolean;
  /** Set by the layout checker: hold the screen still, start no voice or microphone. */
  frozen: boolean;
};

export const FLOOR_HOLDER = 'One moment, I’m answering.';

export const PHRASES = [
  'Yes',
  'No',
  'Thank you',
  'Give me a minute',
  'Can you say that again?',
  'I need a break',
  'I’m in pain',
] as const;

export const INITIAL_STATE: AppState = {
  flow: 'idle',
  page: 1,
  screen: 'main',
  calibration: null,
  composition: EMPTY_COMPOSITION,
  transcript: '',
  turns: 0,
  speaking: null,
  spokenText: null,
  lastDecoded: null,
  voiceFailed: false,
  frozen: false,
};

export type Event =
  | { type: 'act'; action: string }
  | { type: 'transcript'; text: string }
  | { type: 'speech-word'; id: number; index: number }
  | { type: 'speech-end'; id: number; ok: boolean }
  | { type: 'calibration-step'; step: CalibrationStep }
  | { type: 'skip-calibration' }
  | { type: 'restore'; state: AppState };

export function contextWords(state: AppState): string[] {
  return state.transcript.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
}

export function message(state: AppState): string {
  return messageText(state.composition);
}

/** Page 2 offers Say again in Speak's place while the message is exactly what was last spoken. */
export function offersSayAgain(state: AppState): boolean {
  const text = message(state);
  return !state.speaking && text !== '' && text === state.spokenText;
}

let speechId = 0;
function startSpeaking(state: AppState, text: string, origin: SpeechOrigin): AppState {
  speechId += 1;
  return {
    ...state,
    // The microphone never records the device's own voice: speaking pauses listening, and the
    // floor-holder (said mid-turn) resumes it afterwards.
    flow: state.flow === 'listening' ? 'paused' : state.flow,
    speaking: { id: speechId, text, words: text.split(/\s+/).filter(Boolean), index: -1, origin, resumeListening: state.flow === 'listening' },
  };
}

/**
 * What happens when speech finishes or is stopped, by where it was started. End clears the
 * message only once it has been heard in full; stopping End's speech keeps the message and
 * returns to composing. Speak and Say again stay on page 2 so repair is one look away.
 */
function finishSpeaking(state: AppState, stopped: boolean, failed = false): AppState {
  const speaking = state.speaking;
  const origin = speaking?.origin;
  const resumed: Flow = speaking?.resumeListening ? 'listening' : state.flow;
  const base = { ...state, speaking: null };
  // A voice that failed said nothing: keep the message (and what was last heard in full) and put
  // Speak one look away.
  if (failed) return { ...base, flow: origin === 'end' ? 'composing' : resumed, page: origin === 'floor' ? 1 : 2, voiceFailed: true };
  if (origin === 'floor') return { ...base, flow: resumed, page: 1 };
  // Only speech heard to the end counts as said; a stopped message stays unsaid.
  if (stopped) return origin === 'end' ? { ...base, flow: 'composing' } : base;
  if (origin === 'end') return { ...base, flow: 'idle', page: 1, composition: EMPTY_COMPOSITION, spokenText: null, lastDecoded: null };
  return { ...base, spokenText: speaking?.text ?? state.spokenText };
}

function composeEvent(state: AppState, event: Parameters<typeof compose>[1]): AppState {
  const composition = compose(state.composition, event, contextWords(state));
  const decoded = event.type === 'accept' && composition.words.length > state.composition.words.length;
  return {
    ...state,
    composition,
    lastDecoded: decoded ? { index: composition.words.length - 1, groups: state.composition.pending, key: Date.now() } : state.lastDecoded,
  };
}

export function reducer(state: AppState, event: Event): AppState {
  switch (event.type) {
    case 'restore': return event.state;
    // The device's own voice is never the partner's turn.
    case 'transcript': return state.speaking || state.flow !== 'listening' ? state : { ...state, transcript: event.text };
    case 'speech-word':
      return state.speaking?.id === event.id ? { ...state, speaking: { ...state.speaking, index: event.index } } : state;
    case 'speech-end':
      return state.speaking?.id === event.id ? finishSpeaking(state, false, !event.ok) : state;
    case 'calibration-step': return { ...state, calibration: event.step };
    case 'skip-calibration': return { ...state, calibration: null };
    case 'act': return { ...act({ ...state, voiceFailed: false }, event.action), frozen: false };
  }
}

function act(state: AppState, action: string): AppState {
  // The candidate's action id names its word (autocomplete:good), so a candidate that changes
  // under a preview is a new target and the engine cancels the preview instead of accepting it.
  if (action.startsWith('autocomplete:')) return composeEvent(state, { type: 'accept' });
  if (/^G[1-4]$/.test(action)) return composeEvent(state, { type: 'group', group: action as GroupId });
  if (action.startsWith('phrase-')) {
    const text = PHRASES[Number(action.slice(7))];
    // Land on page 2, so Speak is the next look.
    return { ...composeEvent(state, { type: 'phrase', text }), flow: 'composing', screen: 'main', page: 2 };
  }
  switch (action) {
    case 'mode':
      switch (state.flow) {
        case 'idle': return { ...state, flow: 'listening', transcript: '', turns: state.turns + 1 };
        case 'listening': return { ...state, flow: 'paused' };
        case 'paused': return { ...state, flow: 'composing' };
        case 'composing': {
          // End is inert while groups are pending (see screens.tsx); never drop typed input.
          if (state.composition.pending.length) return state;
          const text = message(state);
          if (text && text !== state.spokenText) return startSpeaking(state, text, 'end');
          return { ...state, flow: 'idle', composition: EMPTY_COMPOSITION, spokenText: null, lastDecoded: null };
        }
      }
      return state;
    case 'stop': return state.speaking ? finishSpeaking(state, true) : state;
    case 'delete': return composeEvent(state, { type: 'delete' });
    case 'flip': return { ...state, page: state.page === 1 ? 2 : 1 };
    case 'speak': return message(state) ? startSpeaking(state, message(state), 'speak') : state;
    case 'again': return startSpeaking(state, state.spokenText ?? message(state), 'again');
    case 'moment': return startSpeaking(state, FLOOR_HOLDER, 'floor');
    case 'menu': return { ...state, screen: 'menu', page: 1 };
    case 'back': return { ...state, screen: state.screen === 'menu' ? 'main' : 'menu' };
    case 'open-phrases': return { ...state, screen: 'menu-phrases' };
    case 'open-selection': return { ...state, screen: 'menu-selection' };
    case 'open-display': return { ...state, screen: 'menu-display' };
    case 'clear': return { ...state, composition: EMPTY_COMPOSITION, spokenText: null, lastDecoded: null, screen: 'main' };
    // Calibration hides the recording indicator, so it never runs with the microphone on.
    case 'recalibrate': return { ...state, screen: 'main', calibration: 'position', flow: state.flow === 'listening' ? 'paused' : state.flow };
    case 'calib-start': return { ...state, calibration: null };
  }
  return state;
}

/** The name of the screen state, for the layout checker and the developer overlay. */
export function phaseOf(state: AppState): string {
  if (state.calibration) return `calib-${state.calibration}`;
  if (state.screen !== 'main') return state.screen;
  if (state.speaking) return 'speaking';
  if (state.page === 2) return offersSayAgain(state) ? 'say-again' : 'page2';
  if (state.flow === 'composing') return state.composition.pending.length ? 'composing-pending' : 'composing-empty';
  return state.flow;
}

export const PHASES = [
  'calib-position', 'calib-points', 'calib-validate', 'calib-ready',
  'idle', 'listening', 'paused', 'composing-pending', 'composing-empty',
  'page2', 'speaking', 'say-again',
  'menu', 'menu-selection', 'menu-display', 'menu-phrases',
  // Worst-case data (break-ui): a long partner turn, a three-line message and the longest word
  // the vocabulary knows; and a word in progress with no candidate at all.
  'worst-long', 'worst-nomatch',
] as const;

const decodedWord = (text: string): Word => ({ text, groups: signatureOf(text), candidateIndex: 0, source: 'decoded' });

/** A still, representative state for each phase, built from a real exchange. */
export function presetFor(phase: string): AppState {
  const partner = DEMO_UTTERANCES[0];
  const base: AppState = { ...INITIAL_STATE, frozen: true, turns: 1 };
  const replied: AppState = {
    ...base,
    flow: 'composing',
    transcript: partner,
    composition: { words: ['tired', 'but', 'good'].map(decodedWord), pending: [], candidateIndex: 0, reopened: false },
  };
  switch (phase) {
    case 'calib-position': return { ...base, calibration: 'position' };
    case 'calib-points': return { ...base, calibration: 'points' };
    case 'calib-validate': return { ...base, calibration: 'validate' };
    case 'calib-ready': return { ...base, calibration: 'ready' };
    case 'idle': return base;
    case 'listening': return { ...base, flow: 'listening', transcript: partner };
    case 'paused': return { ...base, flow: 'paused', transcript: partner };
    case 'composing-pending':
      return { ...replied, composition: { words: ['tired', 'but'].map(decodedWord), pending: signatureOf('good'), candidateIndex: 0, reopened: false } };
    case 'composing-empty': return replied;
    case 'page2': return { ...replied, page: 2 };
    case 'speaking': {
      const text = message(replied);
      return { ...replied, page: 2, speaking: { id: -1, text, words: text.split(' '), index: 1, origin: 'speak', resumeListening: false } };
    }
    case 'say-again': return { ...replied, page: 2, spokenText: message(replied) };
    case 'menu': case 'menu-selection': case 'menu-display': case 'menu-phrases':
      return { ...replied, screen: phase };
    case 'worst-long':
      return {
        ...replied,
        transcript: 'The physiotherapist rang this morning and said the appointment on Thursday has moved to half past three, and she wants to know whether you would rather do the exercises at home or come in, because the car park is closed until next week.',
        composition: {
          words: ['i', 'am', 'uncomfortable', 'today', 'and', 'disappointed', 'about', 'the', 'appointment', 'but', 'please', 'tell', 'the'].map(decodedWord),
          pending: signatureOf('physiotherapist'),
          candidateIndex: 0,
          reopened: false,
        },
      };
    case 'worst-nomatch':
      return { ...replied, composition: { ...replied.composition, pending: ['G4', 'G4', 'G4', 'G4'] } };
  }
  return base;
}
