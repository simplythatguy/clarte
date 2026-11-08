import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mountOverlay } from '../../../v0/shared/overlay.ts';
import './variant.ts';
import { App } from './App.tsx';
import DemoOne from '@/components/ui/demo';
import { engine } from './gaze.ts';
// Atkinson Hyperlegible Next, bundled: no font request leaves the machine.
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './tailwind.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('demo') ? <main className="demo"><DemoOne /></main> : <App />}
  </StrictMode>,
);

// Developer overlay: backend grid, gaze point, dwell state, violations. Toggle with `.
if (import.meta.env.DEV) mountOverlay(engine, { visible: false });
