import { afterAll, describe, expect, it, vi } from 'vitest';
import { computeHomography, applyHomography, warpImageData, getHeadVector, computeFaceOrigin3D } from '../vendor/webeyetrack/local/utils/mathUtils';
import { Matrix } from 'ml-matrix';
class PixelData {
 constructor(width,height){this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);}
}
vi.stubGlobal('ImageData',PixelData);
afterAll(()=>vi.unstubAllGlobals());
describe('actual pinned WebEyeTrack geometry with synthetic landmarks',()=>{
 it('maps a four-corner homography and produces the model input dimensions',()=>{
  const src=[[100,100],[100,400],[400,400],[400,100]], dst=[[0,0],[0,300],[300,300],[300,0]];
  const H=computeHomography(src,dst);
  src.forEach((p,i)=>{const result=applyHomography(H,p);expect(result[0]).toBeCloseTo(dst[i][0],3);expect(result[1]).toBeCloseTo(dst[i][1],3);});
  const frame=new PixelData(10,10);frame.data.fill(128);
  const identity=computeHomography([[0,0],[0,10],[10,10],[10,0]],[[0,0],[0,128],[512,128],[512,0]]);
  const output=warpImageData(frame,identity,512,128);expect(output.width).toBe(512);expect(output.height).toBe(128);
  expect(output.data.some(n=>n===128)).toBe(true);
 });
 it('retains the official head-vector direction and face-origin feature rather than adding pose correction',()=>{
  const vector=getHeadVector(Matrix.eye(4));expect(vector).toHaveLength(3);expect(vector.every(Number.isFinite)).toBe(true);
  const metric=Array.from({length:478},()=>[1,2,60]);expect(computeFaceOrigin3D(metric)).toEqual([1,2,60]);
 });
});
