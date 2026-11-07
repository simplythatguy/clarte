import { describe, expect, it } from 'vitest';
import { lifecycle, type Lifecycle } from '../src/core/lifecycle';

describe('session lifecycle', () => {
  it.each(['compose','validation'] as const)('requires training and follows the explicit destination (%s)', destination => {
    let state: Lifecycle = { kind: 'off' };
    state = lifecycle(state, { type: 'start', request: 1 });
    state = lifecycle(state, { type: 'started', request: 1 });
    expect(state).toEqual({ kind: 'camera', phase: 'calibration' });
    expect(lifecycle(state, { type: 'compose' })).toEqual(state);
    expect(lifecycle(state, { type: 'validate' })).toEqual(state);
    state = lifecycle(state, { type: 'calibrated', destination });
    expect(state).toEqual({ kind: 'camera', phase: destination });
    if (destination === 'validation') state = lifecycle(state, { type: 'compose' });
    expect(state).toEqual({ kind: 'camera', phase: 'compose' });
  });
  it('ignores camera completion after stop, a mode switch or another start', () => {
    const starting: Lifecycle = { kind: 'starting', request: 1 };
    expect(lifecycle(lifecycle(starting, { type: 'stop' }), { type: 'started', request: 1 })).toEqual({ kind: 'off' });
    expect(lifecycle(lifecycle(starting, { type: 'simulate' }), { type: 'started', request: 1 })).toEqual({ kind: 'simulation', phase: 'compose' });
    expect(lifecycle({ kind: 'starting', request: 2 }, { type: 'started', request: 1 })).toEqual({ kind: 'starting', request: 2 });
  });
  it('resets a camera calibration without pretending that simulation calibrated a camera', () => {
    expect(lifecycle({ kind: 'camera', phase: 'compose' }, { type: 'resetCalibration' })).toEqual({ kind: 'camera', phase: 'calibration' });
    const simulation: Lifecycle = { kind: 'simulation', phase: 'compose' };
    expect(lifecycle(simulation, { type: 'calibrated', destination: 'compose' })).toBe(simulation);
    expect(lifecycle(simulation, { type: 'pause' })).toEqual({ kind: 'paused', mode: 'simulation' });
  });
});
