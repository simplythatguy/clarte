import type { CSSProperties } from 'react';
import { CALIBRATION_TIMING, type CalibrationPace, type CalibrationState, type Point, type Viewport } from '../core/calibration';
import { StagePage } from './StagePage';
type Props = {
  state: CalibrationState; point: Point; viewport: Viewport; pace: CalibrationPace; status: string;
  saved: boolean; compatible: boolean; busy: boolean; recovery: string;
  /** Name of the active profile when there is more than one, so people know whose calibration is offered. */
  profile?: string;
  onUse: () => void; onToggle: () => void; onRestart: () => void; onCancel: () => void;
};
export function Calibration(props: Props) {
  const { state, point } = props;
  const running = ['moving', 'settling', 'sampling', 'collecting'].includes(state.kind);
  const style: CSSProperties & { '--point-move': string } = { left: point.x, top: point.y, '--point-move': `${CALIBRATION_TIMING[props.pace].moveMs}ms` };
  if (running) return <section className="calibration-stage dot-stage" aria-label={state.stage === 'eyes' ? 'Screen calibration, camera on' : 'Head movement calibration, camera on'} onClick={props.onToggle}>
    <div className={`calibration-point phase-${state.kind}`} style={style} aria-hidden="true" />
  </section>;
  const title = props.recovery && state.kind === 'ready' ? props.recovery : props.busy ? 'Restoring calibration' : state.kind === 'training' ? 'Calibrating' : state.kind === 'resetting' ? 'Calibrating'
    : state.kind === 'paused' ? props.recovery || 'Calibration paused'
    : state.kind === 'reading' ? `${state.stage === 'eyes' ? 'Calibrate screen dimensions' : 'Follow with your head'} · ${Math.ceil(state.remainingMs / 1000)}`
    : state.stage === 'head' || state.kind === 'collected' ? 'Calibrate head movement' : 'Calibrate';
  return <div className="calibration-stage">
    <StagePage title={title} alert={Boolean(props.recovery)}>
      {state.kind === 'reading' ? null : props.busy || state.kind === 'training' || state.kind === 'resetting' ? <button onClick={props.onCancel}>Cancel</button> : <>
        {props.saved && props.compatible && state.kind === 'ready' && <button className="primary-button" onClick={props.onUse}>Use saved calibration{props.profile ? ` · ${props.profile}` : ''}</button>}
        <button className={!props.saved || !props.compatible ? 'primary-button' : ''} onClick={props.onToggle}>{state.kind === 'paused' ? 'Continue' : 'Calibrate'}</button>
        {state.kind === 'paused' && <><button onClick={props.onRestart}>Restart</button><button onClick={props.onCancel}>Stop</button></>}
      </>}
    </StagePage>
  </div>;
}
