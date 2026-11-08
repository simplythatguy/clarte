/**
 * Seeds for every distinct screen state, so `check-layout.mjs` can walk them all through
 * `window.clarteDebug.setPhase(name)`. Seeds use real conversational content and the real
 * composer and decoder, never a hand-built message.
 */
import { EMPTY_COMPOSITION, candidates, reduce, type Composition } from '../../shared/composer.ts';
import { signatureOf } from '../../shared/decoder.ts';
import { contextWords, type State, type Turn } from './model.ts';

export const PHASES = [
  'idle',
  'listening',
  'suggested',
  'composing-pending',
  'composing-reopened',
  'composing-branch',
  'composing-nomatch',
  'composing-ready',
  'speaking',
  'spoken',
  'menu',
  'menu-settings',
  'menu-settings-2',
  'menu-settings-3',
  'menu-demo',
  'worst-case',
  'worst-nomatch',
  'calibrate-position',
  'calibrate-points',
  'calibrate-validate',
  'calibrate-ready',
  'setup-eyes',
  'setup-voice',
  'setup-voice-sample',
  'setup-ready',
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

/** Type a word through the four groups and accept it, cycling to it if it is not the top guess. */
function typeWord(c: Composition, word: string, context: string[]): Composition {
  let next = c;
  for (const g of signatureOf(word)) next = reduce(next, { type: 'group', group: g }, context);
  const index = candidates(next, context).findIndex((x) => x.word === word);
  if (index < 0) return reduce(next, { type: 'accept' }, context);
  return reduce({ ...next, candidateIndex: index }, { type: 'accept' }, context);
}

function typeGroupsOf(c: Composition, word: string, context: string[]): Composition {
  let next = c;
  for (const g of signatureOf(word)) next = reduce(next, { type: 'group', group: g }, context);
  return next;
}

export function seedFor(name: PhaseName, base: State): State {
  const clean: State = { ...base, screen: { kind: 'talk' }, live: { kind: 'quiet' }, composition: EMPTY_COMPOSITION, dismissed: null };
  const talk = withTurns(clean, [...HISTORY, OUTSIDE]);
  const context = contextWords(talk);
  const message = (words: string[]) => words.reduce((c, w) => typeWord(c, w, context), EMPTY_COMPOSITION);
  switch (name) {
    case 'idle':
      return withTurns(clean, HISTORY);
    case 'listening':
      return { ...withTurns(clean, HISTORY), live: { kind: 'listening', transcript: 'Do you want to go outside for a bit? It is', token: 0 } };
    case 'suggested':
      return talk;
    case 'composing-pending':
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['i', 'would', 'love', 'to', 'go']), 'outs', context) };
    case 'composing-reopened':
      return { ...talk, dismissed: talk.nextId - 1, composition: reduce(message(['i', 'would', 'love', 'to', 'go']), { type: 'delete' }, context) };
    case 'composing-branch':
      // "I might" / "I night": two whole words, close in frequency, neither used in the conversation.
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['i']), 'might', context) };
    case 'composing-nomatch':
      return { ...talk, dismissed: talk.nextId - 1, composition: typeGroupsOf(message(['ask']), 'suzy', context) };
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
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'settings' } };
    case 'menu-settings-2':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'settings-2' } };
    case 'menu-settings-3':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'settings-3' } };
    case 'menu-demo':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'demo' } };
    case 'worst-case': {
      const worst = withTurns(clean, WORST);
      const ctx = contextWords(worst);
      const words = ['really', 'uncomfortable', 'physiotherapist', 'everything', 'temperature'].reduce((c, w) => typeWord(c, w, ctx), EMPTY_COMPOSITION);
      return { ...worst, dismissed: worst.nextId - 1, composition: typeGroupsOf(words, 'disappointed', ctx) };
    }
    case 'worst-nomatch': {
      const worst = withTurns(clean, WORST);
      const ctx = contextWords(worst);
      return { ...worst, dismissed: worst.nextId - 1, composition: typeGroupsOf(typeWord(EMPTY_COMPOSITION, 'ask', ctx), 'wojciechowski', ctx) };
    }
    case 'calibrate-position':
      return { ...clean, screen: { kind: 'calibration', step: 'position' } };
    case 'calibrate-points':
      return { ...clean, screen: { kind: 'calibration', step: 'points' } };
    case 'calibrate-validate':
      return { ...clean, screen: { kind: 'calibration', step: 'validate' } };
    case 'calibrate-ready':
      return { ...clean, screen: { kind: 'calibration', step: 'ready' } };
    case 'setup-eyes':
      return { ...clean, screen: { kind: 'setup', step: 'eyes' } };
    case 'setup-voice':
      return { ...clean, screen: { kind: 'setup', step: 'voice' } };
    case 'setup-voice-sample':
      return { ...clean, screen: { kind: 'setup', step: 'voice', sample: true } };
    case 'setup-ready':
      return { ...clean, screen: { kind: 'setup', step: 'ready' } };
  }
}
