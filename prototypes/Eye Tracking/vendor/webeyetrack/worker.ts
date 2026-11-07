import * as tf from '@tensorflow/tfjs';
import WebEyeTrack from './local/WebEyeTrack';
import { CalibrationEngine } from '../../src/core/worker-engine';
import { installLocalNetworkBoundary } from '../../src/core/network';
installLocalNetworkBoundary();
let engine: CalibrationEngine | null = null;
let busy = false;
// Development replay recording is only reachable when the page initializes the worker in development.
let development = false;
self.onmessage = async ({ data }: MessageEvent<unknown>) => {
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'number' || !('type' in data) || !('payload' in data)) return;
  const { id, type, payload } = data;
  if (busy) { self.postMessage({ id, error: 'Local tracker is busy' }); return; }
  busy = true;
  try {
    let value: unknown;
    if (type === 'init') {
      if (engine) throw new Error('Tracker already initialized');
      try { if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu'); } catch { await tf.setBackend('cpu'); }
      await tf.ready();
      const tracker = new WebEyeTrack();
      try { await tracker.initialize(`${self.location.origin}/vendor/webeyetrack`); }
      catch (error) { tracker.dispose(); throw error; }
      engine = new CalibrationEngine(tracker);
      development = !!payload && typeof payload === 'object' && 'development' in payload && payload.development === true;
      value = { backend: tf.getBackend() };
    } else {
      if (!engine) throw new Error('Tracker is not initialized');
      if (type === 'step' && payload && typeof payload === 'object' && 'frame' in payload && payload.frame instanceof ImageData && 'at' in payload && typeof payload.at === 'number' && 'epoch' in payload && typeof payload.epoch === 'number') {
        value = await engine.step(payload.frame, payload.at, payload.epoch);
      } else if (type === 'collect' && payload && typeof payload === 'object' && 'at' in payload && typeof payload.at === 'number' && 'x' in payload && typeof payload.x === 'number' && 'y' in payload && typeof payload.y === 'number') {
        value = engine.collect(payload.at, payload.x, payload.y);
      } else if (type === 'train') value = await engine.train();
      else if (type === 'exportCalibration') value = engine.exportCalibration();
      else if (type === 'restoreCalibration') value = engine.restoreCalibration(payload);
      else if (type === 'recording' && development && payload && typeof payload === 'object' && 'enabled' in payload && typeof payload.enabled === 'boolean') { engine.setRecording(payload.enabled); value = engine.replayCount; }
      else if (type === 'record' && development && payload && typeof payload === 'object' && 'at' in payload && typeof payload.at === 'number' && 'x' in payload && typeof payload.x === 'number' && 'y' in payload && typeof payload.y === 'number') {
        value = await engine.record(payload.at, payload.x, payload.y);
      } else if (type === 'replayCount' && development) value = engine.replayCount;
      else if (type === 'exportReplay' && development) value = engine.exportReplay();
      else if (type === 'dispose') { engine.dispose(); engine = null; value = null; }
      else throw new Error('Invalid local tracker request');
    }
    self.postMessage({ id, value });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Local tracker failed' });
  } finally { busy = false; }
};
