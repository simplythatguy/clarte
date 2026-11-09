/**
 * Recorded audio to events, the same way in the app and in the offline evaluation: a fresh
 * front end and cutter over the samples, so an enrolment take is cut exactly as a live sound is.
 */
import { FeatureStream, type Frame } from './features.ts';
import { EventCutter, type SoundEvent } from './events.ts';
import { variants } from './augment.ts';

export function eventsIn(samples: Float32Array): { events: SoundEvent[]; frames: Frame[] } {
  const features = new FeatureStream(), cutter = new EventCutter();
  const frames = features.push(samples);
  const events: SoundEvent[] = [];
  for (const f of frames) cutter.push(f, events);
  return { events, frames };
}

/**
 * The loudest event in a recording, or null when nothing rose out of the room. The recording is
 * followed by 0.3 s of silence, so a sound that runs to its very end still ends and is decided.
 */
export function mainEvent(samples: Float32Array): SoundEvent | null {
  const padded = new Float32Array(samples.length + 4800);
  padded.set(samples);
  return eventsIn(padded).events.sort((a, b) => b.stats.peakDb - a.stats.peakDb)[0] ?? null;
}

/** A take (with the room before it) and its variants, as events for `enroll`. */
export function takeEvents(samples: Float32Array): SoundEvent[] {
  return variants(samples).map(mainEvent).filter((e): e is SoundEvent => e !== null);
}
