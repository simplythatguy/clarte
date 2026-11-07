import { useEffect, useRef } from 'react';
import type { CalibrationPace } from '../core/calibration';
export type SettingsValue = { selection: 'blink' | 'dwell'; dwellMs: number; assistance: boolean; pointer: boolean; pace: CalibrationPace; learning: boolean };
type Props = {
  value: SettingsValue; camera: boolean; simulation: boolean; canValidate: boolean;
  savedStatus: string; hasSaved: boolean; fullscreenError: boolean;
  onDeleteSaved: () => void; onChange: (value: SettingsValue) => void; onClose: () => void;
  onReset: () => void; onValidate: () => void; onSimulation: () => void; onCamera: () => void; onStop: () => void; onFullscreen: () => void;
};
export function Settings(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { value, onChange, onClose } = props;
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const storageProblem = /could not|failed|blocked|not saved|not be saved|not saved over/i.test(props.savedStatus);
  return <dialog className="settings-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="settings-title">
    <h1 id="settings-title">Settings</h1>
    <div className="settings-fields">
      <label htmlFor="selection">Selection</label><select id="selection" value={value.selection} onChange={event => onChange({ ...value, selection: event.target.value === 'dwell' ? 'dwell' : 'blink' })}><option value="blink">Two blinks</option><option value="dwell">Dwell</option></select>
      {value.selection === 'dwell' && <>
        <label htmlFor="dwell">Dwell · {(value.dwellMs / 1000).toFixed(1)} s</label><input id="dwell" type="range" min="1500" max="5000" step="100" value={value.dwellMs} onChange={event => onChange({ ...value, dwellMs: Number(event.target.value) })} />
        <label htmlFor="assistance">Target assistance</label><input id="assistance" type="checkbox" checked={value.assistance} onChange={event => onChange({ ...value, assistance: event.target.checked })} />
      </>}
      <label htmlFor="learning">Learn from selections</label><input id="learning" type="checkbox" checked={value.learning} onChange={event => onChange({ ...value, learning: event.target.checked })} />
      <label htmlFor="calibration-pace">Pace</label><select id="calibration-pace" value={value.pace} onChange={event => onChange({ ...value, pace: event.target.value === 'quick' ? 'quick' : event.target.value === 'gentle' ? 'gentle' : 'comfortable' })}><option value="quick">Quick</option><option value="comfortable">Comfortable</option><option value="gentle">Slower</option></select>
    </div>
    <div className="settings-actions">
      <button className="primary-button" onClick={onClose}>Done</button>
      {props.camera && <button onClick={props.onReset}>Recalibrate</button>}
      {props.canValidate && <button onClick={props.onValidate}>Free flow check</button>}
      {props.hasSaved && <button onClick={props.onDeleteSaved}>Delete saved calibration</button>}
      <button onClick={props.onFullscreen}>{props.fullscreenError ? 'Full screen unavailable' : 'Full screen'}</button>
      {!props.simulation && <button onClick={props.onSimulation}>Try simulation</button>}
      {!props.camera && <button onClick={props.onCamera}>Start camera</button>}
      {props.camera && <button onClick={props.onStop}>Stop</button>}
    </div>
    {storageProblem && <span role="status" className="storage-error">Saved calibration unavailable</span>}
  </dialog>;
}
