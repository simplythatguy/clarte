import { afterEach, describe, expect, it, vi } from 'vitest';

// Actual App handlers/reducers with synthetic hook scheduling and camera/DOM boundaries.
// This does not mount a browser, run FaceMesh or verify rendered layout.
const head = { centerX: .5, centerY: .4, span: .3, roll: 0, yawRatio: 0, pitchRatio: .3 };
const hooks = vi.hoisted(() => ({ cells: [], dependencies: [], effects: [], index: 0 }));
const camera = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), collect: vi.fn(async () => true), train: vi.fn(async () => true), resetCalibration: vi.fn(async () => true), geometry: vi.fn(() => ({ deviceId: "fixture-camera", width: 640, height: 480, facingMode: "user" })), exportCalibration: vi.fn(), restoreCalibration: vi.fn(async () => true), preview: vi.fn(),
}));
vi.mock('react', () => ({
  useState(initial) {
    const index = hooks.index++;
    if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.cells[index], next => { hooks.cells[index] = typeof next === 'function' ? next(hooks.cells[index]) : next; }];
  },
  useRef(initial) {
    const index = hooks.index++;
    hooks.cells[index] ??= { current: initial };
    return hooks.cells[index];
  },
  useEffect(effect, dependencies) {
    const index = hooks.index++;
    const before = hooks.dependencies[index];
    if (!before || before.length !== dependencies.length || dependencies.some((value, i) => value !== before[i])) {
      hooks.effects.push(effect);
      hooks.dependencies[index] = dependencies;
    }
  },
}));
vi.mock('../src/core/webeyetrack', () => ({ createCameraSession: () => camera, cameraError: () => 'Synthetic camera error' }));
import { App } from '../src/App';
import { CalibrationEngine } from '../src/core/worker-engine';
import { ESTIMATOR_SHAPES, SAVED_CALIBRATION_KEY } from '../src/core/saved-calibration';
const learned = () => ({ weights: ESTIMATOR_SHAPES.map(shape => Array(shape.reduce((a,b)=>a*b,1)).fill(.01)), affine: [1,0,0,0,1,0], faceWidthCm: 15 });

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree?.props ? text(tree.props.children) : '';
}

let cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup?.();
  cleanups = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(storage = new Map()) {
  hooks.cells = []; hooks.dependencies = []; hooks.effects = []; hooks.index = 0;
  Object.values(camera).forEach(mock => mock.mockReset());
  camera.collect.mockResolvedValue(true); camera.train.mockResolvedValue(true); camera.resetCalibration.mockResolvedValue(true); camera.restoreCalibration.mockResolvedValue(true);
  camera.geometry.mockReturnValue({deviceId:'fixture-camera',width:640,height:480,facingMode:'user'});
  camera.exportCalibration.mockImplementation(async () => learned());
  let now = 0;
  let emit = () => {};
  let failure = () => {};
  let tick = () => {};
  camera.start.mockImplementation(async (listener, fail) => { emit = listener; failure = fail; return true; });
  const win = Object.assign(new EventTarget(), {
    innerWidth: 1400, innerHeight: 900,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) },
    setInterval: callback => { tick = callback; return 1; }, clearInterval() {},
    speechSynthesis: Object.assign(new EventTarget(), { getVoices: () => [], cancel: vi.fn() }),
  });
  class TargetElement {
    constructor(id, left, right) { this.dataset = { dwell: id }; this.left = left; this.right = right; }
    getBoundingClientRect() { return { left: this.left, right: this.right, top: 100, bottom: 300, width: this.right - this.left, height: 200 }; }
    closest() { return this; }
  }
  vi.stubGlobal('HTMLElement', TargetElement);
  const doc = Object.assign(new EventTarget(), {
    hidden: false, hasFocus: () => true, documentElement: {}, fullscreenElement: null,
    querySelectorAll: () => [], getElementById: () => null, elementFromPoint: () => null,
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const render = () => {
    hooks.index = 0;
    const tree = App();
    const effects = hooks.effects.splice(0);
    for (const effect of effects) cleanups.push(effect());
    return tree;
  };
  const stage = () => nodes(render()).find(node => node.type?.name === 'Calibration');
  const saved = () => nodes(render()).find(node => node.type?.name === 'SavedCalibration')?.props;
  const validation = () => nodes(render()).find(node => node.type?.name === 'Validation')?.props;
  const button = label => {
    const result = nodes(render()).find(node => node.type === 'button' && text(node).trim() === label);
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  };
  const advance = async (count, face = true, point = null, pose = head, rawPoint = point) => {
    for (let i = 0; i < count; i++) {
      now += 100;
      await emit({ face, facePresent: face, eyeState: face ? 'open' : 'unknown', point, pose, at: now, rawPoint: typeof rawPoint === 'function' ? rawPoint(now) : rawPoint });
      tick();
      render();
    }
  };
  const silence = count => { for (let i = 0; i < count; i++) { now += 100; tick(); render(); } };
  const targets = () => {
    win.innerWidth = 1000; win.innerHeight = 700;
    const elements = [new TargetElement('top', 100, 450), new TargetElement('right', 500, 850)];
    doc.querySelectorAll = () => elements;
    doc.elementFromPoint = (x, y) => y >= 100 && y < 300 ? elements.find(e => x >= e.left && x < e.right) : null;
  };
  const start = async () => {
    button('Start camera').props.onClick();
    await vi.waitFor(() => expect(Boolean(stage() || saved())).toBe(true));
  };
  const completeEyes = async () => {
    await start(); await advance(12); stage().props.onToggle();
    await advance(255);
    expect(stage().props.state).toMatchObject({ kind:'ready', stage:'head' });
    expect(camera.collect).toHaveBeenCalledTimes(27);
  };
  const train = async () => {
    await completeEyes(); await advance(12); stage().props.onToggle(); await advance(155);
    await vi.waitFor(() => expect(validation()?.state.kind).toBe('ready'));
    expect(camera.collect).toHaveBeenCalledTimes(42); expect(camera.train).toHaveBeenCalledOnce();
  };
  const calibrate = async (navigation = true) => {
    await train();
    if(navigation) { validation().onStart(); await advance(630,true,{x:300,y:200}); expect(validation()).toBeUndefined(); }
  };
  const selection = () => nodes(render()).find(n => n.type?.name==='DwellTarget' && n.props.selected)?.props;
  const dwell = () => nodes(render()).find(n => n.type?.name==='DwellTarget')?.props.state;
  const key = (key, code='') => win.dispatchEvent(Object.assign(new Event('keydown'), {key,code}));
  const settings = () => {
    key('Escape'); button('Settings').props.onClick();
    return nodes(render()).find(n => n.type?.name==='Settings').props;
  };
  const resume = () => button('Continue').props.onClick();
  const choose = (id='top') => nodes(render()).find(n=>n.type?.name==='DwellTarget' && n.props.id===id).props.onClick({detail:0});
  const diagnostics = () => nodes(render()).find(n=>n.props['aria-label']==='Toggle gaze diagnostics');
  const area = () => nodes(render()).find(n=>n.props.className==='gaze-area');
  const emitFrame = async (frame, arrival) => { now = arrival; await emit(frame); tick(); render(); };
  return { setNow: value => { now = value; }, sendOnly: frame => emit(frame), pulse: () => { tick(); render(); }, render, stage, saved, storage, validation, button, start, completeEyes, train, calibrate, advance, silence, targets, selection, dwell, settings, resume, choose, diagnostics, area, key, fail: () => failure(Error('fixture camera error')), win, doc, now: () => now, emitFrame };
}

const preview=f=>nodes(f.render()).find(n=>n.type?.name==='DwellTarget'&&n.props.id==='top')?.props.preview;
const eye=async(f,state='closed',face=true,point={x:300,y:200})=>{
  const open=state==='open';await f.emitFrame({at:f.now()+100,face:face&&open,facePresent:face,eyeState:face?state:'unknown',point:open?point:null,rawPoint:open?point:null,pose:null},f.now()+100);
};
const blink=async f=>{await eye(f);await eye(f,'open');};
const arm=f=>f.advance(23,true,{x:300,y:200});
const title=f=>nodes(f.render()).find(n=>n.type?.name==='StagePage')?.props.title;

describe('minimal automatic setup, with actual run/state classes and synthetic camera boundaries',()=>{
  it('starts only by action, uses three second intros, collects 9 + 5 distinct references then trains and freezes the free flow check',async()=>{
    const f=fixture();f.render();expect(camera.start).not.toHaveBeenCalled();expect(title(f)).toBe('Start camera');
    await f.start();expect(f.stage().props.pace).toBe('quick');await f.advance(12);f.stage().props.onToggle();
    await f.advance(29);expect(f.stage().props.state).toMatchObject({kind:'reading',remainingMs:100});expect(camera.collect).not.toHaveBeenCalled();
    await f.advance(1);expect(f.stage().props.state.kind).toBe('moving');
    await f.advance(224);expect(camera.collect).toHaveBeenCalledTimes(26);await f.advance(1);
    expect(f.stage().props.state).toMatchObject({kind:'ready',stage:'head'});expect(camera.train).not.toHaveBeenCalled();
    await f.advance(12);f.stage().props.onToggle();await f.advance(29);expect(camera.collect).toHaveBeenCalledTimes(27);
    await f.advance(126);await vi.waitFor(()=>expect(f.validation()?.state.kind).toBe('ready'));
    expect(camera.collect).toHaveBeenCalledTimes(42);expect(new Set(camera.collect.mock.calls.map(c=>c[1])).size).toBe(42);
    f.validation().onStart();expect(f.validation().state).toEqual({kind:'intro',remainingMs:3000});
    await f.advance(29,true,{x:1,y:1});expect(f.validation().position).toBeNull();await f.advance(1,true,{x:1,y:1});
    expect(f.validation().state.kind).toBe('running');await f.advance(599,true,{x:1,y:1});expect(f.validation().state.kind).toBe('running');
    await f.advance(1,true,{x:1,y:1});expect(f.validation()).toBeUndefined();
    expect(nodes(f.render()).filter(n=>n.type?.name==='DwellTarget')).toHaveLength(9);
    expect(camera.train).toHaveBeenCalledOnce();expect(camera.collect).toHaveBeenCalledTimes(42);expect(text(f.render())).not.toContain('reference check');
    expect(camera.preview.mock.calls.every(([visible])=>visible===false)).toBe(true);
  });
  it.each(['cancel','failure','false-ack'])('never enters navigation or saves before the real training acknowledgement (%s)',async action=>{
    const f=fixture();await f.completeEyes();await f.advance(12);let finish,reject;
    camera.train.mockImplementationOnce(()=>new Promise((resolve,fail)=>{finish=resolve;reject=fail;}));f.stage().props.onToggle();await f.advance(155);
    expect(f.stage().props.state.kind).toBe('training');expect(f.validation()).toBeUndefined();expect(f.storage.size).toBe(0);
    if(action==='cancel'){f.stage().props.onCancel();finish(true);}
    else if(action==='failure'){reject(Error('Fixture training failure'));}
    else finish(false);
    await Promise.resolve();await Promise.resolve();expect(f.validation()).toBeUndefined();expect(f.selection()).toBeUndefined();expect(f.storage.size).toBe(0);
    if(action!=='cancel')expect(title(f)).toBe('Camera unavailable');
  });
  it('requires explicit start and holds remaining intro time across blur, hidden, and settings',async()=>{
    const f=fixture();await f.start();await f.advance(12);expect(camera.collect).not.toHaveBeenCalled();f.stage().props.onToggle();await f.advance(10);
    f.win.dispatchEvent(new Event('blur'));f.silence(50);f.win.dispatchEvent(new Event('focus'));
    expect(f.stage().props.state).toMatchObject({kind:'paused',reading:{remainingMs:2000}});f.stage().props.onToggle();await f.advance(10);
    f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));await f.advance(20);f.doc.hidden=false;
    expect(f.stage().props.state).toMatchObject({kind:'paused',reading:{remainingMs:1000}});
    const s=f.settings();s.onClose();f.resume();await f.advance(9);expect(camera.collect).not.toHaveBeenCalled();
    await f.advance(17);expect(camera.collect).not.toHaveBeenCalled();await f.advance(1);expect(camera.collect).toHaveBeenCalledOnce();
  });
  it('pauses a pending label acknowledgement and retains full movement/settling on continue',async()=>{
    const f=fixture();await f.start();await f.advance(12);f.stage().props.onToggle();await f.advance(46);
    let finish;camera.collect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.advance(1);
    f.key('Escape');finish(true);await pending;f.silence(20);expect(camera.collect).toHaveBeenCalledTimes(1);
    f.resume();await f.advance(16);expect(camera.collect).toHaveBeenCalledTimes(1);await f.advance(1);expect(camera.collect).toHaveBeenCalledTimes(2);
  });
  it.each(['blur','hidden'])('does not auto-train from a final label acknowledged across %s',async event=>{
    const f=fixture();await f.completeEyes();await f.advance(12);f.stage().props.onToggle();await f.advance(154);
    let finish;camera.collect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.advance(1);
    if(event==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else f.win.dispatchEvent(new Event('blur'));
    finish(true);await pending;f.doc.hidden=false;f.win.dispatchEvent(new Event('focus'));f.silence(20);
    expect(camera.train).not.toHaveBeenCalled();expect(title(f)).toBe('Paused');f.resume();await f.advance(1);await vi.waitFor(()=>expect(f.validation()?.state.kind).toBe('ready'));
  });
  it('discards a replaced run acknowledgement and refreshes geometry after slow startup',async()=>{
    const f=fixture();let ready;const startImpl=camera.start.getMockImplementation();camera.start.mockImplementationOnce(listener=>{startImpl(listener);return new Promise(resolve=>{ready=resolve;});});f.button('Start camera').props.onClick();
    f.win.innerWidth=700;f.win.dispatchEvent(new Event('resize'));ready(true);await vi.waitFor(()=>expect(f.stage()).toBeDefined());expect(f.stage().props.viewport.width).toBe(700);
    await f.advance(12);f.stage().props.onToggle();await f.advance(46);let finish;camera.collect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.advance(1);
    f.stage().props.onRestart();await vi.waitFor(()=>expect(f.stage().props.state.kind).toBe('ready'));finish(true);await pending;
    expect(f.stage().props.state).toMatchObject({kind:'ready',samples:0});
  });
  it('invalidates cumulative geometry changes, preserves camera during fullscreen-reset events and reports fullscreen failure',async()=>{
    const f=fixture();await f.calibrate();for(let width=1390;width>=1360;width-=10){f.win.innerWidth=width;f.win.dispatchEvent(new Event('resize'));}
    expect(camera.resetCalibration).not.toHaveBeenCalled();let finish;camera.resetCalibration.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    f.win.innerWidth=1350;f.win.dispatchEvent(new Event('resize'));expect(f.stage().props.state.kind).toBe('resetting');const stopped=camera.stop.mock.calls.length;
    f.doc.dispatchEvent(new Event('fullscreenchange'));expect(camera.stop).toHaveBeenCalledTimes(stopped);finish(true);await vi.waitFor(()=>expect(f.stage().props.state.kind).toBe('ready'));
    const s=f.settings();await s.onFullscreen();await Promise.resolve();expect(nodes(f.render()).find(n=>n.type?.name==='Settings').props.fullscreenError).toBe(true);
  });
  it('replaces open Settings with a single camera error page and releases the camera',async()=>{
    const f=fixture();await f.calibrate();f.settings();f.fail();expect(title(f)).toBe('Camera unavailable');
    expect(nodes(f.render()).some(n=>n.type?.name==='Settings')).toBe(false);expect(camera.stop).toHaveBeenCalled();
  });
  it('keeps manual check pauses inside the camera session and never resumes on focus',async()=>{
    const f=fixture();await f.train();f.validation().onStart();await f.advance(60,true,{x:1,y:1});f.validation().onPause();const elapsed=f.validation().state.elapsedMs;
    f.silence(100);expect(f.validation().state).toMatchObject({kind:'paused',elapsedMs:elapsed});f.validation().onResume();
    const stopped=camera.stop.mock.calls.length;f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.silence(100);f.doc.hidden=false;f.win.dispatchEvent(new Event('focus'));
    expect(f.validation().state.kind).toBe('paused');expect(camera.stop).toHaveBeenCalledTimes(stopped);
    f.validation().onResume();await f.advance(600,true,{x:1,y:1});expect(f.validation()).toBeUndefined();expect(camera.collect).toHaveBeenCalledTimes(42);
  });
  it('cancels a free flow run on a one-pixel resize or changed motion preference',async()=>{
    const f=fixture(),query=Object.assign(new EventTarget(),{matches:false});f.win.matchMedia=()=>query;
    await f.train();f.validation().onStart();await f.advance(60,true,{x:1,y:1});f.win.innerWidth--;f.win.dispatchEvent(new Event('resize'));
    expect(f.validation().state).toEqual({kind:'cancelled',reason:'viewport'});expect(camera.resetCalibration).not.toHaveBeenCalled();f.validation().onRestart();
    await f.advance(40,true,{x:1,y:1});query.matches=true;query.dispatchEvent(new Event('change'));expect(f.validation().state).toEqual({kind:'cancelled',reason:'motion'});
    f.validation().onRestart();expect(f.validation().reducedMotion).toBe(true);
  });
  it('opens a separate recoverable page after prolonged loss and does not auto-resume on recovery',async()=>{
    const f=fixture();await f.start();await f.advance(12);f.stage().props.onToggle();await f.advance(40);await f.advance(82,false);
    expect(title(f)).toBe('Face not detected');expect(f.stage()).toBeUndefined();await f.advance(10);expect(title(f)).toBe('Face not detected');
    f.resume();expect(f.stage().props.state.kind).toBe('moving');await f.advance(16);const before=camera.collect.mock.calls.length;await f.advance(1);expect(camera.collect.mock.calls.length).toBe(before+1);
  });
});

