/**
 * Head position from the tracker's own numbers. `faceOrigin3D` is the eye midpoint in the tracker's camera
 * space in cm: +x toward image right (the tester's left on an unmirrored webcam), +y toward image bottom, +z
 * depth away from the camera. `faceRt` is MediaPipe's face transformation matrix (16 values, column-major,
 * camera axes x right, y up, z toward the viewer); the head's forward axis is its third column.
 * Sign conventions are documented, not verified on hardware: the Setup live readout is where to check them.
 */
export type HeadAngles = { yawDeg: number; pitchDeg: number; rollDeg: number };
export type HeadOffset = { dx: number; dy: number; dz: number; yawDeg: number; pitchDeg: number };
export type HeadReference = { origin: [number, number, number]; yawDeg: number; pitchDeg: number; samples: number };

const deg = (r: number) => r * 180 / Math.PI;

export function headAngles(faceRt: readonly number[] | null | undefined): HeadAngles | null {
  if (!faceRt || faceRt.length !== 16 || !faceRt.every(Number.isFinite)) return null;
  const fx = faceRt[8], fy = faceRt[9], fz = faceRt[10];
  const n = Math.hypot(fx, fy, fz);
  if (!(n > 1e-6)) return null;
  // Yaw: forward axis swung toward +x (image right); pitch: toward +y (up); roll from the head's x axis.
  return { yawDeg: deg(Math.atan2(fx / n, fz / n)), pitchDeg: deg(Math.asin(Math.max(-1, Math.min(1, fy / n)))), rollDeg: deg(Math.atan2(faceRt[1], faceRt[0])) };
}

export function median(values: readonly number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
}
export function percentile(values: readonly number[], p: number): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : NaN;
}

export type HeadSample = { origin: readonly number[]; faceRt: readonly number[] | null };

/** Median position and angles over samples, e.g. the calibration frames; null without usable samples. */
export function headReference(samples: readonly HeadSample[]): HeadReference | null {
  const usable = samples.filter(s => s.origin.length === 3 && s.origin.every(Number.isFinite) && s.origin[2] > 0);
  if (!usable.length) return null;
  const angles = usable.map(s => headAngles(s.faceRt)).filter((a): a is HeadAngles => a !== null);
  return { origin: [median(usable.map(s => s.origin[0])), median(usable.map(s => s.origin[1])), median(usable.map(s => s.origin[2]))], yawDeg: angles.length ? median(angles.map(a => a.yawDeg)) : NaN, pitchDeg: angles.length ? median(angles.map(a => a.pitchDeg)) : NaN, samples: usable.length };
}

export function headOffset(current: HeadSample, reference: HeadReference): HeadOffset | null {
  if (current.origin.length !== 3 || !current.origin.every(Number.isFinite)) return null;
  const angles = headAngles(current.faceRt);
  return { dx: current.origin[0] - reference.origin[0], dy: current.origin[1] - reference.origin[1], dz: current.origin[2] - reference.origin[2],
    yawDeg: angles ? angles.yawDeg - reference.yawDeg : NaN, pitchDeg: angles ? angles.pitchDeg - reference.pitchDeg : NaN };
}

/** Median offset over many samples (a block), relative to the calibration reference. */
export function medianOffset(samples: readonly HeadSample[], reference: HeadReference): (HeadOffset & { samples: number }) | null {
  const offsets = samples.map(s => headOffset(s, reference)).filter((o): o is HeadOffset => o !== null);
  if (!offsets.length) return null;
  return { dx: median(offsets.map(o => o.dx)), dy: median(offsets.map(o => o.dy)), dz: median(offsets.map(o => o.dz)), yawDeg: median(offsets.map(o => o.yawDeg)), pitchDeg: median(offsets.map(o => o.pitchDeg)), samples: offsets.length };
}

/** One line for the live readout: signed cm and degrees, in the tester's words. */
export function describeOffset(o: HeadOffset | null): string {
  if (!o) return 'head not found';
  const cm = (v: number, neg: string, pos: string) => (!Number.isFinite(v) ? '—' : Math.abs(v) < .5 ? '0 cm' : `${Math.abs(v).toFixed(1)} cm ${v < 0 ? neg : pos}`);
  const dg = (v: number, neg: string, pos: string) => (!Number.isFinite(v) ? '—' : Math.abs(v) < 1 ? '0°' : `${Math.abs(v).toFixed(0)}° ${v < 0 ? neg : pos}`);
  return `${cm(o.dx, 'right', 'left')} · ${cm(-o.dy, 'down', 'up')} · ${cm(o.dz, 'closer', 'farther')} · yaw ${dg(o.yawDeg, 'right', 'left')} · pitch ${dg(o.pitchDeg, 'down', 'up')}`;
}
