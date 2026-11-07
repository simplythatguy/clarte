/**
 * Which tile owns which backend quadrant, for every screen state. One function per screen, each
 * returning the top rail (Q1–Q4), the bottom rail (Q5–Q8) and what the middle band shows.
 *
 * Fixed positions: Q1 is always the conversation state (Listen, Pause, Respond, End, Stop) on
 * page 1 and Speak / Say again on page 2; Q4 is always navigation (the flip arrow, or back in a
 * menu); Q5–Q8 are always the four letter groups while composing.
 */
import type { ReactNode } from 'react';
import { currentCandidate, pendingGlyphs } from '../../shared/composer.ts';
import { GROUPS } from '../../shared/decoder.ts';
import { valueLabel, type SettingKey, type Settings } from './settings.ts';
import { PHRASES, contextWords, message, offersSayAgain, type AppState } from './state.ts';
import { Message, type BandState, type RailSlots, type TileSpec, type Visibility } from './ui.tsx';
import type { IconName } from './icons.tsx';

/** `above` is the partner's last turn, kept in view; `middle` scrolls to its newest line. */
export type ScreenModel = { top: RailSlots; bottom: RailSlots; above?: ReactNode; middle: ReactNode; band: BandState };

const tile = (spec: Omit<TileSpec, 'vis'> & { vis?: Visibility }): TileSpec => ({ vis: 'live', ...spec });

function groupRail(vis: Visibility): RailSlots {
  return GROUPS.map((g) => tile({ id: g.id, kind: 'group', label: g.label, vis })) as RailSlots;
}

function bandState(state: AppState): ScreenModel['band'] {
  if (state.speaking) return 'speaking';
  if (state.flow === 'listening') return 'listening';
  if (state.flow === 'composing') return 'composing';
  return null;
}

function modeTile(state: AppState): TileSpec {
  if (state.speaking) return tile({ id: 'stop', kind: 'primary', label: 'Stop', icon: 'stop' });
  switch (state.flow) {
    // Where Listen or Respond is the only next step, it is the screen's primary action.
    case 'idle': return tile({ id: 'mode', kind: 'primary', label: 'Listen', icon: 'mic' });
    case 'listening': return tile({ id: 'mode', kind: 'control', label: 'Pause', icon: 'pause' });
    case 'paused': return tile({ id: 'mode', kind: 'primary', label: 'Respond', icon: 'respond' });
    // End would drop the groups typed but not accepted, so it waits (inert) until they are.
    case 'composing': return tile({ id: 'mode', kind: 'control', label: 'End', icon: 'finish', vis: state.composition.pending.length ? 'muted' : 'live', blocked: 'Finish the word first' });
  }
}

