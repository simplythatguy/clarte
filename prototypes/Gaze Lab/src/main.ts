import './styles.css';
import { App, readQuery } from './lab/app';
import { SimpleApp, readSimpleQuery } from './lab/simple-app';

const root = document.getElementById('app');
if (!root) throw new Error('App root missing');
const query = new URLSearchParams(location.search);
// `/` is the simple flow (Start → calibration → 8 quadrants → result); `?mode=research` is the full harness, unchanged.
if (query.get('mode') === 'research') new App(root, readQuery(query)).mount();
else new SimpleApp(root, readSimpleQuery(query)).mount();
