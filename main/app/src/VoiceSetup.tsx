/**
 * Making the person's voice (NAT-32), in place of the first run's voice placeholder and from
 * Menu › My voice. The recording and the clone come from prototypes/Voice (myvoice/); the pages are
 * this app's own. A page with one action besides Not now (or Hear it) puts both in the bottom row
 * as wide cards, the action in ink over Q7–Q8 (owner, 2026-11-08). A page with more keeps the
 * onboarding's tall ink card over Q4 and Q8 for its main action, Not now in Q1 where Back sits in
 * the menu, and its other actions in the bottom row. The text sits in the top row's rest zone
 * (Q2–Q3), under a smaller orb, centred on the row.
 *
 *   intro      Record my voice · Old recordings · Not now
 *   consent    I agree · Not now            (the service's consent statement, word for word)
 *   record     Record / Stop / Record again · Back · Skip · Make my voice · Not now
 *   files      Choose files · Not now       (a helper picks them; the browser needs a click)
 *   making     Not now                      (the voice is made and chosen even if the person leaves)
 *   ready      Hear it (Q5–Q6) · Continue (Q7–Q8)
 *   need-more  Record more · Not now
 *   error      Try again · Record more · Not now
 *
 * While a page records, it is the only thing listening: look + sound selection pauses (App), so
 * reading aloud never selects a card, and no interface cue plays into the recording.
 */
import type { ReactNode } from 'react';
import type { SlotView, Slots } from './Tile.tsx';
import type { VoiceStep } from './model.ts';
import type { Source } from './myvoice/service.ts';
import type { ServiceState } from './myvoice/voices.ts';
import { ENOUGH_SECONDS, MINIMUM_SECONDS, PROMPTS, recordedSeconds, type MakerState } from './myvoice/maker.ts';
import { tallCard } from './Onboarding.tsx';
import { longest } from './text.ts';
import { Again, Back, Check, Close, Mic, Next, Speaker, StopSquare, Waveform } from './icons.tsx';

/** Word for word the statement the voice service stores with every voice it makes. */
export const CONSENT =
  'These recordings are of my own voice, or I am authorized to make this voice for the person speaking in them. ' +
  'I agree that the selected speech is sent to ElevenLabs to create the voice.';

export type VoiceView = { step: VoiceStep; source: Source; maker: MakerState; service: ServiceState; note: string | null };

const card = (action: string, label: string, icon: ReactNode, disabled = false, span?: 2): SlotView => ({
  action, tone: 'surface', icon, disabled, span, bodyKey: `${action}:${label}`,
  body: <span className="card-label" style={longest(label)}>{label}</span>,
});
const notNow = () => card('voice-leave', 'Not now', <Close />);
/**
 * A page with one action besides Not now (owner, 2026-11-08): both share the bottom row as wide
 * cards, Not now over Q5–Q6 and the action, in ink, over Q7–Q8, so the top row is the words alone.
 */
const pair = (left: SlotView, action: string, label: string, icon: ReactNode): Slots =>
  ({ q5: { ...left, span: 2 }, q7: { ...card(action, label, icon, false, 2), tone: 'ink' } });

/** Why voice making cannot start, or null when it can. */
function blocked(service: ServiceState): string | null {
  if (service.kind === 'offline') return service.message;
  if (service.kind === 'no-key') return 'Voice making needs an ElevenLabs key on this computer.';
  return null;
}

