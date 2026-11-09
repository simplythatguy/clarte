import assert from 'node:assert/strict';
import { GazeEngine } from '../src/core/gaze.ts';

const engine = new GazeEngine({ mode: 'dwell', dwellMs: 100, holdMs: 0, deadBand: 0, smoothing: 1,
  soundActions: ['accept-centre'], repeat: 'redwell' });
engine.setViewport({ width: 800, height: 400 });
engine.setActionables([{ id: 'accept-centre', rect: { left: 200, right: 600, top: 0, bottom: 200 } }]);
let selected = 0;
engine.subscribe((_, event) => { if (event?.type === 'select') selected++; });
engine.sample(300, 100, 0); engine.confirm(50, 'sound');
assert.equal(selected, 0, 'sound cannot skip acquiring the centre target');
engine.sample(300, 100, 150);
assert.equal(engine.snapshot.state, 'previewed');
engine.sample(500, 100, 500); engine.tick(600);
assert.equal(selected, 0, 'neither dwell nor moving across the centre boundary accepts');
engine.confirm(610);
assert.equal(selected, 0, 'ordinary switch confirmation does not turn a sound-only action into dwell');
engine.confirm(620, 'sound');
assert.equal(selected, 1);
engine.sample(500, 100, 900); engine.confirm(920, 'sound');
assert.equal(selected, 1, 'a long sound/held look cannot accept twice even in repeat mode');
engine.activate('accept-centre', 950);
assert.equal(selected, 2, 'direct pointer/keyboard input remains available');

const lost = new GazeEngine({ dwellMs: 100, holdMs: 0, smoothing: 1, deadBand: 0, soundActions: ['centre'] });
lost.setViewport({ width: 800, height: 400 });
lost.setActionables([{ id: 'centre', rect: { left: 200, right: 600, top: 0, bottom: 200 } }]);
let lostSelections = 0;
lost.subscribe((_, event) => { if (event?.type === 'select') lostSelections++; });
lost.sample(300, 100, 0); lost.sample(300, 100, 150);
lost.sample(null, null, 160); lost.confirm(170, 'sound');
assert.equal(lostSelections, 0, 'a missing sample blocks sound during blink grace');
lost.sample(300, 100, 200); lost.confirm(1000, 'sound');
assert.equal(lostSelections, 0, 'stale gaze cannot confirm even before the next animation tick');
lost.setActionables([]); lost.confirm(1010, 'sound');
assert.equal(lostSelections, 0, 'removed targets cannot receive a late sound');

console.log('Centre gaze guards pass');
