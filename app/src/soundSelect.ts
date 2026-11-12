/**
 * Selecting by sound (owner, 2026-11-08): the eyes point, a sound commits. In the gaze engine's
 * confirm mode a steady look closes the dwell line round a card and waits; the person's sound
 * then selects it.
 *
 * Which sounds count (DEC-128). Once the person has taught Clarté their "yeah" (Menu › Settings ›
 * My sound, `TeachSound.tsx`), only a sound that matches their own takes selects: other
 * people talking, someone beside them saying something similar, claps, coughs and traffic do not
 * (`listen/matcher.ts`, measured in `scripts/listen-eval.ts`). The matcher assumes nothing about
 * the word; it learns the person's own way of saying it. Before they have taught it, a generic
 * rule stands in: a voiced sound that rises clearly out of the room and is not an impact.
 */
import { onsetAt } from './listen/events.ts';
import { microphone } from './listen/runtime.ts';
import { judge, judgeGeneric, type Profile } from './listen/matcher.ts';
import { loadBank, loadProfile, onProfileChange } from './listen/store.ts';

export type SoundSelect = { stop(): void };

/** After a selection, sounds are ignored this long, so one sound selects once. */
const REFRACTORY_S = 0.8;

/**
 * Listen for the person's sound and call `onSound` at each one, while `enabled()` is true.
 * Rejects when the microphone is unavailable or blocked.
 */
export async function startSoundSelect(onSound: () => void, enabled: () => boolean, requireReadyOnset = false): Promise<SoundSelect> {
  const bank = await loadBank();
  let profile: Profile | null = loadProfile(bank);
  const offProfile = onProfileChange(() => { profile = loadProfile(bank); });
  let last = -Infinity;
  let readySince = Infinity;
  let wasReady = false;
  const stopListening = await microphone.subscribe({
    onLevel: (_db, _floor, at) => {
      const ready = enabled();
      if (ready && !wasReady) readySince = at;
      if (!ready) readySince = Infinity;
      wasReady = ready;
    },
    onEvent: ({ event }) => {
      const verdict = profile ? judge(profile, event) : judgeGeneric(event);
      const on = enabled();
      const fires = on && (!requireReadyOnset || onsetAt(event) >= readySince) && verdict.accept && event.at - last >= REFRACTORY_S;
      if (fires) { last = event.at; onSound(); }
      import.meta.hot?.send('clarte:sound', { at: +event.at.toFixed(2), taught: Boolean(profile), accept: verdict.accept, reason: verdict.reason, distance: verdict.distance, enabled: on, fired: fires, peak: Math.round(event.stats.peakDb), stats: event.stats, ended: event.ended, settings: microphone.settings });
    },
  });
  return { stop() { stopListening(); offProfile(); } };
}
