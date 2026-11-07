/**
 * Style 1's binding to the shared gaze engine.
 *
 * The engine owns timing and selection rules; this module owns how a dwell looks and which dwell
 * class applies. It renders without React and without per-frame style writes: the tile being
 * looked at carries `data-gaze` (one attribute change per state), and the ring's fill, drain and
 * bloom are Web Animations started once per event.
 *
 * Choreography (BRIEF "Selection", MOTION "The dwell indicator"), timed from the gaze's arrival:
 * nothing for the first 150 ms (groups) or 250 ms (controls); then one static cue, the face steps
 * one shade and the ring's track turns opaque; then an accent arc fills clockwise from 12 o'clock,
 * linear, over the remaining dwell; at commit the ring goes solid, the click plays and the ring
 * blooms; on cancel the arc drains back over 150 ms.
 */
import { GazeEngine, attachKeyboard, type GazeSnapshot } from '../../shared/gaze.ts';
import { actionIn, collectActionables, quadrantAt, quadrantsForAction, viewportOf, type QuadrantId } from '../../shared/quadrants.ts';
import { trackActionables } from '../../shared/overlay.ts';
import type { Settings } from './settings.ts';

export const engine = new GazeEngine({ mode: 'confirm', dwellMs: 900 });

const isGroup = (action: string) => /^G[1-4]$/.test(action);

/**
 * The dwell class an action belongs to: letter groups are cheap to undo, controls are not.
 * The brief's numbers run from the moment the gaze arrives, but the engine only starts a dwell
 * after its quadrant hold (`holdMs`), so the hold is taken out of both here.
 */
function classOf(action: string, settings: Settings): { dwell: number; visibleAfter: number } {
  const hold = engine.settings.holdMs;
  const [dwell, delay] = isGroup(action) ? [settings.dwellGroups, 150] : [settings.dwellControls, 250];
  return { dwell: Math.max(100, dwell - hold), visibleAfter: Math.max(0, delay - hold) };
}

export function applySettings(settings: Settings): void {
  engine.configure({
    mode: settings.mode,
    // Repeat-by-staying is a dwell feature; in confirm mode it would fire without a confirm.
    repeat: settings.mode === 'confirm' ? 'leave' : settings.repeat,
    noiseSigma: settings.noise,
    // Leaving a quadrant already takes the 150 ms hold, which is the guard against re-firing;
    // a further re-arm delay only postponed the next target's dwell (council round 2).
    rearmMs: 0,
  });
}

