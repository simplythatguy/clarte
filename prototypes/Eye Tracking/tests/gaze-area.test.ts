import { describe, expect, it } from 'vitest';
import { GazeArea } from '../src/core/gaze-area';
const viewport={width:1000,height:800};
describe('recent gaze area',()=>{
 it('has bounded broad extent, expires old estimates and cannot invent duplicate evidence',()=>{
  const area=new GazeArea();const first=area.sample({point:{x:100,y:100},at:0,face:true,pose:null,facePresent:true,eyeState:'open' as const},viewport,0);
  expect(first?.radius).toBe(80);
  expect(area.sample({point:{x:900,y:700},at:0,face:true,pose:null,facePresent:true,eyeState:'open' as const},viewport,100)).toEqual(first);
  for(let at=100;at<=500;at+=100) area.sample({point:{x:900,y:700},at,face:true,pose:null,facePresent:true,eyeState:'open' as const},viewport,at);
  expect(area.sample({point:{x:900,y:700},at:1000,face:true,pose:null,facePresent:true,eyeState:'open' as const},viewport,1000)?.x).toBe(900);
  expect(area.sample({point:{x:900,y:700},at:1000,face:true,pose:null,facePresent:true,eyeState:'open' as const},viewport,1601)).toBeNull();
  expect(area.sample({point:null,at:1700,face:false,pose:null,facePresent:true,eyeState:'open' as const},viewport,1700)).toBeNull();
 });
});
