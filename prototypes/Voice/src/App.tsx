import { useCallback, useEffect, useState } from 'react';
import { health, listVoices, type Health, type Source, type Voice } from './api';
import { Choose } from './screens/Choose';
import { Home } from './screens/Home';
import { RecordToday } from './screens/RecordToday';
import { Upload } from './screens/Upload';
import { VoiceScreen } from './screens/VoiceScreen';

export type Screen =
  | { name: 'home' }
  | { name: 'choose' }
  | { name: 'make'; source: Source }
  | { name: 'voice'; id: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [service, setService] = useState<Health | null | 'offline'>(null);
  const [voices, setVoices] = useState<Voice[]>([]);

  const refresh = useCallback(async () => {
    try {
      setService(await health());
      setVoices(await listVoices());
    } catch {
      setService('offline');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [screen]);

  const go = (next: Screen) => setScreen(next);
  const made = (voice: Voice) => {
    setVoices((list) => [voice, ...list.filter((v) => v.id !== voice.id)]);
    go({ name: 'voice', id: voice.id });
  };

  return (
    <div className="app">
      <header className="bar">
        <button type="button" className="wordmark" onClick={() => go({ name: 'home' })}>
          Clarte <span>voice</span>
        </button>
        {screen.name !== 'home' && (
          <button type="button" className="quiet" onClick={() => go({ name: 'home' })}>
            All voices
          </button>
        )}
      </header>
      <main>
        {screen.name === 'home' && (
          <Home service={service} voices={voices} onRetry={refresh} go={go} />
        )}
        {screen.name === 'choose' && <Choose go={go} />}
        {screen.name === 'make' && screen.source === 'past' && <Upload onMade={made} />}
        {screen.name === 'make' && screen.source === 'current' && <RecordToday onMade={made} />}
        {screen.name === 'voice' && (
          <VoiceScreen
            id={screen.id}
            onChanged={(voice) => setVoices((list) => list.map((v) => (v.id === voice.id ? voice : v)))}
            onDeleted={(id) => {
              setVoices((list) => list.filter((v) => v.id !== id));
              go({ name: 'home' });
            }}
          />
        )}
      </main>
    </div>
  );
}
