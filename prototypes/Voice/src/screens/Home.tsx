import type { Health, Voice } from '../api';
import type { Screen } from '../App';

interface Props {
  service: Health | null | 'offline';
  voices: Voice[];
  onRetry: () => void;
  go: (screen: Screen) => void;
}

const SOURCE_LABEL = {
  past: 'From recordings of before',
  current: 'From how I speak today',
} as const;

export function Home({ service, voices, onRetry, go }: Props) {
  if (service === 'offline') {
    return (
      <section className="stack">
        <h1 tabIndex={-1}>Start the voice service</h1>
        <p className="lede">
          Clarte's voice service, a small program on this computer, isn't running yet. In a
          terminal, from <code>prototypes/Voice</code>, run:
        </p>
        <pre className="command">ELEVENLABS_API_KEY=… npm run server</pre>
        <button type="button" className="primary" onClick={onRetry}>
          Check again
        </button>
      </section>
    );
  }

  return (
    <section className="stack">
      <h1 tabIndex={-1}>Your voice, made from you</h1>
      <p className="lede">
        Clarte can speak what you type or choose in a voice made from your own recordings: old ones
        from before your speech changed, or a few minutes recorded today.
      </p>
      {service && !service.keyConfigured && (
        <div className="notice" role="status">
          The voice service has no ElevenLabs API key. Restart it with{' '}
          <code>ELEVENLABS_API_KEY</code> set, then reload this page.
        </div>
      )}
      <button
        type="button"
        className="primary"
        onClick={() => go({ name: 'choose' })}
        disabled={!service || !service.keyConfigured}
      >
        Make a voice
      </button>

      {voices.length > 0 && (
        <ul className="voice-list" aria-label="Voices on this computer">
          {voices.map((voice) => (
            <li key={voice.id}>
              <button type="button" className="voice-row" onClick={() => go({ name: 'voice', id: voice.id })}>
                <span className="voice-row-name">{voice.name}</span>
                <span className="voice-row-meta">
                  {SOURCE_LABEL[voice.source]}
                  {voice.status === 'need-more' ? ', needs more speech' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="fine">
        Clarte listens to your recordings on this computer and sends only the clearest speech to
        ElevenLabs, which makes the voice. What you ask the voice to say is sent to ElevenLabs too.
        Your recordings are kept here{service ? ` (${service.storage})` : ''}, and deleting a voice
        also deletes it from ElevenLabs.
      </p>
    </section>
  );
}
