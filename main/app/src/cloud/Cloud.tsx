/**
 * The Cloud (owner, 2026-11-07; back in main for NAT-42, 2026-11-08): S8's orb with a hand-drawn
 * face, in place of the mesh-gradient ball. Only the face is swapped: the companion's flight and
 * dock (Companion.tsx) and the calibration orb (GuideOrb.tsx) place it exactly as they placed the
 * ball, because the visible orb fills this component's box.
 *
 * It keeps everything that made it the Cloud:
 *  - mood colour: idle peach, listening coral, replying apricot, speaking green (Orb.tsx);
 *  - speaking makes it livelier, and each word heard or spoken swells it (`pulse`);
 *  - it leans towards the card gaze is on;
 *  - its face: the newest turn's reaction for 8 s after the turn ends (sentiment.ts), otherwise
 *    Listening while the partner is about to speak, otherwise At rest (expressions.ts).
 */
import { useEffect, useState } from 'react';
import { Orb, type OrbMood } from './Orb.tsx';
import { SketchFace } from './SketchFace.tsx';
import type { ExpressionKind } from './expressions.ts';
import type { ReactionKind } from './sentiment.ts';
import { PALETTE } from '../variant.ts';

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
  halo?: boolean;
  /** Wait this long before the pen starts on the first face. */
  enterDelay?: number;
};

/** The reaction to show now: a new turn's reaction for REACTION_HOLD_MS, then none. */
function useHeldReaction(reaction: ShownReaction | null): ReactionKind | null {
  const [expired, setExpired] = useState<Set<string>>(() => new Set());
  const key = reaction?.key ?? null;
  useEffect(() => {
    if (!key || expired.has(key)) return;
    const t = setTimeout(() => setExpired((s) => new Set(s).add(key)), REACTION_HOLD_MS);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return reaction && !expired.has(reaction.key) ? reaction.kind : null;
}

export function Cloud({ mood, pulse = 0, still, listening = false, reaction = null, look = null, lean = true, halo = true, enterDelay = 260 }: Props) {
  const held = useHeldReaction(reaction);
  const kind: ExpressionKind = held ?? (listening ? 'listening' : 'neutral');
  return (
    <Orb mood={mood} pulse={pulse} still={still} palette={PALETTE} lean={lean} halo={halo} look={look}>
      <SketchFace kind={kind} visible enterDelay={enterDelay} alive={!still} />
    </Orb>
  );
}
