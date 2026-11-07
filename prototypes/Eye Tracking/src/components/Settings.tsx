import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../core/profiles';
import type { CalibrationPace } from '../core/calibration';
import type { CheckSummary } from '../core/check-report';
import { CheckReport } from './CheckReport';
export type SettingsValue = { selection: 'blink' | 'dwell'; dwellMs: number; assistance: boolean; pointer: boolean; pace: CalibrationPace; learning: boolean; team: boolean; /** Development comparison: pose-normalized eye crop. */ normalizedCrop: boolean };
/** A team model is present; its held-out result decides the default. */
export type TeamInfo = { improves: boolean; people: number; meanPretrainedPx: number; meanTeamPx: number };
export type SettingsPage = 'settings' | 'check';
/** Development-only replay recording controls; absent in production builds. */
export type TestSessionTools = {
  enabled: boolean; tester: string; recording: string; status: string;
  items: { id: string; label: string; complete: boolean; seconds: number; megabytes: number }[];
  onEnabled: (enabled: boolean) => void; onTester: (tester: string) => void;
  onSave: (id: string) => void; onVideo: (id: string) => void; onDiscard: (id: string) => void;
};
/** Named profiles, each with its own saved calibration. */
export type ProfileTools = {
  list: Profile[]; active: Profile; status: string; hasSaved: (id: string) => boolean;
  onSelect: (id: string) => void; onCreate: (name: string) => void; onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
};
export type DeveloperTools = { recording: boolean; count: number; status: string; onRecording: (enabled: boolean) => void; onSave: () => void; sessions?: TestSessionTools };
type Props = {
  value: SettingsValue; camera: boolean; simulation: boolean; canValidate: boolean;
  savedStatus: string; hasSaved: boolean; fullscreenError: boolean;
  check?: CheckSummary | null; page?: SettingsPage; onPage?: (page: SettingsPage) => void; developer?: DeveloperTools | null; team?: TeamInfo | null; profiles?: ProfileTools | null;
  onDeleteSaved: () => void; onChange: (value: SettingsValue) => void; onClose: () => void;
  onReset: () => void; onValidate: () => void; onSimulation: () => void; onCamera: () => void; onStop: () => void; onFullscreen: () => void;
};
export function Settings(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { value, onChange, onClose } = props;
  const [profileName, setProfileName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const page = props.page ?? 'settings';
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const storageProblem = /could not|failed|blocked|not saved|not be saved|not saved over/i.test(props.savedStatus);
  if (page === 'check' && props.check) return <dialog className="settings-dialog" ref={dialog} onCancel={event => { event.preventDefault(); props.onPage?.('settings'); }} aria-labelledby="settings-title">
    <h1 id="settings-title">Check results</h1>
    <CheckReport summary={props.check} />
    <div className="settings-actions">
      <button className="primary-button" onClick={() => props.onPage?.('settings')}>Back</button>
      {props.canValidate && <button onClick={props.onValidate}>Check again</button>}
      <button onClick={onClose}>Done</button>
    </div>
  </dialog>;
  return <dialog className="settings-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="settings-title">
    <h1 id="settings-title">Settings</h1>
    <div className="settings-fields">
      {props.profiles && <>
        <label htmlFor="profile">Profile</label>
        <select id="profile" value={props.profiles.active.id} aria-describedby="profile-note" onChange={event => props.profiles?.onSelect(event.target.value)}>
          {props.profiles.list.map(p => <option key={p.id} value={p.id}>{p.name}{props.profiles?.hasSaved(p.id) ? ' · calibrated' : ''}</option>)}
        </select>
        <label htmlFor="profile-name">{renaming ? 'Rename to' : 'New profile'}</label>
        <span className="settings-inline">
          <input id="profile-name" type="text" className="settings-text" value={profileName} maxLength={40} placeholder={renaming ? props.profiles.active.name : 'Name'} autoComplete="off" onChange={event => setProfileName(event.target.value)} />
          <button onClick={() => { if (!profileName.trim()) return; if (renaming) props.profiles?.onRename(props.profiles.active.id, profileName); else props.profiles?.onCreate(profileName); setProfileName(''); setRenaming(false); }}>{renaming ? 'Rename' : 'Add'}</button>
          <button onClick={() => { setRenaming(r => !r); setProfileName(''); }}>{renaming ? 'Cancel' : 'Rename current'}</button>
          {props.profiles.list.length > 1 && <button onClick={() => props.profiles?.onRemove(props.profiles.active.id)}>Remove current</button>}
        </span>
        <p id="profile-note" className="settings-note">Each profile keeps its own saved calibration on this browser. Switching while the camera is on starts a new calibration.{props.profiles.status ? ` ${props.profiles.status}` : ''}</p>
      </>}
      <label htmlFor="selection">Selection</label><select id="selection" value={value.selection} onChange={event => onChange({ ...value, selection: event.target.value === 'dwell' ? 'dwell' : 'blink' })}><option value="blink">Two blinks</option><option value="dwell">Dwell</option></select>
      {value.selection === 'dwell' && <>
        <label htmlFor="dwell">Dwell · {(value.dwellMs / 1000).toFixed(1)} s</label><input id="dwell" type="range" min="1500" max="5000" step="100" value={value.dwellMs} onChange={event => onChange({ ...value, dwellMs: Number(event.target.value) })} />
        <label htmlFor="assistance">Target assistance</label><input id="assistance" type="checkbox" checked={value.assistance} onChange={event => onChange({ ...value, assistance: event.target.checked })} />
      </>}
      <label htmlFor="learning">Learn from selections</label><input id="learning" type="checkbox" checked={value.learning} onChange={event => onChange({ ...value, learning: event.target.checked })} />
      <label htmlFor="calibration-pace">Pace</label><select id="calibration-pace" value={value.pace} onChange={event => onChange({ ...value, pace: event.target.value === 'quick' ? 'quick' : event.target.value === 'gentle' ? 'gentle' : 'comfortable' })}><option value="quick">Quick</option><option value="comfortable">Comfortable</option><option value="gentle">Slower</option></select>
      {props.team && <>
        <label htmlFor="team-model">Team model ({props.team.people} people)</label><input id="team-model" type="checkbox" checked={value.team} aria-describedby="team-model-note" onChange={event => onChange({ ...value, team: event.target.checked })} />
        <p id="team-model-note" className="settings-note">On people it was not trained on: {Math.round(props.team.meanTeamPx)} px median error versus {Math.round(props.team.meanPretrainedPx)} px without it{props.team.improves ? '' : ' (not better, so off by default)'}. Applies from the next calibration.</p>
      </>}
      {props.developer?.sessions && <>
        <label htmlFor="test-tester">Tester name (dev)</label><input id="test-tester" type="text" className="settings-text" value={props.developer.sessions.tester} placeholder="e.g. Mukhtar" autoComplete="off" onChange={event => props.developer?.sessions?.onTester(event.target.value)} />
        <label htmlFor="test-recording">Record test sessions (dev)</label><input id="test-recording" type="checkbox" checked={props.developer.sessions.enabled} onChange={event => props.developer?.sessions?.onEnabled(event.target.checked)} />
      </>}
      {props.developer && <>
        <label htmlFor="replay-recording">Record replay set (dev)</label><input id="replay-recording" type="checkbox" checked={props.developer.recording} onChange={event => props.developer?.onRecording(event.target.checked)} />
        <label htmlFor="normalized-crop">Pose-normalized eye crop (dev)</label><input id="normalized-crop" type="checkbox" checked={value.normalizedCrop} aria-describedby="normalized-crop-note" onChange={event => onChange({ ...value, normalizedCrop: event.target.checked })} />
        <p id="normalized-crop-note" className="settings-note">Experimental: the gaze network sees the eyes from a virtual camera facing them. The pretrained network was not trained this way; compare on recordings before trusting it. Applies from the next calibration.</p>
      </>}
    </div>
    <div className="settings-actions">
      <button className="primary-button" onClick={onClose}>Done</button>
      {props.check && <button onClick={() => props.onPage?.('check')}>Check results</button>}
      {props.camera && <button onClick={props.onReset}>Recalibrate</button>}
      {props.canValidate && <button onClick={props.onValidate}>Free flow check</button>}
      {props.hasSaved && <button onClick={props.onDeleteSaved}>Delete saved calibration</button>}
      <button onClick={props.onFullscreen}>{props.fullscreenError ? 'Full screen unavailable' : 'Full screen'}</button>
      {!props.simulation && <button onClick={props.onSimulation}>Try simulation</button>}
      {!props.camera && <button onClick={props.onCamera}>Start camera</button>}
      {props.camera && <button onClick={props.onStop}>Stop</button>}
      {props.developer && props.camera && <button onClick={props.developer.onSave} disabled={!props.developer.count}>Save replay set{props.developer.count ? ` (${props.developer.count})` : ''}</button>}
    </div>
    {storageProblem && <span role="status" className="storage-error">Saved calibration unavailable</span>}
    {props.developer?.status && <span role="status" className="developer-status">{props.developer.status}</span>}
    {props.developer?.sessions && (props.developer.sessions.status || props.developer.sessions.items.length > 0) && <section className="test-sessions" aria-label="Recorded test sessions">
      {props.developer.sessions.status && <p role="status" className="developer-status">{props.developer.sessions.status}</p>}
      {props.developer.sessions.items.length > 0 && <table className="check-table">
        <caption>Recorded test sessions (kept until you close the page)</caption>
        <thead><tr><th scope="col">Sample</th><th scope="col">Length</th><th scope="col">Size</th><th scope="col">Actions</th></tr></thead>
        <tbody>{props.developer.sessions.items.map(item => <tr key={item.id}>
          <th scope="row">{item.label}{item.complete ? '' : ' (no complete check)'}</th><td>{item.seconds} s</td><td>{item.megabytes.toFixed(0)} MB</td>
          <td className="test-session-actions">
            <button onClick={() => props.developer?.sessions?.onSave(item.id)}>Save session</button>
            <button onClick={() => props.developer?.sessions?.onVideo(item.id)}>Download video</button>
            <button onClick={() => props.developer?.sessions?.onDiscard(item.id)} aria-label={`Discard ${item.label}`}>Discard</button>
          </td></tr>)}</tbody>
      </table>}
    </section>}
  </dialog>;
}
