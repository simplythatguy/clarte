import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mountOverlay } from './core/overlay.ts';
import './variant.ts';
import { App } from './App.tsx';
import DemoOne from '@/components/ui/demo';
import { engine } from './gaze.ts';
// Atkinson Hyperlegible Next, bundled: no font request leaves the machine.
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './tailwind.css';
import './styles.css';

// `?reset` forgets everything this page saved (first-run state, settings, the calibration) and opens the first run.
if (new URLSearchParams(location.search).has('reset')) {
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage blocked: nothing saved to forget */ }
  location.replace(location.pathname);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('demo') ? <main className="demo"><DemoOne /></main> : <App />}
  </StrictMode>,
);

// Developer overlay: backend grid, gaze point, dwell state, violations. Toggle with `.
if (import.meta.env.DEV) mountOverlay(engine, { visible: false });
