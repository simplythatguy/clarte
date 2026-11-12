/**
 * The Cloud (owner, 2026-11-07; back in main for NAT-42, 2026-11-08): S8's orb, in place of the
 * mesh-gradient ball: the companion's flight and
 * dock (Companion.tsx) and the calibration orb (GuideOrb.tsx) place it exactly as they placed the
 * ball, because the visible orb fills this component's box.
 *
 * It keeps everything that made it the Cloud:
 *  - UI v1's round mesh-gradient ball, its colours and shading (Orb.tsx), and v1's two long eyes
 *    (Eyes.tsx; owner, 2026-11-10). The sketched faces (SketchFace.tsx) are not shown for now, so
 *    `listening`, `reaction`, `enterDelay` and `smile` change nothing;
 *  - speaking makes it livelier, and each word heard or spoken swells it (`pulse`);
 *  - it leans towards the card gaze is on.
 */
import { Orb, type OrbMood } from './Orb.tsx';
import { Eyes } from './Eyes.tsx';
import type { ReactionKind } from './sentiment.ts';

export type { OrbMood } from './Orb.tsx';
export { reactionFor } from './sentiment.ts';

/** How long a reaction stays on the face before it settles back to At rest. */
export const REACTION_HOLD_MS = 8000;

export type ShownReaction = { key: string; kind: ReactionKind };

type Props = {
  mood: OrbMood;
  /** Increments on each partner word heard and each word spoken. */
  pulse?: number;
  still: boolean;
  /** Listening: the Listening face, unless a reaction is showing. */
  listening?: boolean;
  reaction?: ShownReaction | null;
  /** Where the face looks (Companion's flight); null at rest. */
  look?: { x: number; y: number } | null;
  lean?: boolean;
  /** Wait this long before the pen starts on the first face. */
  enterDelay?: number;
  /** A slow smile on the resting face (calibration's return to the centre). */
  smile?: boolean;
};

export function Cloud({ mood, pulse = 0, still, look = null, lean = true }: Props) {
  return (
    <Orb mood={mood} pulse={pulse} still={still} lean={lean} look={look}>
      <Eyes alive={!still} />
    </Orb>
  );
}
