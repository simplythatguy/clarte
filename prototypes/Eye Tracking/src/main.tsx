import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { installLocalNetworkBoundary } from './core/network';

installLocalNetworkBoundary();
const root = document.getElementById('root');
if (!root) throw new Error('App root missing');
createRoot(root).render(<App />);
