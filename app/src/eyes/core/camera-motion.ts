/**
 * Camera motion (laptop lid tilt, the laptop being nudged) from the camera image itself.
 *
 * When the lid tilts, everything in the image moves together: the background behind the person
 * and the person's face shift by the same amount. When the person moves, only the face does; when
 * someone walks past behind them, only part of the background does. So the detector matches the
 * background outside the face against a reference frame to find a whole-image shift, and reports a
 * camera move only when that shift is clear, repeated over several frames and matched by the face.
 *
 * It works on coarse grey images (1/8 and 1/32 of the frame), never keeps a frame at full
 * resolution, and reports only a shift in pixels and the equivalent tilt angle. Blank walls give
 * no texture to match, so nothing is reported there: the detector fails silent, never loud.
 */
export type FaceBox = { left: number; top: number; right: number; bottom: number };
export type CameraMotion = {
  /** Whole-image shift in frame pixels (+x right, +y down) since the reference frame, when the background was matchable. */
  dx: number; dy: number;
  /** Camera tilt equivalent of `dy`, in degrees, assuming a focal length of one frame width. */
  tiltDeg: number;
  /** True on the observation where a move was confirmed: the app should re-anchor what depends on the camera's pose. */
  moved: boolean;
  /** Whether the background had enough texture to match at all. */
  matchable: boolean;
};

export const CAMERA_MOTION = {
  /** Coarse cell size in frame pixels for the fine and the coarse search. */
  fine: 8, coarse: 32,
  /** Coarse search radius in coarse cells (±6 × 32 = ±192 px, about ±8° at a 1280 px frame) and fine refinement radius in fine cells. */
  coarseRadius: 6, fineRadius: 2,
  /** Minimum standard deviation of the masked background (grey levels) for a match to mean anything. */
  minimumTexture: 6,
  /** The best shift must cut the zero-shift difference to at most this share to count as a shift. */
  improvement: .6,
  /** Shifts smaller than this many frame pixels are stillness; the fine step is 8 px, so the smallest reported move is one cell. */
  minimumShiftPx: 12,
  /** Consecutive agreeing observations (within `agreementPx`) before a move is confirmed. */
  confirmations: 3, agreementPx: 12,
  /** The face must have shifted along with the background: within this share of the shift plus a slack, in pixels. */
  faceShare: .5, faceSlackPx: 10,
  /** With a still background for this long (ms), the reference frame is refreshed so lighting changes do not accumulate. */
  refreshMs: 4000,
  /** Face box margins before masking: a share of the box width on each side, of its height above, and everything below. */
  faceMarginX: .5, faceMarginTop: .4,
  /** The bottom share of the frame (hands, keyboard) is never used. */
  bottomMargin: .15,
  /** Sampling stride inside each fine cell: 2 means every other pixel in both directions. */
  stride: 2,
};

type Grey = { width: number; height: number; data: Float32Array };

/** Grey cells of one frame: the mean of sampled pixels in each `fine`×`fine` block. */
export function downsample(frame: ImageData, cell = CAMERA_MOTION.fine, stride = CAMERA_MOTION.stride): Grey {
  const width = Math.floor(frame.width / cell), height = Math.floor(frame.height / cell);
  const data = new Float32Array(width * height), px = frame.data, perCell = (cell / stride) * (cell / stride);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      let sum = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y += stride) {
        let i = (y * frame.width + cx * cell) * 4;
        for (let x = 0; x < cell; x += stride, i += 4 * stride) sum += px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114;
      }
      data[cy * width + cx] = sum / perCell;
    }
  }
  return { width, height, data };
}

function coarsen(fine: Grey, factor: number): Grey {
  const width = Math.floor(fine.width / factor), height = Math.floor(fine.height / factor);
  const data = new Float32Array(width * height);
  for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
    let sum = 0;
    for (let y = 0; y < factor; y++) for (let x = 0; x < factor; x++) sum += fine.data[(cy * factor + y) * fine.width + cx * factor + x];
    data[cy * width + cx] = sum / (factor * factor);
  }
  return { width, height, data };
}

