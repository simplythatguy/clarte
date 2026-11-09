/**
 * The listening page for Clarté's sound system (NAT-24): every cue side by side, with the
 * settings that shape them. Open http://localhost:5201/sounds.html while this app's dev server runs.
 */
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './sounds.css';
import { CUES, chordName, configureSound, duck, play, render, swell, unlockOnGesture, type SoundLevel } from './core/sound.ts';

unlockOnGesture();

const root = document.getElementById('lab')!;
let level: SoundLevel = 'all';
let volume = 0.75;
let underVoice = false;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

// ── Header and settings ─────────────────────────────────────────────────────────────────────

const chord = el('span', { class: 'chord' });
const refreshChord = () => { chord.textContent = `Next word blooms on ${chordName()}`; };

function segmented(name: string, options: { value: string; label: string }[], current: string, onChange: (v: string) => void) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  for (const o of options) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === current) }, o.label);
    b.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      onChange(o.value);
    });
    group.append(b);
  }
  return group;
}

const volumeInput = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(volume * 100), 'aria-label': 'Volume' }) as HTMLInputElement;
const volumeValue = el('output', {}, `${Math.round(volume * 100)}%`);
volumeInput.addEventListener('input', () => {
  volume = Number(volumeInput.value) / 100;
  volumeValue.textContent = `${volumeInput.value}%`;
  configureSound({ volume });
});
volumeInput.addEventListener('change', () => play('control'));

const voiceToggle = el('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false' }, 'Under the voice');
voiceToggle.addEventListener('click', () => {
  underVoice = !underVoice;
  voiceToggle.setAttribute('aria-pressed', String(underVoice));
  duck(underVoice);
});

root.append(
  el('header', { class: 'top' },
    el('div', {},
      el('h1', {}, 'Sounds'),
      el('p', { class: 'lede' }, 'Calm cues for Clarté. Soft starts, long fades, one key. Click a card to hear it.'),
    ),
    chord,
  ),
  el('section', { class: 'controls', 'aria-label': 'Settings' },
    el('label', { class: 'control' }, el('span', { class: 'caption' }, 'Sounds'),
      segmented('Sounds', [{ value: 'all', label: 'All' }, { value: 'fewer', label: 'Fewer' }, { value: 'off', label: 'Off' }], level, (v) => {
        level = v as SoundLevel;
        configureSound({ level });
        document.body.dataset.level = level;
      })),
    el('label', { class: 'control' }, el('span', { class: 'caption' }, 'Volume'), el('span', { class: 'range' }, volumeInput, volumeValue)),
    el('div', { class: 'control' }, el('span', { class: 'caption' }, 'Clarté speaking'), voiceToggle),
  ),
);
document.body.dataset.level = level;
refreshChord();

// ── Cue cards ───────────────────────────────────────────────────────────────────────────────

const grid = el('section', { class: 'cues', 'aria-label': 'Cues' });
root.append(el('h2', {}, 'Every cue'), grid);

function drawWave(canvas: HTMLCanvasElement, buffer: AudioBuffer, meta: HTMLElement) {
  const data = buffer.getChannelData(0);
  const width = canvas.clientWidth || 280;
  const height = canvas.clientHeight || 56;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  // The cue's envelope, column by column, normalised so quiet cues still show their shape.
  const columns = Array.from({ length: width }, (_, x) => {
    const from = Math.floor((x / width) * data.length);
    const to = Math.floor(((x + 1) / width) * data.length);
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, to - from));
  });
  const max = Math.max(...columns, 1e-6);
  const style = getComputedStyle(canvas);
  const gradient = g.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, style.getPropertyValue('--wave-a'));
  gradient.addColorStop(1, style.getPropertyValue('--wave-b'));
  g.fillStyle = gradient;
  g.beginPath();
  g.moveTo(0, height / 2);
  columns.forEach((v, x) => g.lineTo(x, height / 2 - (v / max) * (height / 2 - 2)));
  for (let x = width - 1; x >= 0; x--) g.lineTo(x, height / 2 + (columns[x] / max) * (height / 2 - 2));
  g.closePath();
  g.fill();

  let peak = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak / 1000) last = i;
  const rise = data.findIndex((v) => Math.abs(v) > peak * 0.9);
  meta.textContent = `${(last / buffer.sampleRate).toFixed(1)} s · reaches full in ${Math.round((rise / buffer.sampleRate) * 1000)} ms`;
}

for (const info of CUES) {
  const card = el('article', { class: 'cue', 'data-fewer': String(info.fewer) });
  const canvas = el('canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const meta = el('span', { class: 'meta' });
  const head = el('button', { type: 'button', class: 'cue-play' },
    el('span', { class: 'cue-name' }, info.name),
    el('span', { class: 'cue-moment' }, info.moment),
  );
  const tags = el('div', { class: 'tags' }, el('code', {}, info.cue), info.fewer ? el('span', { class: 'tag' }, 'Kept at Fewer') : el('span', { class: 'tag quiet' }, 'All only'));
  head.addEventListener('click', () => {
    play(info.cue, info.cue === 'calibration-step' ? { step: Math.floor(Math.random() * 9) } : {});
    card.animate([{ transform: 'scale(0.985)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    refreshChord();
  });
  card.append(head, canvas, el('div', { class: 'cue-foot' }, tags, meta));

  grid.append(card);
  requestAnimationFrame(() => void render(info.cue, {}, 3.5).then((b) => drawWave(canvas, b, meta)).catch(() => { meta.textContent = 'Web Audio unavailable'; }));
}

// ── Dwell swell (experimental) ──────────────────────────────────────────────────────────────

const DWELL_MS = 600;
const ring = el('span', { class: 'ring', 'aria-hidden': 'true' });
const pad = el('button', { type: 'button', class: 'dwell' }, ring, el('span', {}, el('strong', {}, 'Hold to dwell'), el('span', {}, 'A faint chord opens while the ring fills. Let go early and it drains away. Not used in the app yet.')));
let held: { cancel(): void; complete(): void } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const begin = () => {
  if (held) return;
  held = swell(DWELL_MS);
  pad.setAttribute('data-filling', '');
  timer = setTimeout(() => {
    held?.complete();
    held = null;
    pad.removeAttribute('data-filling');
  }, DWELL_MS);
};
const end = () => {
  if (!held) return;
  if (timer) clearTimeout(timer);
  held.cancel();
  held = null;
  pad.removeAttribute('data-filling');
};
pad.addEventListener('pointerdown', begin);
pad.addEventListener('pointerup', end);
pad.addEventListener('pointerleave', end);
pad.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } });
pad.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(); });
root.append(el('h2', {}, 'Experiment'), pad);

root.append(el('footer', {}, 'NAT-24 · rules and cue map in docs/design/SOUND.md · engine in src/core/sound.ts'));
