/**
 * The calibration ring as a hand would sketch it (NAT-44, owner 2026-11-08: "like drawing & real
 * sketching … the circle shouldn't be perfect"). Paths are in GuideOrb's ring viewBox
 * (-50…50, the orb's edge at about 36, the ring's mean radius 45; it never comes inside 38).
 *
 * What makes a drawn circle read as drawn:
 *  - it is a little egg-shaped and tilted (two axes that differ by a few per cent);
 *  - its edge wanders slowly (two low harmonics), and the hand trembles (small fast noise, smoothed);
 *  - it does not close: the pen starts near the top, goes round clockwise, and runs on past its start
 *    by 10–18 %, drifting clearly inside or outside, so the end crosses the beginning;
 */

/** A small seeded generator (mulberry32), so each point's loop is its own but stable while drawn. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 45;
const STEPS = 84;

type Pt = [number, number];

function loop(rand: () => number, radius: number): Pt[] {
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const start = -Math.PI / 2 + between(-0.45, 0.25);
  const sweep = Math.PI * 2 * (1 + between(0.1, 0.18));
  const egg = between(0.03, 0.06);
  const tilt = between(0, Math.PI);
  const drift = rand() < 0.5 ? between(-0.06, -0.035) : between(0.05, 0.09);
  const h2 = [between(0.012, 0.028), between(0, Math.PI * 2)];
  const h3 = [between(0.008, 0.018), between(0, Math.PI * 2)];
  // Tremor: noise at each step, smoothed so it reads as a hand, not as jaggies.
  const raw = Array.from({ length: STEPS + 1 }, () => between(-1, 1));
  const tremor = raw.map((_, i) => (raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(STEPS, i + 1)]) / 4);
  const pts: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const a = start + sweep * u;
    const wobble = 1 + h2[0] * Math.sin(2 * a + h2[1]) + h3[0] * Math.sin(3 * a + h3[1]) + 0.012 * tremor[i];
    // The run-on drifts in or out over the last stretch only, so the start lies on the true loop.
    const run = Math.max(0, (u - 0.78) / 0.22);
    const r = radius * wobble * (1 + drift * run * run);
    // Egg shape: stretch along a tilted axis.
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const along = (x * c + y * s) * (1 + egg), across = (-x * s + y * c) * (1 - egg);
    pts.push([along * c - across * s, along * s + across * c]);
  }
  return pts;
}

/** Catmull-Rom through the points, as cubic Béziers: smooth, like ink, with no corners. */
function smooth(pts: Pt[]): string {
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** The pen's single loop for one calibration point. */
export function sketchedRing(seed: number): string {
  return smooth(loop(random(seed), R));
}
