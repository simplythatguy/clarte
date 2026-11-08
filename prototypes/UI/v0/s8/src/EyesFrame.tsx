/**
 * The eye tracker's frame (NAT-27). Mounted once for the whole session so the camera, the
 * calibration and the trained model survive every screen change. It always covers the full
 * window, so its gaze fractions map 1:1 onto this page and its calibration geometry never
 * changes. During calibration it is shown on top (the tracker's own flow: camera, nine dots,
 * head movement, the free-flow check); otherwise it is invisible and inert behind the app.
 */
import { useEffect, useMemo, useRef } from 'react';
import { eyesFrameUrl } from './eyes.ts';

export function EyesFrame({ shown, onBack }: { shown: boolean; onBack: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => eyesFrameUrl(), []);
  // Hidden, the keyboard stays on this page (digits, Enter, Escape): the tracker focuses its own
  // buttons when it loads and when its phase changes, which would take keys away from the app.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (shown) { frame.current?.focus(); return; }
    const reclaim = () => setTimeout(() => {
      if (shownRef.current || document.activeElement !== frame.current) return;
      frame.current?.blur();
      window.focus();
    }, 0);
    reclaim();
    window.addEventListener('blur', reclaim);
    const node = frame.current;
    node?.addEventListener('load', reclaim);
    return () => { window.removeEventListener('blur', reclaim); node?.removeEventListener('load', reclaim); };
  }, [shown]);
  return (
    <>
      <iframe
        ref={frame}
        className="eyes-frame"
        data-shown={shown || undefined}
        src={src}
        title="Eye tracking calibration"
        allow="camera; fullscreen"
        tabIndex={shown ? 0 : -1}
        aria-hidden={!shown}
        // Hidden, it can take neither focus nor input (the tracker focuses its own buttons on
        // load), yet keeps running and posting gaze.
        inert={!shown}
      />
      {shown && <button type="button" className="eyes-back" onClick={onBack}>Back to Clarte</button>}
    </>
  );
}
