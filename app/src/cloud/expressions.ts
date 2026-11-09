/**
 * Every face the Cloud can make: the eighteen reactions (sentiment.ts) plus two states, neutral
 * (at rest) and listening (the partner is about to speak and no words have arrived yet). Each is a
 * few pen lines on a 120-unit grid, in drawing order: eyes, then mouth, then extras
 * (SketchFace.tsx draws and erases them).
 *
 * Once drawn, a face behaves like one (NAT-26, owner 2026-11-07: "behave in a way that's
 * realistic"). Open eyes (`eye`) blink. Some strokes have their own motion (`life`): tears and
 * sweat fall, hearts beat, sparkles twinkle, the Z floats up. Some faces move as a whole (`face`):
 * a laugh chuckles, a curious face tilts. All of it stops when the Cloud is Still or under reduced
 * motion (styles.css).
 */
import type { ReactionKind } from './sentiment.ts';

export type ExpressionKind = ReactionKind | 'neutral' | 'listening';

/** A stroke's own motion once the face is drawn (styles.css `sketch-life-*`). */
export type Life =
  | 'tear' | 'sweat' | 'drool' | 'beat' | 'twinkle' | 'float' | 'steam'
  | 'rock' | 'spin' | 'chatter' | 'wiggle' | 'pop' | 'lift';
/** The whole face's motion once drawn (styles.css `sketch-face-*`). */
export type FaceLife = 'chuckle' | 'hop' | 'bounce' | 'tilt' | 'wince' | 'queasy' | 'sigh' | 'shake' | 'shiver' | 'nod';

export type Stroke = {
  d: string;
  /** An open eye: it blinks. */
  eye?: boolean;
  life?: Life;
  /** Extra delay before this stroke's motion starts, so paired extras do not move in unison. */
  offset?: number;
};
type Def = { name: string; strokes: (string | Stroke)[]; face?: FaceLife };

export const strokeOf = (s: string | Stroke): Stroke => (typeof s === 'string' ? { d: s } : s);

/** A small closed loop that reads as a dot when stroked. */
const dot = (x: number, y: number, r = 2.4) => `M${x} ${y - r} c-${r * 1.1} 0 -${r * 1.1} ${r * 2} 0 ${r * 2} c${r * 1.1} 0 ${r * 1.1} -${r * 2} 0 -${r * 2}`;
const ring = (x: number, y: number, r: number) => `M${x} ${y - r} c-${r * 1.33} 0 -${r * 1.33} ${r * 2} 0 ${r * 2} c${r * 1.33} 0 ${r * 1.33} -${r * 2} 0 -${r * 2}`;
const eye = (d: string, life?: Life): Stroke => ({ d, eye: true, life });
const live = (d: string, life: Life, offset = 0): Stroke => ({ d, life, offset });

