/**
 * The person's face as the Cloud mirrors it (NAT-47, owner 2026-11-08): "it reads if a face is
 * smiling or blinking eyes (right or left) it would blink the cloud character as well. When the
 * user moves right or left, the character keeps tracking his movement in the drawn face."
 *
 * Read from the MediaPipe face landmarks the eye tracker already finds each frame (tracker.ts asks
 * the worker for them with `debug`); nothing here touches gaze. Each measure is relative to the
 * person's own face, learnt as they go, so it works for any face shape and distance:
 *
 *  - Eyes: each eye's openness (lid gap over eye width). An eye is shut when it falls below half of
 *    that eye's usual open gap, and open again above two thirds of it (hysteresis, so it does not
 *    flicker). A smile narrows the eyes, so while smiling an eye must close further to count.
 *  - Smile: mouth width over the eyes' width, plus how far the mouth corners rise above the lips'
 *    middle. The resting level is learnt quickly downwards and slowly upwards, so a smile never
 *    becomes the new normal. Smiling above rest + 0.07, not smiling below rest + 0.04. When the mouth
 *    is not in the camera's view (MediaPipe still guesses where it would be) the smile is not read.
 *  - Where they are: the midpoint between the eyes in the camera frame, as a look for the Cloud's
 *    face. The camera sees the person unmirrored, so moving to their right moves them left in the
 *    frame; the face looks towards the screen side they moved to.
 *
 * Sides are the Cloud's screen sides, as in a mirror: closing the right eye closes the Cloud's eye
 * on the right of the screen.
 */
import { useSyncExternalStore } from 'react';

export type FaceMirror = {
  /** A face was read recently. Everything below is at rest when not. */
  present: boolean;
  /** Where the Cloud's face looks to follow the person: -1…1 per axis at full reach. */
  look: { x: number; y: number } | null;
  shutLeft: boolean;
  shutRight: boolean;
  smiling: boolean;
};

const AT_REST: FaceMirror = { present: false, look: null, shutLeft: false, shutRight: false, smiling: false };
/** No face read for this long: back to rest. */
const LOST_MS = 600;
/** How far the face looks per unit of frame offset from the centre, and its limit. */
const LOOK_GAIN = { x: 6, y: 4.5 };
const LOOK_MAX = 2.6;

// MediaPipe Face Mesh indices. "Right" is the person's own right eye.
const RIGHT_EYE = { outer: 33, inner: 133, lids: [[159, 145], [158, 153], [160, 144]] };
const LEFT_EYE = { outer: 263, inner: 362, lids: [[386, 374], [385, 380], [387, 373]] };
const MOUTH = { left: 291, right: 61, upper: 13, lower: 14 };

type P = { x: number; y: number };

/** A level that follows a signal quickly one way and slowly the other. */
class Level {
  value: number | null = null;
  constructor(private readonly fast: number, private readonly slow: number, private readonly towardHigh: boolean) {}
  feed(v: number): number {
    if (this.value === null) { this.value = v; return v; }
    const quick = this.towardHigh ? v > this.value : v < this.value;
    this.value += (v - this.value) * (quick ? this.fast : this.slow);
    return this.value;
  }
  reset() { this.value = null; }
}

let state: FaceMirror = AT_REST;
const listeners = new Set<() => void>();
const openRight = new Level(0.25, 0.01, true);
const openLeft = new Level(0.25, 0.01, true);
const smileRest = new Level(0.08, 0.003, false);
let seenAt = -Infinity;
let lostTimer = 0;
let look: { x: number; y: number } | null = null;

function publish(next: FaceMirror) {
  const same = next.present === state.present && next.shutLeft === state.shutLeft && next.shutRight === state.shutRight && next.smiling === state.smiling
    && (next.look === state.look || (next.look && state.look && Math.abs(next.look.x - state.look.x) < 0.01 && Math.abs(next.look.y - state.look.y) < 0.01));
  if (same) return;
  state = next;
  for (const fn of listeners) fn();
}

const dist = (a: P, b: P, aspect: number) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);

function openness(at: (i: number) => P, eye: typeof RIGHT_EYE, aspect: number): number {
  const width = dist(at(eye.outer), at(eye.inner), aspect);
  if (!(width > 1e-6)) return 0;
  const gap = eye.lids.reduce((sum, [u, l]) => sum + dist(at(u), at(l), aspect), 0) / eye.lids.length;
  return gap / width;
}

