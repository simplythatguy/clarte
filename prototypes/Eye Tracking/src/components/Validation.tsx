import type { ValidationPosition, ValidationState } from '../core/validation';
import { StagePage } from './StagePage';
type Props = {
  state: ValidationState; position: ValidationPosition | null; recovery: string; reducedMotion: boolean;
  onStart: () => void; onPause: () => void; onResume: () => void; onCancel: () => void;
  onRestart: () => void; onRecalibrate: () => void; onPhrases: () => void;
};
export function Validation(props: Props) {
  const { state, position } = props;
  if (state.kind === 'running' && position) return <section className="validation-stage dot-stage" aria-label="Free flow check, camera on, model frozen" onClick={props.onPause}>
    <div className={`validation-dot stage-${position.stage} ${props.reducedMotion ? 'reduced-motion' : ''}`} style={{ left: position.point.x, top: position.point.y }} aria-hidden="true" />
  </section>;
  const paused = state.kind === 'paused' || state.kind === 'intro-paused';
  const title = state.kind === 'intro' ? `Calibrate free flow movement · ${Math.ceil(state.remainingMs / 1000)}`
    : paused ? props.recovery || 'Calibration paused' : state.kind === 'cancelled' ? (state.reason === 'camera' ? 'The screen moved' : 'Calibration interrupted') : 'Calibrate free flow movement';
  return <div className="validation-stage"><StagePage title={title} alert={Boolean(props.recovery) || (state.kind === 'cancelled' && state.reason === 'camera')}>
    {state.kind === 'intro' ? null : <>
      <button className="primary-button" onClick={paused ? props.onResume : state.kind === 'cancelled' ? props.onRestart : props.onStart}>{paused ? 'Continue' : state.kind === 'cancelled' ? 'Restart' : 'Calibrate'}</button>
      {paused && <button onClick={props.onRestart}>Restart</button>}
      {state.kind === 'ready' && <button onClick={props.onPhrases}>Skip</button>}
      <button onClick={props.onCancel}>Stop</button>
    </>}
  </StagePage></div>;
}
