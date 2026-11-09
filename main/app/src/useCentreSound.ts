import { useEffect, useRef, useState } from 'react';
import { captureCentreSound, type CaptureState } from './centreSound.ts';

export type CentreSoundState = CaptureState | 'off' | 'starting';

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
    const controller = new AbortController();
    setState('starting');
    void captureCentreSound(controller.signal,
      () => !document.hidden && document.hasFocus() && latest.current.eligible(),
      () => latest.current.confirm(),
      next => { if (!controller.signal.aborted) setState(next); },
    ).catch(() => { if (!controller.signal.aborted) setState('unavailable'); });
    return () => controller.abort();
  }, [active, visible]);
  return active && visible ? state : 'off';
}