/** Feed one frame's landmarks: flat x, y, z per point (478 points), normalized to the frame. */
export function observeFace(flat: ArrayLike<number>, at: number, frame: { width: number; height: number }): void {
  if (flat.length < 478 * 3 || !(frame.width > 0) || !(frame.height > 0)) return;
  const aspect = frame.height / frame.width;
  const point = (i: number): P => ({ x: flat[i * 3], y: flat[i * 3 + 1] });

  // Eyes.
  const smilingNow = state.smiling;
  const shut = (open: number, level: Level, wasShut: boolean) => {
    // Learn the open level from open frames only, so a held wink does not drag it down.
    const usual = level.value ?? open;
    if (!wasShut) level.feed(open);
    const closeAt = (smilingNow ? 0.4 : 0.5) * usual, openAt = (smilingNow ? 0.55 : 0.66) * usual;
    return wasShut ? open < openAt : open < closeAt;
  };
  const right = openness(point, RIGHT_EYE, aspect), left = openness(point, LEFT_EYE, aspect);
  // The person's right eye is the Cloud's right side, as in a mirror.
  const shutRight = shut(right, openRight, state.shutRight);
  const shutLeft = shut(left, openLeft, state.shutLeft);

  // Smile: wider mouth and lifted corners, against the person's own resting mouth.
  const span = dist(point(RIGHT_EYE.outer), point(LEFT_EYE.outer), aspect);
  let smiling = false;
  const inView = (q: P) => q.x > 0.01 && q.x < 0.99 && q.y > 0.01 && q.y < 0.97;
  const mouthSeen = [MOUTH.left, MOUTH.right, MOUTH.upper, MOUTH.lower].every((i) => inView(point(i)));
  if (span > 1e-6 && mouthSeen) {
    const width = dist(point(MOUTH.left), point(MOUTH.right), aspect) / span;
    const middle = (point(MOUTH.upper).y + point(MOUTH.lower).y) / 2;
    const corners = (point(MOUTH.left).y + point(MOUTH.right).y) / 2;
    const lift = ((middle - corners) * aspect) / span; // positive when the corners rise above the lips' middle
    const measure = width + 0.6 * lift;
    const rest = smileRest.value ?? measure;
    smiling = state.smiling ? measure > rest + 0.04 : measure > rest + 0.07;
    if (!smiling) smileRest.feed(measure);
  }

  // Where they are: the midpoint between the eyes, smoothed a little.
  const c = { x: (point(RIGHT_EYE.outer).x + point(LEFT_EYE.outer).x) / 2, y: (point(RIGHT_EYE.outer).y + point(LEFT_EYE.outer).y) / 2 };
  const clamp = (v: number) => Math.max(-LOOK_MAX, Math.min(LOOK_MAX, v));
  const target = { x: clamp((0.5 - c.x) * LOOK_GAIN.x), y: clamp((c.y - 0.45) * LOOK_GAIN.y) };
  look = look ? { x: look.x + (target.x - look.x) * 0.5, y: look.y + (target.y - look.y) * 0.5 } : target;

  seenAt = at;
  publish({ present: true, look, shutLeft, shutRight, smiling });
  clearTimeout(lostTimer);
  lostTimer = window.setTimeout(faceLost, LOST_MS);
}

/** No face (the camera stopped, or the person left): the Cloud's face goes back to rest. */
export function faceLost(): void {
  clearTimeout(lostTimer);
  if (performance.now() - seenAt < LOST_MS - 50 && state.present) { lostTimer = window.setTimeout(faceLost, LOST_MS); return; }
  look = null;
  publish(AT_REST);
}

/** Forget the person's learnt levels (a new camera session). */
export function resetFace(): void {
  openRight.reset(); openLeft.reset(); smileRest.reset();
  seenAt = -Infinity;
  look = null;
  publish(AT_REST);
}

export function faceMirror(): FaceMirror { return state; }

export function subscribeFace(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Whether the person is smiling now, for React (re-renders only when it changes). */
export function useMirrorSmile(): boolean {
  return useSyncExternalStore(subscribeFace, () => state.smiling, () => false);
}
