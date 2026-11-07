/**
 * Every face the Cloud can make: the eighteen reactions (sentiment.ts) plus two states, neutral
 * (at rest) and listening (the partner is about to speak and no words have arrived yet). Each is a
 * few pen lines on a 120-unit grid, in drawing order: eyes, then mouth, then extras
 * (SketchFace.tsx draws and erases them).
 */
import type { ReactionKind } from './sentiment.ts';

export type ExpressionKind = ReactionKind | 'neutral' | 'listening';

type Def = { name: string; strokes: string[] };

/** A small closed loop that reads as a dot when stroked. */
const dot = (x: number, y: number, r = 2.4) => `M${x} ${y - r} c-${r * 1.1} 0 -${r * 1.1} ${r * 2} 0 ${r * 2} c${r * 1.1} 0 ${r * 1.1} -${r * 2} 0 -${r * 2}`;
const ring = (x: number, y: number, r: number) => `M${x} ${y - r} c-${r * 1.33} 0 -${r * 1.33} ${r * 2} 0 ${r * 2} c${r * 1.33} 0 ${r * 1.33} -${r * 2} 0 -${r * 2}`;

export const EXPRESSIONS: Record<ExpressionKind, Def> = {
  // ── States ──
  neutral: {
    name: 'At rest',
    strokes: [dot(42, 52), dot(78, 52), 'M50 71 Q60 77 70 71'],
  },
  listening: {
    name: 'Listening',
    strokes: [ring(41, 51, 4.5), ring(79, 51, 4.5), 'M34 39 Q41 34 48 37', 'M72 37 Q79 34 86 39', 'M55 74 Q60 77.5 65 74'],
  },

  // ── Positive ──
  calm: {
    name: 'Content',
    strokes: ['M33 50 Q41 59 50 50', 'M70 49 Q79 58 87 50', 'M44 73 Q58 84 77 71', 'M36 37 L43 34', 'M78 33 L84 37'],
  },
  joy: {
    name: 'Happy',
    strokes: ['M33 54 Q41 43 49 53', 'M71 53 Q79 42 87 54', 'M37 68 C46 72 75 72 84 67 C80 87 44 89 37 68'],
  },
  love: {
    name: 'Loving',
    strokes: ['M42 58 C30 49 32 38 41 44 C49 37 55 48 42 58', 'M79 58 C67 49 69 38 78 44 C86 37 92 48 79 58', 'M46 72 Q60 84 75 71'],
  },
  laugh: {
    name: 'Laughing',
    strokes: [dot(41, 51.2, 2.2), 'M86 44 L74 50 L86 56', 'M33 39 Q39 34 47 37', 'M36 66 C45 72 76 72 85 64 C80 88 44 90 36 66'],
  },
  excited: {
    name: 'Excited',
    strokes: ['M32 53 Q41 40 50 53', 'M70 53 Q79 40 88 53', 'M38 66 C46 70 74 70 82 66 C80 90 40 90 38 66', 'M24 28 L24 38 M19 33 L29 33', 'M97 26 L97 36 M92 31 L102 31'],
  },
  proud: {
    name: 'Proud',
    strokes: ['M33 51 Q41 57 49 51', 'M71 51 Q79 57 87 51', 'M34 41 Q41 36 48 39', 'M72 39 Q79 36 86 41', 'M46 74 Q63 81 77 68', 'M96 58 L96 66 M92 62 L100 62'],
  },
  silly: {
    name: 'Silly',
    strokes: ['M33 53 Q41 45 49 53', dot(79, 51), 'M44 70 Q60 79 76 70', 'M54 73 C53 87 67 87 66 74'],
  },

  // ── Negative ──
  sad: {
    name: 'Sad',
    strokes: ['M32 42 Q40 40 47 33', 'M73 33 Q80 40 88 42', dot(41, 53.1, 2.1), dot(79, 53.1, 2.1), 'M45 80 Q60 68 76 79', 'M86 61 C83 67 83 71 86 71 C89 71 89 67 86 61'],
  },
  hurt: {
    name: 'In pain',
    strokes: ['M32 45 L46 51 L33 57', 'M88 45 L74 51 L87 57', 'M39 77 Q44.5 71 50 77 T61 77 T72 77 T82 76', 'M35 35 L46 40', 'M85 35 L74 40'],
  },
  tired: {
    name: 'Tired',
    strokes: ['M32 51 Q41 54 49 51', 'M71 51 Q79 54 88 51', 'M36 59 Q41 62 46 59', 'M74 59 Q79 62 84 59', ring(60, 75.2, 4.2), 'M88 22 L97 22 L88 31 L97 31'],
  },
  worried: {
    name: 'Worried',
    strokes: ['M32 38 Q39 31 48 35', 'M72 35 Q81 31 88 38', ring(41, 52.2, 4.2), ring(79, 52.2, 4.2), 'M45 76 Q48.75 72 52.5 76 T60 76 T67.5 76 T75 76', 'M94 42 C91 48 91 52 94 52 C97 52 97 48 94 42'],
  },
  angry: {
    name: 'Cross',
    strokes: ['M32 38 L48 45', 'M88 38 L72 45', dot(41, 53), dot(79, 53), 'M46 78 Q60 70 74 78', 'M95 34 Q99 30 95 26 Q91 22 95 18'],
  },
  sick: {
    name: 'Unwell',
    strokes: ['M33 50 L49 52', 'M71 52 L87 50', 'M44 78 Q50 72 56 78 T68 78 T78 77', 'M80 76 L96 62', ring(79, 76, 3)],
  },
  cold: {
    name: 'Cold',
    strokes: ['M33 51 L48 51', 'M72 51 L87 51', 'M44 74 L48 78 L52 74 L56 78 L60 74 L64 78 L68 74 L72 78 L76 74', 'M97 22 L97 34 M91 28 L103 28 M93 24 L101 32 M101 24 L93 32'],
  },

  // ── Neutral ──
  surprised: {
    name: 'Surprised',
    strokes: [ring(41, 50, 5), ring(79, 50, 5), 'M33 34 Q41 29 49 33', 'M71 33 Q79 29 87 34', ring(60, 76.5, 6.5)],
  },
  curious: {
    name: 'Curious',
    strokes: [dot(42, 52), dot(80, 51), 'M33 41 L48 40', 'M72 34 Q79 29 87 34', 'M52 75 Q60 72 69 76'],
  },
  confused: {
    name: 'Confused',
    strokes: [dot(42, 52), dot(79, 52, 1.6), 'M33 38 L48 42', 'M72 40 Q79 36 87 39', 'M48 76 Q52 72 56 76 T64 76 T72 76', 'M90 24 C90 17 100 17 100 24 C100 29 95 29 95 34', dot(95, 41, 0.6)],
  },
  hungry: {
    name: 'Hungry or thirsty',
    strokes: [dot(42, 50), dot(78, 50), 'M45 70 Q60 80 75 70', 'M62 75 C62 84 72 84 71 74', 'M76 73 C74 78 74 81 76 81 C78 81 78 78 76 73'],
  },
};
