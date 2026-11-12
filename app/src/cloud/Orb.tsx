/**
 * The orb: the one object on the conversation screen (owner concept, 2026-11-07). A soft gradient
 * blob in the centre rest zone (Q2–Q3), drawn by one small WebGL fragment shader:
 *
 *  - shape: a round ball, as UI v1's was (owner, 2026-11-10, after a trial of the logo's cloud
 *    outline). Only its face differs from v1's: the sketched dots and smile (SketchFace.tsx) in
 *    place of v1's two long eyes;
 *  - fill (owner, 2026-11-09): UI v1's mesh gradient: Paper's MeshGradient (@paper-design/shaders
 *    0.0.82, distortion 0.8, swirl 0.1, speed 1) with v1's five colours, ported into this shader so
 *    it rides the lean and swell. The orb's box maps to the gradient's square as v1's ball did.
 *    v1's shading comes with it: a shadow on the edge all round, deeper at the lower right, and a
 *    faint light at the upper left. The edge is crisp, with no halo, as v1's clipped ball was. The
 *    colours no longer change with the mood.
 *
 * It is interactive, never ambient-only:
 *  - speaking (owner, 2026-11-07): while Clarte speaks the orb is livelier: its gradient flows
 *    about 2.4x faster and each spoken word swells it up to 7%. It calms back over 0.9 s when
 *    speech ends;
 *  - lean (owner, 2026-11-07): it leans towards the card gaze is on (a letter group, a word
 *    choice, Delete on the right, any action): the body shifts about 45 px that way, staying
 *    round. It aims at the card's centre, never the raw gaze point, and eases there at its own
 *    unhurried pace (time constant 1.2 s); over a rest zone it drifts back to centre;
 *  - look (owner, 2026-11-10): while gaze is on a letter group the face turns towards that card,
 *    from wherever the orb is on screen (in the middle it looks down; docked at the top left it
 *    looks down and to the right). Otherwise it follows the person in front of the camera (NAT-47).
 *    A look from the caller wins: the companion's flight, and calibration, where it looks straight
 *    ahead;
 *  - pulse: each new word heard from the partner, and each word as it is spoken, swells it a
 *    little and lets it settle on a spring.
 * Under reduced motion or Orb motion "Still" the gradient holds still and it never leans.
 *
 * In main (NAT-42, owner 2026-11-08) the Cloud is a square drop-in for the mesh-gradient ball: the
 * visible orb fills its box exactly and the canvas overflows it by the room the swell and lean
 * need, so the companion's flight and the calibration orb place it as they placed the ball.
 *
 * The frame loop stops whenever nothing is changing (Still, or a hidden tab).
 */
import { useEffect, useRef } from 'react';
import { animate, type AnimationPlaybackControls } from 'motion';
import type { ReactNode } from 'react';
import { engine, GROUP_ACTIONS } from '../gaze.ts';
import { faceMirror, subscribeFace } from '../eyes/expression.ts';

