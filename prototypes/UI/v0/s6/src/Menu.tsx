/**
 * The pages that use the menu geometry: Q1 goes back, Q4 holds the page's own action, Q5–Q8 hold
 * the items, and Q2–Q3 stay a rest zone.
 *
 * Menu (message empty): the page name over the blurred conversation; Settings, Recalibrate and
 * Demo, then the settings pages with More in Q4. Settings show their current value and advance to
 * the next value on selection, so every change is one look.
 *
 * Done (owner, 2026-11-07; the message has words): the message stays in the rest zone to review,
 * Speak sits where Done was, so looking twice at Q4 speaks, and the message's own actions are the
 * items: Delete word, Clear message, Other words and Recalibrate. Other words took Settings' place:
 * a rare word is often deep in the engine's list (49% of dictionary words are not top-2 at the
 * full code with no context), and Recalibrate is the more immediate repair mid-message; Settings
 * stays one step away through Menu once the message is spoken or cleared.
 *
 * Other words: Q1 Back, Q4 More (the next page; past the last it starts again), and four exact-
 * length words for the last word's code in Q5–Q8. Picking one replaces the last word. A page with
 * fewer words leaves the rest of the row empty; a single page has no More.
 */
import type { ReactNode } from 'react';
import type { MenuPage, Settings } from './model.ts';
import type { SlotName, Slots, SlotView } from './Tile.tsx';
import { displayWord, longest, type Shown } from './text.ts';
import { Again, Back, Blob, Bubble, Erase, Exchange, Flask, Mic, Next, Palette, Sliders, Speaker, Sun, Target, TextSize, Timer, Trash, Wave } from './icons.tsx';

type Cycle<K extends keyof Settings> = { key: K; name: string; values: Settings[K][]; format: (v: Settings[K]) => string };

/** A quiet glyph on each setting's card. */
const SETTING_ICON: Record<keyof Settings, () => ReactNode> = {
  letterDwell: Timer, controlDwell: Timer, textScale: TextSize, theme: Sun, sound: Speaker, mode: Target,
  wordColours: Palette, noise: Wave, repeat: Again, partner: Mic, orbMotion: Blob,
};

const seconds = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;
const onOff = (v: boolean) => (v ? 'On' : 'Off');

const CYCLES = {
  letterDwell: { key: 'letterDwell', name: 'Letter dwell', values: [300, 450, 600, 800, 1000, 1500, 2000], format: seconds },
  controlDwell: { key: 'controlDwell', name: 'Button dwell', values: [300, 600, 900, 1200, 1500, 2000], format: seconds },
  textScale: { key: 'textScale', name: 'Text size', values: [1, 1.25, 1.5, 1.75, 2], format: (v: number) => `${Math.round(v * 100)}%` },
  theme: { key: 'theme', name: 'Theme', values: ['light', 'dark'], format: (v: string) => (v === 'light' ? 'Light' : 'Dark') },
  sound: { key: 'sound', name: 'Sounds', values: [true, false], format: onOff },
  mode: { key: 'mode', name: 'Selection', values: ['dwell', 'confirm'], format: (v: string) => (v === 'dwell' ? 'Dwell' : 'Confirm') },
  wordColours: { key: 'wordColours', name: 'Word colours', values: [false, true], format: onOff },
  noise: { key: 'noise', name: 'Gaze noise', values: [false, true], format: onOff },
  repeat: { key: 'repeat', name: 'Repeat', values: ['leave', 'redwell'], format: (v: string) => (v === 'leave' ? 'Look away' : 'Hold') },
  partner: { key: 'partner', name: 'Microphone', values: ['microphone', 'script'], format: (v: string) => (v === 'microphone' ? 'On' : 'Off') },
  orbMotion: { key: 'orbMotion', name: 'Orb motion', values: ['moving', 'still'], format: (v: string) => (v === 'moving' ? 'Moving' : 'Still') },
} as { [K in keyof Settings]: Cycle<K> };

export type SettingKey = keyof Settings;

export function nextValue<K extends SettingKey>(key: K, settings: Settings): Settings[K] {
  const { values } = CYCLES[key];
  const i = values.indexOf(settings[key]);
  return values[(i + 1) % values.length];
}

const PAGES: Record<Exclude<MenuPage, 'main'>, (SettingKey | null)[]> = {
  settings: ['letterDwell', 'controlDwell', 'textScale', 'theme'],
  'settings-2': ['sound', 'mode', 'orbMotion', 'repeat'],
  // The Demo page's fourth card plays the next scripted partner line (App: 'partner-speaks').
  demo: ['noise', 'partner', 'wordColours', null],
};

