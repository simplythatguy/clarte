import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mountOverlay } from '../../shared/overlay.ts';
import { App } from './App.tsx';
import { engine } from './gaze.ts';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Developer overlay: backend grid, gaze point, dwell state, violations. Toggle with `.
if (import.meta.env.DEV) mountOverlay(engine, { visible: false });