export type OrbMood = 'idle' | 'listening' | 'composing' | 'speaking';

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
// The gradient's own clock: seconds since the orb appeared, frozen when Still.
uniform float u_flow;
uniform float u_swell;
uniform float u_radius;
uniform vec2 u_lean;
varying vec2 v_uv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// UI v1's ball (prototypes/UI/v1/s1/src/components/ui/shader-svg.tsx): Paper's MeshGradient,
// @paper-design/shaders 0.0.82, ported line for line at its defaults (distortion 0.8, swirl 0.1,
// no grain) with v1's five colours.
vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
vec2 meshPosition(float i, float t) {
  float a = i * 0.37;
  float b = 0.6 + fract(i / 3.0) * 0.9;
  float c = 0.8 + fract((i + 1.0) / 4.0);
  return 0.5 + 0.5 * vec2(sin(t * b + a), cos(t * c + a * 1.5));
}
vec3 meshColour(int i) {
  if (i == 0) return vec3(1.0, 0.702, 0.851);     // #FFB3D9 pastel pink
  if (i == 1) return vec3(0.529, 0.808, 0.922);   // #87CEEB sky blue
  if (i == 2) return vec3(0.290, 0.565, 0.886);   // #4A90E2 medium blue
  if (i == 3) return vec3(0.855, 0.867, 0.890);   // #DADDE3 grey-white
  return vec3(0.925, 0.933, 0.945);               // #ECEEF1 pale grey-white
}
// uv: 0 to 1 across the gradient's square; time in seconds at speed 1.
vec3 mesh(vec2 uv, float time) {
  float t = 0.5 * (time + 41.5);
  float radius = smoothstep(0.0, 1.0, length(uv - 0.5));
  float center = 1.0 - radius;
  for (float i = 1.0; i <= 2.0; i++) {
    uv.x += 0.8 * center / i * sin(t + i * 0.4 * smoothstep(0.0, 1.0, uv.y)) * cos(0.2 * t + i * 2.4 * smoothstep(0.0, 1.0, uv.y));
    uv.y += 0.8 * center / i * cos(t + i * 2.0 * smoothstep(0.0, 1.0, uv.x));
  }
  vec2 uvRotated = rotate(uv - 0.5, -3.0 * 0.1 * radius) + 0.5;
  vec3 color = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    float dist = pow(length(uvRotated - meshPosition(float(i), t)), 3.5);
    float weight = 1.0 / (dist + 1e-3);
    color += meshColour(i) * weight;
    total += weight;
  }
  return color / max(1e-4, total);
}

