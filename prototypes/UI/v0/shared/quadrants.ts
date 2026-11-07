/**
 * Backend Quadrants.
 *
 * Every Clarte screen is classified by the gaze backend into a fixed grid of 2 rows × 4 columns.
 * The grid never changes. Each cell is a "backend quadrant", named Q1..Q8 in reading order:
 *
 *   Q1 Q2 Q3 Q4
 *   Q5 Q6 Q7 Q8
 *
 * Rule: a backend quadrant holds at most one actionable element. An element may span several
 * quadrants, but then no other actionable element may touch any of those quadrants. A quadrant
 * with no actionable element is a rest zone: looking there does nothing.
 *
 * This module is the single source of truth for that rule. UIs register their actionable elements
 * with `data-action="<id>"`; `validateLayout` reports violations and `actionIn` resolves which
 * action a quadrant selects. See prototypes/UI/v0/README.md.
 */

export const BACKEND_ROWS = 2;
export const BACKEND_COLS = 4;

export const QUADRANT_IDS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'] as const;
export type QuadrantId = (typeof QUADRANT_IDS)[number];

export type Viewport = { width: number; height: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Actionable = { id: string; rect: Rect };
export type Violation = { quadrant: QuadrantId; actions: string[] };

export function quadrantIndex(id: QuadrantId): number {
  return QUADRANT_IDS.indexOf(id);
}

export function quadrantPosition(id: QuadrantId): { row: number; col: number } {
  const index = quadrantIndex(id);
  return { row: Math.floor(index / BACKEND_COLS), col: index % BACKEND_COLS };
}

export function quadrantId(row: number, col: number): QuadrantId {
  return QUADRANT_IDS[row * BACKEND_COLS + col];
}

/** The pixel rectangle of a backend quadrant for a viewport. */
export function quadrantRect(id: QuadrantId, viewport: Viewport): Rect {
  const { row, col } = quadrantPosition(id);
  const cellWidth = viewport.width / BACKEND_COLS;
  const cellHeight = viewport.height / BACKEND_ROWS;
  return {
    left: col * cellWidth,
    top: row * cellHeight,
    right: (col + 1) * cellWidth,
    bottom: (row + 1) * cellHeight,
  };
}

/** The backend quadrant containing a viewport point, or null when the point is off screen. */
export function quadrantAt(x: number, y: number, viewport: Viewport): QuadrantId | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return null;
  const col = Math.min(BACKEND_COLS - 1, Math.floor((x / viewport.width) * BACKEND_COLS));
  const row = Math.min(BACKEND_ROWS - 1, Math.floor((y / viewport.height) * BACKEND_ROWS));
  return quadrantId(row, col);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}

/**
 * Every backend quadrant a rectangle touches. Overlaps thinner than `minOverlap` px in either
 * direction are ignored so that a 1px border bleeding over a grid line does not count.
 */
export function quadrantsOf(rect: Rect, viewport: Viewport, minOverlap = 2): QuadrantId[] {
  return QUADRANT_IDS.filter((id) => {
    const o = overlap(rect, quadrantRect(id, viewport));
    return o.width >= minOverlap && o.height >= minOverlap;
  });
}

/** Violations of the one-action-per-quadrant rule. Empty means the layout is valid. */
export function validateLayout(actionables: readonly Actionable[], viewport: Viewport): Violation[] {
  const byQuadrant = new Map<QuadrantId, string[]>();
  for (const action of actionables) {
    for (const quadrant of quadrantsOf(action.rect, viewport)) {
      const list = byQuadrant.get(quadrant) ?? [];
      if (!list.includes(action.id)) list.push(action.id);
      byQuadrant.set(quadrant, list);
    }
  }
  return QUADRANT_IDS.flatMap((quadrant) => {
    const actions = byQuadrant.get(quadrant) ?? [];
    return actions.length > 1 ? [{ quadrant, actions }] : [];
  });
}

/** The single action a quadrant selects, or null for a rest zone. Assumes a valid layout. */
export function actionIn(quadrant: QuadrantId, actionables: readonly Actionable[], viewport: Viewport): Actionable | null {
  return actionables.find((action) => quadrantsOf(action.rect, viewport).includes(quadrant)) ?? null;
}

/** Quadrants that select a given action, in reading order. */
export function quadrantsForAction(actionId: string, actionables: readonly Actionable[], viewport: Viewport): QuadrantId[] {
  const action = actionables.find((a) => a.id === actionId);
  return action ? quadrantsOf(action.rect, viewport) : [];
}

function isRenderedActionable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Collect every rendered, enabled `[data-action]` element under `root` as an actionable.
 * This is what both the gaze engine and the dev overlay feed on, so what the user can select
 * is always what the layout check verifies.
 */
export function collectActionables(root: ParentNode = document): Actionable[] {
  return Array.from(root.querySelectorAll('[data-action]'))
    .filter(isRenderedActionable)
    .map((element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { id: element.getAttribute('data-action') as string, rect: { left, top, right, bottom } };
    });
}

export function viewportOf(win: Window = window): Viewport {
  return { width: win.innerWidth, height: win.innerHeight };
}
