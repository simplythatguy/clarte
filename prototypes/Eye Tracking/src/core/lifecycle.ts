export type Lifecycle =
  | { kind: 'off' }
  | { kind: 'starting'; request: number }
  | { kind: 'camera'; phase: 'calibration' | 'validation' | 'compose' }
  | { kind: 'simulation'; phase: 'compose' }
  | { kind: 'paused'; mode: 'camera' | 'simulation' }
  | { kind: 'error'; message: string };

export type LifecycleEvent =
  | { type: 'start'; request: number }
  | { type: 'started'; request: number }
  | { type: 'failure'; message: string }
  | { type: 'calibrated'; destination: 'compose' | 'validation' }
  | { type: 'restored' }
  | { type: 'compose' }
  | { type: 'validate' }
  | { type: 'resetCalibration' }
  | { type: 'simulate' }
  | { type: 'pause' }
  | { type: 'stop' };

export function lifecycle(state: Lifecycle, event: LifecycleEvent): Lifecycle {
  switch (event.type) {
    case 'start': return { kind: 'starting', request: event.request };
    case 'started': return state.kind === 'starting' && state.request === event.request ? { kind: 'camera', phase: 'calibration' } : state;
    case 'failure': return { kind: 'error', message: event.message };
    case 'simulate': return { kind: 'simulation', phase: 'compose' };
    case 'pause': return { kind: 'paused', mode: state.kind === 'simulation' ? 'simulation' : 'camera' };
    case 'stop': return { kind: 'off' };
    case 'calibrated': return state.kind === 'camera' && state.phase === 'calibration' ? { kind: 'camera', phase: event.destination } : state;
    case 'restored': return state.kind === 'camera' && state.phase === 'calibration' ? { kind: 'camera', phase: 'compose' } : state;
    case 'compose': return (state.kind === 'camera' || state.kind === 'simulation') && state.phase === 'validation' ? { ...state, phase: 'compose' } : state;
    case 'validate': return state.kind === 'camera' && state.phase !== 'calibration' ? { ...state, phase: 'validation' } : state;
    case 'resetCalibration': return state.kind === 'camera' ? { kind: 'camera', phase: 'calibration' } : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
