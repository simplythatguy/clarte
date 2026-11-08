/**
 * Menu pages (owner, 2026-11-08). The menu replaces the conversation screen and keeps its geometry:
 * Q1 goes back one level and names where it goes (Home, Menu, Settings), and Q2–Q3 stay a rest zone
 * that shows the page name with its path above it (Menu › Settings › Dwell). The Menu page holds two wide cards, Recalibrate (Q5–Q6) and
 * Settings (Q7–Q8), and My voice top right (Q4, NAT-32). Every other page lays out up to five entries, four along the bottom (Q5–Q8)
 * and a fifth top right (Q4); more than five page two at a time with arrows (Pager.tsx). Settings show their current value and advance to the next value on
 * selection, so every change is one look.
 */
import type { ReactNode } from 'react';
import type { MenuPage, Settings } from './model.ts';
import type { SlotName, SlotView } from './Tile.tsx';
import { pageList, type Paged } from './Pager.tsx';
import { longest } from './text.ts';
import { Again, Back, Blob, Check, Flask, Mic, Palette, Sliders, Sparkle, Speaker, Target, TextSize, Timer, Wave, Waveform } from './icons.tsx';
import { readyVoices, voiceName } from './myvoice/voices.ts';

type Cycle<K extends keyof Settings> = { key: K; name: string; values: Settings[K][]; format: (v: Settings[K]) => string };

/** A quiet glyph inside each setting's dwell ring, so the ring never reads as an empty radio button. */
const SETTING_ICON: Record<keyof Settings, () => ReactNode> = {
  letterDwell: Timer, controlDwell: Timer, textScale: TextSize, sound: Speaker, mode: Target,
  wordColours: Palette, suggestions: Sparkle, noise: Wave, repeat: Again, partner: Mic, orbMotion: Blob, volume: Speaker,
  voiceId: Waveform, pacing: Timer,
};

const seconds = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;
const onOff = (v: boolean) => (v ? 'On' : 'Off');

const CYCLES = {
  letterDwell: { key: 'letterDwell', name: 'Letter dwell', values: [300, 450, 600, 800, 1000, 1500, 2000], format: seconds },
  controlDwell: { key: 'controlDwell', name: 'Button dwell', values: [300, 600, 900, 1200, 1500, 2000], format: seconds },
  textScale: { key: 'textScale', name: 'Text size', values: [1, 1.25, 1.5, 1.75, 2], format: (v: number) => `${Math.round(v * 100)}%` },
  sound: { key: 'sound', name: 'Sounds', values: ['all', 'fewer', 'off'], format: (v: string) => ({ all: 'All', fewer: 'Fewer', off: 'Off' })[v] ?? v },
  volume: { key: 'volume', name: 'Volume', values: [0.25, 0.5, 0.75, 1], format: (v: number) => `${Math.round(v * 100)}%` },
  mode: { key: 'mode', name: 'Selection', values: ['dwell', 'confirm'], format: (v: string) => (v === 'dwell' ? 'Dwell' : 'Confirm') },
  wordColours: { key: 'wordColours', name: 'Word colours', values: [false, true], format: onOff },
  suggestions: { key: 'suggestions', name: 'Suggested replies', values: [true, false], format: onOff },
  noise: { key: 'noise', name: 'Gaze noise', values: [false, true], format: onOff },
  repeat: { key: 'repeat', name: 'Repeat', values: ['leave', 'redwell'], format: (v: string) => (v === 'leave' ? 'Look away' : 'Hold') },
  partner: { key: 'partner', name: 'Partner voice', values: ['microphone', 'script'], format: (v: string) => (v === 'microphone' ? 'Microphone' : 'Script') },
  orbMotion: { key: 'orbMotion', name: 'Motion', values: ['moving', 'still'], format: (v: string) => (v === 'moving' ? 'Moving' : 'Still') },
  // The system voice, then every voice made on this computer that can speak (NAT-32).
  voiceId: { key: 'voiceId', name: 'Voice', get values() { return [null, ...readyVoices().map((v) => v.id)]; }, format: voiceName },
  pacing: { key: 'pacing', name: 'Pacing', values: ['like-me', 'clearer'], format: (v: string) => (v === 'clearer' ? 'Steadier' : 'Like my recordings') },
} as { [K in keyof Settings]: Cycle<K> };

export type SettingKey = keyof Settings;

export function nextValue<K extends SettingKey>(key: K, settings: Settings): Settings[K] {
  const { values } = CYCLES[key];
  const i = values.indexOf(settings[key]);
  return values[(i + 1) % values.length];
}

