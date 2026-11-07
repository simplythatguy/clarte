import { describe, expect, it } from 'vitest';
import { initialDwell, stepDwell, type DwellState } from '../src/core/dwell';

function sample(state: DwellState, target: string | null, at: number, now = at) { return stepDwell(state, { type: 'sample', target, at, now }, 1000); }
function armed(): DwellState { return sample(sample(initialDwell, null, 0).state, null, 400).state; }

describe('dwell selection', () => {
  it('requires fresh neutral input to arm after a mode switch', () => {
    expect(sample(initialDwell, 'yes', 2000).state.kind).toBe('locked');
    expect(armed().kind).toBe('idle');
  });
  it('selects exactly once after continuous fresh samples', () => {
    let state = sample(armed(), 'yes', 500).state;
    state = sample(state, 'yes', 1000).state;
    expect(state.kind === 'dwelling' && state.progress).toBe(.5);
    const result = sample(state, 'yes', 1500);
    expect(result.selected).toBe('yes');
    expect(sample(result.state, 'yes', 3000).selected).toBeNull();
    expect(sample(result.state, 'no', 3200).selected).toBeNull();
  });
  it('leaving cancels partial dwell; a new target starts from zero', () => {
    let state = sample(armed(), 'yes', 500).state;
    state = sample(state, 'yes', 900).state;
    state = sample(state, null, 1000).state;
    expect(state.kind).toBe('idle');
    expect(sample(state, 'yes', 1200).state).toMatchObject({ kind: 'dwelling', progress: 0 });
  });
  it('stale data and a long inter-frame gap cannot complete a selection', () => {
    const state = sample(armed(), 'yes', 500).state;
    expect(sample(state, 'yes', 800, 1500).state.kind).toBe('idle');
    expect(sample(state, 'yes', 1600).state).toMatchObject({ kind: 'dwelling', since: 1600, progress: 0 });
    expect(stepDwell(state, { type: 'tick', now: 1800 }, 1000).selected).toBeNull();
    expect(stepDwell(state, { type: 'tick', now: 1800 }, 1000).state.kind).toBe('idle');
  });
  it('lost tracking cancels, but cannot rearm a resting selected target', () => {
    const state = stepDwell(armed(), { type: 'activate', target: 'help' }, 1000).state;
    const lost = stepDwell(state, { type: 'lost' }, 1000).state;
    expect(lost).toEqual({ kind: 'latched', target: 'help' });
    expect(sample(lost, 'help', 8000).selected).toBeNull();
  });
  it('rearms only after continuous fresh samples in a gap', () => {
    let state: DwellState = { kind: 'latched', target: 'yes' };
    state = sample(state, null, 500).state;
    state = stepDwell(state, { type: 'lost' }, 1000).state;
    expect(state.kind).toBe('latched');
    state = sample(state, null, 1200).state;
    state = sample(state, null, 1600).state;
    expect(state.kind).toBe('idle');
    state = sample(state, 'yes', 1800).state;
    state = sample(state, 'yes', 2300).state;
    expect(sample(state, 'yes', 2800).selected).toBe('yes');
  });
  it('changing settings/modes cancels in-flight progress and requires rearming', () => {
    const state = sample(armed(), 'help', 500).state;
    const reset = stepDwell(state, { type: 'reset' }, 1000);
    expect(reset.state.kind).toBe('locked');
    expect(sample(reset.state, 'help', 9000).selected).toBeNull();
  });
  it('out-of-order, duplicate, nonfinite and future samples never advance progress', () => {
    const state = sample(armed(), 'yes', 500).state;
    expect(sample(state, 'yes', 500).state).toEqual(state);
    expect(sample(state, 'yes', 200).state).toEqual(state);
    expect(sample(state, 'yes', NaN).selected).toBeNull();
    expect(sample(state, 'yes', 1500, 1400).selected).toBeNull();
  });
});
