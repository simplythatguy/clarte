/**
 * Person-facing settings. Each one is a closed list of values that a menu tile cycles through,
 * because a gaze user changes a value by selecting its tile again, not by dragging a slider.
 */
import type { SelectionMode } from '../../shared/gaze.ts';

export const DWELL_STEPS = [300, 450, 600, 750, 900, 1200, 1500, 2000] as const;
export const TEXT_SCALES = [1, 1.25, 1.5, 1.75, 2] as const;
export const NOISE_STEPS = [0, 0.03, 0.06] as const;

export type Settings = {
  mode: SelectionMode;
  /** Dwell (or preview) time for the four letter groups. */
  dwellGroups: number;
  /** Dwell (or preview) time for every other tile. */
  dwellControls: number;
  repeat: 'leave' | 'redwell';
  /** Experimental: a raw gaze point inside the middle band counts as no gaze. */
  bandRests: boolean;
  noise: (typeof NOISE_STEPS)[number];
  textScale: (typeof TEXT_SCALES)[number];
  theme: 'light' | 'dark';
  sound: boolean;
  /** Keep group colours under decoded words, as in the original sketch. */
  wordColours: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'confirm',
  dwellGroups: 600,
  dwellControls: 900,
  repeat: 'leave',
  bandRests: false,
  noise: 0,
  textScale: 1,
  theme: 'light',
  sound: true,
  wordColours: false,
};

export type SettingKey = 'mode' | 'dwellGroups' | 'dwellControls' | 'repeat' | 'bandRests' | 'noise' | 'textScale' | 'theme' | 'sound' | 'wordColours';

function nextOf<T>(list: readonly T[], value: T): T {
  const index = list.indexOf(value);
  return list[(index + 1) % list.length];
}

/** The value a setting takes when its tile is selected once more. */
export function cycle(settings: Settings, key: SettingKey): Settings {
  switch (key) {
    case 'mode': return { ...settings, mode: settings.mode === 'confirm' ? 'dwell' : 'confirm' };
    case 'dwellGroups': return { ...settings, dwellGroups: nextOf(DWELL_STEPS, settings.dwellGroups as (typeof DWELL_STEPS)[number]) };
    case 'dwellControls': return { ...settings, dwellControls: nextOf(DWELL_STEPS, settings.dwellControls as (typeof DWELL_STEPS)[number]) };
    case 'repeat': return { ...settings, repeat: settings.repeat === 'leave' ? 'redwell' : 'leave' };
    case 'bandRests': return { ...settings, bandRests: !settings.bandRests };
    case 'noise': return { ...settings, noise: nextOf(NOISE_STEPS, settings.noise) };
    case 'textScale': return { ...settings, textScale: nextOf(TEXT_SCALES, settings.textScale) };
    case 'theme': return { ...settings, theme: settings.theme === 'light' ? 'dark' : 'light' };
    case 'sound': return { ...settings, sound: !settings.sound };
    case 'wordColours': return { ...settings, wordColours: !settings.wordColours };
  }
}

/** The value as the tile shows it. */
export function valueLabel(settings: Settings, key: SettingKey): string {
  switch (key) {
    case 'mode': return settings.mode === 'confirm' ? 'Confirm' : 'Dwell';
    case 'dwellGroups': return seconds(settings.dwellGroups);
    case 'dwellControls': return seconds(settings.dwellControls);
    case 'repeat': return settings.repeat === 'leave' ? 'Look away' : 'Keep looking';
    case 'bandRests': return settings.bandRests ? 'On' : 'Off';
    case 'noise': return settings.noise === 0 ? 'Off' : settings.noise === 0.03 ? 'Some' : 'Webcam';
    case 'textScale': return `${Math.round(settings.textScale * 100)}%`;
    case 'theme': return settings.theme === 'light' ? 'Light' : 'Dark';
    case 'sound': return settings.sound ? 'On' : 'Off';
    case 'wordColours': return settings.wordColours ? 'On' : 'Off';
  }
}

function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(2))} s`;
}

const STORAGE_KEY = 'clarte.style1.settings';
const CALIBRATED_KEY = 'clarte.style1.calibrated';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode: settings last for the session */ }
}

export function wasCalibrated(): boolean {
  // `?onboarding=off` opens straight into the app (used by the style switcher).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('onboarding') === 'off') return true;
  try { return localStorage.getItem(CALIBRATED_KEY) === '1'; } catch { return false; }
}

export function markCalibrated(): void {
  try { localStorage.setItem(CALIBRATED_KEY, '1'); } catch { /* ignore */ }
}