export function voiceSlots({ step, source, maker, service }: VoiceView): Slots {
  switch (step) {
    case 'intro':
      return blocked(service)
        ? pair(notNow(), 'voice-check', 'Try again', <Again />)
        : { q1: notNow(), q4: tallCard('voice-record', 'Record my voice', <Mic />), q5: card('voice-old', 'Old recordings', <Waveform />) };
    case 'consent':
      return pair(notNow(), 'voice-agree', 'I agree', <Check />);
    case 'record': {
      if (!maker.mic) return pair(notNow(), 'voice-mic', 'Try again', <Again />);
      const live = maker.recording !== null;
      const prompt = PROMPTS[maker.index];
      const take = live
        ? tallCard('voice-take', 'Stop', <StopSquare />, `Recording · ${Math.floor(maker.recording ?? 0)} s`)
        : tallCard('voice-take', maker.takes[prompt.id] ? 'Record again' : 'Record', <Mic />);
      return {
        q1: notNow(),
        q4: take,
        q5: card('voice-prev', 'Back', <Back />, live || maker.index === 0),
        q6: card('voice-next', 'Skip', <Next />, live || maker.index === PROMPTS.length - 1),
        q7: card('voice-make', 'Make my voice', <Check />, live || recordedSeconds(maker) < MINIMUM_SECONDS),
      };
    }
    case 'files':
      return pair(notNow(), 'voice-files', 'Choose files', <Waveform />);
    case 'making':
      return { q1: notNow() };
    case 'ready':
      return pair(card('voice-hear', 'Hear it', <Speaker />), 'voice-done', 'Continue', <Check />);
    case 'need-more':
      return pair(notNow(), 'voice-more', 'Record more', <Mic />);
    case 'error':
      return source === 'current'
        ? { q1: notNow(), q4: tallCard('voice-retry', 'Try again', <Again />), q5: card('voice-more', 'Record more', <Mic />) }
        : pair(notNow(), 'voice-retry', 'Try again', <Again />);
  }
}

/** The page's words: a title and at most one line under it, or the prompt to read. */
export function VoicePage({ step, source, maker, service, note }: VoiceView) {
  // A page whose buttons all sit in the bottom row (pair) has the top row to itself: the orb rests
  // over Q1–Q2 and the words, left-aligned, over Q3–Q4 (owner, 2026-11-08; GuideOrb.tsx places the orb).
  const slots = voiceSlots({ step, source, maker, service, note });
  const split = !slots.q1 && !slots.q4;
  let body: ReactNode;
  let label = 'Your voice';
  switch (step) {
    case 'intro': {
      const why = blocked(service);
      body = <><h1 className="page-title">Make your voice</h1><p className="voice-line">{why ?? 'Read a few short sentences aloud, about a minute in all.'}</p></>;
      break;
    }
    case 'consent':
      body = <><h1 className="page-title">{source === 'past' ? 'Before you choose' : 'Before you record'}</h1><p className="voice-line voice-consent">{CONSENT}</p></>;
      break;
    case 'record': {
      const prompt = PROMPTS[maker.index];
      const seconds = Math.round(recordedSeconds(maker));
      label = 'Recording';
      body = maker.mic ? (
        <>
          <p className="voice-progress">
            {maker.recording !== null && <span className="voice-dot" aria-hidden="true" />}
            {maker.recording !== null ? 'Recording' : `Sentence ${maker.index + 1} of ${PROMPTS.length}`} · {seconds} s of about {ENOUGH_SECONDS} s
          </p>
          <p className="voice-prompt">{prompt.text}</p>
          {prompt.hint && <p className="voice-line">{prompt.hint}</p>}
          {/* Assistive technology hears the recording start and stop, not every second of it. */}
          <span className="sr-only" aria-live="polite">{maker.recording !== null ? 'Recording' : ''}</span>
        </>
      ) : <><h1 className="page-title">The microphone is off</h1><p className="voice-line">{maker.error ?? 'Clarté needs the microphone to record.'}</p></>;
      break;
    }
    case 'files':
      body = <><h1 className="page-title">Recordings from before</h1><p className="voice-line">{note ?? 'Videos, voicemails, anything where you speak. Clarté keeps the clearest speech.'}</p></>;
      break;
    case 'making':
      body = <><h1 className="page-title">Making your voice</h1><p className="voice-line">This takes a minute or two.</p></>;
      break;
    case 'ready': {
      const made = maker.made;
      body = <><h1 className="page-title">Your voice is ready</h1>{made && <p className="voice-line">Made from {Math.round(made.reference.seconds)} s of your speech.</p>}</>;
      break;
    }
    case 'need-more':
      body = <><h1 className="page-title">It needs more speech</h1><p className="voice-line">Record a few more sentences, then make it again.</p></>;
      break;
    case 'error':
      body = <><h1 className="page-title">Your voice wasn’t made</h1><p className="voice-line">{maker.error ?? 'Something went wrong.'}</p></>;
      break;
  }
  return (
    <section className={`onboarding voice-page${split ? ' onboarding-split' : ''}`} aria-label={label}>
      <div className="voice-text">{body}</div>
    </section>
  );
}