void main() {
  vec2 frag = v_uv * u_res;
  float s = min(u_res.x, u_res.y) * 0.5;
  vec2 p = (frag - u_res * 0.5) / s;
  // Lean: the body shifts a little towards the looked-at card.
  p -= u_lean * 0.16;
  float t = u_time;
  // A round ball, as UI v1's was (owner, 2026-11-10: back to the ball, keeping the sketched face).
  float r = u_radius * (1.0 + u_swell);
  float d = length(p) / r;

  // v1's ball maps its square box onto the gradient; here the orb's box does, riding the lean and swell.
  float R = r;
  vec3 col = mesh(p / (2.0 * R) + 0.5, u_flow);

  // v1's shading, lit from the upper left. Its shadow lies on the edge all round, a little deeper at
  // the lower right: v1 drew it as a radial gradient centred at (-0.08, 0.14) of the radius with
  // radius 1.16, so each edge point keeps the depth v1's ball had in that direction.
  vec2 dir = p / max(length(p), 1e-4);
  float sd = d * length(dir - vec2(-0.08, 0.14)) / 1.16;
  float shade = sd < 0.92 ? 0.08 * clamp((sd - 0.72) / 0.20, 0.0, 1.0) : 0.08 + 0.08 * clamp((sd - 0.92) / 0.08, 0.0, 1.0);
  col = mix(col, vec3(0.063, 0.094, 0.188), shade); // #101830
  float light = 0.22 * clamp(1.0 - length(p / R - vec2(-0.32, 0.48)) / 0.84, 0.0, 1.0);
  col = mix(col, vec3(1.0), light);

  // A crisp, antialiased edge, as v1's clipped ball had: about a pixel and a half wide.
  float aa = 1.5 / (s * r);
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
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
  /** Lean towards the card gaze is on (off for the calibration target, whose centre must hold). */
  lean?: boolean;
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
/** The furthest the face moves from its place, as a share of the radius. */
const FACE_REACH = 0.4;

/** How far the face turns towards a looked-at letter group, in look units (about 0.26 of the radius). */
const GROUP_LOOK = 3.2;

export function Orb({ mood, pulse, still, lean: leans = true, look = null, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const leansRef = useRef(leans);
  leansRef.current = leans;
  // The face's look, eased towards its target in the frame loop.
  const lookRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** A look from the caller (the companion's flight, calibration) wins over everything else. */
  const lookSetRef = useRef(false);
  const api = useRef<{ wake(): void; setEnergy(v: number): void; kick(): void; setStill(v: boolean): void } | null>(null);

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
    const uRes = u('u_res'), uTime = u('u_time'), uSwell = u('u_swell'), uRadius = u('u_radius'), uLean = u('u_lean'), uFlow = u('u_flow');

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
    let lookAt: [number, number] = [0, 0];
    const running = new Set<AnimationPlaybackControls>();
    const track = (c: AnimationPlaybackControls) => { running.add(c); void c.finished.then(() => { running.delete(c); wake(); }, () => running.delete(c)); wake(); return c; };

    const resize = () => {
      // Full device pixels (up to 2x): the edge is crisp, as v1's clipped ball was.
      const scale = Math.min(window.devicePixelRatio || 1, 2);
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

    // The face rides the body: the lean's shift, a slow drift, a slight
    // sway, and the pulse's swell. It is still whenever the orb is (Still, reduced motion).
    let half = 1;
    const placeFace = () => {
      const el = faceRef.current;
      if (!el) return;
      const r = half * ORB_RADIUS;
      let x = lean[0] * FACE_LEAN * half + 0.035 * r * Math.sin(0.26 * time + 1.3) + lookAt[0] * LOOK_REACH * r;
      let y = -lean[1] * FACE_LEAN * half + 0.03 * r * Math.cos(0.19 * time + 0.4) + lookAt[1] * LOOK_REACH * r;
      // The lean and the look add up; a face can only turn so far round the ball, so both eyes stay inside it.
      const far = Math.hypot(x, y) / (FACE_REACH * r);
      if (far > 1) { x /= far; y /= far; }
      y += FACE_DROP * r;
      const turn = 2.5 * Math.sin(0.15 * time) + lean[0] * 4;
      el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${turn.toFixed(2)}deg) scale(${(1 + swell).toFixed(4)})`;
    };

    const draw = () => {
      placeFace();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uSwell, swell);
      gl.uniform1f(uRadius, ORB_RADIUS);
      gl.uniform2f(uLean, lean[0], lean[1]);
      // v1's gradient starts at its own first frame; it flows on the orb's clock (faster while speaking).
      gl.uniform1f(uFlow, time - 18);
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
      // Speaking runs the gradient about 2.4x faster.
      time += dt * speed * (1 + 1.4 * energy);
      const k = 1 - Math.exp(-dt / LEAN_TAU);
      lean = [lean[0] + (leanTarget[0] - lean[0]) * k, lean[1] + (leanTarget[1] - lean[1]) * k];
      // The look is quicker than the lean: eyes move before bodies.
      const kl = 1 - Math.exp(-dt / LOOK_TAU);
      // Otherwise it looks at the letter group gaze is on, or follows the person (NAT-47).
      const lt = frozen() ? { x: 0, y: 0 } : lookSetRef.current ? lookRef.current : group ? towards(group) : faceMirror().look ?? { x: 0, y: 0 };
      lookAt = [lookAt[0] + (lt.x - lookAt[0]) * kl, lookAt[1] + (lt.y - lookAt[1]) * kl];
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
    // The letter group gaze is on, if any. Its direction is measured every frame, as the orb flies and docks.
    let group: Element | null = null;
    const towards = (card: Element) => {
      const t = card.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (c.left + c.width / 2), dy = t.top + t.height / 2 - (c.top + c.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      return { x: (dx / len) * GROUP_LOOK, y: (dy / len) * GROUP_LOOK };
    };
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
      group = lookedAt && GROUP_ACTIONS.has(lookedAt) ? document.querySelector(`.card[data-group][data-action="${CSS.escape(lookedAt)}"]`) : null;
      aimAt(lookedAt);
    });

    api.current = {
      wake,
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

  useEffect(() => { api.current?.setEnergy(mood === 'speaking' ? 1 : 0); }, [mood]);
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
