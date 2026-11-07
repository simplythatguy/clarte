/**
 * The Cloud in the middle of the conversation (owner, 2026-11-07): style 6's orb with a hand-drawn
 * face, there only while the middle is blank. As soon as new text appears there (the partner's
 * words as heard, the message being typed, the sentence being spoken, a menu title) its face
 * erases itself and the orb fades; when the text is gone the orb returns and the face draws itself.
 *
 * Its face: the newest turn's reaction for 8 s after the turn ends (sentiment.ts), otherwise
 * Listening while the partner is about to speak, otherwise At rest.
 */
import { useEffect, useRef, useState } from 'react';
import { Orb, type OrbMood } from './Orb.tsx';
import { SketchFace } from './SketchFace.tsx';
import type { ExpressionKind } from './expressions.ts';
import type { ReactionKind } from './sentiment.ts';
import { PALETTE } from './variant.ts';

/** How long a reaction stays on the face before it settles back to At rest. */
export const REACTION_HOLD_MS = 8000;

export type ShownReaction = { key: string; kind: ReactionKind };

type Props = {
  /** The middle is blank: no live text and no title there. */
  visible: boolean;
  /** Listening, with no words heard yet. */
  listening: boolean;
  reaction: ShownReaction | null;
  mood: OrbMood;
  pulse: number;
  still: boolean;
  theme: 'light' | 'dark';
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

export function Companion({ visible, listening, reaction, mood, pulse, still, theme }: Props) {
  const held = useHeldReaction(reaction);
  const kind: ExpressionKind = held ?? (listening ? 'listening' : 'neutral');
  // While text holds the middle, keep the last face so it leaves wearing it.
  const shownKind = useRef(kind);
  if (visible) shownKind.current = kind;
  return (
    <Orb mood={mood} pulse={pulse} still={still} theme={theme} palette={PALETTE} visible={visible}>
      <SketchFace kind={visible ? kind : shownKind.current} visible={visible} enterDelay={260} />
    </Orb>
  );
}