describe('blank navigation selection, freshness and optional diagnostics',()=>{
  it('is silent before a blink, previews first, confirms second, latches, and cancels on lookaway',async()=>{
    const f=fixture();f.targets();await f.calibrate();await arm(f);expect(f.selection()).toBeUndefined();expect(preview(f)).toBe(false);expect(f.area()).toBeUndefined();
    await blink(f);expect(preview(f)).toBe(true);expect(f.selection()).toBeUndefined();await f.advance(4,true,{x:300,y:200});await blink(f);expect(f.selection()).toMatchObject({id:'top',activation:1});
    await arm(f);await blink(f);expect(f.selection().activation).toBe(1);
    await f.advance(1,true,{x:600,y:200});await arm(f);await blink(f);expect(preview(f)).toBe(true);await f.advance(1,true,{x:300,y:600});expect(preview(f)).toBe(false);await blink(f);expect(f.selection().activation).toBe(1);
  });
  it.each(['missing','unknown','timeout','duplicate','long-closure'])('does not convert %s into a blink',async reason=>{
    const f=fixture();f.targets();await f.calibrate();await arm(f);await blink(f);
    if(reason==='missing')await eye(f,'closed',false);if(reason==='unknown')await eye(f,'unknown');if(reason==='timeout')f.silence(7);
    if(reason==='duplicate')await f.emitFrame({at:f.now(),face:true,facePresent:true,eyeState:'open',point:{x:300,y:200},rawPoint:{x:300,y:200},pose:null},f.now());
    if(reason==='long-closure'){await eye(f);f.silence(6);}expect(preview(f)).toBe(false);await eye(f,'open');await blink(f);expect(f.selection()).toBeUndefined();
  });
  it.each(['settings','blur','hidden','escape','scroll','delete','mode','stop','reset','validation','pagehide'])('clears preview on %s and rejects a stale next blink',async action=>{
    const f=fixture();f.targets();await f.calibrate();await arm(f);await blink(f);
    if(action==='settings'){const s=f.settings();s.onClose();f.resume();}
    if(action==='blur'){f.win.dispatchEvent(new Event('blur'));f.win.dispatchEvent(new Event('focus'));f.resume();}
    if(action==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.doc.hidden=false;}
    if(action==='escape'){f.key('Escape');f.resume();}if(action==='scroll')f.win.dispatchEvent(new Event('scroll'));
    if(action==='delete'){const s=f.settings();await s.onDeleteSaved();s.onClose();f.resume();}
    if(action==='mode'){const s=f.settings();s.onChange({...s.value,selection:'dwell'});s.onClose();f.resume();}
    if(action==='stop')f.settings().onStop();if(action==='reset'){f.settings().onReset();await vi.waitFor(()=>expect(f.stage()?.props.state.kind).toBe('ready'));}
    if(action==='validation')f.settings().onValidate();if(action==='pagehide')f.win.dispatchEvent(new Event('pagehide'));
    expect(preview(f)).not.toBe(true);await eye(f,'open');await blink(f);expect(f.selection()).toBeUndefined();
  });
  it('uses raw reopening target, never the old filtered point',async()=>{
    const f=fixture();f.targets();await f.calibrate();await arm(f);await blink(f);await f.advance(4,true,{x:300,y:200});await eye(f);
    await f.emitFrame({at:f.now()+100,face:true,facePresent:true,eyeState:'open',point:{x:300,y:200},rawPoint:{x:600,y:200},pose:null},f.now()+100);
    expect(preview(f)).toBe(false);expect(f.selection()).toBeUndefined();
  });
  it.each([true,false])('retains dwell neutral rearm and accepts natural head movement (assistance=%s)',async assistance=>{
    const f=fixture();f.targets();await f.calibrate();const s=f.settings();s.onChange({...s.value,selection:'dwell',assistance});s.onClose();f.resume();
    await f.advance(12,true,{x:300,y:600});await f.advance(23,true,{x:300,y:200},{...head,yawRatio:.2});expect(f.dwell().kind).toBe('dwelling');
    await f.advance(1,false);await f.advance(50,true,{x:300,y:200});expect(f.selection()).toBeUndefined();
    await f.advance(30,true,{x:300,y:600});await f.advance(50,true,{x:300,y:200});expect(f.selection().activation).toBe(1);
    for(let i=0;i<15;i++){await f.advance(3,true,{x:300,y:600});await f.advance(2,true,{x:300,y:200});}await f.advance(50,true,{x:300,y:200});expect(f.selection().activation).toBe(1);
  });
  it('allows deliberate keyboard selection after loss and has no speech action or hover speech',async()=>{
    const f=fixture();f.targets();await f.calibrate();f.win.speechSynthesis.speak=vi.fn();await f.advance(5,false);f.choose();expect(f.selection().id).toBe('top');
    await f.advance(10,true,{x:600,y:200});expect(f.win.speechSynthesis.speak).not.toHaveBeenCalled();expect(text(f.render())).not.toContain('Speak');
  });
  it('toggles diagnostics without resetting selection, never fabricates a point and hides on closed/lost/stale/paused/settings/stop',async()=>{
    const f=fixture();f.targets();await f.calibrate();expect(f.diagnostics().props['aria-pressed']).toBe(false);expect(f.area()).toBeUndefined();
    await arm(f);await blink(f);expect(preview(f)).toBe(true);f.diagnostics().props.onClick();expect(preview(f)).toBe(true);expect(f.area()).toBeDefined();
    await f.advance(4,true,{x:300,y:200});await blink(f);expect(f.selection().activation).toBe(1);f.diagnostics().props.onClick();expect(f.area()).toBeUndefined();
    f.diagnostics().props.onClick();await eye(f);expect(f.area()).toBeUndefined();await eye(f,'open');expect(f.area()).toBeDefined();
    await f.advance(1,false);expect(f.area()).toBeUndefined();await f.advance(1,true,{x:300,y:200});f.silence(7);expect(f.area()).toBeUndefined();
    f.key('Escape');expect(f.area()).toBeUndefined();f.button('Settings').props.onClick();expect(f.area()).toBeUndefined();nodes(f.render()).find(n=>n.type?.name==='Settings').props.onStop();expect(f.area()).toBeUndefined();
  });
  it('diagnostics do not alter calibration labels and reserve the top-right control rail before a run',async()=>{
    const f=fixture();await f.start();f.diagnostics().props.onClick();expect(f.area()).toBeUndefined();await f.advance(12,true,{x:400,y:300});f.stage().props.onToggle();await f.advance(31,true,{x:400,y:300});expect(f.area()).toBeDefined();
    await f.advance(224,true,{x:400,y:300});expect(camera.collect).toHaveBeenCalledTimes(27);expect(new Set(camera.collect.mock.calls.map(([p])=>`${p.x},${p.y}`)).size).toBe(9);
    expect(camera.collect.mock.calls.every(([p])=>p.y>=88)).toBe(true);expect(camera.collect.mock.calls.some(([p])=>p.x===400&&p.y===300)).toBe(false);expect(camera.train).not.toHaveBeenCalled();
  });
  it('does not cancel preview for a same-geometry resize notification, but does for a one-pixel change',async()=>{
    const f=fixture();f.targets();await f.calibrate();await arm(f);await blink(f);f.win.dispatchEvent(new Event('resize'));expect(preview(f)).toBe(true);f.win.innerWidth--;f.win.dispatchEvent(new Event('resize'));expect(preview(f)).toBe(false);
  });
});