/** Cells to compare: outside the padded face box, above the body, above the bottom margin. */
function mask(grey: Grey, cell: number, frame: { width: number; height: number }, face: FaceBox | null): Uint8Array {
  const out = new Uint8Array(grey.width * grey.height);
  const bottom = frame.height * (1 - CAMERA_MOTION.bottomMargin);
  const fw = face ? face.right - face.left : 0, fh = face ? face.bottom - face.top : 0;
  const fx0 = face ? face.left - fw * CAMERA_MOTION.faceMarginX : Infinity, fx1 = face ? face.right + fw * CAMERA_MOTION.faceMarginX : -Infinity, fy0 = face ? face.top - fh * CAMERA_MOTION.faceMarginTop : Infinity;
  for (let cy = 0; cy < grey.height; cy++) for (let cx = 0; cx < grey.width; cx++) {
    const x = (cx + .5) * cell, y = (cy + .5) * cell;
    out[cy * grey.width + cx] = y < bottom && !(x >= fx0 && x <= fx1 && y >= fy0) ? 1 : 0;
  }
  return out;
}

function texture(grey: Grey, keep: Uint8Array): number {
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < grey.data.length; i++) if (keep[i]) { n++; sum += grey.data[i]; sq += grey.data[i] * grey.data[i]; }
  return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
}

/** Mean absolute difference between `current` cells (where kept) and `reference` cells displaced by (dx, dy); NaN without overlap. */
function difference(current: Grey, reference: Grey, keep: Uint8Array, dx: number, dy: number): number {
  let n = 0, sum = 0;
  for (let cy = Math.max(0, dy); cy < Math.min(current.height, reference.height + dy); cy++) {
    for (let cx = Math.max(0, dx); cx < Math.min(current.width, reference.width + dx); cx++) {
      const i = cy * current.width + cx;
      if (!keep[i]) continue;
      sum += Math.abs(current.data[i] - reference.data[(cy - dy) * reference.width + (cx - dx)]); n++;
    }
  }
  return n >= 16 ? sum / n : NaN;
}