export const EXPRESSIONS: Record<ExpressionKind, Def> = {
  // ── States ──
  neutral: {
    name: 'At rest',
    strokes: [eye(dot(42, 52)), eye(dot(78, 52)), 'M50 71 Q60 77 70 71'],
  },
  listening: {
    name: 'Listening',
    strokes: [eye(ring(41, 51, 4.5)), eye(ring(79, 51, 4.5)), live('M34 39 Q41 34 48 37', 'lift'), live('M72 37 Q79 34 86 39', 'lift'), 'M55 74 Q60 77.5 65 74'],
  },

  // ── Positive ──
  calm: {
    name: 'Content',
    strokes: ['M33 50 Q41 59 50 50', 'M70 49 Q79 58 87 50', 'M44 73 Q58 84 77 71', 'M36 37 L43 34', 'M78 33 L84 37'],
    face: 'nod',
  },
  joy: {
    name: 'Happy',
    strokes: ['M33 54 Q41 43 49 53', 'M71 53 Q79 42 87 54', 'M37 68 C46 72 75 72 84 67 C80 87 44 89 37 68'],
    face: 'hop',
  },
  love: {
    name: 'Loving',
    strokes: [live('M42 58 C30 49 32 38 41 44 C49 37 55 48 42 58', 'beat'), live('M79 58 C67 49 69 38 78 44 C86 37 92 48 79 58', 'beat'), 'M46 72 Q60 84 75 71'],
  },
  laugh: {
    name: 'Laughing',
    strokes: [dot(41, 51.2, 2.2), 'M86 44 L74 50 L86 56', 'M33 39 Q39 34 47 37', 'M36 66 C45 72 76 72 85 64 C80 88 44 90 36 66'],
    face: 'chuckle',
  },
  excited: {
    name: 'Excited',
    strokes: ['M32 53 Q41 40 50 53', 'M70 53 Q79 40 88 53', 'M38 66 C46 70 74 70 82 66 C80 90 40 90 38 66', live('M24 28 L24 38 M19 33 L29 33', 'twinkle'), live('M97 26 L97 36 M92 31 L102 31', 'twinkle', 700)],
    face: 'bounce',
  },
  proud: {
    name: 'Proud',
    strokes: ['M33 51 Q41 57 49 51', 'M71 51 Q79 57 87 51', 'M34 41 Q41 36 48 39', 'M72 39 Q79 36 86 41', 'M46 74 Q63 81 77 68', live('M96 58 L96 66 M92 62 L100 62', 'twinkle')],
    face: 'tilt',
  },
  silly: {
    name: 'Silly',
    strokes: ['M33 53 Q41 45 49 53', eye(dot(79, 51)), 'M44 70 Q60 79 76 70', live('M54 73 C53 87 67 87 66 74', 'wiggle')],
  },

  // ── Negative ──
  sad: {
    name: 'Sad',
    strokes: ['M32 42 Q40 40 47 33', 'M73 33 Q80 40 88 42', eye(dot(41, 53.1, 2.1)), eye(dot(79, 53.1, 2.1)), 'M45 80 Q60 68 76 79', live('M86 61 C83 67 83 71 86 71 C89 71 89 67 86 61', 'tear')],
    face: 'sigh',
  },
  hurt: {
    name: 'In pain',
    strokes: ['M32 45 L46 51 L33 57', 'M88 45 L74 51 L87 57', 'M39 77 Q44.5 71 50 77 T61 77 T72 77 T82 76', 'M35 35 L46 40', 'M85 35 L74 40'],
    face: 'wince',
  },
  tired: {
    name: 'Tired',
    strokes: ['M32 51 Q41 54 49 51', 'M71 51 Q79 54 88 51', 'M36 59 Q41 62 46 59', 'M74 59 Q79 62 84 59', ring(60, 75.2, 4.2), live('M88 22 L97 22 L88 31 L97 31', 'float')],
    face: 'sigh',
  },
  worried: {
    name: 'Worried',
    strokes: ['M32 38 Q39 31 48 35', 'M72 35 Q81 31 88 38', eye(ring(41, 52.2, 4.2)), eye(ring(79, 52.2, 4.2)), 'M45 76 Q48.75 72 52.5 76 T60 76 T67.5 76 T75 76', live('M94 42 C91 48 91 52 94 52 C97 52 97 48 94 42', 'sweat')],
  },
  angry: {
    name: 'Cross',
    strokes: ['M32 38 L48 45', 'M88 38 L72 45', eye(dot(41, 53)), eye(dot(79, 53)), 'M46 78 Q60 70 74 78', live('M95 34 Q99 30 95 26 Q91 22 95 18', 'steam')],
    face: 'shake',
  },
  sick: {
    name: 'Unwell',
    strokes: ['M33 50 L49 52', 'M71 52 L87 50', 'M44 78 Q50 72 56 78 T68 78 T78 77', 'M80 76 L96 62', ring(79, 76, 3)],
    face: 'queasy',
  },
  cold: {
    name: 'Cold',
    strokes: ['M33 51 L48 51', 'M72 51 L87 51', live('M44 74 L48 78 L52 74 L56 78 L60 74 L64 78 L68 74 L72 78 L76 74', 'chatter'), live('M97 22 L97 34 M91 28 L103 28 M93 24 L101 32 M101 24 L93 32', 'spin')],
    face: 'shiver',
  },

  // ── Neutral ──
  surprised: {
    name: 'Surprised',
    strokes: [eye(ring(41, 50, 5), 'pop'), eye(ring(79, 50, 5), 'pop'), live('M33 34 Q41 29 49 33', 'lift'), live('M71 33 Q79 29 87 34', 'lift'), ring(60, 76.5, 6.5)],
  },
  curious: {
    name: 'Curious',
    strokes: [eye(dot(42, 52)), eye(dot(80, 51)), 'M33 41 L48 40', live('M72 34 Q79 29 87 34', 'lift'), 'M52 75 Q60 72 69 76'],
    face: 'tilt',
  },
  confused: {
    name: 'Confused',
    strokes: [eye(dot(42, 52)), eye(dot(79, 52, 1.6)), 'M33 38 L48 42', 'M72 40 Q79 36 87 39', 'M48 76 Q52 72 56 76 T64 76 T72 76', live('M90 24 C90 17 100 17 100 24 C100 29 95 29 95 34', 'rock'), dot(95, 41, 0.6)],
  },
  hungry: {
    name: 'Hungry or thirsty',
    strokes: [eye(dot(42, 50)), eye(dot(78, 50)), 'M45 70 Q60 80 75 70', live('M62 75 C62 84 72 84 71 74', 'wiggle'), live('M76 73 C74 78 74 81 76 81 C78 81 78 78 76 73', 'drool')],
  },
};
