/**
 * Fixtures for `window.clarteDebug`: every distinct screen of the style, with real conversation
 * content, so `shared/check-layout.mjs` can walk them all and screenshot each.
 */
import { EMPTY_COMPOSITION, reduce, type Composition } from '../../shared/composer.ts';
import { signatureOf } from '../../shared/decoder.ts';
import { DEMO_UTTERANCES } from '../../shared/speech.ts';
import { MENU_PAGE_IDS, displayWords, type MenuPage, type Stage } from './model.ts';

/**
 * `?data=worst` (dev and review only) swaps the demo content for the realistic worst case from
 * break-ui: a long partner turn, the vocabulary's longest words, and a long name to spell.
 */
const WORST = typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 'worst';
const PARTNER = WORST
  ? 'The physiotherapist said your wheelchair appointment moved to tomorrow afternoon, and the nurse wondered whether you would rather stay inside because it might rain, or go outside to the garden before dinner?'
  : DEMO_UTTERANCES[1]; // "Do you want to go outside for a bit? It is sunny."
const REPLY = WORST
  ? ['i', 'feel', 'uncomfortable', 'today', 'because', 'everything', 'hurts', 'and', 'i', 'would', 'prefer', 'to', 'stay', 'inside', 'tomorrow', 'afternoon']
  : ['yes', 'i', 'would', 'love', 'that'];
const PENDING = WORST ? 'uncomfortable' : 'love';
const SPELLED = WORST ? 'wisniewska' : 'mar';

const menuPhase = (page: MenuPage) => `menu-${page}`;

export const PHASES: string[] = [
  'calibrate-position', 'calibrate-points', 'calibrate-validate', 'calibrate-ready',
  'listen',
  'compose-empty', 'compose-pending', 'compose-message',
  'speak', 'speaking', 'spoken',
  'spell', 'spell-letters',
  ...MENU_PAGE_IDS.map(menuPhase),
];

function typed(words: string[], pendingWord?: string): Composition {
  const context = PARTNER.toLowerCase().split(/[^a-z']+/);
  let c = EMPTY_COMPOSITION;
  for (const w of words) {
    for (const g of signatureOf(w)) c = reduce(c, { type: 'group', group: g }, context);
    // Pick the intended word among the candidates, as a person would by delete-and-accept.
    while (true) {
      const next = reduce(c, { type: 'accept' }, context);
      if (next.words[next.words.length - 1]?.text === w) { c = next; break; }
      const cycled = reduce(c, { type: 'next' }, context);
      if (cycled.candidateIndex === 0) { c = next; break; }
      c = cycled;
    }
  }
  if (pendingWord) for (const g of signatureOf(pendingWord)) c = reduce(c, { type: 'group', group: g }, context);
  return c;
}

type Fixture = {
  model: { stage: Stage; composition: Composition; turn: string; said: string; turns: number; spelled?: string };
  frozenAt?: number;
  voiceWord?: number;
};

export function fixtureFor(name: string): Fixture | null {
  const base = { composition: EMPTY_COMPOSITION, turn: PARTNER, said: '', turns: 1 };
  const message = typed(REPLY);
  const said = displayWords(message.words).join(' ');
  switch (name) {
    case 'calibrate-position': return { model: { ...base, turn: '', stage: { kind: 'calibrate', step: 'position' } }, frozenAt: 0 };
    case 'calibrate-points': return { model: { ...base, turn: '', stage: { kind: 'calibrate', step: 'points' } }, frozenAt: 4 };
    case 'calibrate-validate': return { model: { ...base, turn: '', stage: { kind: 'calibrate', step: 'validate' } }, frozenAt: 1 };
    case 'calibrate-ready': return { model: { ...base, turn: '', stage: { kind: 'calibrate', step: 'ready' } }, frozenAt: 0 };
    case 'listen': return { model: { ...base, stage: { kind: 'listen' } } };
    case 'compose-empty': return { model: { ...base, stage: { kind: 'compose' } } };
    case 'compose-pending': return { model: { ...base, stage: { kind: 'compose' }, composition: typed(REPLY.slice(0, 3), PENDING) } };
    case 'compose-message': return { model: { ...base, stage: { kind: 'compose' }, composition: message } };
    case 'speak': return { model: { ...base, stage: { kind: 'speak' }, composition: message } };
    case 'speaking': return { model: { ...base, stage: { kind: 'speaking' }, composition: message, said }, voiceWord: 2 };
    case 'spoken': return { model: { ...base, stage: { kind: 'spoken' }, composition: message, said } };
    case 'spell': return { model: { ...base, stage: { kind: 'spell', group: null, half: 0 }, composition: message, spelled: SPELLED } };
    case 'spell-letters': return { model: { ...base, stage: { kind: 'spell', group: 'G2', half: 0 }, composition: message, spelled: SPELLED } };
  }
  const page = MENU_PAGE_IDS.find((id) => menuPhase(id) === name);
  if (page) return { model: { ...base, stage: { kind: 'menu', page, from: 'compose' }, composition: message } };
  return null;
}

export function phaseName(stage: Stage, c: Composition): string {
  switch (stage.kind) {
    case 'calibrate': return `calibrate-${stage.step}`;
    case 'menu': return menuPhase(stage.page);
    case 'spell': return stage.group ? 'spell-letters' : 'spell';
    case 'compose': return c.pending.length ? 'compose-pending' : c.words.length ? 'compose-message' : 'compose-empty';
    default: return stage.kind;
  }
}
