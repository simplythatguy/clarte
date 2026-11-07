/**
 * Menu pages. The menu replaces the conversation screen and keeps its geometry: Q1 goes back,
 * Q4 holds the page's own extra action, Q5–Q8 hold four items, and Q2–Q3 stay a rest zone that
 * shows only the page name. Settings show their current value and advance to the next value on
 * selection, so every change is one look.
 */
import type { ReactNode } from 'react';
import type { MenuPage, Settings } from './model.ts';
import type { SlotName, Slots, SlotView } from './Tile.tsx';
import { longest } from './text.ts';
import { Again, Back, Blob, Bubble, Flask, Hand, Mic, Next, Palette, Sliders, Sparkle, Speaker, Sun, Target, TextSize, Timer, Wave } from './icons.tsx';

export const PHRASES = ['Yes', 'No', 'Thank you', 'Please say that again'];

type Cycle<K extends keyof Settings> = { key: K; name: string; values: Settings[K][]; format: (v: Settings[K]) => string };

/** A quiet glyph inside each setting's dwell ring, so the ring never reads as an empty radio button. */
const SETTING_ICON: Record<keyof Settings, () => ReactNode> = {
  letterDwell: Timer, controlDwell: Timer, textScale: TextSize, theme: Sun, sound: Speaker, mode: Target,
  wordColours: Palette, suggestions: Sparkle, noise: Wave, repeat: Again, partner: Mic, orbMotion: Blob,
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
  suggestions: { key: 'suggestions', name: 'Suggested replies', values: [true, false], format: onOff },
  noise: { key: 'noise', name: 'Gaze noise', values: [false, true], format: onOff },
  repeat: { key: 'repeat', name: 'Repeat', values: ['leave', 'redwell'], format: (v: string) => (v === 'leave' ? 'Look away' : 'Hold') },
  partner: { key: 'partner', name: 'Partner voice', values: ['microphone', 'script'], format: (v: string) => (v === 'microphone' ? 'Microphone' : 'Script') },
  orbMotion: { key: 'orbMotion', name: 'Orb motion', values: ['moving', 'still'], format: (v: string) => (v === 'moving' ? 'Moving' : 'Still') },
} as { [K in keyof Settings]: Cycle<K> };

export type SettingKey = keyof Settings;

export function nextValue<K extends SettingKey>(key: K, settings: Settings): Settings[K] {
  const { values } = CYCLES[key];
  const i = values.indexOf(settings[key]);
  return values[(i + 1) % values.length];
}

const PAGES: Record<Exclude<MenuPage, 'main' | 'phrases'>, (SettingKey | null)[]> = {
  settings: ['letterDwell', 'controlDwell', 'textScale', 'theme'],
  'settings-2': ['sound', 'mode', 'orbMotion', 'suggestions'],
  demo: ['noise', 'repeat', 'partner', 'wordColours'],
};

export const TITLES: Record<MenuPage, string> = {
  main: 'Menu',
  phrases: 'Phrases',
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

/** The menu as slot descriptions, rendered by the same persistent cards as the conversation. */
export function menuSlots(page: MenuPage, settings: Settings): Slots {
  const icon = (action: string, label: string, glyph: ReactNode, tone: 'surface' | 'ink' = 'surface'): SlotView => ({
    action, tone, icon: glyph, bodyKey: `${action}:${label}`,
    body: <span className="card-label" style={longest(label)}>{label}</span>,
  });
  const setting = <K extends SettingKey>(k: K) => settingSlot(k, settings);
  const back = icon('back', 'Back', <Back />, 'ink');

  if (page === 'main') {
    return {
      q1: back,
      q4: icon('one-moment', 'One moment', <Hand />),
      q5: icon('phrases', 'Phrases', <Bubble />),
      q6: icon('settings', 'Settings', <Sliders />),
      q7: icon('recalibrate', 'Recalibrate', <Target />),
      q8: icon('demo', 'Demo', <Flask />),
    };
  }
  if (page === 'phrases') {
    const slots: Slots = { q1: back };
    PHRASES.forEach((text, i) => {
      slots[`q${i + 5}` as SlotName] = { action: `phrase-${i}`, tone: 'surface', icon: <Bubble />, bodyKey: `phrase-${i}`, body: <span className="phrase" style={longest(text)}>{text}</span> };
    });
    return slots;
  }
  const slots: Slots = { q1: back };
  if (page === 'settings' || page === 'settings-2') {
    slots.q4 = {
      action: 'more', tone: 'surface', icon: <Next />, label: `More, page ${page === 'settings' ? 1 : 2} of 2`, bodyKey: 'more',
      body: <><span className="card-label" style={longest('More')}>More</span><span className="pager" aria-hidden="true"><i data-on={page === 'settings' || undefined} /><i data-on={page === 'settings-2' || undefined} /></span></>,
    };
  }
  PAGES[page].forEach((k, i) => { if (k) slots[`q${i + 5}` as SlotName] = setting(k); });
  return slots;
}