function tileFor(action: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`);
}

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One tile's instrument. Every change runs as a Web Animation on the ring itself, never as a
 * per-frame style write: the arc's fill is one linear animation per dwell, the drain and the
 * bloom are one animation each, and each starts from the value on screen, so they retarget
 * instead of snapping (MOTION "The dwell indicator").
 */
type RingMode = 'rest' | 'dwell' | 'paused' | 'preview' | 'latched';
type Ring = {
  tile: HTMLElement;
  /** The arc's two sweeps: the right half (12 → 6 o'clock) and the left half (6 → 12). */
  first: HTMLElement;
  second: HTMLElement;
  arc: HTMLElement;
  bloom: HTMLElement;
  mode: RingMode;
  anims: Animation[];
};

const rings = new WeakMap<HTMLElement, Ring>();

function ringOf(tile: HTMLElement): Ring | null {
  const known = rings.get(tile);
  if (known && known.first.isConnected) return known;
  const first = tile.querySelector<HTMLElement>('.half--r .sweep');
  const second = tile.querySelector<HTMLElement>('.half--l .sweep');
  const arc = tile.querySelector<HTMLElement>('.arc');
  const bloom = tile.querySelector<HTMLElement>('.bloom');
  if (!first || !second || !arc || !bloom) return null;
  const made: Ring = { tile, first, second, arc, bloom, mode: 'rest', anims: [] };
  rings.set(tile, made);
  return made;
}

/** The angle a sweep shows right now, read from the screen (0..180). */
function angleOf(el: HTMLElement): number {
  const m = getComputedStyle(el).transform;
  if (!m || m === 'none') return 0;
  const [a, b] = m.slice(m.indexOf('(') + 1, -1).split(',').map(Number);
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return Math.max(0, Math.min(180, deg < -1 ? deg + 360 : deg));
}

const rot = (deg: number) => ({ transform: `rotate(${deg}deg)` });

function stop(r: Ring): void {
  for (const anim of r.anims) anim.cancel();
  r.anims = [];
}

function setMode(r: Ring, mode: RingMode): void {
  r.mode = mode;
  if (mode === 'rest') delete r.tile.dataset.gaze;
  else r.tile.dataset.gaze = mode === 'paused' ? 'dwell' : mode;
}

/** The gaze is already in another quadrant (the engine's hold has not switched yet): hold still. */
function pause(r: Ring): void {
  for (const anim of r.anims) anim.pause();
  r.mode = 'paused';
}

/** Fill clockwise from what is drawn now to full, linear, over the time the dwell has left. */
function fill(r: Ring, from: number, remaining: number): void {
  stop(r);
  setMode(r, 'dwell');
  const duration = Math.max(1, remaining);
  if (reducedMotion()) {
    // Reduced motion: the ring is drawn whole (CSS) and steps from faint to solid in four steps.
    r.anims = [r.arc.animate([{ opacity: 0.3 + 0.7 * from }, { opacity: 1 }], { duration, easing: 'steps(4, end)', fill: 'forwards' })];
    return;
  }
  const a = Math.min(180, from * 360);
  const b = Math.max(0, from * 360 - 180);
  // The moment the first half completes, as a fraction of the remaining time.
  const k = from >= 0.5 ? 0 : (0.5 - from) / (1 - from);
  r.anims = [
    r.first.animate([{ ...rot(a), offset: 0 }, { ...rot(180), offset: k }, { ...rot(180), offset: 1 }], { duration, easing: 'linear', fill: 'forwards' }),
    r.second.animate([{ ...rot(b), offset: 0 }, { ...rot(b), offset: k }, { ...rot(180), offset: 1 }], { duration, easing: 'linear', fill: 'forwards' }),
  ];
}

/** Gaze left before the end: the arc drains back over 150 ms instead of vanishing. */
function drain(r: Ring): void {
  const a = angleOf(r.first);
  const b = angleOf(r.second);
  const shown = Number(getComputedStyle(r.arc).opacity);
  stop(r);
  setMode(r, 'rest');
  if (reducedMotion()) {
    // The whole ring fades from where it stood rather than vanishing (council round 5).
    if (!(shown > 0) || document.documentElement.dataset.input === 'keys') return;
    const hold: KeyframeAnimationOptions = { duration: 150, easing: EASE_OUT };
    r.anims = [
      r.arc.animate([{ opacity: shown }, { opacity: 0 }], hold),
      r.first.animate([rot(180), rot(180)], hold),
      r.second.animate([rot(180), rot(180)], hold),
    ];
    return;
  }
  if (a + b <= 0) return;
  const options: KeyframeAnimationOptions = { duration: 150, easing: EASE_OUT };
  r.anims = [r.first.animate([rot(a), rot(0)], options), r.second.animate([rot(b), rot(0)], options)];
}

/** Preview (confirm mode): the arc stands complete until the confirm. */
function complete(r: Ring): void {
  stop(r);
  if (!reducedMotion()) {
    const hold: KeyframeAnimationOptions = { duration: 1, fill: 'forwards' };
    r.anims = [r.first.animate([rot(180), rot(180)], hold), r.second.animate([rot(180), rot(180)], hold)];
  }
}

/**
 * Commit: the ring goes solid accent for 120 ms on the same frame as the click, and a copy of it
 * blooms from 1× to 2.4× while fading from 0.35 to 0 over 450 ms. Only transform and opacity
 * move, on a layer outside layout, so not a pixel of layout shifts.
 */
function commit(r: Ring): void {
  complete(r);
  setMode(r, 'latched');
  r.tile.dataset.commit = '';
  setTimeout(() => { delete r.tile.dataset.commit; }, 120);
  // No bloom under reduced motion, and none for a digit-key selection (keyed actions get no motion).
  if (!reducedMotion() && document.documentElement.dataset.input !== 'keys') {
    r.bloom.animate([{ transform: 'scale(1)', opacity: 0.35 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 450, easing: EASE_OUT });
  }
}

/** The gaze has left a committed tile and the engine re-armed it: the solid arc fades to the
 *  track over 150 ms (opacity only), then resets. */
function release(r: Ring): void {
  setMode(r, 'rest');
  if (document.documentElement.dataset.input === 'keys') { stop(r); return; }
  const fade = r.arc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: EASE_OUT });
  fade.onfinish = () => { if (r.mode === 'rest') stop(r); };
}

type Visual = { action: string; mode: 'dwell' | 'preview' | 'latched'; fill: number; remaining: number } | null;

function visualOf(snapshot: GazeSnapshot, settings: Settings): Visual {
  const { action, state, progress } = snapshot;
  if (!action) return null;
  if (state === 'previewed') return { action, mode: 'preview', fill: 1, remaining: 0 };
  if (state === 'selected') return snapshot.looked === action ? { action, mode: 'latched', fill: 1, remaining: 0 } : null;
  if (state === 'dwelling') {
    const { dwell, visibleAfter } = classOf(action, settings);
    const elapsed = progress * engine.settings.dwellMs;
    if (elapsed < visibleAfter) return null;
    return { action, mode: 'dwell', fill: Math.min(1, (elapsed - visibleAfter) / Math.max(1, dwell - visibleAfter)), remaining: Math.max(0, dwell - elapsed) };
  }
  return null;
}

/**
 * A key or a click names its tile directly, so it is not held back by the gaze latch. A click is
 * still where the gaze (the pointer) rests, so it latches its quadrant like a gaze selection; a
 * key does not. Set just before `engine.activate` runs and cleared once the event is handled.
 */
let direct: 'key' | 'click' | null = null;
function markDirect(kind: 'key' | 'click'): void {
  direct = kind;
  setTimeout(() => { direct = null; }, 0);
}

/** Select a tile by name: a click, or Enter or Space on a keyboard-focused tile. */
export function selectDirectly(action: string, at: number, kind: 'key' | 'click' = 'click'): void {
  markDirect(kind);
  engine.activate(action, at);
}

/**
 * Wire the engine to the page: track actionables, render dwell, feed the pointer as gaze, keys.
 * `onSelect` receives every committed selection. Returns a disposer.
 *
 * Quadrant latch: the engine stops a selected action from firing again until the gaze leaves
 * it, but it tracks the action, not the place. In this style a selection often relabels the
 * tile under the gaze (Speak becomes Stop, Menu becomes Recalibrate), which the engine would
 * treat as a fresh target. So after a selection, the quadrant it came from stays inert until the
 * gaze has left that quadrant. Proposed for shared/gaze.ts in REPORT.md.
 */
export function attachGaze(options: {
  settings: () => Settings;
  onSelect: (action: string) => void;
  bandRect: () => DOMRect | null;
  onKey: (event: KeyboardEvent) => boolean;
  /** Says a preview is ready or was cancelled, once each, for assistive technology. */
  announce: (text: string) => void;
}): () => void {
  let current: Ring | null = null;
  // The last raw gaze sample (the pointer), unsmoothed. The engine's point is smoothed and its
  // quadrant held, so straight after a click both can still be far from where the click landed.
  let pointer: { x: number; y: number } | null = null;
  // The quadrants a selected action owns, and the action. Held until both the engine's quadrant and
  // the gaze point itself have left them, so a click made before the engine's 150 ms hold caught
  // up latches the right place and is not cleared against the stale one (council round 4).
  let latch: { quadrants: QuadrantId[]; action: string } | null = null;
  const latchFor = (action: string, fallback: QuadrantId | null) => {
    const owned = quadrantsForAction(action, collectActionables(), viewportOf());
    return { quadrants: owned.length ? owned : fallback ? [fallback] : [], action };
  };
  // A dwell-mode completion that fell inside a glance away: delivered if the gaze comes back
  // within the engine's hold (the brief's 150 ms survival), dropped if it does not.
  let refused: { action: string; quadrant: QuadrantId | null } | null = null;

  const letGo = (r: Ring) => {
    if (r.mode === 'preview') options.announce('Cancelled');
    if (r.mode === 'dwell' || r.mode === 'paused' || r.mode === 'preview') drain(r);
    else if (r.mode === 'latched') release(r);
  };

  const unsubscribe = engine.subscribe((snapshot, event) => {
    const settings = options.settings();
    // Where the gaze actually is now. The engine holds a new quadrant for 150 ms before switching,
    // and keeps a dwell for 150 ms of grace; in that window the arc pauses, a preview cancels and
    // a completion is refused, so nothing finishes on a target the person has looked away from.
    const pointQuadrant = snapshot.point ? quadrantAt(snapshot.point.x, snapshot.point.y, viewportOf()) : null;
    const away = snapshot.quadrant !== null && pointQuadrant !== snapshot.quadrant;

    const inLatch = (q: QuadrantId | null) => latch !== null && q !== null && latch.quadrants.includes(q);
    // The latch lets go only once the raw sample, the smoothed point and the engine's quadrant have
    // all left the latched quadrants: a click from across the screen lands before the other two
    // arrive, and must not be cleared against them (council round 5).
    const rawQuadrant = pointer ? quadrantAt(pointer.x, pointer.y, viewportOf()) : null;
    if (latch && !inLatch(snapshot.quadrant) && !inLatch(pointQuadrant) && !inLatch(rawQuadrant)) latch = null;
    // Only a different action in the latched quadrant (a relabelled tile) is held back; the same
    // tile is the engine's to re-arm, which keeps the "Keep looking" repeat mode working.
    const relabelled = (action: string | null) => latch !== null && action !== null && action !== latch.action;

    // The engine gave a dwell up (its grace ran out): the arc drains, even if the gaze is back by
    // now, so it never shows progress the engine has thrown away (council round 6).
    if (event?.type === 'cancel' && current && current.tile === tileFor(event.action)) {
      letGo(current);
      current = null;
    }
    if (event?.type === 'select') {
      if (latch && (inLatch(event.quadrant) || inLatch(pointQuadrant) || inLatch(rawQuadrant)) && relabelled(event.action) && !direct) return;
      if (away && !direct) { refused = { action: event.action, quadrant: snapshot.quadrant }; return; }
      const tile = tileFor(event.action);
      const r = tile ? ringOf(tile) : null;
      if (current && current !== r) letGo(current);
      if (r) commit(r);
      current = r;
      // A key names its tile directly and does not latch where the gaze happens to be.
      latch = direct === 'key' ? null : latchFor(event.action, snapshot.quadrant);
      options.onSelect(event.action);
      return;
    }
    if (latch && (inLatch(snapshot.quadrant) || inLatch(rawQuadrant)) && relabelled(snapshot.action) && (snapshot.state === 'dwelling' || snapshot.state === 'previewed')) {
      engine.cancel();
      return;
    }
    if (refused) {
      const same = snapshot.state === 'selected' && snapshot.action === refused.action && snapshot.quadrant === refused.quadrant;
      if (same && !away) {
        // The gaze came back: the selection stands after all.
        const action = refused.action;
        refused = null;
        const tile = tileFor(action);
        const r = tile ? ringOf(tile) : null;
        if (r) commit(r);
        current = r;
        latch = latchFor(action, snapshot.quadrant);
        options.onSelect(action);
        return;
      }
      if (same) return; // still away: hold the ring where it paused
      refused = null;
    }
    if (away && snapshot.state === 'previewed') { engine.cancel(); return; }
    // The engine has switched quadrant but keeps the old dwell for its grace period: the arc
    // holds still there too, so it never completes on a card the person has looked away from.
    if (snapshot.state === 'dwelling' && snapshot.looked !== snapshot.action) {
      if (current && current.mode === 'dwell') pause(current);
      return;
    }
    if (away && snapshot.state === 'dwelling') {
      if (current && current.mode === 'dwell') pause(current);
      return;
    }
    if (snapshot.state === 'dwelling' && snapshot.action) {
      const { dwell } = classOf(snapshot.action, settings);
      if (engine.settings.dwellMs !== dwell) { engine.configure({ dwellMs: dwell }); return; }
    }

    const visual = visualOf(snapshot, settings);
    const tile = visual ? tileFor(visual.action) : null;
    const r = tile ? ringOf(tile) : null;
    if (current && (current !== r || !current.tile.isConnected)) { letGo(current); current = null; }
    if (!r || !visual) return;
    current = r;
    if (visual.mode === 'dwell' && r.mode !== 'dwell') {
      // Back from a glance away: carry on from what is drawn, not from the engine's count (which
      // kept running while the arc held), so the arc never jumps; it lands on the preview on time.
      const drawn = r.mode === 'paused' && !reducedMotion() ? (angleOf(r.first) + angleOf(r.second)) / 360 : null;
      fill(r, drawn ?? visual.fill, visual.remaining);
    }
    else if (visual.mode === 'preview' && r.mode !== 'preview') {
      complete(r);
      setMode(r, 'preview');
      options.announce(`${r.tile.getAttribute('aria-label') ?? 'Selection'} ready`);
    }
    else if (visual.mode === 'latched' && r.mode !== 'latched') setMode(r, 'latched');
  });

  // The mouse is the gaze point. With "middle band rests", a point inside the band is no gaze.
  // A tracker reports continuously; a mouse held still does not, so the last point is repeated
  // every 16 ms, a 60 Hz tracker's rate (otherwise the engine counts a still mouse as lost gaze
  // after `staleMs`, and its smoothing would take longer to follow the gaze to a new quadrant).
  const feed = (x: number, y: number, at: number) => {
    const band = options.settings().bandRests ? options.bandRect() : null;
    if (band && y >= band.top && y <= band.bottom) engine.sample(null, null, at);
    else engine.sample(x, y, at);
  };
  // Looking off screen cancels at once (BRIEF "Selection"): blink tolerance is for short gaps
  // while the eyes stay on the screen, so it is switched off while the pointer is away.
  const BLINK_GRACE = engine.settings.blinkGraceMs;
  // Keyboard-triggered actions get no motion (MOTION "Choreography"): a key press marks the page
  // as keyed until the pointer (the gaze) moves again, and the stylesheet drops durations then.
  const root = document.documentElement;
  const move = (e: PointerEvent) => {
    if (root.dataset.input !== 'gaze') root.dataset.input = 'gaze';
    if (!pointer && engine.settings.blinkGraceMs !== BLINK_GRACE) engine.configure({ blinkGraceMs: BLINK_GRACE });
    pointer = { x: e.clientX, y: e.clientY };
    feed(e.clientX, e.clientY, e.timeStamp);
  };
  const leave = (e: Event) => {
    pointer = null;
    engine.configure({ blinkGraceMs: 0 });
    engine.sample(null, null, e.timeStamp);
    engine.cancel(e.timeStamp);
  };
  const repeat = setInterval(() => {
    if (pointer) feed(pointer.x, pointer.y, performance.now());
    else engine.sample(null, null, performance.now());
  }, 16);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerdown', move);
  document.addEventListener('pointerleave', leave);

  // Our keys run first (capture). Calibration skip and Enter on a focused tile are the app's.
  // Space or Enter (the blink, in the product) commits only a finished preview, in either mode: a
  // blink while the eye is still travelling or reading must not select what lies under it. (In
  // dwell mode there is no preview, so the key does nothing; a keyboard-focused card is handled
  // by `onKey` first.)
  const capture = (e: KeyboardEvent) => {
    if (options.onKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    // Tab, arrows and digits mean the keyboard is driving; Space alone stays gaze (it is the blink).
    if (/^[1-8]$/.test(e.key) || e.key === 'Tab' || e.key.startsWith('Arrow')) root.dataset.input = 'keys';
    if (/^[1-8]$/.test(e.key)) { markDirect('key'); return; }
    const confirmKey = e.key === ' ' || e.key === 'Enter';
    if (confirmKey && engine.snapshot.state !== 'previewed') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', capture, true);
  const detachKeys = attachKeyboard(engine, (quadrant: QuadrantId) => actionIn(quadrant, collectActionables(), viewportOf())?.id ?? null);
  const untrack = trackActionables(engine);
  // The engine's clock. The shared `startTicking` uses requestAnimationFrame, which forces a main
  // frame every frame and so makes the browser re-style the ring's composited animations each
  // frame. Nothing here draws per frame (the ring animates itself), so a 16 ms timer advances the
  // dwell instead and leaves the page idle between events.
  const clock = setInterval(() => engine.tick(performance.now()), 16);
  const stopTicking = () => clearInterval(clock);

  return () => {
    unsubscribe();
    clearInterval(repeat);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerdown', move);
    document.removeEventListener('pointerleave', leave);
    window.removeEventListener('keydown', capture, true);
    detachKeys();
    untrack();
    stopTicking();
  };
}
