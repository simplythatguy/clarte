import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// After the first painted frames, entrances may animate; the initial screen is simply there.
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.settled = ''; }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
