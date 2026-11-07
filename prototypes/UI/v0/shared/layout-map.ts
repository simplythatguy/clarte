/**
 * Quadrant maps for the five styles.
 *
 * Each style declares which backend quadrants every action owns, per phase. This script validates
 * the declarations against the Backend Quadrant rule and writes an SVG map next to each style's
 * DESIGN.md, so builders and reviewers compare the implementation against one unambiguous picture.
 *
 * Run with: node prototypes/UI/v0/shared/layout-map.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUADRANT_IDS, quadrantRect, validateLayout, type Actionable, type QuadrantId, type Rect } from './quadrants.ts';

type Action = { id: string; label: string; quadrants: QuadrantId[]; kind: 'group' | 'control' | 'primary' };
type Phase = { name: string; note: string; actions: Action[]; display: { quadrants: QuadrantId[]; label: string }[] };
type StyleMap = { folder: string; title: string; phases: Phase[] };

const groups = (ids: [QuadrantId, QuadrantId, QuadrantId, QuadrantId]): Action[] => [
  { id: 'G1', label: 'A–F', quadrants: [ids[0]], kind: 'group' },
  { id: 'G2', label: 'G–N', quadrants: [ids[1]], kind: 'group' },
  { id: 'G3', label: 'O–S', quadrants: [ids[2]], kind: 'group' },
  { id: 'G4', label: 'T–Z', quadrants: [ids[3]], kind: 'group' },
];

export const STYLES: StyleMap[] = [
  {
    folder: 's1',
    title: 'Style 1 · Rails',
    phases: [
      {
        name: 'compose',
        note: 'Every quadrant is actionable: no rest zone. Reading the middle band is classified as the top or bottom row, so selection uses a confirm step by default.',
        actions: [
          { id: 'mode', label: 'Record / Respond', quadrants: ['Q1'], kind: 'control' },
          { id: 'autocomplete', label: 'Autocomplete', quadrants: ['Q2'], kind: 'primary' },
          { id: 'delete', label: 'Delete', quadrants: ['Q3'], kind: 'control' },
          { id: 'flip', label: 'More ↔', quadrants: ['Q4'], kind: 'control' },
          ...groups(['Q5', 'Q6', 'Q7', 'Q8']),
        ],
        display: [{ quadrants: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'], label: 'message band across the middle (visual only)' }],
      },
    ],
  },
  {
    folder: 's2',
    title: 'Style 2 · Corners',
    phases: [
      {
        name: 'compose',
        note: 'Letter groups own the four corners. Q2 and Q3 are rest zones holding the partner transcript and the message.',
        actions: [
          ...groups(['Q1', 'Q4', 'Q5', 'Q8']),
          { id: 'primary', label: 'Candidate · Speak · Listen', quadrants: ['Q6'], kind: 'primary' },
          { id: 'delete', label: 'Delete · Stop', quadrants: ['Q7'], kind: 'control' },
        ],
        display: [{ quadrants: ['Q2', 'Q3'], label: 'rest: partner words + message' }],
      },
    ],
  },
  {
    folder: 's3',
    title: 'Style 3 · Stages',
    phases: [
      {
        name: 'listen',
        note: 'Top row is rest and shows the partner transcript. One wide action stops listening.',
        actions: [{ id: 'done-listening', label: 'Done listening', quadrants: ['Q5', 'Q6', 'Q7', 'Q8'], kind: 'primary' }],
        display: [{ quadrants: ['Q1', 'Q2', 'Q3', 'Q4'], label: 'rest: partner transcript, large' }],
      },
      {
        name: 'compose',
        note: 'Q2 and Q3 rest with the message and the live candidate; accept left, delete right; groups along the bottom.',
        actions: [
          { id: 'accept', label: 'Use candidate · Done', quadrants: ['Q1'], kind: 'primary' },
          { id: 'delete', label: 'Delete', quadrants: ['Q4'], kind: 'control' },
          ...groups(['Q5', 'Q6', 'Q7', 'Q8']),
        ],
        display: [{ quadrants: ['Q2', 'Q3'], label: 'rest: message + candidate' }],
      },
      {
        name: 'speak',
        note: 'The message fills the rest row. Two wide actions: back to editing, or speak.',
        actions: [
          { id: 'edit', label: 'Edit', quadrants: ['Q5', 'Q6'], kind: 'control' },
          { id: 'speak', label: 'Speak', quadrants: ['Q7', 'Q8'], kind: 'primary' },
        ],
        display: [{ quadrants: ['Q1', 'Q2', 'Q3', 'Q4'], label: 'rest: the message, very large' }],
      },
      {
        name: 'spoken',
        note: 'After speaking: a new turn, repair, continue, or settings. Repair is one look away.',
        actions: [
          { id: 'listen', label: 'Listen', quadrants: ['Q5'], kind: 'primary' },
          { id: 'again', label: 'Say again', quadrants: ['Q6'], kind: 'control' },
          { id: 'more', label: 'Add more', quadrants: ['Q7'], kind: 'control' },
          { id: 'menu', label: 'Menu', quadrants: ['Q8'], kind: 'control' },
        ],
        display: [{ quadrants: ['Q1', 'Q2', 'Q3', 'Q4'], label: 'rest: what was said' }],
      },
    ],
  },
  {
    folder: 's4',
    title: 'Style 4 · Split',
    phases: [
      {
        name: 'compose',
        note: 'A 2×2 keypad on the left; the right half acts at the top and reads (rest) at the bottom.',
        actions: [
          ...groups(['Q1', 'Q2', 'Q5', 'Q6']),
          { id: 'primary', label: 'Candidate · Speak · Listen', quadrants: ['Q3'], kind: 'primary' },
          { id: 'delete', label: 'Delete · Menu', quadrants: ['Q4'], kind: 'control' },
        ],
        display: [{ quadrants: ['Q7', 'Q8'], label: 'rest: partner words + message' }],
      },
    ],
  },
  {
    folder: 's5',
    title: 'Style 5 · Dialogue',
    phases: [
      {
        name: 'compose',
        note: 'The conversation thread rests in Q2–Q3. The primary slot offers a whole predicted reply before any typing, then the word candidate, then Speak.',
        actions: [
          { id: 'primary', label: 'Reply · Candidate · Speak · Listen', quadrants: ['Q1'], kind: 'primary' },
          { id: 'delete', label: 'Delete · Stop', quadrants: ['Q4'], kind: 'control' },
          ...groups(['Q5', 'Q6', 'Q7', 'Q8']),
        ],
        display: [{ quadrants: ['Q2', 'Q3'], label: 'rest: conversation thread' }],
      },
    ],
  },
];

const W = 960, H = 600, PAD = 14;
const viewport = { width: W, height: H };

function union(ids: QuadrantId[]): Rect {
  const rects = ids.map((id) => quadrantRect(id, viewport));
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

function toActionables(phase: Phase): Actionable[] {
  return phase.actions.map((a) => {
    const u = union(a.quadrants);
    return { id: a.id, rect: { left: u.left + PAD, top: u.top + PAD, right: u.right - PAD, bottom: u.bottom - PAD } };
  });
}

function escape(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function svg(style: StyleMap, phase: Phase): string {
  const fill = { group: '#dbe7f6', control: '#ececea', primary: '#1b1b1b' } as const;
  const ink = { group: '#1b1b1b', control: '#1b1b1b', primary: '#ffffff' } as const;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 70}" viewBox="0 0 ${W} ${H + 70}" font-family="Inter, system-ui, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H + 70}" fill="#ffffff"/>`);
  for (const d of phase.display) {
    const u = union(d.quadrants);
    parts.push(`<rect x="${u.left}" y="${u.top}" width="${u.right - u.left}" height="${u.bottom - u.top}" fill="url(#rest)"/>`);
    parts.push(`<text x="${(u.left + u.right) / 2}" y="${(u.top + u.bottom) / 2}" text-anchor="middle" font-size="15" fill="#6b6b66">${escape(d.label)}</text>`);
  }
  for (const a of phase.actions) {
    const u = union(a.quadrants);
    parts.push(`<rect x="${u.left + PAD}" y="${u.top + PAD}" width="${u.right - u.left - 2 * PAD}" height="${u.bottom - u.top - 2 * PAD}" rx="22" fill="${fill[a.kind]}" stroke="#1b1b1b" stroke-opacity=".25"/>`);
    parts.push(`<text x="${(u.left + u.right) / 2}" y="${(u.top + u.bottom) / 2 + 6}" text-anchor="middle" font-size="20" font-weight="600" fill="${ink[a.kind]}">${escape(a.label)}</text>`);
  }
  for (const id of QUADRANT_IDS) {
    const r = quadrantRect(id, viewport);
    parts.push(`<rect x="${r.left}" y="${r.top}" width="${r.right - r.left}" height="${r.bottom - r.top}" fill="none" stroke="#d6336c" stroke-dasharray="6 6" stroke-opacity=".8"/>`);
    parts.push(`<text x="${r.left + 8}" y="${r.top + 18}" font-size="13" font-weight="700" fill="#d6336c">${id}</text>`);
  }
  parts.push(`<defs><pattern id="rest" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#fafaf8"/><line x1="0" y1="0" x2="0" y2="12" stroke="#e4e4df" stroke-width="4"/></pattern></defs>`);
  parts.push(`<text x="14" y="${H + 28}" font-size="17" font-weight="700" fill="#1b1b1b">${escape(style.title)} · ${phase.name}</text>`);
  parts.push(`<text x="14" y="${H + 52}" font-size="13" fill="#4f4f4a">${escape(phase.note)}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
for (const style of STYLES) {
  for (const phase of style.phases) {
    const violations = validateLayout(toActionables(phase), viewport);
    const restZones = QUADRANT_IDS.filter((q) => !phase.actions.some((a) => a.quadrants.includes(q)));
    const status = violations.length ? `VIOLATION ${JSON.stringify(violations)}` : 'ok';
    if (violations.length) failures += 1;
    console.log(`${style.folder}/${phase.name}: ${phase.actions.length} actions, rest ${restZones.join(',') || 'none'} → ${status}`);
    const dir = join(here, '..', style.folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `quadrant-map-${phase.name}.svg`), svg(style, phase));
  }
}
if (failures) { console.error(`${failures} phase(s) violate the Backend Quadrant rule`); process.exit(1); }
