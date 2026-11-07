import type { SavedCalibration as Saved } from '../core/saved-calibration';
import { Icon } from './Icon';
type Props = { saved: Saved; compatible: boolean; message: string; status: string; busy: boolean; onUse: () => void; onRecalibrate: () => void; onStop: () => void; onSettings: () => void };
export function SavedCalibration(props: Props) {
  return <section className="calibration-stage is-reading" aria-labelledby="saved-title">
    <button className="icon-button validation-settings" title="Settings" aria-label="Settings" onClick={props.onSettings}><Icon name="settings" /></button>
    <div className="calibration-dock">
      <h1 id="saved-title">Use your saved calibration?</h1>
      <p className="calibration-instruction">{props.message}</p>
      <p className="calibration-readiness" role="status">{props.busy ? 'Restoring locally · sampling paused · camera on.' : props.status || `Saved ${new Date(props.saved.savedAt).toLocaleDateString()} · camera on.`}</p>
      <div className="calibration-controls">
        <button className="primary-button compact" disabled={!props.compatible || props.busy} onClick={props.onUse}>Use saved calibration</button>
        <button className="quiet-button" disabled={props.busy} onClick={props.onRecalibrate}>Recalibrate</button>
        <button className="quiet-button" onClick={props.onStop}>Stop camera</button>
      </div>
    </div>
  </section>;
}
