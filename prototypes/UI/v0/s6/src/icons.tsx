/**
 * Inline icons. One family, drawn on a 24 grid with round joins, `currentColor`, and a rendered
 * stroke of 1.5 px (MOTION.md craft rules: 1.5 px icon outlines on a 24 px grid, rounded caps).
 */
import type { ReactNode } from 'react';

function Icon({ children, filled = false, destructive = false }: { children: ReactNode; filled?: boolean; destructive?: boolean }) {
  return (
    <svg className={destructive ? 'icon icon-destructive' : 'icon'} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Mic = () => <Icon><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></Icon>;
export const StopSquare = () => <Icon><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Icon>;
export const Speaker = () => <Icon><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></Icon>;
export const Again = () => <Icon><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></Icon>;
/** Delete, in the destructive red (as in the editor reference's toolbar). */
export const Erase = () => <Icon destructive><path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" /><path d="M11.5 9.5l5 5M16.5 9.5l-5 5" /></Icon>;
/** Clear the message: a bin, in the destructive red like Delete. */
export const Trash = () => <Icon destructive><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l.8 11.2A1.5 1.5 0 0 0 8.8 19.5h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" /><path d="M10 10.5v6M14 10.5v6" /></Icon>;
export const MenuLines = () => <Icon><path d="M4.5 7h15M4.5 12h15M4.5 17h15" /></Icon>;
export const Back = () => <Icon><path d="M19 12H5.5" /><path d="M11 6l-6 6 6 6" /></Icon>;
export const Next = () => <Icon><path d="M5 12h13.5" /><path d="M13 6l6 6-6 6" /></Icon>;
export const Bubble = () => <Icon><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" /><path d="M8 10h8M8 13h5" /></Icon>;
export const Sliders = () => <Icon><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon>;
export const Target = () => <Icon><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></Icon>;
export const Flask = () => <Icon><path d="M9.5 3.5h5M10.5 3.5v5.2L5 18a1.8 1.8 0 0 0 1.6 2.5h10.8A1.8 1.8 0 0 0 19 18l-5.5-9.3V3.5" /><path d="M7.5 14.5h9" /></Icon>;
export const RecordDot = () => <Icon><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" /></Icon>;
export const Ellipsis = () => <Icon><circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.8" fill="currentColor" stroke="none" /></Icon>;
export const Check = () => <Icon><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const ArrowRight = () => <Icon><path d="M5 12h13.5" /><path d="M13 6.5l5.5 5.5-5.5 5.5" /></Icon>;
export const Timer = () => <Icon><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2" /><path d="M9.5 3h5" /></Icon>;
export const TextSize = () => <Icon><path d="M3.5 18l4.5-12 4.5 12M5.2 14h5.6" /><path d="M14 18l3-8 3 8M15 15.5h4" /></Icon>;
export const Sun = () => <Icon><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></Icon>;
export const Palette = () => <Icon><circle cx="7.5" cy="12" r="2.5" /><circle cx="12" cy="7" r="2.5" /><circle cx="16.5" cy="12" r="2.5" /><circle cx="12" cy="17" r="2.5" /></Icon>;
export const Blob = () => <Icon><path d="M13.2 4.2c3.4.4 6.6 3 6.3 6.9-.3 3.6-2.6 4.6-3.4 6.4-.9 2-3.3 2.8-5.5 2.2-2.8-.8-3.2-3-5-4.3C3.4 14 3.6 10.6 5.4 8c1.7-2.5 4.6-4.2 7.8-3.8z" /><path d="M9.5 9.5c.8-1 2-1.5 3.2-1.3" /></Icon>;
export const Eye = () => <Icon><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const Waveform = () => <Icon><path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 10.5v3" /></Icon>;
export const Alert = () => <Icon><path d="M12 4l9 15.5H3z" /><path d="M12 10v4.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></Icon>;
/** Other words: two arrows exchanging places (the word gives way to another). */
export const Exchange = () => <Icon><path d="M4.5 8.5h14" /><path d="M14.5 4.5l4 4-4 4" /><path d="M19.5 15.5h-14" /><path d="M9.5 11.5l-4 4 4 4" /></Icon>;
export const Wave = () => <Icon><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /></Icon>;
