import { describe, expect, it } from 'vitest';
import { applyHomography3, intrinsics, multiply3, normalizeFaceRt, poseNormalization, transpose3, type Point2 } from '../src/core/pose-normalize';

const W = 1280, H = 720;
/** 478 landmarks: everything at the face centre except the four eye corners, placed around it with a roll. */
function face(cx: number, cy: number, roll = 0, halfSpan = 60): Point2[] {
  const points: Point2[] = Array.from({ length: 478 }, () => [cx, cy]);
  const place = (index: number, dx: number, dy: number) => { points[index] = [cx + dx * Math.cos(roll) - dy * Math.sin(roll), cy + dx * Math.sin(roll) + dy * Math.cos(roll)]; };
  place(33, -halfSpan, 0); place(133, -halfSpan * .3, 0); place(362, halfSpan * .3, 0); place(263, halfSpan, 0);
  return points;
}
const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, -50, 1]].flat();

describe('pose normalization', () => {
  it('leaves a centred, level face alone', () => {
    const n = poseNormalization(face(W / 2, H / 2), identity, W, H)!;
    n.rotation.forEach((row, r) => row.forEach((v, c) => expect(v).toBeCloseTo(r === c ? 1 : 0, 6)));
    const p = applyHomography3(n.homography, [700, 300]);
    expect(p[0]).toBeCloseTo(700, 4); expect(p[1]).toBeCloseTo(300, 4);
  });
  it('brings an off-centre face to the image centre and keeps the rotation orthonormal', () => {
    const n = poseNormalization(face(900, 500), identity, W, H)!;
    const centre = applyHomography3(n.homography, [900, 500]);
    expect(centre[0]).toBeCloseTo(W / 2, 3); expect(centre[1]).toBeCloseTo(H / 2, 3);
    const rrt = multiply3(n.rotation, transpose3(n.rotation));
    rrt.forEach((row, r) => row.forEach((v, c) => expect(v).toBeCloseTo(r === c ? 1 : 0, 6)));
    // Head x-axis follows the matrix's first column, so a frontal head stays level.
    const [left, right] = [applyHomography3(n.homography, [840, 500]), applyHomography3(n.homography, [960, 500])];
    expect(Math.abs(left[1] - right[1])).toBeLessThan(.5);
  });
  it('removes roll, from the eye-corner line when no face matrix is given', () => {
    const roll = .3, points = face(W / 2, H / 2, roll);
    const n = poseNormalization(points, null, W, H)!;
    const a = applyHomography3(n.homography, points[33]), b = applyHomography3(n.homography, points[263]);
    expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-3);
    expect(b[0]).toBeGreaterThan(a[0]);
    // With the matrix carrying the same roll (about the viewing axis) the result agrees.
    const c = Math.cos(roll), s = Math.sin(roll);
    const rolled = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1]; // column-major Rz(roll) in y-up axes equals image-plane roll of -roll
    const m = poseNormalization(points, rolled.map((v, i) => (i === 1 ? -s : i === 4 ? s : v)), W, H)!;
    const a2 = applyHomography3(m.homography, points[33]), b2 = applyHomography3(m.homography, points[263]);
    expect(Math.abs(a2[1] - b2[1])).toBeLessThan(1e-3);
  });
  it('rejects degenerate input and rotates the face matrix consistently', () => {
    expect(poseNormalization([], identity, W, H)).toBeNull();
    const bad = face(W / 2, H / 2); bad[33] = [NaN, 0];
    expect(poseNormalization(bad, identity, W, H)).toBeNull();
    const n = poseNormalization(face(900, 500), identity, W, H)!;
    const rotated = normalizeFaceRt(identity, n.rotation);
    expect(rotated).toHaveLength(16);
    // The rotated frame's columns stay orthonormal and the translation keeps its length.
    const cols = [0, 1, 2].map(c => [rotated[c * 4], rotated[c * 4 + 1], rotated[c * 4 + 2]]);
    cols.forEach((u, i) => cols.forEach((v, j) => expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(i === j ? 1 : 0, 6)));
    expect(Math.hypot(rotated[12], rotated[13], rotated[14])).toBeCloseTo(50, 6);
    expect(rotated[15]).toBe(1);
    const { k, inverse } = intrinsics(W, H);
    multiply3(k, inverse).forEach((row, r) => row.forEach((v, c) => expect(v).toBeCloseTo(r === c ? 1 : 0, 9)));
  });
});
