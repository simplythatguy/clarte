import { headDifference, HEAD_LIMITS, type HeadFeedback } from '../core/head-position';

function guidance(feedback: HeadFeedback): string {
  if (feedback.kind === 'setup') return feedback.stable ? 'Start saves this position.' : feedback.current ? 'Hold still before Start.' : 'Face the camera in even light.';
  if (feedback.kind === 'missing') return 'Face the camera in even light.';
  if (feedback.kind === 'recovering') return 'Hold here, then look into the gap to rearm.';
  if (feedback.kind === 'matched') return 'Position only · gaze accuracy unverified';
  if (!feedback.current) return 'Return to your calibration position.';
  const delta = headDifference(feedback.current, feedback.reference);
  const offsets = [
    { size: Math.hypot(delta.x, delta.y) / HEAD_LIMITS.translation, text: 'Match the dashed outline position.' },
    { size: Math.abs(delta.scale) / HEAD_LIMITS.scale, text: 'Match the dashed outline size.' },
    { size: Math.abs(delta.roll) / HEAD_LIMITS.roll, text: 'Match the saved head tilt.' },
    { size: Math.abs(delta.yawRatio) / HEAD_LIMITS.yawRatio, text: 'Face the camera as at calibration.' },
    { size: Math.abs(delta.pitchRatio) / HEAD_LIMITS.pitchRatio, text: 'Match the saved face angle.' },
  ];
  return offsets.reduce((largest, item) => item.size > largest.size ? item : largest).text;
}

export function HeadPosition({ feedback, calibration = false, fallback = 'Mouse / keyboard input available', onRestart }: {
  feedback: HeadFeedback; calibration?: boolean; fallback?: string; onRestart?: () => void;
}) {
  const reference = feedback.reference ?? feedback.current;
  const delta = reference && feedback.current ? headDifference(feedback.current, reference) : null;
  const bound = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const blocked = feedback.kind !== 'setup' && feedback.kind !== 'matched';
  const title = feedback.kind === 'setup' ? 'Set your head position' : feedback.kind === 'matched' ? 'Head position held'
    : feedback.kind === 'missing' ? 'Head position unavailable' : feedback.kind === 'recovering' ? 'Hold this position' : 'Head position changed';
  return <div className={`head-position ${blocked ? 'is-blocked' : ''}`} data-head-state={feedback.kind}>
    <svg className="head-guide" viewBox="0 0 120 80" role="img" aria-label={feedback.reference ? 'Dashed outline: saved reference. Solid outline and dot: current position. Match the position, size, tilt and dots.' : 'Current head outline. Start saves a reference after stable frames.'}>
      {feedback.reference && <g className="head-reference" transform="translate(60 36)"><ellipse rx="17" ry="24" /><path d="M-12-6H12" /><circle cy="7" r="2.5" /></g>}
      {delta && <g className="head-current" transform={`translate(${60 + bound(delta.x * 160, 35)} ${36 + bound(delta.y * 120, 22)}) rotate(${bound(delta.roll * 180 / Math.PI, 40)}) scale(${1 + bound(delta.scale, .4)})`}>
        <ellipse rx="17" ry="24" /><path d="M-12-6H12" /><circle cx={bound(delta.yawRatio * 100, 14)} cy={7 + bound(delta.pitchRatio * 100, 14)} r="2.5" />
      </g>}
    </svg>
    <div className="head-message"><p role="status">{blocked ? `${calibration ? 'Sampling' : 'Selection'} paused · ` : ''}{title}</p><span>{guidance(feedback)}</span>
      {!calibration && <small>Camera on · {fallback}</small>}
    </div>
    {onRestart && <button className="text-button head-restart" onClick={onRestart}>Recalibrate</button>}
  </div>;
}
