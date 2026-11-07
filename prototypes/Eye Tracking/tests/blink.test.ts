import { describe, expect, it } from 'vitest';
import { BilateralEyes, BlinkSelection } from '../src/core/blink';
import type { EyeState, GazeFrame } from '../src/core/tracking';
const frame = (at: number, eyeState: EyeState = 'open', facePresent = true): GazeFrame => ({ at, eyeState, facePresent, face: facePresent && eyeState === 'open', point: eyeState === 'open' ? { x: 100, y: 100 } : null, pose: null });
function fixture() {
  const selection = new BlinkSelection(); let at = 0;
  const sample = (eye: EyeState = 'open', target: string | null = 'yes', delta = 100, face = true) => { at += delta; return selection.sample(frame(at, eye, face), target, at); };
  const steady = () => { for (let i = 0; i < 22; i++) sample(); };
  const blink = () => { sample('closed'); return sample(); };
  return { selection, sample, steady, blink, at: () => at };
}
describe('bilateral eye measurements', () => {
  it('uses hysteresis, rejects winks/invalid measurements and resets on face loss', () => {
    const eyes = new BilateralEyes();
    expect(eyes.observe(.25,.25)).toBe('open'); expect(eyes.observe(.215,.215)).toBe('open');
    expect(eyes.observe(.1,.27)).toBe('unknown'); expect(eyes.observe(.27,.1)).toBe('unknown');
    expect(eyes.observe(.19,.21)).toBe('unknown'); expect(eyes.observe(.1,.1)).toBe('closed');
    expect(eyes.observe(.215,.215)).toBe('closed'); expect(eyes.observe(NaN,.1)).toBe('unknown');
    expect(eyes.observe(.3,.3)).toBe('open'); eyes.reset(); expect(eyes.observe(.21,.21)).toBe('unknown');
  });
});
describe('steady look, completed blink preview, distinct blink confirm', () => {
  it('silently arms without an event, previews on reopening, commits once and requires fresh lookaway', () => {
    const f = fixture();
    for (let i=0;i<22;i++) expect(f.sample()).toEqual({selected:null,previewed:null});
    expect(f.selection.state.kind).toBe('armed'); expect(f.blink()).toEqual({selected:null,previewed:'yes'});
    f.sample(); f.sample(); f.sample(); expect(f.blink().selected).toBe('yes');
    f.steady(); expect(f.blink().selected).toBeNull(); expect(f.selection.state.kind).toBe('latched');
    f.sample('unknown',null,100,false); f.steady(); expect(f.blink().selected).toBeNull();
    f.sample('open',null); f.steady(); expect(f.blink().previewed).toBe('yes');
  });
  it('requires the same fresh reopening target and cancels a preview immediately on lookaway', () => {
    const f=fixture(); f.steady(); f.blink(); f.sample('open','no'); expect(f.selection.state.kind).toBe('steady');
    expect(f.blink().selected).toBeNull(); f.steady(); f.sample('closed','yes');
    expect(f.sample('open','no').previewed).toBeNull();
  });
  it('never counts closed time toward the two seconds of stable open gaze', () => {
    const f=fixture(); for(let i=0;i<19;i++)f.sample(); f.sample('closed'); f.sample('open','yes',400);
    expect(f.selection.state.kind).toBe('steady'); expect(f.blink().previewed).toBeNull();
  });
  it.each(['unknown','missing','stale','duplicate','future','long','invalid-point'] as const)('cancels arming and preview on %s without creating a blink', reason => {
    const f=fixture(); f.steady(); f.blink(); const at=f.at();
    if(reason==='unknown')f.sample('unknown');
    if(reason==='missing')f.sample('closed',null,100,false);
    if(reason==='stale')f.selection.tick(at+601);
    if(reason==='duplicate')f.selection.sample(frame(at), 'yes', at);
    if(reason==='future')f.selection.sample(frame(at+100), 'yes', at);
    if(reason==='long'){f.sample('closed'); f.sample('closed',null,501);}
    if(reason==='invalid-point')f.selection.sample({...frame(at+100),point:null},'yes',at+100);
    expect(f.selection.state.kind).toBe('idle'); expect(f.blink().selected).toBeNull(); expect(f.selection.state.kind).not.toBe('preview');
  });
  it('rejects too-short closure, closure without prior open time and a second blink inside refractory time', () => {
    const f=fixture(); f.steady(); f.sample('closed'); expect(f.sample('open','yes',20).previewed).toBeNull();
    f.sample(); f.sample(); expect(f.blink().previewed).toBe('yes');
    f.sample('closed'); expect(f.sample().selected).toBeNull(); expect(f.selection.state.kind).toBe('preview');
    f.sample(); f.sample(); f.sample(); expect(f.blink().selected).toBe('yes');
    const g=fixture(); g.sample(); g.sample('closed','yes',20); expect(g.sample().previewed).toBeNull();
  });
  it('cancels by explicit lifecycle reset and keeps a direct activation latched until fresh lookaway', () => {
    const f=fixture(); f.steady(); f.blink(); f.selection.reset(); expect(f.blink().selected).toBeNull();
    f.selection.activate('yes'); f.steady(); expect(f.blink().selected).toBeNull(); f.sample('open',null); f.steady(); expect(f.blink().previewed).toBe('yes');
  });
});
