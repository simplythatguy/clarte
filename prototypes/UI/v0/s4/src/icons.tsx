import type { Icon } from './model.ts';

/** One outline family on a 24 grid, 1.5 px strokes with round caps, drawn in currentColor. */
const PATHS: Record<Icon, React.ReactNode> = {
  listen: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />,
  speak: (
    <>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  again: (
    <>
      <path d="M5 12a7 7 0 1 0 2.1-5" />
      <path d="M6.6 3.8 7 7.4l3.6-.5" />
    </>
  ),
  delete: (
    <>
      <path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" />
      <path d="m11.5 9.5 5 5M16.5 9.5l-5 5" />
    </>
  ),
  moment: (
    <>
      <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 14.5" />
    </>
  ),
  menu: <path d="M5 7.5h14M5 12h14M5 16.5h14" />,
  back: <path d="M14.5 6 8.5 12l6 6" />,
  more: <path d="M9.5 6l6 6-6 6" />,
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  recalibrate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  add: <path d="m5.5 12.5 4 4 9-9" />,
  swap: <path d="M7 7.5h11l-3-3M17 16.5H6l3 3" />,
  phrases: <path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z" />,
  spell: <path d="M4 18 8.5 6l4.5 12M5.6 14h5.8M16 6v12" />,
  settings: <path d="M5 7h8M17 7h2M5 17h2M11 17h8M15 5v4M9 15v4" />,
  clear: <path d="M5 7h14M9.5 7V5.5h5V7M7 7l.8 11.5h8.4L17 7" />,
  timer: <><circle cx="12" cy="13" r="7" /><path d="M12 13V9.5M10 3.5h4" /></>,
  text: <path d="M3.5 17.5 7.5 7l4 10.5M5 14h5M14.5 12.5a2.5 2.5 0 1 1 0 5h0a2.5 2.5 0 0 1 0-5zM17 12.5v5" />,
  theme: <><circle cx="12" cy="12" r="7" /><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" /></>,
  sound: <><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" /></>,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  colour: <><circle cx="8.5" cy="9" r="3" /><circle cx="15.5" cy="9" r="3" /><circle cx="12" cy="15" r="3" /></>,
  demo: <path d="M9.5 4h5M10.5 4v5.5L5.5 18a1.5 1.5 0 0 0 1.3 2h10.4a1.5 1.5 0 0 0 1.3-2l-5-8.5V4" />,
  noise: <><circle cx="7" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="6.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="11" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="17.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="6.5" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="13" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
  repeat: <path d="M17 4.5 19.5 7 17 9.5M5 11V9.5A2.5 2.5 0 0 1 7.5 7h12M7 19.5 4.5 17 7 14.5M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5h-12" />,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  grid: <path d="M4 4h16v16H4zM12 4v16M4 12h16" />,
  quote: <path d="M7 10.5h3.5V15H7a.5.5 0 0 1-.5-.5zM6.5 10.5c0-2 1-3.5 3-4M13.5 10.5H17V15h-3.5a.5.5 0 0 1-.5-.5zM13 10.5c0-2 1-3.5 3-4" />,
};

export function IconGlyph({ name }: { name: Icon }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
