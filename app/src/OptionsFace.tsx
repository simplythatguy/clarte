/**
 * The Options card's face (owner, 2026-11-08): "Options" at the bottom, the three most likely words
 * above it, dimmer going up, and a faint ⋯ on top when the list goes on.
 *
 * As typing changes the list it behaves like a live leaderboard: a word that stays slides to its new
 * rank, a word that drops out slides off upward and fades (160 ms), a word that arrives slides in
 * from above (beyond third place, where the list goes on) once the leavers have cleared its row
 * (from 120 ms), and each word's dimness eases to its new rank. Words never sit on top of each
 * other. Moves measure where each word was and play the difference out (FLIP), 320 ms on --ease-move.
 * Under reduced motion the words change in place.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { longest } from './text.ts';

const MOVE_MS = 320;
const LEAVE_MS = 160;
/** Arrivals wait for the leavers to clear, so two words never share a row. */
const ARRIVE_AFTER = 120;
const EASE_MOVE = 'cubic-bezier(0.77, 0, 0.175, 1)';
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** Dimness by rank: first (nearest "Options"), second, third. */
const RANK_OPACITY = [0.62, 0.42, 0.27];

type Leaving = { word: string; top: number; rank: number };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function OptionsFace({ top, more }: { top: string[]; more: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const was = useRef(new Map<string, { top: number; rank: number }>());
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const key = top.join('|');

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Tops are measured from the card, not the face: the face is centred in the card, so it moves
    // when the list's height changes, and a word that stays must play that move out too.
    const now = new Map<string, { top: number; rank: number }>();
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-word]')];
    for (const n of nodes) now.set(n.dataset.word!, { top: el.offsetTop + n.offsetTop, rank: Number(n.dataset.rank) });
    if (was.current.size && !reducedMotion()) {
      const gone = [...was.current].filter(([w]) => !now.has(w)).map(([word, at]) => ({ word, rank: at.rank, top: at.top - el.offsetTop }));
      const wait = gone.length ? ARRIVE_AFTER : 0;
      for (const n of nodes) {
        const before = was.current.get(n.dataset.word!);
        const after = now.get(n.dataset.word!)!;
        if (!before) {
          n.animate(
            [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: RANK_OPACITY[after.rank], transform: 'none' }],
            { duration: MOVE_MS - 40, delay: wait, easing: EASE_OUT, fill: 'backwards' },
          );
        } else if (before.top !== after.top || before.rank !== after.rank) {
          n.animate(
            [{ transform: `translateY(${before.top - after.top}px)`, opacity: RANK_OPACITY[before.rank] }, { transform: 'none', opacity: RANK_OPACITY[after.rank] }],
            { duration: MOVE_MS, easing: EASE_MOVE },
          );
        }
      }
      if (gone.length) setLeaving(gone);
    }
    was.current = now;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Words that dropped out are drawn where they were, sliding up and fading, then removed.
  useLayoutEffect(() => {
    if (!leaving.length || !box.current) return;
    const anims = [...box.current.querySelectorAll<HTMLElement>('[data-leaving]')].map((n) =>
      n.animate([{ opacity: Number(n.style.opacity), transform: 'none' }, { opacity: 0, transform: 'translateY(-18px)' }], { duration: LEAVE_MS, easing: EASE_OUT, fill: 'forwards' }),
    );
    const t = setTimeout(() => setLeaving([]), LEAVE_MS);
    return () => { clearTimeout(t); anims.forEach((a) => a.cancel()); };
  }, [leaving]);

  return (
    <span ref={box} className="options-face">
      {leaving.map((l) => (
        <span key={`leaving-${l.word}`} data-leaving="" className="options-word options-leaving" aria-hidden="true" style={{ top: l.top, opacity: RANK_OPACITY[l.rank], ['--len' as string]: l.word.length }}>{l.word}</span>
      ))}
      <span className="options-more" aria-hidden="true" data-on={more || undefined}>⋯</span>
      {[...top].reverse().map((word) => {
        const rank = top.indexOf(word);
        return <span key={word} data-word={word} data-rank={rank} className="options-word" style={{ opacity: RANK_OPACITY[rank], ['--len' as string]: word.length }}>{word}</span>;
      })}
      <span className="card-label" style={longest('Options')}>Options</span>
    </span>
  );
}
