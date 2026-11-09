/**
 * The orb: the one object on the conversation screen (owner concept, 2026-11-07). A soft gradient
 * blob in the centre rest zone (Q2–Q3), drawn by one small WebGL fragment shader:
 *
 *  - shape: a circle whose radius is modulated by three low harmonics (2, 3 and 5 lobes) drifting
 *    at different rates, which gives the slow organic loop of the owner's Lottie reference
 *    (about one full change of shape every 24 s, 0.04 Hz, well under the 0.2 Hz the HIG warns
 *    about);
 *  - fill: light orange (owner, 2026-11-07): four colour points from light orange to near white
 *    blended by inverse distance, drifting inside the shape, with a white rim towards the lower
 *    left and a soft edge, like the health-app orb;
 *  - every palette's deepest orange keeps relative luminance at or above 0.57, and the moods only
 *    shift hue within light orange (peach, coral, apricot, tangerine), so the screen's luminance stays
 *    near constant (BRIEF, RESEARCH §4) and ink text on the orb keeps its contrast.
 *
 * It is interactive, never ambient-only:
 *  - mood: the conversation state tints it (idle peach, listening coral, replying apricot,
 *    speaking green), cross-faded over 600 ms by Motion; the state pill stays the text twin;
 *  - speaking (owner, 2026-11-07): while Clarte speaks the orb is livelier: its lobes deepen,
 *    it wobbles about 2.4x faster, a quick ripple runs round its edge, each spoken word swells it
 *    up to 7%, and it is drawn at a stronger opacity (80%). It calms back over 0.9 s when speech ends;
 *  - lean (owner, 2026-11-07): it leans towards the card gaze is on (a letter group, a word
 *    choice, Delete on the right, any action): the body shifts about 45 px that way and bulges on
 *    that side. It aims at the card's centre, never the raw gaze point, and eases there at its own
 *    unhurried pace (time constant 1.2 s); over a rest zone it drifts back to centre. The wobble
 *    keeps its speed throughout;
 *  - pulse: each new word heard from the partner, and each word as it is spoken, swells it a
 *    little and lets it settle on a spring.
 * Under reduced motion or Orb motion "Still" the shape never moves or leans; only the mood colour
 * cross-fades.
 *
 * In main (NAT-42, owner 2026-11-08) the Cloud is a square drop-in for the mesh-gradient ball: the
 * visible orb fills its box exactly and the canvas overflows it by the room the wobble, lean and
 * halo need, so the companion's flight and the calibration orb place it as they placed the ball.
 *
 * The canvas renders at a fraction of device pixels (the orb is soft, so detail is not lost) and
 * the frame loop stops whenever nothing is changing (Still, or a hidden tab).
 */
import { useEffect, useRef } from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';
import type { ReactNode } from 'react';
import { engine } from '../gaze.ts';
import { faceMirror, subscribeFace } from '../eyes/expression.ts';
import type { PaletteKind } from '../variant.ts';

export type OrbMood = 'idle' | 'listening' | 'composing' | 'speaking';

type Palette = [string, string, string, string];

/**
 * Four colour points per mood, from light orange to near white: the deepest orange at relative
 * luminance 0.57 or more. Style 8 has no dark theme (owner, 2026-11-07).
 */
const LIGHT: Record<OrbMood, Palette> = {
    // Light orange on white (owner, 2026-11-07): the moods stay within it.
    idle: ['#FFC49C', '#FFE4D0', '#FFD5B6', '#FFF7F0'],
    listening: ['#FFB9A0', '#FFDDD0', '#FFCDBA', '#FFF6F2'],
    composing: ['#FFCB8E', '#FFE8C8', '#FFDBAE', '#FFF9EE'],
    // Speaking turns green (owner, 2026-11-07), matched in lightness to the oranges.
    speaking: ['#BCEBCA', '#E0F6E7', '#CDF0D7', '#F7FDF9'],
};

