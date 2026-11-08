/**
 * Seeds for every distinct screen state, so `check-layout.mjs` can walk them all through
 * `window.clarteDebug.setPhase(name)`. Seeds use real conversational content and the real
 * composer. The word shown comes from the engine (or the local decoder); a phase that depends on
 * a particular answer (a branch, no match) seeds the prediction cache for its request.
 */
import { EMPTY_COMPOSITION, reduce, type Composition } from '../../shared/composer.ts';
import { signatureOf, type GroupId } from '../../shared/decoder.ts';
import { chooserRequestOf, requestOf, type State, type Turn } from './model.ts';
import { seed } from './prediction.ts';

export const PHASES = [
  'idle',
  'hearing',
  'hearing-typing',
  'composing-pending',
  'composing-reopened',
  'composing-branch',
  'composing-nomatch',
  'composing-slip',
  'composing-ready',
  'done',
  'other-words',
  'other-words-few',
  'speaking',
  'spoken',
  'menu',
  'menu-settings',
  'menu-settings-2',
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
const HEARING = 'Do you want to go outside for a bit? It is';

function withTurns(base: State, turns: Omit<Turn, 'id'>[]): State {
  return { ...base, turns: turns.map((t, i) => ({ ...t, id: i + 1 })), nextId: turns.length + 1 };
}

/** A message of accepted words, each remembering the groups that typed it. */
function message(words: string[]): Composition {
  return { words: words.map((text) => ({ text, groups: signatureOf(text), candidateIndex: 0, source: 'decoded' as const })), pending: [], candidateIndex: 0, reopened: false };
}

function typeGroupsOf(c: Composition, word: string): Composition {
  let next = c;
  for (const g of signatureOf(word)) next = reduce(next, { type: 'group', group: g });
  return next;
}

export function seedFor(name: PhaseName, base: State): State {
  const clean: State = { ...base, screen: { kind: 'talk' }, live: { kind: 'quiet' }, hearing: '', composition: EMPTY_COMPOSITION };
  const talk = withTurns(clean, [...HISTORY, OUTSIDE]);
  switch (name) {
    case 'idle':
      return withTurns(clean, HISTORY);
    case 'hearing':
      return { ...withTurns(clean, HISTORY), hearing: HEARING };
    case 'hearing-typing':
      return { ...withTurns(clean, HISTORY), hearing: HEARING, composition: typeGroupsOf(message(['yes']), 'ple') };
    case 'composing-pending':
      return { ...talk, composition: typeGroupsOf(message(['i', 'would', 'love', 'to', 'go']), 'outs') };
    case 'composing-reopened':
      return { ...talk, composition: { ...message(['i', 'would', 'love', 'to']), pending: signatureOf('go'), candidateIndex: 1, reopened: true } };
    case 'composing-branch': {
      // "I might" / "I night": two whole words, close in probability. The engine decides this in
      // use; the phase seeds its answer so the layout check always sees the branch.
      const state = { ...talk, composition: typeGroupsOf(message(['i']), 'might') };
      seed(requestOf(state), {
        words: [{ word: 'might', p: 0.42, complete: true }, { word: 'night', p: 0.31, complete: true }, { word: 'mighty', p: 0.06, complete: false }, { word: 'nights', p: 0.04, complete: false }],
        total: 4, longer: 0.1, offset: 0, source: 'engine',
      });
      return state;
    }
    case 'composing-nomatch': {
      // Nothing matches and nothing is one digit off either: Q1 says No word (the engine never
      // answers like this for a real code, but the layout must hold).
      const state = { ...talk, composition: typeGroupsOf(message(['ask']), 'suzy') };
      seed(requestOf(state), { words: [], total: 0, longer: 0, offset: 0, source: 'engine' });
      return state;
    }
    case 'composing-slip': {
      // "suzy" typed with one slip (its third group read as O–S): nothing matches, so Q1 offers the
      // engine's correction; the slipped letter wears its own group's colour in the message.
      const state = { ...talk, composition: { ...message(['ask']), pending: ['G3', 'G4', 'G3', 'G4'] as GroupId[], candidateIndex: 0, reopened: false } };
      seed(requestOf(state), { words: [], total: 0, longer: 0, offset: 0, source: 'engine', fallback: { word: 'suzy', kind: 'corrected' } });
      return state;
    }
    case 'composing-ready':
      return { ...talk, composition: message(['i', 'would', 'love', 'to', 'go']) };
    case 'done':
      return { ...talk, screen: { kind: 'done' }, composition: message(['i', 'would', 'love', 'to', 'go']) };
    case 'other-words': {
      // Other words for "go" (code 23): the first page of four exact-length words, with More.
      const state: State = { ...talk, screen: { kind: 'other', page: 0 }, composition: message(['i', 'would', 'love', 'to', 'go']) };
      seed(chooserRequestOf(state, 0), { words: [['go', 0.5], ['no', 0.2], ['ho', 0.03], ['jo', 0.02]].map(([word, p]) => ({ word: word as string, p: p as number, complete: true })), total: 9, longer: 0, offset: 0, source: 'engine' });
      return state;
    }
    case 'other-words-few': {
      // A code with three exact-length words: no More, and the fourth quadrant rests.
      const state: State = { ...talk, screen: { kind: 'other', page: 0 }, composition: message(['i', 'would', 'love', 'to', 'go', 'outside']) };
      seed(chooserRequestOf(state, 0), { words: [['outside', 0.9], ['outsize', 0.05], ['spurted', 0.01]].map(([word, p]) => ({ word: word as string, p: p as number, complete: true })), total: 3, longer: 0, offset: 0, source: 'engine' });
      return state;
    }
    case 'speaking':
      return { ...talk, live: { kind: 'speaking', text: 'I would love to go', word: 2, turnId: null, token: 0, draft: message(['i', 'would', 'love', 'to', 'go']) } };
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
    case 'menu-demo':
      return { ...withTurns(clean, HISTORY), screen: { kind: 'menu', page: 'demo' } };
    case 'worst-case': {
      const worst = withTurns(clean, WORST);
      const state = { ...worst, composition: typeGroupsOf(message(['really', 'uncomfortable', 'physiotherapist', 'everything', 'temperature']), 'disappointed') };
      seed(requestOf(state), { words: [{ word: 'disappointed', p: 0.6, complete: true }, { word: 'disappointing', p: 0.2, complete: false }], total: 2, longer: 0.2, offset: 0, source: 'engine' });
      return state;
    }
    case 'worst-nomatch': {
      const worst = withTurns(clean, WORST);
      const state = { ...worst, composition: typeGroupsOf(message(['ask']), 'wojciechowski') };
      seed(requestOf(state), { words: [], total: 0, longer: 0, offset: 0, source: 'engine' });
      return state;
    }
    case 'calibrate-position':
      return { ...clean, screen: { kind: 'calibration', step: 'position', from: { kind: 'talk' } } };
    case 'calibrate-points':
      return { ...clean, screen: { kind: 'calibration', step: 'points', from: { kind: 'talk' } } };
    case 'calibrate-validate':
      return { ...clean, screen: { kind: 'calibration', step: 'validate', from: { kind: 'talk' } } };
    case 'calibrate-ready':
      return { ...clean, screen: { kind: 'calibration', step: 'ready', from: { kind: 'talk' } } };
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
