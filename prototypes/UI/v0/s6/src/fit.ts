/**
 * Card text fit. Text starts at its type-scale size (sized by its longest word, text.ts). When a
 * card's content does not fit its width and height, the card first tightens its icon-to-text gap,
 * then steps its text down by `--fit`, never below the 20 px floor (the Clarte policy: nothing on a
 * gaze screen is smaller than 20 px). Words never break while the type can still step down; at the
 * floor a card that still overflows is marked `data-overflow`, and its CSS lets a long word wrap
 * inside itself (every letter stays visible) rather than shrink further or be cut. The bottom row's
 * cards are peers (menu items, settings, phrases): each text role (label, setting name, setting
 * value, phrase) takes the smallest size that role reached in the row, so peers match without one
 * role dragging another down. Q1 (primary) and Q4 (secondary) are different ranks and fit alone. A
 * hint never outranks its label: it is capped at 0.6× the label's fitted size, floored at 20 px.
 * Runs only when card text, viewport, text size or fonts change.
 */
export const FLOOR_PX = 20;
const STEP = 0.05;
const ROLES = ['.card-label', '.setting-name', '.setting-value', '.phrase'];
const TEXT = ROLES.join(', ');
const HINT = '.card-hint';
const HINT_RATIO = 0.6;
const ALONE = ['q1', 'q4'];
const PEERS = ['q5', 'q6', 'q7', 'q8'];

let signature = '';

const texts = (card: HTMLElement, selector = TEXT) =>
  [...card.querySelectorAll<HTMLElement>(selector)].filter((e) => !e.closest('.card-leaving'));

function overflows(card: HTMLElement): boolean {
  const cs = getComputedStyle(card);
  const width = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const height = card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (texts(card).some((el) => el.scrollWidth > width + 1)) return true;
  const kids = [...card.children].filter((k) => (k as HTMLElement).offsetHeight > 0 && getComputedStyle(k).position !== 'absolute') as HTMLElement[];
  const gap = parseFloat(cs.rowGap) || 0;
  const used = kids.reduce((sum, k) => sum + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
  return used > height + 1;
}

function fitOne(card: HTMLElement): void {
  card.removeAttribute('data-tight');
  card.removeAttribute('data-overflow');
  card.style.setProperty('--fit', '1');
  for (const el of texts(card, `${TEXT}, ${HINT}`)) el.style.removeProperty('font-size');
  if (!overflows(card)) return;
  card.setAttribute('data-tight', '');
  // The type may step down until its largest role would pass the floor; the CSS floors each role too.
  const natural = Math.max(FLOOR_PX, ...texts(card).map((el) => parseFloat(getComputedStyle(el).fontSize)));
  const floor = Math.min(1, FLOOR_PX / natural);
  let fit = 1;
  while (fit - floor > 1e-6 && overflows(card)) {
    fit = Math.max(floor, fit - STEP);
    card.style.setProperty('--fit', fit.toFixed(2));
  }
  if (overflows(card)) card.setAttribute('data-overflow', '');
}

/** The hint is support: never larger than 0.6× its label (only ever shrinks, so it cannot overflow). */
function rankHints(card: HTMLElement): void {
  for (const hint of texts(card, HINT)) {
    const label = hint.parentElement?.querySelector<HTMLElement>(TEXT);
    if (!label) continue;
    const cap = Math.max(FLOOR_PX, parseFloat(getComputedStyle(label).fontSize) * HINT_RATIO);
    if (parseFloat(getComputedStyle(hint).fontSize) > cap) hint.style.fontSize = `${cap.toFixed(1)}px`;
  }
}

function cardIn(q: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.cell-${q} > .card:not(.card-gone)`);
}

export function fitCards(): void {
  const scale = getComputedStyle(document.documentElement).getPropertyValue('--scale');
  const cards = [...ALONE, ...PEERS].map(cardIn);
  const sig = [innerWidth, innerHeight, scale, document.fonts.status,
    ...cards.map((c) => (c ? texts(c, `${TEXT}, ${HINT}`).map((e) => e.textContent).join('|') : ''))].join('§');
  if (sig === signature) return;
  signature = sig;
  const fitted = (qs: string[]) => qs.map(cardIn).filter((c): c is HTMLElement => Boolean(c && texts(c).length));
  for (const card of fitted(ALONE)) { fitOne(card); rankHints(card); }
  const peers = fitted(PEERS);
  for (const card of peers) fitOne(card);
  // Peers share one rhythm: if any card needed the tighter gap, all take it.
  if (peers.some((c) => c.hasAttribute('data-tight'))) for (const c of peers) c.setAttribute('data-tight', '');
  for (const role of ROLES) {
    const els = peers.flatMap((c) => texts(c, role));
    const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
    const smallest = Math.max(FLOOR_PX, Math.min(...sizes));
    els.forEach((e, i) => { if (sizes[i] > smallest + 0.5) e.style.fontSize = `${smallest}px`; });
  }
}