/**
 * Style 7's Vibrant palette (light theme): the same moods, more saturated. On each mood's deepest
 * point ink keeps at least 6.9:1 and secondary ink 4.4–5.7:1 (Listening's coral is the lowest);
 * the orb is drawn at 72%, so these are minimums.
 */
const VIBRANT: Record<OrbMood, Palette> = {
  idle: ['#FF9A52', '#FFC79E', '#FFAE70', '#FFE9D8'],
  listening: ['#FF7F66', '#FFB8A8', '#FF9A85', '#FFE6E0'],
  composing: ['#FFA83D', '#FFD08A', '#FFBC5E', '#FFF0D6'],
  speaking: ['#3DD27A', '#9BE8B8', '#6BDD97', '#E2F9EA'],
};

/** The four colour points for a mood and palette. */
export function orbPalette(mood: OrbMood, palette: PaletteKind): Palette {
  return palette === 'vibrant' ? VIBRANT[mood] : LIGHT[mood];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const flat = (p: Palette) => p.flatMap(rgb);

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_swell;
uniform float u_radius;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_lean;
uniform float u_energy;
uniform float u_halo;
varying vec2 v_uv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float weight(vec2 p, vec2 q) { vec2 d = p - q; return 1.0 / (dot(d, d) + 0.06); }

void main() {
  vec2 frag = v_uv * u_res;
  float s = min(u_res.x, u_res.y) * 0.5;
  vec2 p = (frag - u_res * 0.5) / s;
  // Lean: the body shifts a little towards the looked-at card and bulges on that side.
  p -= u_lean * 0.16;
  float t = u_time;
  float a = atan(p.y, p.x);
  float lean = length(u_lean);
  vec2 ld = lean > 0.0001 ? u_lean / lean : vec2(0.0);
  float toward = max(0.0, dot(vec2(cos(a), sin(a)), ld));
  // Energy (speaking): the slow lobes deepen and a quick ripple runs round the edge.
  float e = u_energy;
  float amp = 1.0 + 0.8 * e;
  float r = u_radius * (1.0 + u_swell) * (1.0 + 0.12 * lean * toward * toward) * (1.0
    + amp * 0.070 * sin(2.0 * a + 0.26 * t + 1.3)
    + amp * 0.045 * sin(3.0 * a - 0.19 * t + 0.4)
    + amp * 0.022 * sin(5.0 * a + 0.31 * t + 2.1)
    + e * 0.018 * sin(7.0 * a + 1.9 * t));
  float d = length(p) / r;

  vec2 q0 = r * (vec2(-0.38, 0.34) + 0.22 * vec2(sin(0.17 * t), cos(0.13 * t)));
  vec2 q1 = r * (vec2(0.42, 0.28) + 0.22 * vec2(cos(0.15 * t + 1.0), sin(0.19 * t)));
  vec2 q2 = r * (vec2(0.30, -0.42) + 0.22 * vec2(sin(0.12 * t + 2.0), cos(0.16 * t + 0.5)));
  vec2 q3 = r * (vec2(-0.42, -0.30) + 0.22 * vec2(cos(0.14 * t + 3.0), sin(0.11 * t + 1.5)));
  float w0 = weight(p, q0), w1 = weight(p, q1), w2 = weight(p, q2), w3 = weight(p, q3);
  vec3 col = (u_c0 * w0 + u_c1 * w1 + u_c2 * w2 + u_c3 * w3) / (w0 + w1 + w2 + w3);

  // A lighter rim towards the lower left, as if lit from there.
  vec2 dir = p / max(length(p), 1e-4);
  float rim = smoothstep(0.55, 1.0, d) * (0.5 + 0.5 * dot(dir, normalize(vec2(-0.75, -0.55))));
  col = mix(col, vec3(1.0), clamp(rim, 0.0, 1.0) * 0.55);
  // A slightly deeper core, so the orb has depth rather than reading as a flat disc.
  col = mix(col, col * 0.94, (1.0 - smoothstep(0.0, 0.7, d)) * 0.5);

  // A soft but defined edge, and a faint halo in the orb's own colour (never white, which would
  // read as a smudge on the light canvas).
  float body = 1.0 - smoothstep(0.9, 1.0, d);
  float halo = (1.0 - smoothstep(1.0, 1.35, d)) * 0.22 * u_halo;
  float alpha = max(body, halo);
  col += (hash(frag + fract(t)) - 0.5) / 255.0; // dither against banding
  gl_FragColor = vec4(col * alpha, alpha);
}`;

/** Lean time constant: 63% of the way in 1.2 s, the orb's own unhurried pace. */
const LEAN_TAU = 1.2;

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

type Props = {
  mood: OrbMood;
  /** Increments on each partner word heard and each word spoken. */
  pulse: number;
  /** Orb motion "Still": never drift or pulse. */
  still: boolean;
  palette: PaletteKind;
  /** Lean towards the card gaze is on (off for the calibration target, whose centre must hold). */
  lean?: boolean;
  /** The faint halo past the edge (off where white must show round the orb, as in calibration). */
  halo?: boolean;
  /** Where the face looks, -1…1 per axis at full reach (up to ±2.6 for a big glance); null at rest. */
  look?: { x: number; y: number } | null;
  /** The Cloud's face, carried on the body: it rides the lean, the drift and the swell. */
  children?: ReactNode;
};

/** The face's box as a share of the orb's radius, and how far it rides the lean (shader: 0.16). */
const FACE_SIZE = 0.8;
/** The orb's radius as a share of half its canvas: style 7's size (a 0.8× trial was undone). */
const ORB_RADIUS = 0.62;
const FACE_LEAN = 0.2;
/** The face sits a little below the orb's centre, clear of the history, well inside the body. */
const FACE_DROP = 0.3;
/** How far the face travels with the look, as a share of the radius per unit, and how fast. */
const LOOK_REACH = 0.08;
const LOOK_TAU = 0.12;

export function Orb({ mood, pulse, still, palette, lean: leans = true, halo = true, look = null, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const leansRef = useRef(leans);
  leansRef.current = leans;
  const haloRef = useRef(halo);
  haloRef.current = halo;
  // The face's look, eased towards its target in the frame loop.
  const lookRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** A look from the caller (the companion's flight) wins over following the person (NAT-47). */
  const lookSetRef = useRef(false);
  const api = useRef<{ wake(): void; setMood(p: Palette, instant: boolean): void; setEnergy(v: number): void; kick(): void; setStill(v: boolean): void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    // preserveDrawingBuffer: calibration's ghost trail (GuideOrb.tsx) copies the last frame with drawImage.
    if (!canvas || !gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = u('u_res'), uTime = u('u_time'), uSwell = u('u_swell'), uRadius = u('u_radius'), uLean = u('u_lean'), uEnergy = u('u_energy'), uHalo = u('u_halo');
    const uCols = [u('u_c0'), u('u_c1'), u('u_c2'), u('u_c3')];

    // Live values. `time` advances by `speed` (1 while moving, 0 when Still). `lean` follows
    // `leanTarget` slowly: towards the card gaze is on, back to centre over a rest zone.
    let time = 18; // a pleasing starting shape, also the frozen shape for "Still"
    let speed = 0;
    let lean: [number, number] = [0, 0];
    let leanTarget: [number, number] = [0, 0];
    let swell = 0;
    // 0 at rest, 1 while speaking: faster, deeper motion and bigger word swells.
    let energy = 0;
    let stillMode = false;
    let haloOn = haloRef.current;
    let lookAt: [number, number] = [0, 0];
    let colours = flat(LIGHT.idle);
    let from = colours;
    let to = colours;
    let mix = 1;
    const running = new Set<AnimationPlaybackControls>();
    const track = (c: AnimationPlaybackControls) => { running.add(c); void c.finished.then(() => { running.delete(c); wake(); }, () => running.delete(c)); wake(); return c; };

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.6;
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      // Resizing clears the canvas. Redraw at once (below), in the same frame, or a growing or
      // shrinking Cloud flickers out between frames and its face floats alone (NAT-44).
      const resized = canvas.width !== w || canvas.height !== h;
      if (resized) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      half = Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
      const face = half * ORB_RADIUS * FACE_SIZE;
      faceRef.current?.style.setProperty('--face-size', `${face.toFixed(1)}px`);
      // About 2.6 px of ink on screen at any size: a 168 px Cloud keeps the pen's 3.2, a small one thickens.
      faceRef.current?.style.setProperty('--sketch-w', `${Math.min(8, Math.max(3.2, (2.6 * 88) / Math.max(face, 1))).toFixed(2)}px`);
      if (resized) draw();
      wake();
    };

    // The face rides the body: the lean's shift, a slow drift in step with the wobble, a slight
    // sway, and the pulse's swell. It is still whenever the orb is (Still, reduced motion).
    let half = 1;
    const placeFace = () => {
      const el = faceRef.current;
      if (!el) return;
      const r = half * ORB_RADIUS;
      const x = lean[0] * FACE_LEAN * half + 0.035 * r * Math.sin(0.26 * time + 1.3) + lookAt[0] * LOOK_REACH * r;
      const y = FACE_DROP * r - lean[1] * FACE_LEAN * half + 0.03 * r * Math.cos(0.19 * time + 0.4) + lookAt[1] * LOOK_REACH * r;
      const turn = 2.5 * Math.sin(0.15 * time) + lean[0] * 4;
      el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${turn.toFixed(2)}deg) scale(${(1 + swell).toFixed(4)})`;
    };

    const draw = () => {
      placeFace();
      colours = from.map((v, i) => v + (to[i] - v) * mix);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uSwell, swell);
      gl.uniform1f(uRadius, ORB_RADIUS);
      gl.uniform2f(uLean, lean[0], lean[1]);
      gl.uniform1f(uEnergy, frozen() ? 0 : energy);
      gl.uniform1f(uHalo, haloOn ? 1 : 0);
      uCols.forEach((loc, i) => gl.uniform3f(loc, colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2]));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      // Speaking runs the wobble about 2.4x faster (still under 0.2 Hz).
      time += dt * speed * (1 + 1.4 * energy);
      const k = 1 - Math.exp(-dt / LEAN_TAU);
      lean = [lean[0] + (leanTarget[0] - lean[0]) * k, lean[1] + (leanTarget[1] - lean[1]) * k];
      // The look is quicker than the lean: eyes move before bodies.
      const kl = 1 - Math.exp(-dt / LOOK_TAU);
      // Otherwise the face follows the person in front of the camera (NAT-47, eyes/expression.ts).
      const lt = frozen() ? { x: 0, y: 0 } : lookSetRef.current ? lookRef.current : faceMirror().look ?? { x: 0, y: 0 };
      lookAt = [lookAt[0] + (lt.x - lookAt[0]) * kl, lookAt[1] + (lt.y - lookAt[1]) * kl];
      haloOn = haloRef.current;
      const settling = Math.hypot(leanTarget[0] - lean[0], leanTarget[1] - lean[1]) > 0.002
        || Math.hypot(lt.x - lookAt[0], lt.y - lookAt[1]) > 0.002;
      draw();
      if (speed > 0 || running.size || settling) frame = requestAnimationFrame(loop);
      else last = 0;
    };
    function wake() { if (!frame) frame = requestAnimationFrame(loop); }

    let speedAnim: AnimationPlaybackControls | null = null;
    const setSpeed = (target: number, duration: number) => {
      speedAnim?.stop();
      if (speed === target) return;
      speedAnim = track(animate(speed, target, { duration, ease: [0.23, 1, 0.32, 1], onUpdate: (v) => { speed = v; } }));
    };
    const frozen = () => stillMode || (reducedMotion?.matches ?? false);
    // The orb leans towards the card gaze is on: a grid card, a word choice, Delete, anything with
    // an action. It follows the card's centre, never the raw gaze point (a chased cursor), and it
    // moves at the orb's own slow pace (LEAN_TAU), whatever the dwell is doing.
    let lookedAt: string | null = null;
    const aimAt = (action: string | null) => {
      if (frozen() || !action || !leansRef.current) { leanTarget = [0, 0]; wake(); return; }
      const target = document.querySelector(`[data-action="${CSS.escape(action)}"]`);
      if (!target) { leanTarget = [0, 0]; wake(); return; }
      const t = target.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      const half = Math.min(c.width, c.height) / 2;
      const dx = (t.left + t.width / 2 - (c.left + c.width / 2)) / half;
      const dy = -(t.top + t.height / 2 - (c.top + c.height / 2)) / half;
      const len = Math.hypot(dx, dy) || 1;
      leanTarget = [dx / len, dy / len];
      wake();
    };
    const unfollow = subscribeFace(() => wake());
    const unsubscribe = engine.subscribe((s) => {
      if (s.looked === lookedAt) return;
      lookedAt = s.looked;
      aimAt(lookedAt);
    });

    api.current = {
      wake,
      setMood(p, instant) {
        from = colours;
        to = flat(p);
        if (instant) { mix = 1; colours = to; wake(); return; }
        mix = 0;
        track(animate(0, 1, { duration: 0.6, ease: [0.2, 0, 0, 1], onUpdate: (v) => { mix = v; } }));
      },
      setEnergy(v) {
        if (energy === v) return;
        // Up quickly as speech starts; down more slowly as it ends, so the orb calms rather than stops.
        track(animate(energy, v, { duration: v > energy ? 0.5 : 0.9, ease: [0.23, 1, 0.32, 1], onUpdate: (x) => { energy = x; } }));
      },
      kick() {
        if (frozen()) return;
        const startAt = swell;
        // Each spoken word swells it more than a heard word (3.5% at rest, up to 7% while speaking).
        track(animate(startAt, 0.035 + 0.035 * energy, { duration: 0.16, ease: [0.23, 1, 0.32, 1], onUpdate: (v) => { swell = v; } })).finished.then(() => {
          track(animate(swell, 0, { type: 'spring', stiffness: 140, damping: 11, onUpdate: (v) => { swell = v; } }));
        }, () => {});
      },
      setStill(v) {
        stillMode = v;
        if (frozen()) { speedAnim?.stop(); speed = 0; leanTarget = [0, 0]; wake(); }
        else { setSpeed(1, 0.8); aimAt(lookedAt); }
      },
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const onMotionPref = () => api.current?.setStill(stillMode);
    reducedMotion?.addEventListener('change', onMotionPref);
    return () => {
      ro.disconnect();
      unsubscribe();
      unfollow();
      reducedMotion?.removeEventListener('change', onMotionPref);
      running.forEach((c) => c.stop());
      cancelAnimationFrame(frame);
      api.current = null;
      // No loseContext(): React's development double mount reuses this canvas, and a lost
      // context cannot be restored on it. The context is released with the canvas.
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, []);

  const first = useRef(true);
  useEffect(() => {
    api.current?.setMood(orbPalette(mood, palette), first.current);
    api.current?.setEnergy(mood === 'speaking' ? 1 : 0);
    first.current = false;
  }, [mood, palette]);
  useEffect(() => { api.current?.setStill(still); }, [still]);
  useEffect(() => { api.current?.setStill(still); }, [leans]); // re-aim (or centre) the lean
  const lx = look ? Math.max(-2.6, Math.min(2.6, look.x)) : 0;
  const ly = look ? Math.max(-2.6, Math.min(2.6, look.y)) : 0;
  useEffect(() => { lookRef.current = { x: lx, y: ly }; lookSetRef.current = look !== null; api.current?.wake(); }, [lx, ly, look === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse > lastPulse.current) api.current?.kick();
    lastPulse.current = pulse;
  }, [pulse]);

  return (
    <div className="cloud" data-mood={mood} aria-hidden="true">
      <canvas ref={canvasRef} className="cloud-canvas" data-mood={mood} />
      <div className="cloud-face" data-mood={mood}>
        <div ref={faceRef} className="cloud-face-body">{children}</div>
      </div>
    </div>
  );
}
