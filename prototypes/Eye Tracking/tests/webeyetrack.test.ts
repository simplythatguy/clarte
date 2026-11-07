import { describe, expect, it, vi } from 'vitest';
import { CameraSession, DecodedFrameGate, type TrackerRuntime } from '../src/core/webeyetrack';
import { normalizeGaze, readWorkerGaze } from '../src/core/tracking';
import { WorkerClient, type WorkerPort } from '../src/core/worker-client';
import { CalibrationEngine, type Observation, type TrackerCore } from '../src/core/worker-engine';
import { ESTIMATOR_SHAPES } from '../src/core/saved-calibration';
const learnedFixture = () => ({ weights: ESTIMATOR_SHAPES.map(shape => Array<number>(shape.reduce((a,b)=>a*b,1)).fill(.01)), affine: [1,0,0,0,1,0], faceWidthCm: 15 });
function deferred<T>() { let resolve: (v:T) => void = () => {}; let reject: (e:Error) => void = () => {}; const promise = new Promise<T>((a,b) => { resolve=a;reject=b; });return {promise,resolve,reject}; }
function cameraFixture() {
 const permission=deferred<MediaStream>(), begin=deferred<void>();
 const track=Object.assign(new EventTarget(),{stop:vi.fn()});
 const stream={getTracks:()=>[track]} as unknown as MediaStream;
 const runtime:TrackerRuntime={begin:vi.fn(()=>begin.promise),stop:vi.fn(),collect:vi.fn(async()=>true),train:vi.fn(async()=>{}),reset:vi.fn(async()=>{}),exportCalibration:vi.fn(),restoreCalibration:vi.fn(async()=>{}),preview:vi.fn()};
 const create=vi.fn(()=>runtime);
 return {permission,begin,track,stream,runtime,create,camera:new CameraSession({create,acquire:()=>permission.promise})};
}
describe('WebEyeTrack camera ownership and coordinate boundary',()=>{
 it('normalizes the documented center-origin axes and rejects closed/invalid output',()=>{
  expect(normalizeGaze({rawNormPog:[0,0],normPog:[-.5,.25],face:true,open:true,facePresent:true,eyeState:'open',at:1},{width:1000,height:800}).point).toEqual({x:0,y:600});
  expect(normalizeGaze({rawNormPog:[0,0],normPog:[.1,.2],face:true,open:false,facePresent:true,eyeState:'closed',at:1},{width:1000,height:800}).point).toBeNull();
  expect(normalizeGaze({rawNormPog:[0,0],normPog:[.6,0],face:true,open:true,facePresent:true,eyeState:'open',at:1},{width:1000,height:800}).face).toBe(false);
  expect(()=>readWorkerGaze({at:1,open:true,face:true,facePresent:true,eyeState:'open',normPog:[NaN,0]})).toThrow();
  expect(()=>readWorkerGaze({at:1,open:true,face:true,facePresent:true,eyeState:'open',normPog:[0,0],rawNormPog:[NaN,0]})).toThrow();
  const raw=normalizeGaze(readWorkerGaze({at:1,open:true,face:true,facePresent:true,eyeState:'open',normPog:[.5,0],rawNormPog:[.8,.1]}),{width:1000,height:800});
  expect(raw.point).toEqual({x:1000,y:400});expect(raw.rawPoint).toEqual({x:1300,y:480});
 });
 it('requires a distinct decoded frame, never just an advancing render clock',()=>{
  const gate=new DecodedFrameGate();expect(gate.accept(1,.1)).toBe(true);expect(gate.accept(1,.2)).toBe(false);
  expect(gate.accept(2,.1)).toBe(false);expect(gate.accept(2,.2)).toBe(true);expect(gate.accept(NaN,.3)).toBe(false);
 });
 it('stops a permission result arriving after cancellation without creating a worker',async()=>{
  const f=cameraFixture();const start=f.camera.start(vi.fn(),vi.fn());f.camera.stop();f.permission.resolve(f.stream);
  expect(await start).toBe(false);expect(f.track.stop).toHaveBeenCalledOnce();expect(f.create).not.toHaveBeenCalled();
 });
 it('ignores late model initialization and always releases its stream/runtime',async()=>{
  const f=cameraFixture();const onFrame=vi.fn();const start=f.camera.start(onFrame,vi.fn());f.permission.resolve(f.stream);
  await vi.waitFor(()=>expect(f.runtime.begin).toHaveBeenCalled());f.camera.stop();f.begin.resolve();expect(await start).toBe(false);
  expect(f.track.stop).toHaveBeenCalled();expect(f.runtime.stop).toHaveBeenCalledOnce();
  const args=vi.mocked(f.runtime.begin).mock.calls[0];await args[1]({at:1,face:true,pose:null,facePresent:true,eyeState:'open' as const,point:{x:1,y:1}});expect(onFrame).not.toHaveBeenCalled();
 });
 it('tears down on a lost track, and isolates training/collection/reset from later sessions',async()=>{
  const f=cameraFixture();const failed=vi.fn();const start=f.camera.start(vi.fn(),failed);f.permission.resolve(f.stream);f.begin.resolve();expect(await start).toBe(true);
  const training=deferred<void>();vi.mocked(f.runtime.train).mockReturnValue(training.promise);const promise=f.camera.train();
  f.track.dispatchEvent(new Event('ended'));expect(failed).toHaveBeenCalledOnce();training.reject(new Error('cancelled'));
  expect(await promise).toBe(false);expect(await f.camera.collect({x:1,y:1},1,{width:100,height:100})).toBe(false);expect(await f.camera.resetCalibration()).toBe(false);
 });
 it('rejects a late export/restore across model reset, and a restore across camera stop',async()=>{
  const f=cameraFixture();const started=f.camera.start(vi.fn(),vi.fn());f.permission.resolve(f.stream);f.begin.resolve();await started;
  const exported=deferred<ReturnType<typeof learnedFixture>>();vi.mocked(f.runtime.exportCalibration).mockReturnValue(exported.promise);
  const save=f.camera.exportCalibration();await f.camera.resetCalibration();exported.resolve(learnedFixture());expect(await save).toBeNull();
  const restored=deferred<void>();vi.mocked(f.runtime.restoreCalibration).mockReturnValue(restored.promise);
  const use=f.camera.restoreCalibration(learnedFixture());await f.camera.resetCalibration();restored.resolve();expect(await use).toBe(false);
  const later=deferred<void>();vi.mocked(f.runtime.restoreCalibration).mockReturnValue(later.promise);
  const stopped=f.camera.restoreCalibration(learnedFixture());f.camera.stop();later.resolve();expect(await stopped).toBe(false);
 });
});
function workerFixture(){
 const target=new EventTarget();const worker:WorkerPort={postMessage:vi.fn(),terminate:vi.fn(),addEventListener:target.addEventListener.bind(target)};
 const failed=vi.fn();const client=new WorkerClient(worker,failed);
 const reply=(data:unknown)=>target.dispatchEvent(new MessageEvent('message',{data}));return {target,worker,client,failed,reply};
}
describe('worker cancellation and asynchronous failures',()=>{
 it('resolves explicit acknowledgements, rejects errors, ignores late messages after stop',async()=>{
  const f=workerFixture();const a=f.client.call('collect');f.reply({id:1,value:true});expect(await a).toBe(true);
  const b=f.client.call('train');f.reply({id:2,error:'Training failed'});await expect(b).rejects.toThrow('Training failed');
  const c=f.client.call('step');const stopped=expect(c).rejects.toThrow('stopped');f.client.stop();f.reply({id:3,value:4});await stopped;expect(f.worker.terminate).toHaveBeenCalledOnce();
 });
 it('a timeout rejects all pending work and terminates exactly once',async()=>{
  vi.useFakeTimers();try {const f=workerFixture();const a=expect(f.client.call('train',null,[],100)).rejects.toThrow('timed out');const b=expect(f.client.call('collect')).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(101);await a;await b;expect(f.failed).toHaveBeenCalledOnce();expect(f.worker.terminate).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}
 });
});
const observation=():Observation=>({eyePatch:{width:512,height:128,data:new Uint8ClampedArray(512*128*4),colorSpace:'srgb'},headVector:[0,0,1],faceOrigin3D:[0,0,60],gazeState:'open',eyeState:'open',rawNormPog:[.02,.03],normPog:[.01,.02],facialLandmarks:Array.from({length:478},()=>({x:.5,y:.5,z:0}))});
describe('same-frame instructed samples and frozen validation',()=>{
 it('restores validated learned state without labels/adaptation, clears the latest raw sample and freezes collection',async()=>{
  const sample=observation(), restore=vi.fn(), core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(async()=>{}),dispose:vi.fn(),restoreCalibration:restore,exportCalibration:()=>learnedFixture()};
  const engine=new CalibrationEngine(core,()=>1000);
  expect(()=>engine.restoreCalibration({...learnedFixture(),rawVideo:[]})).toThrow();expect(restore).not.toHaveBeenCalled();
  await engine.step(sample.eyePatch,1,1000);expect(engine.restoreCalibration(learnedFixture())).toBe(true);
  expect(engine.collect(1,0,0)).toBe(false);expect(engine.state).toBe('trained');expect(core.adapt).not.toHaveBeenCalled();expect(engine.count).toBe(0);
  expect(engine.exportCalibration()).toEqual(learnedFixture());
 });
 it('requires matching frame ids, finite instructed labels, fresh open eyes and no duplicate labels',async()=>{
  let now=1000;let sample=observation();const core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(async()=>{}),dispose:vi.fn()};const engine=new CalibrationEngine(core,()=>now);
  await engine.step(sample.eyePatch,1,1000);expect(engine.collect(2,0,0)).toBe(false);expect(engine.collect(1,NaN,0)).toBe(false);
  expect(engine.collect(1,.2,-.2)).toBe(true);expect(engine.collect(1,.2,-.2)).toBe(false);
  await engine.step(sample.eyePatch,2,1000);now=1601;expect(engine.collect(2,0,0)).toBe(false);
  sample={...sample,gazeState:'closed'};await engine.step(sample.eyePatch,3,1601);expect(engine.collect(3,0,0)).toBe(false);expect(engine.count).toBe(1);
  await expect(engine.train()).rejects.toThrow('nine');
 });
 it('passes separate pre-Kalman raw coordinates unchanged across the worker seam',async()=>{
  const sample={...observation(),normPog:[0,0],rawNormPog:[.8,-.2]};
  const core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(async()=>{}),dispose:vi.fn()};
  const engine=new CalibrationEngine(core,()=>1000);
  const result=await engine.step(sample.eyePatch,1,1000);
  expect(result.normPog).toEqual([0,0]);expect(result.rawNormPog).toEqual([.8,-.2]);
 });
 it('trains only explicit references with paired head features, clears raw samples, and freezes later frames',async()=>{
  let sample=observation();const core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(async()=>{}),dispose:vi.fn()};const engine=new CalibrationEngine(core,()=>1000);
  for(let n=0;n<27;n++){sample={...observation(),headVector:[n*.001,0,1]};await engine.step(sample.eyePatch,n+1,1000);expect(engine.collect(n+1,((Math.floor(n/3)%3)-1)*.3,(Math.floor(n/9)-1)*.3)).toBe(true);}
  expect(core.adapt).not.toHaveBeenCalled();expect(await engine.train()).toBe(27);expect(engine.count).toBe(0);expect(engine.state).toBe('trained');
  const [eyes,heads,origins,labels]=core.adapt.mock.calls[0];expect(eyes).toHaveLength(27);expect(heads[26][0]).toBeCloseTo(.026);expect(origins[0]).toEqual([0,0,60]);expect(labels[0]).toEqual([-.3,-.3]);
  await engine.step(sample.eyePatch,30,1000);expect(engine.collect(30,0,0)).toBe(false);expect(core.adapt).toHaveBeenCalledOnce();engine.dispose();expect(core.dispose).toHaveBeenCalledOnce();
 });
 it('does not accept a training completion after disposal and cannot collect while training',async()=>{
  const train=deferred<void>();const sample=observation();const core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(()=>train.promise),dispose:vi.fn()};const engine=new CalibrationEngine(core,()=>1000);
  for(let n=0;n<27;n++){await engine.step(sample.eyePatch,n+1,1000);engine.collect(n+1,(n%3-1)*.3,(Math.floor(n/3)%3-1)*.3);}
  const pending=engine.train();expect(engine.state).toBe('training');expect(engine.collect(27,0,0)).toBe(false);engine.dispose();train.resolve();await expect(pending).rejects.toThrow('cancelled');expect(engine.state).toBe('disposed');expect(engine.count).toBe(0);
 });
});

