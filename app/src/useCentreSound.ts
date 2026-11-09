import { useEffect, useRef, useState } from 'react';
import { startSoundSelect } from './soundSelect.ts';

export type CentreSoundState = 'ready' | 'suspended' | 'unavailable' | 'off' | 'starting';

export function useCentreSound(active: boolean, eligible: () => boolean, confirm: () => void): CentreSoundState {
  const latest = useRef({ eligible, confirm });
  latest.current = { eligible, confirm };
  const [state, setState] = useState<CentreSoundState>('off');
  const [visible, setVisible] = useState(!document.hidden && document.hasFocus());
  useEffect(() => {
    const changed = () => setVisible(!document.hidden && document.hasFocus());
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('focus', changed);
    window.addEventListener('blur', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('focus', changed);
      window.removeEventListener('blur', changed);
    };
  }, []);
  useEffect(() => {
    if (!active || !visible) { setState('off'); return; }
    let stopped = false;
    let stop: (() => void) | undefined;
    setState('starting');
    void startSoundSelect(
      () => latest.current.confirm(),
      () => !stopped && !document.hidden && document.hasFocus() && latest.current.eligible(),
      true,
    ).then(listener => {
      if (stopped) listener.stop();
      else { stop = () => listener.stop(); setState('ready'); }
    }, () => { if (!stopped) setState('unavailable'); });
    return () => { stopped = true; stop?.(); };
  }, [active, visible]);
  return active && visible ? state : 'off';
}
