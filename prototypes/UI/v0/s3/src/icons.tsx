/**
 * Thin outline icons: 24 px grid, 1.5 px stroke, round caps and joins, `currentColor`
 * (BRIEF "Visual direction", MOTION "Craft rules"). One set for the whole style.
 */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  delete: 'M9 5.5h10.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9L3.5 12z M12.5 9.5l5 5 M17.5 9.5l-5 5',
  menu: 'M4.5 8h15 M4.5 16h15',
  mic: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3z M6 11.5a6 6 0 0 0 12 0 M12 17.5v3',
  speak: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11',
  stop: 'M7 7h10v10H7z',
  again: 'M5 12a7 7 0 1 0 2.1-5 M5 4.5V8h3.5',
  plus: 'M12 5v14 M5 12h14',
  edit: 'M14.5 5.5l4 4L9 19H5v-4z M12.5 7.5l4 4',
  moment: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M12 8v4.5l3 1.5',
  back: 'M14.5 5.5L8 12l6.5 6.5',
  target: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M12 2v4 M12 18v4 M2 12h4 M18 12h4',
  text: 'M5 7h14 M5 12h14 M5 17h9',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
  spell: 'M4 18l4.5-12L13 18 M5.8 13.5h5.4 M17 6v12 M15 6h4 M15 18h4',
  clear: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  quote: 'M6 17c2.5-1 3.5-3 3.5-6V7H5v5h4.5 M15 17c2.5-1 3.5-3 3.5-6V7H14v5h4.5',
  arrow: 'M5 12h14 M13.5 6.5L19 12l-5.5 5.5',
  dot: 'M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z',
  gauge: 'M4.5 16.5a7.5 7.5 0 1 1 15 0 M12 16.5l4-5',
  gaugeLetter: 'M4.5 16.5a7.5 7.5 0 1 1 15 0 M9.6 16l2.4-6.5 2.4 6.5 M10.5 13.8h3',
  wave: 'M3 12c2 0 2-5 4-5s2 10 4 10s2-10 4-10s2 5 4 5h2',
  drop: 'M12 4c3 4 6 7 6 10a6 6 0 0 1-12 0c0-3 3-6 6-10z',
  size: 'M3.5 18L8 7l4.5 11 M5 14.5h6 M14 18l3.5-8 3.5 8 M15.2 15.5h4.6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