describe('saved calibration and revocable asynchronous ownership',()=>{
  const restart=async f=>{f.settings().onStop();await f.start();expect(f.stage().props.saved).toBe(true);};
  it('saves only learned weights, retains on stop, and restores only after explicit camera and saved choices',async()=>{
    const f=fixture();await f.calibrate();await vi.waitFor(()=>expect(f.storage.size).toBe(1));await restart(f);expect(camera.restoreCalibration).not.toHaveBeenCalled();
    await f.stage().props.onUse();await vi.waitFor(()=>expect(f.stage()).toBeUndefined());expect(camera.restoreCalibration).toHaveBeenCalledWith(learned());expect(f.validation()).toBeUndefined();
    expect(f.settings().canValidate).toBe(true);await f.settings().onDeleteSaved();expect(f.storage.size).toBe(0);
  });
  it.each(['delete','stop','reset'])('does not resurrect async export after %s',async action=>{
    const f=fixture();let finish;camera.exportCalibration.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await f.train();
    if(action==='delete')await f.settings().onDeleteSaved();else if(action==='stop')f.settings().onStop();else f.settings().onReset();
    finish(learned());await Promise.resolve();await Promise.resolve();expect(f.storage.size).toBe(0);
  });
  it('cancels a pending restore on deletion and resets the partially restored worker',async()=>{
    const f=fixture();await f.calibrate();await restart(f);let finish;camera.restoreCalibration.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.stage().props.onUse();expect(f.stage().props.busy).toBe(true);
    f.settings().onDeleteSaved();await vi.waitFor(()=>expect(f.stage()?.props.state.kind).toBe('ready'));finish(true);await Promise.resolve();expect(f.stage().props.state.kind).toBe('ready');expect(f.storage.size).toBe(0);
  });
  it.each(['before','during'])('rechecks stored identity %s restore to reject unseen cross-tab deletion',async when=>{
    const f=fixture();await f.calibrate();await restart(f);let finish;if(when==='during')camera.restoreCalibration.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    if(when==='before')f.storage.delete(SAVED_CALIBRATION_KEY);f.stage().props.onUse();
    if(when==='during'){f.storage.delete(SAVED_CALIBRATION_KEY);finish(true);}await vi.waitFor(()=>expect(f.stage()?.props.state.kind).toBe('ready'));
    expect(f.selection()).toBeUndefined();if(when==='before')expect(camera.restoreCalibration).not.toHaveBeenCalled();else expect(camera.resetCalibration).toHaveBeenCalledOnce();
  });
  it.each(['delete','replace'])('keeps a cross-tab %s while automatic worker training is pending',async change=>{
    const f=fixture();await f.calibrate();await restart(f);f.stage().props.onRestart();await vi.waitFor(()=>expect(f.stage().props.state.kind).toBe('ready'));
    await f.advance(12);f.stage().props.onToggle();await f.advance(255);await f.advance(12);let finish;camera.train.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    f.stage().props.onToggle();await f.advance(155);expect(f.stage().props.state.kind).toBe('training');
    const changed=JSON.parse(f.storage.get(SAVED_CALIBRATION_KEY));changed.savedAt+=123;changed.learned.weights[0][0]=.12345;
    if(change==='delete')f.storage.delete(SAVED_CALIBRATION_KEY);else f.storage.set(SAVED_CALIBRATION_KEY,JSON.stringify(changed));
    f.win.dispatchEvent(Object.assign(new Event('storage'),{key:SAVED_CALIBRATION_KEY}));const expected=f.storage.get(SAVED_CALIBRATION_KEY);finish(true);
    await vi.waitFor(()=>expect(f.validation()?.state.kind).toBe('ready'));await Promise.resolve();await Promise.resolve();expect(f.storage.get(SAVED_CALIBRATION_KEY)).toBe(expected);
    expect(f.settings().savedStatus).toContain('not saved over it');
  });
  it('keeps a quota-failed trained session usable and rejects corrupted saved records',async()=>{
    const f=fixture();f.win.localStorage.setItem=()=>{throw Error('QuotaExceededError');};await f.calibrate();expect(f.settings().savedStatus).toContain('could not be saved');
    const bad=fixture(new Map([[SAVED_CALIBRATION_KEY,'{broken']]));await bad.start();expect(bad.stage().props.saved).toBe(false);expect(bad.settings().savedStatus).toContain('could not be loaded');
  });
  it('releases all session data on pagehide, requires explicit camera start again, and labels simulation entry',async()=>{
    const f=fixture();await f.calibrate();f.win.dispatchEvent(new Event('pagehide'));expect(f.validation()).toBeUndefined();expect(title(f)).toBe('Paused');
    f.button('Continue').props.onClick();await vi.waitFor(()=>expect(f.stage()).toBeDefined());f.settings().onSimulation();expect(title(f)).toBe('Simulation · camera off');
    f.button('Start simulation').props.onClick();expect(nodes(f.render()).some(n=>n.props['aria-label']==='Simulation targets, camera off')).toBe(true);expect(f.settings().canValidate).toBe(false);
  });
});