/** A long partner turn keeps its end, which is what the reply answers. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  return `…${cut.slice(cut.indexOf(' '))}`;
}

function partnerFor(state: AppState, settings: Settings): ReactNode {
  const showsMessage = (state.flow === 'composing' || state.speaking) && state.speaking?.origin !== 'floor';
  return showsMessage && state.transcript ? (
    <>
      <p className="partner">{tail(state.transcript, settings.textScale >= 1.5 ? 44 : 100)}</p>
      <div className="rule" aria-hidden="true" />
    </>
  ) : null;
}

function middleFor(state: AppState, settings: Settings): ReactNode {
  const { composition, speaking, transcript, flow } = state;
  if (speaking && speaking.origin === 'floor') {
    return <p className="message message--floor" data-speaking="true">{speaking.words.map((w, i) => <span key={i} className="word" data-spoken={i < speaking.index ? 'done' : i === speaking.index ? 'now' : 'next'}>{i > 0 ? ' ' : ''}{w}</span>)}</p>;
  }
  if (flow === 'listening' || flow === 'paused') {
    return <p className="transcript" data-live={flow === 'listening'}>{transcript}</p>;
  }
  if (flow === 'composing' || speaking) {
    return (
      <>
        <Message
          words={composition.words}
          glyphs={pendingGlyphs(composition, contextWords(state))}
          lastDecoded={state.lastDecoded}
          wordColours={settings.wordColours}
          speakingIndex={speaking ? speaking.index : null}
          caret={!speaking && flow === 'composing'}
        />
      </>
    );
  }
  return null;
}

function mainScreen(state: AppState, settings: Settings): ScreenModel {
  const speaking = state.speaking !== null;
  const composing = state.flow === 'composing';
  const live = (on: boolean): Visibility => (on ? 'live' : 'hidden');
  const groups = groupRail(composing ? (speaking ? 'muted' : 'live') : 'hidden');
  const middle = middleFor(state, settings);
  const above = partnerFor(state, settings);
  const band = bandState(state);

  if (state.page === 2) {
    const text = message(state);
    const first: TileSpec = speaking
      ? tile({ id: 'stop', kind: 'primary', label: 'Stop', icon: 'stop' })
      : offersSayAgain(state)
        ? tile({ id: 'again', kind: 'primary', label: 'Say again', icon: 'again' })
        : tile({ id: 'speak', kind: 'primary', label: 'Speak', icon: 'speak', vis: text ? 'live' : 'hidden' });
    return {
      top: [
        first,
        tile({ id: 'moment', kind: 'control', label: 'One moment', icon: 'moment', vis: speaking ? 'muted' : 'live' }),
        tile({ id: 'menu', kind: 'control', label: 'Menu', icon: 'menu', vis: speaking ? 'muted' : 'live' }),
        tile({ id: 'flip', kind: 'control', label: 'Back', icon: 'back', vis: speaking ? 'muted' : 'live' }),
      ],
      bottom: groups,
      above,
      middle,
      band,
    };
  }

  const candidate = composing && state.composition.pending.length ? currentCandidate(state.composition, contextWords(state)) : null;
  const canDelete = composing && (state.composition.pending.length > 0 || state.composition.words.length > 0);
  return {
    top: [
      modeTile(state),
      // Only a real word can be accepted; with no candidate, Q2 rests.
      tile({ id: `autocomplete:${candidate?.word ?? ''}`, kind: 'primary', label: candidate?.word ?? '', icon: 'done', vis: candidate ? (speaking ? 'muted' : 'live') : 'hidden' }),
      tile({ id: 'delete', kind: 'control', label: 'Delete', icon: 'delete', vis: speaking ? 'muted' : live(canDelete) }),
      tile({ id: 'flip', kind: 'control', label: 'More', icon: 'next', vis: speaking ? 'muted' : 'live' }),
    ],
    bottom: groups,
    above,
    middle,
    band,
  };
}

const SETTING_ICON: Record<SettingKey, IconName> = {
  mode: 'eye', dwellGroups: 'timer', dwellControls: 'timer', repeat: 'again', bandRests: 'rest', noise: 'noise',
  textScale: 'display', theme: 'theme', sound: 'speak', wordColours: 'colours',
};

function setting(settings: Settings, key: SettingKey, label: string): TileSpec {
  return tile({ id: `set-${key}`, kind: 'setting', label, icon: SETTING_ICON[key], value: valueLabel(settings, key) });
}

const back = tile({ id: 'back', kind: 'control', label: 'Back', icon: 'back' });

function menuScreen(state: AppState, settings: Settings): ScreenModel {
  const band = bandState(state);
  switch (state.screen) {
    case 'menu':
      return {
        top: [
          tile({ id: 'open-phrases', kind: 'control', label: 'Phrases', icon: 'phrases' }),
          tile({ id: 'clear', kind: 'control', label: 'Clear message', icon: 'clear', vis: message(state) || state.composition.pending.length ? 'live' : 'hidden' }),
          tile({ id: 'recalibrate', kind: 'control', label: 'Recalibrate', icon: 'recalibrate' }),
          back,
        ],
        bottom: [
          tile({ id: 'open-selection', kind: 'control', label: 'Selection', icon: 'selection' }),
          tile({ id: 'open-display', kind: 'control', label: 'Display', icon: 'display' }),
          null,
          null,
        ],
        middle: <h1 className="title">Menu</h1>,
        band,
      };
    case 'menu-selection':
      return {
        top: [setting(settings, 'mode', 'Select by'), setting(settings, 'dwellGroups', 'Letters'), setting(settings, 'dwellControls', 'Controls'), back],
        // Repeat only applies to dwell; in confirm mode every selection needs its own confirm.
        bottom: [{ ...setting(settings, 'repeat', 'Repeat'), vis: settings.mode === 'confirm' ? 'muted' : 'live', blocked: 'Only with dwell' }, setting(settings, 'bandRests', 'Middle rest (test)'), setting(settings, 'noise', 'Gaze noise'), null],
        middle: (
          <>
            <h1 className="title">Selection</h1>
            {settings.mode === 'dwell' && <p className="caution">With dwell, reading the message can select a tile.</p>}
          </>
        ),
        band,
      };
    case 'menu-display':
      return {
        top: [setting(settings, 'textScale', 'Text size'), setting(settings, 'theme', 'Theme'), setting(settings, 'sound', 'Sounds'), back],
        bottom: [setting(settings, 'wordColours', 'Word colours'), null, null, null],
        middle: <h1 className="title">Display</h1>,
        band,
      };
    case 'menu-phrases': {
      const phrase = (i: number) => tile({ id: `phrase-${i}`, kind: 'phrase', label: PHRASES[i], icon: 'phrases' });
      return {
        top: [phrase(0), phrase(1), phrase(2), back],
        bottom: [phrase(3), phrase(4), phrase(5), phrase(6)],
        middle: <h1 className="title">Phrases</h1>,
        band,
      };
    }
    case 'main':
      return mainScreen(state, settings);
  }
}

export function screenFor(state: AppState, settings: Settings): ScreenModel {
  return state.screen === 'main' ? mainScreen(state, settings) : menuScreen(state, settings);
}
