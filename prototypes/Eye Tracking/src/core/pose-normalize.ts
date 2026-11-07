/**
 * Pose normalization of the camera image before the eye crop ("data normalization" in the gaze
 * literature). A virtual camera is rotated so that it looks straight at the face and has no roll:
 * its z-axis points at the eye midpoint and its x-axis follows the head's x-axis. The image is
 * warped by the pure-rotation homography H = K·R·K⁻¹, so the eye strip stops changing with where
 * the face sits in the frame or how the head is tilted, and the gaze network sees a narrower range
 * of appearances. The face's real position is kept separately for the point-of-regard mapping.
 *
 * Plain arrays, no dependencies; pixel coordinates throughout (x right, y down, z into the scene).
 */
export type Matrix3 = number[][];
export type Point2 = [number, number];

const EYE_CORNERS = [33, 133, 362, 263];
const normalize = (v: number[]) => { const n = Math.hypot(v[0], v[1], v[2]); return n > 1e-12 ? v.map(c => c / n) : null; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map(row => [0, 1, 2].map(c => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
}
export const transpose3 = (m: Matrix3): Matrix3 => [0, 1, 2].map(c => m.map(row => row[c]));
export function applyHomography3(h: Matrix3, p: Point2): Point2 {
  const w = h[2][0] * p[0] + h[2][1] * p[1] + h[2][2];
  return [(h[0][0] * p[0] + h[0][1] * p[1] + h[0][2]) / w, (h[1][0] * p[0] + h[1][1] * p[1] + h[1][2]) / w];
}

/** Pinhole intrinsics matching the tracker's fallback: focal length = frame width, principal point at the centre. */
export function intrinsics(width: number, height: number): { k: Matrix3; inverse: Matrix3 } {
  const f = width, cx = width / 2, cy = height / 2;
  return { k: [[f, 0, cx], [0, f, cy], [0, 0, 1]], inverse: [[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]] };
}

/**
 * Rotation from camera to normalized camera, and the image homography that applies it.
 * `landmarksPx`: MediaPipe landmarks in pixels. `faceRt`: the 16-value column-major face
 * transformation matrix in MediaPipe's camera axes (x right, y up, z toward the viewer), or null to
 * take the head's x-axis from the eye-corner line instead. Null when the geometry is degenerate.
 */
export function poseNormalization(landmarksPx: readonly Point2[], faceRt: ArrayLike<number> | null | undefined, width: number, height: number): { rotation: Matrix3; homography: Matrix3 } | null {
  if (landmarksPx.length < 478 || !(width > 0) || !(height > 0)) return null;
  const corners = EYE_CORNERS.map(i => landmarksPx[i]);
  if (corners.some(p => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const centre: Point2 = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4];
  const { k, inverse } = intrinsics(width, height);
  const z = normalize([inverse[0][0] * centre[0] + inverse[0][2], inverse[1][1] * centre[1] + inverse[1][2], 1]);
  if (!z) return null;
  // Head x-axis in image axes: MediaPipe's camera has y up and z toward the viewer, the image has y down and z forward.
  let xHead: number[] | null = null;
  if (faceRt && faceRt.length === 16 && [faceRt[0], faceRt[1], faceRt[2]].every(Number.isFinite)) xHead = normalize([faceRt[0], -faceRt[1], -faceRt[2]]);
  if (!xHead || Math.abs(dot(xHead, z)) > .95) {
    // Fallback: the eye-corner line from the person's right eye to their left eye, in the image plane.
    xHead = normalize([landmarksPx[263][0] - landmarksPx[33][0], landmarksPx[263][1] - landmarksPx[33][1], 0]);
    if (!xHead) return null;
  }
  const xProjected = normalize([xHead[0] - dot(xHead, z) * z[0], xHead[1] - dot(xHead, z) * z[1], xHead[2] - dot(xHead, z) * z[2]]);
  if (!xProjected) return null;
  const y = cross(z, xProjected);
  const rotation: Matrix3 = [xProjected, y, z];
  const homography = multiply3(multiply3(k, rotation), inverse);
  return { rotation, homography };
}

/**
 * The face transformation matrix as seen by the normalized camera, in MediaPipe's layout
 * (16 values, column-major, y up, z toward the viewer): the rotation part is pre-multiplied by the
 * normalization rotation converted into those axes; the translation column is rotated the same way.
 */
export function normalizeFaceRt(faceRt: ArrayLike<number>, rotation: Matrix3): number[] {
  // Image axes → MediaPipe axes: flip y and z.
  const flip: Matrix3 = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const r = multiply3(multiply3(flip, rotation), flip);
  const out = Array.from({ length: 16 }, (_, i) => Number(faceRt[i]));
  for (let col = 0; col < 4; col++) {
    const v = [faceRt[col * 4], faceRt[col * 4 + 1], faceRt[col * 4 + 2]].map(Number);
    for (let row = 0; row < 3; row++) out[col * 4 + row] = r[row][0] * v[0] + r[row][1] * v[1] + r[row][2] * v[2];
  }
  return out;
}
