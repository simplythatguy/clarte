import type { Point, Viewport } from '../core/tracking';

/** Validation grid: 4 columns × 4 rows; the 25% and 75% rows are the centres of the app's 4×2 navigation cells. */
export const COLUMNS = [.125, .375, .625, .875] as const;
export const ROWS = [.1, .25, .75, .9] as const;
export type Target = Point & {
  /** 0..15, row-major (row × 4 + column). */
  index: number; column: number; row: number;
  /** Normalized screen coordinates in [-0.5, 0.5], as the tracker uses them. */
  nx: number; ny: number;
  /** The 4×2 navigation cell the target lies in, 0..7 row-major. */
  cell: number;
};

export function validationTargets(viewport: Viewport): Target[] {
  return ROWS.flatMap((ry, row) => COLUMNS.map((cx, column) => {
    const x = cx * viewport.width, y = ry * viewport.height;
    return { index: row * 4 + column, column, row, x, y, nx: cx - .5, ny: ry - .5, cell: cellOf({ x, y }, viewport)! };
  }));
}

/** The 4×2 navigation cell a screen point falls in, or null outside the viewport. */
export function cellOf(point: Point, viewport: Viewport): number | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) return null;
  return Math.floor(point.y / viewport.height * 2) * 4 + Math.floor(point.x / viewport.width * 4);
}

/** Centimetres per CSS pixel from the screen diagonal in inches and the screen's physical pixel grid. */
export function cmPerCssPx(diagonalInches: number, screen: { width: number; height: number }, devicePixelRatio: number): number {
  const physical = Math.hypot(screen.width * devicePixelRatio, screen.height * devicePixelRatio);
  if (!(diagonalInches > 0) || !(physical > 0) || !(devicePixelRatio > 0)) return NaN;
  return (diagonalInches * 2.54 / physical) * devicePixelRatio;
}

export type WindowMetrics = {
  innerWidth: number; innerHeight: number; outerWidth: number; outerHeight: number; screenX: number; screenY: number;
  devicePixelRatio: number; screenWidth: number; screenHeight: number; fullscreen: boolean;
};
export function windowMetrics(w: Window = window): WindowMetrics {
  return { innerWidth: w.innerWidth, innerHeight: w.innerHeight, outerWidth: w.outerWidth, outerHeight: w.outerHeight, screenX: w.screenX, screenY: w.screenY,
    devicePixelRatio: w.devicePixelRatio || 1, screenWidth: w.screen.width, screenHeight: w.screen.height, fullscreen: w.document.fullscreenElement !== null };
}

/** mulberry32: a small seeded generator so a block's dot order is reproducible from the recorded seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
