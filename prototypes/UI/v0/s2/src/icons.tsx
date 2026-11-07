/**
 * Inline icons. One set, drawn on a 24 grid, `currentColor`, round caps, non-scaling 1.6 px stroke:
 * the thin outline icons of the owner's visual direction (BRIEF).
 */
import type { ReactNode } from 'react';

export type IconName = 'listen' | 'stop' | 'check' | 'speak' | 'again' | 'delete' | 'hand' | 'menu' | 'done' | 'next' | 'calibrate' | 'phrases' | 'clear' | 'swap' | 'more';

const paths: Record<IconName, ReactNode> = {
  listen: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  speak: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  again: (
    <>
      <path d="M5 12a7 7 0 1 0 2.1-5" />
      <path d="M5 4.5V8h3.5" />
    </>
  ),
  delete: (
    <>
      <path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" />
      <path d="M11.5 9.5l5 5M16.5 9.5l-5 5" />
    </>
  ),
  hand: (
    <>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14" />
      <path d="M8 12V9.5a1.5 1.5 0 0 0-3 0v4.5a7 7 0 0 0 7 7h.5a4.5 4.5 0 0 0 4.5-4.5V14" />
    </>
  ),
  menu: <path d="M5 7.5h14M5 12h14M5 16.5h14" />,
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  next: <path d="M10 6l6 6-6 6" />,
  calibrate: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  phrases: <path d="M5 6.5h14v9H11l-4 3v-3H5z" />,
  clear: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  swap: (
    <>
      <path d="M5 9h12.5M14.5 5.5L18 9l-3.5 3.5" />
      <path d="M19 15H6.5M9.5 11.5L6 15l3.5 3.5" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
