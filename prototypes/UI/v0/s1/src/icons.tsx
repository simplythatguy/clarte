/**
 * Thin outline glyphs on a 24 grid, drawn at 24 px with a 1.6 px stroke and rounded caps, as the
 * shared light direction asks (BRIEF "Visual direction"). One set; colour comes from the tile.
 */
import type { ReactNode } from 'react';

export type IconName =
  | 'mic' | 'pause' | 'respond' | 'done' | 'stop' | 'speak' | 'again' | 'moment' | 'menu'
  | 'next' | 'back' | 'delete' | 'phrases' | 'clear' | 'recalibrate' | 'selection' | 'display'
  | 'finish' | 'eye' | 'timer' | 'rest' | 'noise' | 'theme' | 'colours';

const paths: Record<IconName, ReactNode> = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  pause: <><path d="M9 5v14M15 5v14" /></>,
  respond: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="M13.5 6.5l4 4" /></>,
  done: <><path d="M4.5 12.5l5 5L19.5 7" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2.5" /></>,
  speak: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  again: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
  moment: <><path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 8 4.5 8 8.5s-8 4-8 8.5M16 3.5c0 4.5-8 4.5-8 8.5" /></>,
  menu: <><path d="M4.5 7h15M4.5 12h15M4.5 17h15" /></>,
  next: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
  back: <><path d="M20 12H5M11 6l-6 6 6 6" /></>,
  delete: <><path d="M9 5h10.5a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7 6-7Z" /><path d="M11.5 9.5l5 5M16.5 9.5l-5 5" /></>,
  phrases: <><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" /></>,
  clear: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>,
  recalibrate: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5" /></>,
  selection: <><circle cx="12" cy="12" r="8.5" /><path d="M12 12V6.5M12 12l3.5 3.5" /></>,
  display: <><path d="M3.5 18.5L9 5.5l5.5 13M5.5 14h7" /><path d="M15.5 18.5v-6.5a2.5 2.5 0 0 1 5 0v6.5M15.5 15h5" /></>,
  finish: <><path d="M19.5 5v6.5a3 3 0 0 1-3 3h-12" /><path d="M8.5 10.5l-4 4 4 4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 13V9.5M9.5 2.5h5" /></>,
  rest: <><path d="M3.5 8h17M3.5 16h17" /><path d="M7 12h10" strokeDasharray="1.5 3" /></>,
  noise: <><path d="M2.5 12h2l2-5 3 10 3-12 3 12 2-5h4" /></>,
  theme: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>,
  colours: <><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="8" r="2.5" /><circle cx="8" cy="16" r="2.5" /><circle cx="16" cy="16" r="2.5" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
