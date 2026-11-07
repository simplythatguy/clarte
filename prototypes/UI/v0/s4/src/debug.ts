/**
 * `window.clarteDebug`: every distinct screen state of this style, reachable by name, so
 * `shared/check-layout.mjs` can walk them and assert the Backend Quadrant rule in each.
 */
import { EMPTY_COMPOSITION, currentCandidate, reduce as reduceComposition, type Composition } from '../../shared/composer.ts';
import { signatureOf } from '../../shared/decoder.ts';
import type { GazeEngine } from '../../shared/gaze.ts';
import { collectActionables, validateLayout, viewportOf, type Violation } from '../../shared/quadrants.ts';
import { INITIAL_STATE, contextWords, type Event, type State } from './model.ts';

export const DEMO_PARTNER = 'Are you hungry? I can make lunch now or later.';
const CONTEXT = DEMO_PARTNER.toLowerCase().match(/[a-z']+/g) ?? [];

/** Type words the way a person would: their groups, then accept; `fix` takes the next candidate. */
function typed(words: { word: string; fix?: boolean }[], pending = ''): Composition {
  let c = EMPTY_COMPOSITION;
  for (const { word, fix } of words) {
    for (const group of signatureOf(word)) c = reduceComposition(c, { type: 'group', group }, CONTEXT);
    c = reduceComposition(c, { type: 'accept' }, CONTEXT);
    if (fix) {
      c = reduceComposition(c, { type: 'delete' }, CONTEXT);
      c = reduceComposition(c, { type: 'accept' }, CONTEXT);
    }
  }
  for (const group of signatureOf(pending)) c = reduceComposition(c, { type: 'group', group }, CONTEXT);
  return c;
}

/** "Not now, maybe later": "not" decodes as "now" first (the partner said it), then Delete, Accept. */
const REPLY = [{ word: 'not', fix: true }, { word: 'now' }, { word: 'maybe' }];
const SAID = 'not now maybe later';

type Builder = (base: State) => State;
const talk = (s: State, patch: Partial<State>): State => ({ ...s, view: { kind: 'talk' }, ...patch });

export const PHASES: Record<string, Builder> = {
  idle: (s) => talk(s, { activity: { kind: 'ready' }, composition: EMPTY_COMPOSITION, partner: '' }),
  listening: (s) => talk(s, { activity: { kind: 'listening', scripted: true, held: true }, composition: EMPTY_COMPOSITION, partner: DEMO_PARTNER }),
  'composing-pending': (s) => talk(s, { activity: { kind: 'ready' }, partner: DEMO_PARTNER, composition: typed(REPLY, 'tomor') }),
  'composing-ready': (s) => talk(s, { activity: { kind: 'ready' }, partner: DEMO_PARTNER, composition: typed([...REPLY, { word: 'later' }]) }),
  // "Ruth" matches no word in the vocabulary: Q3 offers Spell instead of a candidate.
  'composing-unknown': (s) => talk(s, { activity: { kind: 'ready' }, partner: 'Who is coming to dinner tonight?', composition: typed([], 'ruth') }),
  'more-idle': (s) => ({ ...talk(s, { activity: { kind: 'ready' }, partner: DEMO_PARTNER, composition: EMPTY_COMPOSITION }), view: { kind: 'more' } }),
  more: (s) => ({ ...talk(s, { activity: { kind: 'ready' }, partner: DEMO_PARTNER, composition: typed([...REPLY, { word: 'later' }]) }), view: { kind: 'more' } }),
  speaking: (s) => talk(s, { activity: { kind: 'speaking', text: SAID, index: 2, started: true, held: true }, partner: DEMO_PARTNER, composition: typed([...REPLY, { word: 'later' }]) }),
  spoken: (s) => talk(s, { activity: { kind: 'spoken', text: SAID, held: true }, partner: DEMO_PARTNER, composition: EMPTY_COMPOSITION, said: SAID }),
  menu: (s) => ({ ...s, view: { kind: 'menu', page: 'root' }, activity: { kind: 'ready' } }),
  'menu-settings': (s) => ({ ...s, view: { kind: 'menu', page: 'settings' }, activity: { kind: 'ready' } }),
  'menu-settings-more': (s) => ({ ...s, view: { kind: 'menu', page: 'settings-more' }, activity: { kind: 'ready' } }),
  'menu-demo': (s) => ({ ...s, view: { kind: 'menu', page: 'demo' }, activity: { kind: 'ready' } }),
  'menu-phrases': (s) => ({ ...s, view: { kind: 'menu', page: 'phrases' }, activity: { kind: 'ready' } }),
  'menu-phrases-more': (s) => ({ ...s, view: { kind: 'menu', page: 'phrases-more' }, activity: { kind: 'ready' } }),
  spell: (s) => ({ ...s, view: { kind: 'spell', word: 'Nad', level: { kind: 'groups' }, from: 'menu' }, activity: { kind: 'ready' } }),
  'spell-pairs': (s) => ({ ...s, view: { kind: 'spell', word: 'Nad', level: { kind: 'chunks', group: 'G2' }, from: 'menu' }, activity: { kind: 'ready' } }),
  'spell-letters': (s) => ({ ...s, view: { kind: 'spell', word: 'Nad', level: { kind: 'letters', chunk: 'ij' }, from: 'menu' }, activity: { kind: 'ready' } }),
  'calibration-position': (s) => ({ ...s, view: { kind: 'calibration', step: 'position' }, activity: { kind: 'ready' } }),
  'calibration-points': (s) => ({ ...s, view: { kind: 'calibration', step: 'points' }, activity: { kind: 'ready' } }),
  'calibration-validate': (s) => ({ ...s, view: { kind: 'calibration', step: 'validate' }, activity: { kind: 'ready' } }),
  'calibration-ready': (s) => ({ ...s, view: { kind: 'calibration', step: 'ready' }, activity: { kind: 'ready' } }),
};

export function phaseOf(s: State): string {
  const v = s.view;
  if (v.kind === 'calibration') return `calibration-${v.step}`;
  if (v.kind === 'menu') return v.page === 'root' ? 'menu' : `menu-${v.page}`;
  if (v.kind === 'more') return s.composition.words.length ? 'more' : 'more-idle';
  if (v.kind === 'spell') return v.level.kind === 'groups' ? 'spell' : v.level.kind === 'chunks' ? 'spell-pairs' : 'spell-letters';
  const a = s.activity;
  if (a.kind !== 'ready') return a.kind;
  const c = s.composition;
  if (c.reopened) return 'composing-reopened';
  if (c.pending.length) return currentCandidate(c, contextWords(s)) ? 'composing-pending' : 'composing-unknown';
  if (c.words.length) return 'composing-ready';
  return 'idle';
}

export type ClarteDebug = {
  phases: string[];
  phase(): string;
  setPhase(name: string): void;
  validate(): Violation[];
  /** Change settings the way the Settings page does (text size, theme, ...). */
  settings(patch: Partial<State['settings']>): void;
  /** The current state, and a way to replace it (worst-case data for break-ui). */
  state(): State;
  replace(state: State): void;
  engine: GazeEngine;
};

export function installDebug(engine: GazeEngine, get: () => State, dispatch: (e: Event) => void): () => void {
  const api: ClarteDebug = {
    phases: Object.keys(PHASES),
    phase: () => phaseOf(get()),
    setPhase: (name) => {
      const build = PHASES[name];
      if (!build) throw new Error(`unknown phase ${name}; known: ${Object.keys(PHASES).join(', ')}`);
      dispatch({ type: 'replace', state: build({ ...INITIAL_STATE, settings: get().settings }) });
    },
    validate: () => validateLayout(collectActionables(), viewportOf()),
    settings: (patch) => dispatch({ type: 'settings', patch }),
    state: () => get(),
    replace: (state) => dispatch({ type: 'replace', state }),
    engine,
  };
  (window as unknown as { clarteDebug: ClarteDebug }).clarteDebug = api;
  // `?phase=composing-pending` opens a state directly (reviews, linting, screenshots).
  const requested = new URLSearchParams(location.search).get('phase');
  if (requested && PHASES[requested]) api.setPhase(requested);
  return () => { delete (window as unknown as { clarteDebug?: ClarteDebug }).clarteDebug; };
}
