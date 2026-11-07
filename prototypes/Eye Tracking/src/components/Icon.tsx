export function Icon({ name, size = 20 }: { name: 'eye' | 'settings' | 'pause' | 'stop' | 'play' | 'speaker' | 'close' | 'arrow' | 'check' | 'reset'; size?: number }) {
  const paths = {
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    settings: <><path d="m9.5 3-.6 2.3-2 .9-2.2-.6-2.5 4.3 1.7 1.7v2.3l-1.7 1.7 2.5 4.3 2.2-.6 2 .9.6 2.3h5l.6-2.3 2-.9 2.2.6 2.5-4.3-1.7-1.7v-2.3l1.7-1.7-2.5-4.3-2.2.6-2-.9L14.5 3Z" /><circle cx="12" cy="12" r="3" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    speaker: <><path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    reset: <><path d="M3 10a9 9 0 1 1 1.5 7M3 4v6h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