function bestShift(current: Grey, reference: Grey, keep: Uint8Array, centre: [number, number], radius: number): { dx: number; dy: number; best: number; zero: number } {
  const zero = difference(current, reference, keep, 0, 0);
  let best = { dx: centre[0], dy: centre[1], value: difference(current, reference, keep, centre[0], centre[1]) };
  for (let dy = centre[1] - radius; dy <= centre[1] + radius; dy++) for (let dx = centre[0] - radius; dx <= centre[0] + radius; dx++) {
    const value = difference(current, reference, keep, dx, dy);
    // Prefer the smaller shift on ties, so flat regions settle on stillness.
    if (value < best.value - 1e-6 || (Math.abs(value - best.value) <= 1e-6 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, value };
  }
  return { dx: best.dx, dy: best.dy, best: best.value, zero };
}

export class CameraMotionDetector {
  private reference: { fine: Grey; coarse: Grey; face: [number, number] | null; at: number } | null = null;
  private stillSince = -Infinity;
  private pending: { dx: number; dy: number; count: number } | null = null;

  reset(): void { this.reference = null; this.pending = null; this.stillSince = -Infinity; }

  /**
   * One camera frame with its face box (frame pixels) or null when no face was found.
   * Returns the shift since the reference frame; `moved` is true once per confirmed move.
   */
  observe(frame: ImageData, face: FaceBox | null, at: number): CameraMotion | null {
    if (!(frame.width >= CAMERA_MOTION.coarse * 4) || !(frame.height >= CAMERA_MOTION.coarse * 3)) return null;
    const fine = downsample(frame), coarse = coarsen(fine, CAMERA_MOTION.coarse / CAMERA_MOTION.fine);
    const faceCentre: [number, number] | null = face ? [(face.left + face.right) / 2, (face.top + face.bottom) / 2] : null;
    const keepFine = mask(fine, CAMERA_MOTION.fine, frame, face), keepCoarse = mask(coarse, CAMERA_MOTION.coarse, frame, face);
    if (!this.reference) { this.reference = { fine, coarse, face: faceCentre, at }; this.stillSince = at; return { dx: 0, dy: 0, tiltDeg: 0, moved: false, matchable: texture(fine, keepFine) >= CAMERA_MOTION.minimumTexture }; }
    const matchable = texture(this.reference.fine, keepFine) >= CAMERA_MOTION.minimumTexture && texture(fine, keepFine) >= CAMERA_MOTION.minimumTexture;
    if (!matchable) { this.pending = null; return { dx: 0, dy: 0, tiltDeg: 0, moved: false, matchable: false }; }
    const wide = bestShift(coarse, this.reference.coarse, keepCoarse, [0, 0], CAMERA_MOTION.coarseRadius);
    const factor = CAMERA_MOTION.coarse / CAMERA_MOTION.fine;
    const narrow = bestShift(fine, this.reference.fine, keepFine, [wide.dx * factor, wide.dy * factor], CAMERA_MOTION.fineRadius);
    let dx = narrow.dx * CAMERA_MOTION.fine, dy = narrow.dy * CAMERA_MOTION.fine;
    const clear = Number.isFinite(narrow.best) && Number.isFinite(narrow.zero) && narrow.best <= narrow.zero * CAMERA_MOTION.improvement;
    if (!clear || Math.hypot(dx, dy) < CAMERA_MOTION.minimumShiftPx) { dx = 0; dy = 0; }
    const tiltDeg = Math.atan2(dy, frame.width) * 180 / Math.PI;
    let moved = false;
    if (dx === 0 && dy === 0) {
      this.pending = null;
      if (!Number.isFinite(this.stillSince)) this.stillSince = at;
      // A long-still scene refreshes the reference so slow lighting changes never read as motion.
      if (at - this.stillSince >= CAMERA_MOTION.refreshMs) { this.reference = { fine, coarse, face: faceCentre, at }; this.stillSince = at; }
      return { dx, dy, tiltDeg, moved, matchable };
    }
    this.stillSince = -Infinity;
    const faceAgrees = faceCentre && this.reference.face
      ? Math.hypot(faceCentre[0] - this.reference.face[0] - dx, faceCentre[1] - this.reference.face[1] - dy) <= Math.hypot(dx, dy) * CAMERA_MOTION.faceShare + CAMERA_MOTION.faceSlackPx
      : false;
    if (!faceAgrees) { this.pending = null; return { dx, dy, tiltDeg, moved, matchable }; }
    if (this.pending && Math.hypot(this.pending.dx - dx, this.pending.dy - dy) <= CAMERA_MOTION.agreementPx) this.pending.count++;
    else this.pending = { dx, dy, count: 1 };
    if (this.pending.count >= CAMERA_MOTION.confirmations) {
      moved = true; this.pending = null;
      // The new pose becomes the reference: later moves are measured from here.
      this.reference = { fine, coarse, face: faceCentre, at }; this.stillSince = at;
    }
    return { dx, dy, tiltDeg, moved, matchable };
  }
}

/** Face box in frame pixels from normalized landmarks; null when there are none. */
export function faceBox(landmarks: readonly { x: number; y: number }[], frame: { width: number; height: number }): FaceBox | null {
  if (landmarks.length < 468) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
  }
  return { left: left * frame.width, top: top * frame.height, right: right * frame.width, bottom: bottom * frame.height };
}

export function readCameraMotion(v: unknown): CameraMotion | null {
  if (!v || typeof v !== 'object' || !('dx' in v) || !('dy' in v) || !('tiltDeg' in v) || !('moved' in v) || !('matchable' in v)) return null;
  const { dx, dy, tiltDeg, moved, matchable } = v;
  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof tiltDeg !== 'number' || ![dx, dy, tiltDeg].every(Number.isFinite) || typeof moved !== 'boolean' || typeof matchable !== 'boolean') return null;
  return { dx, dy, tiltDeg, moved, matchable };
}
