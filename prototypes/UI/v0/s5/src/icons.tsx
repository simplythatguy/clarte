/**
 * Inline icons. One family, drawn on a 24 grid with round joins, `currentColor`, and a rendered
 * stroke of 1.5 px (MOTION.md craft rules: 1.5 px icon outlines on a 24 px grid, rounded caps).
 */
import type { ReactNode } from 'react';

function Icon({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Mic = () => <Icon><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></Icon>;
export const StopSquare = () => <Icon><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Icon>;
export const Speaker = () => <Icon><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></Icon>;
export const Again = () => <Icon><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></Icon>;
export const Backspace = () => <Icon><path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" /><path d="M11.5 9.5l5 5M16.5 9.5l-5 5" /></Icon>;
export const Hand = () => <Icon><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5" /><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a5.5 5.5 0 0 1-4.3-2.1L4 15.2a1.5 1.5 0 0 1 2.2-2L8 15" /></Icon>;
export const MenuLines = () => <Icon><path d="M4.5 7h15M4.5 12h15M4.5 17h15" /></Icon>;
export const Close = () => <Icon><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icon>;
export const Back = () => <Icon><path d="M19 12H5.5" /><path d="M11 6l-6 6 6 6" /></Icon>;
export const Next = () => <Icon><path d="M5 12h13.5" /><path d="M13 6l6 6-6 6" /></Icon>;
export const Sparkle = () => <Icon><path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" /><path d="M18.5 16v4M16.5 18h4" /></Icon>;
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
export const Wave = () => <Icon><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /></Icon>;