describe('reviewed lifecycle regressions', () => {
  const restart = async f => { f.settings().onStop(); await f.start(); expect(f.stage().props.saved).toBe(true); };
  it('resets the real label owner after Calibrate is chosen over saved reuse and capture is resized', async () => {
    const f=fixture(); await f.calibrate(); await restart(f);
    const before=camera.collect.mock.calls.length;
    await f.advance(12); f.stage().props.onToggle(); await f.advance(80);
    expect(camera.collect.mock.calls.length).toBeGreaterThan(before);
    const labelsBeforeResize=camera.collect.mock.calls.length-before;
    f.win.innerWidth-=100; f.win.dispatchEvent(new Event('resize'));
    expect(camera.resetCalibration).toHaveBeenCalledOnce();
  });
  it('leaves navigation and resets the model after a large resize of a newly recalibrated saved-choice session', async () => {
    const f=fixture(); await f.calibrate(); await restart(f);
    await f.advance(12); f.stage().props.onToggle(); await f.advance(255);
    await f.advance(12); f.stage().props.onToggle(); await f.advance(155);
    await vi.waitFor(()=>expect(f.validation()?.state.kind).toBe('ready')); f.validation().onPhrases();
    f.win.innerWidth-=100; f.win.dispatchEvent(new Event('resize'));
    expect(camera.resetCalibration).toHaveBeenCalledOnce();
    expect(f.stage()).toBeDefined();
  });
  it.each(['blur','hidden'])('requires explicit Continue when a saved restore finishes across %s', async event => {
    const f=fixture(); await f.calibrate(); await restart(f); let finish;
    camera.restoreCalibration.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const restore=f.stage().props.onUse();
    if(event==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else f.win.dispatchEvent(new Event('blur'));
    finish(true); await restore; await Promise.resolve();
    f.doc.hidden=false; f.win.dispatchEvent(new Event('focus')); f.silence(2);
    expect(title(f)).toBe('Paused');
    expect(nodes(f.render()).filter(n=>n.type?.name==='DwellTarget')).toHaveLength(0);
    f.resume(); f.silence(1);
    expect(nodes(f.render()).filter(n=>n.type?.name==='DwellTarget')).toHaveLength(9);
  });
  it.each(['blur','hidden'])('requires explicit Continue if a final validation frame completes just before %s', async event => {
    const f=fixture(); await f.train(); f.validation().onStart(); await f.advance(629,true,{x:300,y:200});
    expect(f.validation().state).toMatchObject({kind:'running',elapsedMs:59900});
    f.setNow(f.now()+100); await f.sendOnly({at:f.now(),face:true,facePresent:true,eyeState:'open',point:{x:300,y:200},rawPoint:{x:300,y:200},pose:null});
    expect(f.validation().state.kind).toBe('complete');
    if(event==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else f.win.dispatchEvent(new Event('blur'));
    f.pulse(); f.doc.hidden=false; f.win.dispatchEvent(new Event('focus')); f.silence(2);
    expect(title(f)).toBe('Paused');
    expect(nodes(f.render()).filter(n=>n.type?.name==='DwellTarget')).toHaveLength(0);
    f.resume(); f.silence(1);
    expect(nodes(f.render()).filter(n=>n.type?.name==='DwellTarget')).toHaveLength(9);
  });
  it('retains a final acknowledged label behind Escape and starts training exactly once after Continue', async () => {
    const f=fixture(); await f.completeEyes(); await f.advance(12); f.stage().props.onToggle(); await f.advance(154); let finish;
    camera.collect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})); const pending=f.advance(1);
    f.key('Escape'); finish(true); await pending; f.silence(20); expect(camera.train).not.toHaveBeenCalled();
    f.resume(); await f.advance(1); await vi.waitFor(()=>expect(f.validation()?.state.kind).toBe('ready')); f.silence(20);
    expect(camera.train).toHaveBeenCalledOnce(); expect(camera.collect).toHaveBeenCalledTimes(42);
  });
});


