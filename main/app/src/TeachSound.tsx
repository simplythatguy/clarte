/**
 * Teaching Clarté the person's sound (DEC-128), from Menu › Settings › My sound.
 *
 * The select sound is "yeah" (owner, 2026-11-08), said however the person says it: the listener
 * learns their own "yeah" from them, dysarthric or not, and assumes nothing about how it sounds.
 * About 30 seconds:
 *  1. Stay quiet (3 s): the room, kept as sounds that must not select.
 *  2. Say "yeah", TAKES times: each take fills a dot as it is heard (the live feedback that
 *     vocal-input studies found essential). Each take is kept with two slightly faster and slower
 *     variants (`listen/augment.ts`).
 *  3. Anything but "yeah" (6 s): talking, a cough, clearing the throat. These are the hardest
 *     sounds to tell apart, because they are the person's own voice at the person's distance.
 *  4. Try saying "yeah": the profile is in use, and each sound heard says whether it matched.
 * The page shows one prompt at a time; Back leaves without changing anything until step 4.
 */
import { useEffect, useRef, useState } from 'react';
import { microphone, type Heard } from './listen/runtime.ts';
import { enroll, judge, type Profile } from './listen/matcher.ts';
import { loadBank, saveProfile } from './listen/store.ts';
import { mainEvent, takeEvents } from './listen/takes.ts';
import type { SoundEvent } from './listen/events.ts';

/** The word the person teaches and then says to select. */
export const WORD = 'yeah';
export const TAKES = 8;
const ROOM_MS = 3000;
const OTHER_MS = 6000;
/** A take shorter than this is a click of the mouth or a bump, not a take. */
const MIN_TAKE_MS = 80;

export type TeachStep = 'room' | 'takes' | 'other' | 'ready' | 'failed';

type Flow = { step: TeachStep; takes: number; tried: 'yes' | 'no' | null; tries: number };

/** Exposed for the end-to-end check: what the flow heard and decided. */
declare global { interface Window { clarteListen?: { step: TeachStep; takes: number; tries: ({ at: number; accept: boolean; reason: string } & Record<string, unknown>)[]; profile: Profile | null } } }

export function TeachSound({ onStep }: { onStep: (step: TeachStep) => void }) {
  const [flow, setFlow] = useState<Flow>({ step: 'room', takes: 0, tried: null, tries: 0 });
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => {
    let step: TeachStep = 'room';
    const takes: SoundEvent[][] = [];
    const negatives: SoundEvent[] = [];
    let profile: Profile | null = null;
    let lastTakeEnd = -Infinity;
    let timer = 0;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const debug: NonNullable<Window["clarteListen"]> = { step, takes: 0, tries: [], profile: null };
    window.clarteListen = debug;
    const go = (next: TeachStep) => {
      step = next; debug.step = next;
      setFlow((f) => ({ ...f, step: next }));
      onStepRef.current(next);
    };

    const finish = async () => {
      const bank = await loadBank();
      if (cancelled) return;
      profile = enroll(takes, negatives, bank);
      saveProfile(profile, bank.length);
      debug.profile = profile;
      go('ready');
    };

    const onEvent = ({ event, samples }: Heard) => {
      if (step === 'room' || step === 'other') {
        const e = mainEvent(samples());
        if (e) negatives.push(e);
      } else if (step === 'takes') {
        if (event.stats.durationMs < MIN_TAKE_MS || event.start < lastTakeEnd) return;
        const variants = takeEvents(samples());
        if (!variants.length) return;
        lastTakeEnd = event.at;
        takes.push(variants);
        debug.takes = takes.length;
        setFlow((f) => ({ ...f, takes: takes.length }));
        if (takes.length >= TAKES) {
          go('other');
          timer = window.setTimeout(() => void finish(), OTHER_MS);
        }
      } else if (step === 'ready' && profile) {
        const v = judge(profile, event);
        debug.tries.push({ at: event.start, accept: v.accept, reason: v.reason, distance: v.distance, nearestNegative: v.nearestNegative, negativeSource: v.negativeSource, threshold: profile.threshold });
        setFlow((f) => ({ ...f, tried: v.accept ? 'yes' : 'no', tries: f.tries + 1 }));
      }
    };

    microphone.subscribe({ onEvent }).then((off) => {
      if (cancelled) { off(); return; }
      stop = off;
      timer = window.setTimeout(() => go('takes'), ROOM_MS);
    }, () => { if (!cancelled) go('failed'); });

    return () => { cancelled = true; window.clearTimeout(timer); stop?.(); };
  }, []);

  const { step, takes, tried, tries } = flow;
  const title = {
    room: 'Stay quiet',
    takes: `Say “${WORD}” ${TAKES} times`,
    other: `Now anything but “${WORD}”`,
    ready: `Try saying “${WORD}”`,
    failed: 'No microphone',
  }[step];
  const note = step === 'takes' ? 'Your own way, a breath apart'
    : step === 'other' ? 'Talk, cough or clear your throat'
    : step === 'ready' ? (tried === 'yes' ? `That was your “${WORD}”` : tried === 'no' ? `That was not your “${WORD}”` : 'Clarté listens for it now')
    : step === 'failed' ? 'Allow the microphone, then try again'
    : null;
  return (
    <>
      <h1 className="page-title">{title}</h1>
      {note && <p key={`${step}:${tries}`} className="teach-note" data-tried={step === 'ready' ? tried ?? undefined : undefined}>{note}</p>}
      {(step === 'takes' || step === 'other' || step === 'ready') && (
        <div className="teach-dots" role="progressbar" aria-label="Takes heard" aria-valuemin={0} aria-valuemax={TAKES} aria-valuenow={takes}>
          {Array.from({ length: TAKES }, (_, i) => <span key={i} data-on={i < takes || undefined} />)}
        </div>
      )}
    </>
  );
}
