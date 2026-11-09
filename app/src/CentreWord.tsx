import { useEffect, useState, type ReactNode } from 'react';
import { engine, isQuiet } from './gaze.ts';
import type { CentreSoundState } from './useCentreSound.ts';

export type CentreAcceptance = { word: string; activate(): void; sound: CentreSoundState };

export function CentreWord({ acceptance, children }: { acceptance: CentreAcceptance; children: ReactNode }) {
  const [looked, setLooked] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => engine.subscribe(snapshot => {
    setLooked(snapshot.looked === 'accept-centre');
    const armed = acceptance.sound === 'ready' && snapshot.looked === 'accept-centre'
      && snapshot.action === 'accept-centre' && snapshot.state === 'previewed' && !isQuiet('accept-centre', snapshot);
    setReady(previous => previous === armed ? previous : armed);
  }), [acceptance.sound]);
  return (
    <span className="word in-progress centre-word" data-centre-looked={looked || undefined} data-centre-ready={(acceptance.sound === 'ready' && ready) || undefined}>
      {children}
      <button type="button" className="centre-activate" aria-label={`Accept ${acceptance.word}`}
        aria-description={ready ? 'Ready. Make your sound to accept this word.' : undefined}
        onClick={acceptance.activate} />
    </span>
  );
}