export const TITLES: Record<MenuPage, string> = {
  main: 'Menu',
  settings: 'Settings',
  'settings-2': 'Settings',
  demo: 'Demo',
};

/** One setting as a card: its name, its current value; selecting it advances to the next value. */
export function settingSlot<K extends SettingKey>(k: K, settings: Settings): SlotView {
  const cycle = CYCLES[k];
  const value = cycle.format(settings[k]);
  return {
    action: `set-${k}`, tone: 'surface', icon: SETTING_ICON[k](), bodyKey: `set-${k}`,
    body: <><span className="setting-name" style={longest(cycle.name)}>{cycle.name}</span><span key={value} className="setting-value" style={longest(value)}>{value}</span></>,
  };
}

/** A setting's current value as shown on its card. */
export function settingText<K extends SettingKey>(k: K, settings: Settings): { name: string; value: string } {
  return { name: CYCLES[k].name, value: CYCLES[k].format(settings[k]) };
}

const item = (action: string, label: string, glyph: ReactNode, tone: 'surface' | 'ink' = 'surface'): SlotView => ({
  action, tone, icon: glyph, bodyKey: `${action}:${label}`,
  body: <span className="card-label" style={longest(label)}>{label}</span>,
});

/** The menu as slot descriptions, rendered by the same persistent cards as the conversation. */
export function menuSlots(page: MenuPage, settings: Settings): Slots {
  const back = item('back', 'Back', <Back />, 'ink');
  if (page === 'main') {
    // Three items in reading order after Back; Q4 and Q8 rest.
    return {
      q1: back,
      q5: item('settings', 'Settings', <Sliders />),
      q6: item('recalibrate', 'Recalibrate', <Target />),
      q7: item('demo', 'Demo', <Flask />),
    };
  }
  const slots: Slots = { q1: back };
  if (page === 'settings' || page === 'settings-2') {
    slots.q4 = {
      action: 'more', tone: 'surface', icon: <Next />, label: `More, page ${page === 'settings' ? 1 : 2} of 2`, bodyKey: 'more',
      body: <><span className="card-label" style={longest('More')}>More</span><span className="pager" aria-hidden="true"><i data-on={page === 'settings' || undefined} /><i data-on={page === 'settings-2' || undefined} /></span></>,
    };
  }
  PAGES[page].forEach((k, i) => { if (k) slots[`q${i + 5}` as SlotName] = settingSlot(k, settings); });
  // Its peers in the row are settings, so its words take the setting value's size.
  if (page === 'demo') slots.q8 = { ...item('partner-speaks', 'Partner speaks', <Bubble />), body: <span className="setting-value" style={longest('Partner speaks')}>Partner speaks</span> };
  return slots;
}

/** The Done page (owner, 2026-11-07). */
export function doneSlots(): Slots {
  return {
    q1: item('back', 'Back', <Back />, 'ink'),
    q4: item('speak', 'Speak', <Speaker />),
    q5: item('delete-word', 'Delete word', <Erase />),
    q6: item('clear', 'Clear message', <Trash />),
    q7: item('other-words', 'Other words', <Exchange />),
    q8: item('recalibrate', 'Recalibrate', <Target />),
  };
}

export const WORD_SLOTS: SlotName[] = ['q5', 'q6', 'q7'];

/**
 * The word chooser (Options and Other words; owner, 2026-11-08): three words in Q5–Q7 and, while
 * more remain, a right arrow in Q8 that swaps in the next three. On the last page the arrow is gone;
 * Back (Q1) leaves. `words` is this page's list (each with its written form when the engine sent
 * one), `index` the word's place in the message (for its capital), `page` and `pages` the position.
 */
export function otherSlots(words: Shown[], index: number, page: number, pages: number): Slots {
  const slots: Slots = { q1: item('back', 'Back', <Back />, 'ink') };
  if (page + 1 < pages) {
    const at = `Page ${page + 1} of ${pages}`;
    slots.q8 = {
      action: 'more', tone: 'surface', label: `More words, ${at}`, bodyKey: `more:${page}`,
      body: <><span className="card-label card-arrow" aria-hidden="true"><Next /></span><span className="card-hint">{at}</span></>,
    };
  }
  words.forEach((word, i) => {
    const text = displayWord(word.text, index, word.display);
    slots[WORD_SLOTS[i]] = {
      action: `other-${i}`, tone: 'surface', bodyKey: `other:${word.text}`,
      body: <span className="card-label is-word" style={{ ['--len' as string]: text.length }}>{text}</span>,
    };
  });
  return slots;
}
