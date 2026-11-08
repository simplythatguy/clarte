/**
 * Seeds for every distinct screen state, so `check-layout.mjs` can walk them all through
 * `window.clarteDebug.setPhase(name)`. Seeds use real conversational content and the real
 * composer and decoder, never a hand-built message.
 */
import { EMPTY_COMPOSITION, acceptWord, reduce, type Composition } from './core/composer.ts';
import { signatureOf } from './core/decoder.ts';
import { optionsRequestOf, requestOf, type MenuPage, type State, type Turn, type VoiceStep } from './model.ts';
import { type MakerState } from './myvoice/maker.ts';
import { predictLocal } from './prediction/local.ts';
import { optionsOf } from './words.ts';

/**
 * What the recording session shows in each voice phase (App passes it to `showMaker`): a session
 * three sentences in, recording the fourth, and a voice made from 52 s.
 */
export function makerFor(name: PhaseName): Partial<MakerState> | null {
  const takes = { ah: 4.2, 'cape-1': 3.1, 'cape-2': 2.6 };
  const made = { id: 'sample', name: 'My voice', source: 'current' as const, status: 'ready' as const, createdAt: 0, updatedAt: 0, problems: [], reference: { seconds: 52, segments: [] } };
  switch (name) {
    case 'voice-record': return { mic: true, index: 3, takes, recording: null, error: null, made: null };
    case 'voice-recording': return { mic: true, index: 3, takes, recording: 7.4, error: null, made: null };
    case 'voice-ready': return { mic: false, made, error: null };
    case 'voice-error': return { mic: false, error: 'The voice service answered 502.', made: null };
    default: return name.startsWith('voice') ? { mic: false, index: 0, takes: {}, recording: null, error: null, made: null } : null;
  }
}

export const PHASES = [
  'idle',
  'listening',
  'suggested',
  'composing-pending',
  'composing-reopened',
  'composing-options',
  'composing-options-b',
  'composing-nomatch',
  'composing-ready',
  'speaking',
  'spoken',
  'menu',
  'menu-settings',
  'menu-appearance',
  'menu-sound',
  'menu-dev-tools',
  'options',
  'options-many',
  'options-many-end',
  'worst-case',
  'worst-nomatch',
  'welcome',
  'voice',
  'voice-consent',
  'voice-record',
  'voice-recording',
  'voice-files',
  'voice-making',
  'voice-ready',
  'voice-need-more',
  'voice-error',
  'menu-voice',
] as const;

export type PhaseName = (typeof PHASES)[number];

const HISTORY: Omit<Turn, 'id'>[] = [
  { who: 'partner', text: 'Hey, how are you feeling this morning?' },
  { who: 'me', text: "I'm okay, thanks" },
  { who: 'partner', text: 'Did you sleep at all?' },
  { who: 'me', text: 'Not much. My back hurts' },
];
/** break-ui: the longest realistic content the screen must hold. */
const WORST: Omit<Turn, 'id'>[] = [
  { who: 'partner', text: 'Hm?' },
  { who: 'me', text: 'Ok' },
  { who: 'partner', text: 'So the physiotherapist called again this morning and said your appointment moved from Tuesday to Thursday afternoon, and your grandmother wants to come with us too, is that alright with you or would you rather I tell her another time when you are feeling more comfortable?' },
];

const OUTSIDE: Omit<Turn, 'id'> = { who: 'partner', text: 'Do you want to go outside for a bit? It is sunny.' };

function withTurns(base: State, turns: Omit<Turn, 'id'>[]): State {
  return { ...base, turns: turns.map((t, i) => ({ ...t, id: i + 1 })), nextId: turns.length + 1 };
}

/** Type a word through the four groups and accept it. */
function typeWord(c: Composition, word: string): Composition {
  return acceptWord(typeGroupsOf(c, word), word, 0);
}

function typeGroupsOf(c: Composition, word: string): Composition {
  let next = c;
  for (const g of signatureOf(word)) next = reduce(next, { type: 'group', group: g });
  return next;
}

