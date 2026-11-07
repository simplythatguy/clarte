/**
 * Developer overlay and actionable tracking.
 *
 * `trackActionables` keeps a gaze engine fed with the page's `[data-action]` elements as the DOM
 * and viewport change. `mountOverlay` draws the backend quadrant grid, the gaze point, the dwell
 * state and any rule violations on top of the page. Toggle it with the backquote key.
 *
 * Violations are also logged with console.error once per distinct set, so a layout that breaks
 * the one-action-per-quadrant rule is loud during development.
 */
import { GazeEngine, type GazeSnapshot } from './gaze.ts';
import {
  QUADRANT_IDS,
  collectActionables,
  quadrantRect,
  validateLayout,
  viewportOf,
  type Actionable,
  type Violation,
} from './quadrants.ts';

export type LayoutReport = { actionables: Actionable[]; violations: Violation[] };

/** Re-collect actionables on DOM changes, resizes and a slow timer; push them into the engine. */
export function trackActionables(engine: GazeEngine, root: ParentNode = document, onReport?: (report: LayoutReport) => void): () => void {
  let lastSignature = '';
  const update = () => {
    const viewport = viewportOf();
    engine.setViewport(viewport);
    const actionables = collectActionables(root);
    engine.setActionables(actionables);
    const violations = validateLayout(actionables, viewport);
    const signature = JSON.stringify(violations);
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (violations.length) {
        console.error('[backend quadrants] more than one action in a quadrant:', violations);
      }
    }
    onReport?.({ actionables, violations });
  };
  const observer = new MutationObserver(update);
  observer.observe(root === document ? document.body : (root as Node), { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden', 'aria-disabled', 'data-action'] });
  window.addEventListener('resize', update);
  const timer = setInterval(update, 500);
  update();
  return () => { observer.disconnect(); window.removeEventListener('resize', update); clearInterval(timer); };
}

const STYLE = `
.cq-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
.cq-overlay[hidden] { display: none; }
.cq-cell { position: absolute; border: 1px dashed rgba(255, 0, 128, .55); color: rgba(255, 0, 128, .9); padding: 4px 6px; }
.cq-cell.is-rest { background: repeating-linear-gradient(45deg, rgba(0,0,0,.035) 0 6px, transparent 6px 12px); }
.cq-cell.is-violation { background: rgba(255, 0, 0, .18); border-color: red; color: red; font-weight: 700; }
.cq-cell.is-current { box-shadow: inset 0 0 0 3px rgba(255, 0, 128, .9); }
.cq-point { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 2px solid rgba(255, 0, 128, .9); background: rgba(255, 0, 128, .25); }
.cq-ring { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: conic-gradient(rgba(255, 0, 128, .85) calc(var(--p) * 1turn), transparent 0); mask: radial-gradient(circle, transparent 16px, #000 17px); -webkit-mask: radial-gradient(circle, transparent 16px, #000 17px); }
.cq-hud { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); background: rgba(0, 0, 0, .78); color: #fff; padding: 6px 10px; border-radius: 8px; white-space: pre; }
`;

export type OverlayOptions = { visible?: boolean; toggleKey?: string };

/** Mount the quadrant overlay. Returns an unmount function. */
export function mountOverlay(engine: GazeEngine, options: OverlayOptions = {}): () => void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const layer = document.createElement('div');
  layer.className = 'cq-overlay';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = options.visible === false;
  const cells = new Map<string, HTMLDivElement>();
  for (const id of QUADRANT_IDS) {
    const cell = document.createElement('div');
    cell.className = 'cq-cell';
    cells.set(id, cell);
    layer.append(cell);
  }
  const ring = document.createElement('div');
  ring.className = 'cq-ring';
  const point = document.createElement('div');
  point.className = 'cq-point';
  const hud = document.createElement('div');
  hud.className = 'cq-hud';
  layer.append(ring, point, hud);
  document.body.append(layer);

  let report: LayoutReport = { actionables: [], violations: [] };
  let snapshot: GazeSnapshot = engine.snapshot;

  const render = () => {
    if (layer.hidden) return;
    const viewport = viewportOf();
    for (const id of QUADRANT_IDS) {
      const cell = cells.get(id)!;
      const rect = quadrantRect(id, viewport);
      Object.assign(cell.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
      const owners = report.actionables.filter((a) => validateLayout([a], viewport).length === 0 && overlaps(a, rect));
      const violation = report.violations.find((v) => v.quadrant === id);
      cell.textContent = violation ? `${id}  ✕ ${violation.actions.join(' + ')}` : owners.length ? `${id}  ${owners.map((o) => o.id).join(', ')}` : `${id}  rest`;
      cell.classList.toggle('is-rest', !owners.length && !violation);
      cell.classList.toggle('is-violation', Boolean(violation));
      cell.classList.toggle('is-current', snapshot.quadrant === id);
    }
    if (snapshot.point) {
      point.style.display = ring.style.display = '';
      point.style.left = ring.style.left = `${snapshot.point.x}px`;
      point.style.top = ring.style.top = `${snapshot.point.y}px`;
      ring.style.setProperty('--p', String(snapshot.state === 'dwelling' ? snapshot.progress : snapshot.state === 'previewed' || snapshot.state === 'selected' ? 1 : 0));
    } else {
      point.style.display = ring.style.display = 'none';
    }
    const s = engine.settings;
    hud.textContent = `${s.mode} ${s.dwellMs}ms · noise ${s.noiseSigma}  |  ${snapshot.quadrant ?? '—'} → ${snapshot.action ?? 'rest'}  ${snapshot.state} ${(snapshot.progress * 100).toFixed(0)}%` + (report.violations.length ? `  |  ✕ ${report.violations.length} violation(s)` : '  |  layout ok') + `  |  \` toggles overlay`;
  };

  const unsubscribe = engine.subscribe((next) => { snapshot = next; render(); });
  const untrack = trackActionables(engine, document, (next) => { report = next; render(); });
  const toggleKey = options.toggleKey ?? '`';
  const onKey = (e: KeyboardEvent) => { if (e.key === toggleKey) { layer.hidden = !layer.hidden; render(); } };
  window.addEventListener('keydown', onKey);
  render();
  return () => { unsubscribe(); untrack(); window.removeEventListener('keydown', onKey); layer.remove(); style.remove(); };
}

function overlaps(a: Actionable, rect: { left: number; top: number; right: number; bottom: number }): boolean {
  return Math.min(a.rect.right, rect.right) - Math.max(a.rect.left, rect.left) >= 2
    && Math.min(a.rect.bottom, rect.bottom) - Math.max(a.rect.top, rect.top) >= 2;
}