it('passes independent face presence and bilateral eye state across the real engine/parser/normalizer seam', async () => {
  let sample=observation();
  const core={step:vi.fn(async()=>sample),adapt:vi.fn<TrackerCore['adapt']>(async()=>{}),dispose:vi.fn()};
  const engine=new CalibrationEngine(core,()=>1000), viewport={width:1000,height:800};
  sample={...sample,eyeState:'closed',gazeState:'closed'};
  const closed=normalizeGaze(readWorkerGaze(await engine.step(sample.eyePatch,1,1000)),viewport);
  expect(closed).toMatchObject({face:false,facePresent:true,eyeState:'closed',point:null,rawPoint:null});
  expect(engine.collect(1,0,0)).toBe(false);
  sample={...sample,eyeState:'unknown',facialLandmarks:[]};
  const missing=normalizeGaze(readWorkerGaze(await engine.step(sample.eyePatch,2,1000)),viewport);
  expect(missing).toMatchObject({face:false,facePresent:false,eyeState:'unknown',point:null,rawPoint:null});
  sample={...observation(),eyeState:'unknown'};
  expect(normalizeGaze(readWorkerGaze(await engine.step(sample.eyePatch,3,1000)),viewport).face).toBe(false);
  expect(engine.collect(3,0,0)).toBe(false);
  expect(()=>readWorkerGaze({at:4,face:false,open:false,facePresent:false,eyeState:'closed',normPog:[0,0],rawNormPog:null})).toThrow(/Inconsistent/);
});