/** What a menu page offers: a setting to cycle, a page to open, Recalibrate, or another command. */
type Entry =
  | { kind: 'setting'; key: SettingKey }
  | { kind: 'page'; page: MenuPage; glyph: () => ReactNode }
  | { kind: 'recalibrate' }
  | { kind: 'command'; action: string; label: string; glyph: () => ReactNode };

type Page = { title: string; parent: MenuPage | null; entries: Entry[] };

const setting = (key: SettingKey): Entry => ({ kind: 'setting', key });
const open = (page: MenuPage, glyph: () => ReactNode): Entry => ({ kind: 'page', page, glyph });

/**
 * Every page, its place in the tree, and what it offers, in order (owner, 2026-11-08): dwell
 * settings together, appearance together, Sound, and Dev Tools (the old Demo page) last.
 */
const PAGES: Record<MenuPage, Page> = {
  main: { title: 'Menu', parent: null, entries: [{ kind: 'recalibrate' }, open('settings', Sliders), open('voice', Waveform)] },
  // NAT-32: which voice speaks, how it paces, a sample, and making a new one.
  voice: {
    title: 'My voice',
    parent: 'main',
    entries: [
      setting('voiceId'),
      setting('pacing'),
      { kind: 'command', action: 'voice-hear', label: 'Hear it', glyph: Speaker },
      { kind: 'command', action: 'voice-new', label: 'Make my voice', glyph: Check },
    ],
  },
  settings: {
    title: 'Settings',
    parent: 'main',
    entries: [open('dwell', Timer), open('appearance', Palette), setting('suggestions'), open('sound', Speaker), open('dev-tools', Flask)],
  },
  dwell: { title: 'Dwell', parent: 'settings', entries: [setting('mode'), setting('letterDwell'), setting('controlDwell')] },
  appearance: { title: 'Appearance', parent: 'settings', entries: [setting('textScale'), setting('orbMotion'), setting('wordColours')] },
  sound: { title: 'Sound', parent: 'settings', entries: [setting('sound'), setting('volume')] },
  'dev-tools': { title: 'Dev Tools', parent: 'settings', entries: [setting('noise'), setting('repeat'), setting('partner')] },
};

export const TITLES = Object.fromEntries(Object.entries(PAGES).map(([id, p]) => [id, p.title])) as Record<MenuPage, string>;

/** The page Back returns to, or null on the Menu page (Back returns to the conversation). */
export const parentOf = (page: MenuPage): MenuPage | null => PAGES[page].parent;

/** The path to a page, root first: Menu, Settings, Dwell. */
export function trailOf(page: MenuPage): string[] {
  const parent = PAGES[page].parent;
  return [...(parent ? trailOf(parent) : []), PAGES[page].title];
}

/** Up to four entries run along the bottom; a fifth takes the top right first. */
function placesFor(count: number): SlotName[] {
  return count === 5 ? ['q4', 'q5', 'q6', 'q7', 'q8'] : ['q5', 'q6', 'q7', 'q8'];
}

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

/** A Back card that names where it goes (Home is the conversation). */
export function backCard(to: string): SlotView {
  return {
    action: 'back', tone: 'ink', icon: <Back />, label: `Back to ${to}`, bodyKey: `back:${to}`,
    body: <><span className="crumb">{to}</span><span className="card-label" style={longest('Back')}>Back</span></>,
  };
}

/** The menu as slot descriptions, rendered by the same persistent cards as the conversation. */
export function menuSlots(page: MenuPage, settings: Settings, at = 0): Paged {
  const card = (action: string, label: string, glyph: ReactNode, span?: 2): SlotView => ({
    action, tone: 'surface', icon: glyph, span, bodyKey: `${action}:${label}`,
    body: <span className="card-label" style={longest(label)}>{label}</span>,
  });
  const parent = PAGES[page].parent;
  const back = backCard(parent ? PAGES[parent].title : 'Home');
  const view = (e: Entry, span?: 2): SlotView => {
    switch (e.kind) {
      case 'setting': return settingSlot(e.key, settings);
      case 'page': return card(`open-${e.page}`, PAGES[e.page].title, e.glyph(), span);
      case 'recalibrate': return card('recalibrate', 'Recalibrate', <Target />, span);
      case 'command': return card(e.action, e.label, e.glyph(), span);
    }
  };
  const { entries } = PAGES[page];
  // The Menu page's first two entries are wide cards, each across two quadrants (Q5–Q6, Q7–Q8),
  // and My voice sits top right (Q4).
  if (page === 'main') return { slots: { q1: back, q4: view(entries[2]), q5: view(entries[0], 2), q7: view(entries[1], 2) }, strip: null };
  const paged = pageList(entries.map((e) => view(e)), at, placesFor(entries.length));
  return { slots: { q1: back, ...paged.slots }, strip: paged.strip };
}
