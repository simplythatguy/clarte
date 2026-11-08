import { describe, expect, it } from 'vitest';
import { Matrix } from 'ml-matrix';
import { createIntrinsicsMatrix, createPerspectiveMatrix, eulerToMatrix, faceReconstruction, getHeadVector, translateMatrix } from '../vendor/webeyetrack/local/utils/mathUtils';

/** MediaPipe-style packed data: column-major, rotation R (3×3 row-major array) and translation t. */
const packed = (R: Matrix, t: [number, number, number]) => {
  const d = new Array(16).fill(0);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) d[col * 4 + row] = R.get(row, col);
  d[12] = t[0]; d[13] = t[1]; d[14] = t[2]; d[15] = 1;
  return { rows: 4, columns: 4, data: d };
};
const rotations = [[0, 0, 0], [12, -7, 3], [-25, 15, -4], [8, 30, 10], [-18, -22, 6]].map(([p, y, r]) => eulerToMatrix(p, y, r));

describe('fixes.matrixLayout (gaze-lab adaptation of mathUtils)', () => {
  it('reads the translation from indices 12-14 only with the column-major flag', () => {
    const m = packed(rotations[1], [1.5, -2.5, -40]);
    const cm = translateMatrix(m, true), rm = translateMatrix(m);
    expect([cm.get(0, 3), cm.get(1, 3), cm.get(2, 3)]).toEqual([1.5, -2.5, -40]);
    expect([rm.get(3, 0), rm.get(3, 1), rm.get(3, 2)]).toEqual([1.5, -2.5, -40]);
    expect(cm.transpose().to2DArray()).toEqual(rm.to2DArray());
  });
  it('column-major head vector = forward axis (third column, z negated); shipped read = third row', () => {
    for (const R of rotations) {
      const m = packed(R, [0, 0, -45]);
      const fixed = getHeadVector(translateMatrix(m, true)), shipped = getHeadVector(translateMatrix(m));
      const d = m.data;
      [d[8], d[9], -d[10]].forEach((v, i) => expect(fixed[i]).toBeCloseTo(v, 9));
      [d[2], d[6], -d[10]].forEach((v, i) => expect(shipped[i]).toBeCloseTo(v, 9));
    }
    // The two differ as soon as the head turns: yaw and pitch change sign to first order.
    const m = packed(rotations[2], [0, 0, -45]);
    const fixed = getHeadVector(translateMatrix(m, true)), shipped = getHeadVector(translateMatrix(m));
    expect(Math.sign(fixed[0])).toBe(-Math.sign(shipped[0])); expect(Math.sign(fixed[1])).toBe(-Math.sign(shipped[1]));
  });
  it('faceReconstruction with the column-major read + inverse reproduces the shipped reconstruction on an exact rotation', () => {
    // Shipped: row-major read gives Rᵀ = R⁻¹, which the Euler step consumes directly. Fixed: R read correctly, then inverse(R) as the
    // Python pipeline does. Both are the same number for an orthonormal R, so the layout fix changes the head vector but not the face origin.
    const persp = createPerspectiveMatrix(1280 / 720), K = createIntrinsicsMatrix(1280, 720);
    const landmarks: [number, number][] = Array.from({ length: 478 }, (_, i) => [.42 + .16 * ((i * 37) % 101) / 100, .3 + .3 * ((i * 53) % 97) / 96]);
    landmarks[4] = [.5, .5]; landmarks[356] = [.6, .5]; landmarks[127] = [.4, .5];
    for (const R of rotations) {
      const m = packed(R, [0, 0, -45]);
      const [, shipped] = faceReconstruction(persp, landmarks, translateMatrix(m), K, 14, 1280, 720, 60);
      const [, fixed] = faceReconstruction(persp, landmarks, translateMatrix(m, true), K, 14, 1280, 720, 60, true);
      // Not bit-identical: transform3DTo2D rounds projected pixels, so a 1e-16 difference in the Euler angles can move one rounded
      // pixel and shift the refined depth by 0.1/478 ≈ 2e-4 cm. Anything above 1e-3 cm would mean a real geometric difference.
      for (let i = 0; i < 478; i++) for (let k = 0; k < 3; k++) expect(Math.abs(fixed[i][k] - shipped[i][k])).toBeLessThan(1e-3);
    }
  });
});