function withOptions(state: State, at: number): State {
  const words = optionsOf(state.composition, predictLocal(requestOf(state)), predictLocal(optionsRequestOf(state)));
  return { ...state, screen: { kind: 'options', at, words } };
}

export function seedFor(name: PhaseName, base: State): State {
  const clean: State = { ...base, screen: { kind: 'talk' }, live: { kind: 'quiet' }, composition: EMPTY_COMPOSITION, dismissed: null };
  const talk = withTurns(clean, [...HISTORY, OUTSIDE]);
  const message = (words: string[]) => words.reduce((c, w) => typeWord(c, w), EMPTY_COMPOSITION);
  switch (name) {
    case 'idle':
      return withTurns(clean, HISTORY);
    case 'listening':
      return { ...withTurns(clean, HISTORY), live: { kind: 'listening', transcript: 'Do you want to go outside for a bit? It is', token: 0 } };
    case 'suggested':
      return talk;
    case 'composing-pending':
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['i', 'would', 'love', 'to', 'go']), 'outs') };
    case 'composing-reopened':
      return { ...talk, dismissed: talk.nextId - 1, composition: reduce(message(['i', 'would', 'love', 'to', 'go']), { type: 'delete' }) };
    case 'composing-options':
      // "I might": might, night, light and limit fit the same groups, the first two about equally well.
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['i']), 'might') };
    case 'composing-options-b':
      // "I good": good, more, lose and hope fit the same groups.
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['i']), 'good') };
    case 'options':
      return withOptions({ ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['in', 'how']), 'been') }, 0);
    case 'options-many':
    case 'options-many-end':
      // "game": seven whole words (make, game, hand, half, name, land, lend), so the list pages.
      return withOptions({ ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['lets', 'play', 'a']), 'game') }, name === 'options-many' ? 0 : 99);
    case 'composing-nomatch':
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['ask']), 'suzy') };
    case 'composing-ready':
      return { ...talk, dismissed: talk.nextId - 1, composition: message(['i', 'would', 'love', 'to', 'go']) };
    case 'speaking':
      return { ...talk, dismissed: talk.nextId - 1, live: { kind: 'speaking', text: 'I would love to go', word: 2, turnId: null, holder: false, token: 0, draft: message(['i', 'would', 'love', 'to', 'go']) } };
    case 'spoken': {
      const spoken = withTurns(clean, [...HISTORY, OUTSIDE, { who: 'me', text: 'I would love to go' }]);
      return { ...spoken, live: { kind: 'spoken', turnId: spoken.nextId - 1 } };
    }
    case 'menu':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'main' } };
    case 'menu-settings':
    case 'menu-appearance':
    case 'menu-sound':
    case 'menu-dev-tools':
    case 'menu-voice':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: name.slice(5) as MenuPage } };
    case 'worst-case': {
      const worst = withTurns(clean, WORST);
      const words = ['really', 'uncomfortable', 'physiotherapist', 'everything', 'temperature'].reduce((c, w) => typeWord(c, w), EMPTY_COMPOSITION);
      return { ...worst, dismissed: worst.nextId - 1, composition: typeGroupsOf(words, 'disappointed') };
    }
    case 'worst-nomatch': {
      const worst = withTurns(clean, WORST);
      return { ...worst, dismissed: worst.nextId - 1, composition: typeGroupsOf(typeWord(EMPTY_COMPOSITION, 'ask'), 'wojciechowski') };
    }
    case 'welcome':
      return { ...clean, screen: { kind: 'welcome' } };
    case 'voice':
      return { ...clean, screen: { kind: 'voice', step: 'intro', source: 'current', from: 'first-run' } };
    case 'voice-consent':
    case 'voice-record':
    case 'voice-files':
    case 'voice-making':
    case 'voice-ready':
    case 'voice-need-more':
    case 'voice-error':
      return { ...clean, screen: { kind: 'voice', step: name.slice(6) as VoiceStep, source: name === 'voice-files' ? 'past' : 'current', from: 'first-run' } };
    case 'voice-recording':
      return { ...clean, screen: { kind: 'voice', step: 'record', source: 'current', from: 'first-run' } };
  }
}
