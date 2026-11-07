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
 * The canvas renders at a fraction of device pixels (the orb is soft, so detail is not lost) and
 * the frame loop stops whenever nothing is changing (Still, or a hidden tab).
 */
import { useEffect, useRef } from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';
import { engine } from './gaze.ts';

export type OrbMood = 'idle' | 'listening' | 'composing' | 'speaking';

type Palette = [string, string, string, string];

/**
 * Four colour points per mood, from light orange to near white. Light theme: the deepest orange
 * at relative luminance 0.57 or more. Dark: embers, matched.
 */
const PALETTES: Record<'light' | 'dark', Record<OrbMood, Palette>> = {
  light: {
    // Light orange on white (owner, 2026-11-07): the moods stay within it.
    idle: ['#FFC49C', '#FFE4D0', '#FFD5B6', '#FFF7F0'],
    listening: ['#FFB9A0', '#FFDDD0', '#FFCDBA', '#FFF6F2'],
    composing: ['#FFCB8E', '#FFE8C8', '#FFDBAE', '#FFF9EE'],
    // Speaking turns green (owner, 2026-11-07), matched in lightness to the oranges.
    speaking: ['#BCEBCA', '#E0F6E7', '#CDF0D7', '#F7FDF9'],
  },
  dark: {
    idle: ['#7A3A18', '#3A2A22', '#5E3622', '#45302A'],
    listening: ['#7A2E20', '#3E2622', '#5E3026', '#4A2C28'],
    composing: ['#6E4A12', '#3E3222', '#5C4420', '#4A3A26'],
    speaking: ['#1F5A36', '#1C3A28', '#2A6A42', '#203A2C'],
  },
};

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
uniform float u_dark;
uniform vec2 u_lean;
uniform float u_energy;
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
  vec3 lift = mix(vec3(1.0), col * 1.35, u_dark);
  col = mix(col, lift, clamp(rim, 0.0, 1.0) * 0.55);
  // A slightly deeper core, so the orb has depth rather than reading as a flat disc.
  col = mix(col, col * 0.94, (1.0 - smoothstep(0.0, 0.7, d)) * 0.5);

  // A soft but defined edge, and a faint halo in the orb's own colour (never white, which would
  // read as a smudge on the light canvas).
  float body = 1.0 - smoothstep(0.9, 1.0, d);
  float halo = (1.0 - smoothstep(1.0, 1.35, d)) * 0.22;
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
  theme: 'light' | 'dark';
};

export function Orb({ mood, pulse, still, theme }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ setMood(p: Palette, instant: boolean): void; setEnergy(v: number): void; kick(): void; setStill(v: boolean): void; setDark(v: boolean): void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
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
    const uRes = u('u_res'), uTime = u('u_time'), uSwell = u('u_swell'), uRadius = u('u_radius'), uDark = u('u_dark'), uLean = u('u_lean'), uEnergy = u('u_energy');
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
    let dark = 0;
    let stillMode = false;
    let colours = flat(PALETTES.light.idle);
    let from = colours;
    let to = colours;
    let mix = 1;
    const running = new Set<AnimationPlaybackControls>();
    const track = (c: AnimationPlaybackControls) => { running.add(c); void c.finished.then(() => { running.delete(c); wake(); }, () => running.delete(c)); wake(); return c; };

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.6;
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      wake();
    };

    const draw = () => {
      colours = from.map((v, i) => v + (to[i] - v) * mix);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uSwell, swell);
      gl.uniform1f(uRadius, 0.62);
      gl.uniform1f(uDark, dark);
      gl.uniform2f(uLean, lean[0], lean[1]);
      gl.uniform1f(uEnergy, frozen() ? 0 : energy);
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
      const settling = Math.hypot(leanTarget[0] - lean[0], leanTarget[1] - lean[1]) > 0.002;
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
      if (frozen() || !action) { leanTarget = [0, 0]; wake(); return; }
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
    const unsubscribe = engine.subscribe((s) => {
      if (s.looked === lookedAt) return;
      lookedAt = s.looked;
      aimAt(lookedAt);
    });

    api.current = {
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
      setDark(v) { dark = v ? 1 : 0; wake(); },
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const onMotionPref = () => api.current?.setStill(stillMode);
    reducedMotion?.addEventListener('change', onMotionPref);
    return () => {
      ro.disconnect();
      unsubscribe();
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
    api.current?.setDark(theme === 'dark');
    api.current?.setMood(PALETTES[theme][mood], first.current);
    api.current?.setEnergy(mood === 'speaking' ? 1 : 0);
    first.current = false;
  }, [mood, theme]);
  useEffect(() => { api.current?.setStill(still); }, [still]);
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse > lastPulse.current) api.current?.kick();
    lastPulse.current = pulse;
  }, [pulse]);

  return <canvas ref={canvasRef} className="orb" data-mood={mood} aria-hidden="true" />;
}