describe('worker sample owner after resize', () => {
  it('can finish a fresh 42-label run after resizing a saved-choice recalibration', async () => {
    const f=fixture(); await f.calibrate(); f.settings().onStop(); await f.start();
    const observation={eyePatch:{width:512,height:128,data:new Uint8ClampedArray(512*128*4)},headVector:[0,0,1],faceOrigin3D:[0,0,1],gazeState:'open',eyeState:'open',normPog:[0,0],rawNormPog:[0,0],facialLandmarks:Array.from({length:478},()=>({x:.5,y:.5,z:0}))};
    const createEngine=()=>new CalibrationEngine({step:async()=>observation,adapt:async()=>{},dispose(){}},()=>f.now());
    let engine=createEngine(); let accepted=0;
    camera.collect.mockImplementation(async(point,at,view)=>{await engine.step({},at,at);const valid=engine.collect(at,point.x/view.width-.5,point.y/view.height-.5);if(valid)accepted++;return valid;});
    camera.resetCalibration.mockImplementation(async()=>{engine.dispose();engine=createEngine();return true;});
    await f.advance(12); f.stage().props.onToggle(); await f.advance(80);
    const staleSamples=engine.count; expect(staleSamples).toBe(6);
    f.win.innerWidth-=100; f.win.dispatchEvent(new Event('resize'));
    await f.advance(12);f.stage().props.onToggle();await f.advance(255);
    expect(f.stage().props.state).toMatchObject({kind:'ready',stage:'head'});
    await f.advance(12);f.stage().props.onToggle();await f.advance(255);
    expect(f.validation()?.state.kind).toBe('ready');
  });
});
