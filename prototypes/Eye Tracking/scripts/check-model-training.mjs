// Exercises the shipped model's adaptation math with explicitly synthetic eye patches.
// This is tensor/lifecycle evidence only; it is NOT a camera or human gaze check.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
const evidenceRoot = process.argv.find(arg => arg.startsWith('--evidence-root='))?.split('=')[1] ?? 'evidence/webeyetrack';
import path from 'node:path';
await build({ entryPoints: ['vendor/webeyetrack/local/WebEyeTrack.ts','vendor/webeyetrack/local/BlazeGaze.ts'], outdir:`${evidenceRoot}/model-test`,bundle:true,platform:'node',format:'esm',packages:'external',minify:false });
const tf = await import('@tensorflow/tfjs');
const { default: WebEyeTrack } = await import(path.resolve(`${evidenceRoot}/model-test/WebEyeTrack.js`));
const { default: BlazeGaze } = await import(path.resolve(`${evidenceRoot}/model-test/BlazeGaze.js`));
const server = http.createServer(async (req,res) => {
 const name = path.basename(req.url);
 if(!['model.json','group1-shard1of1.bin'].includes(name)) { res.writeHead(404);res.end();return; }
 res.end(await readFile(`public/vendor/webeyetrack/web/${name}`));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 await tf.setBackend('cpu'); await tf.ready();
 const baseline = tf.memory().numTensors;
 const model = new BlazeGaze();
 await model.loadModel(`http://127.0.0.1:${server.address().port}`);
 const tracker = new WebEyeTrack(); tracker.blazeGaze = model;
 const before = model.model.trainableWeights.map(w=>Array.from(w.read().dataSync()));
 const frozen = model.model.getLayer('cnn_encoder').weights.map(w=>Array.from(w.read().dataSync()));
 const eyes=[], heads=[], origins=[], labels=[];
 for(let n=0;n<27;n++) {
   const i=Math.floor(n/3), x=(i%3-1)*.35, y=(Math.floor(i/3)-1)*.35;
   const pixels=new Uint8Array(512*128*4);
   for(let p=0;p<pixels.length;p+=4) { pixels[p]=(p/4+i*11)%255; pixels[p+1]=(i*30)%255; pixels[p+2]=100;pixels[p+3]=255; }
   eyes.push({width:512,height:128,data:pixels});heads.push([x*.2,y*.2,1]);origins.push([x,y,60]);labels.push([x,y]);
 }
 await tracker.adapt(eyes,heads,origins,labels);
 const changed = model.model.trainableWeights.some((w,i)=>Array.from(w.read().dataSync()).some((v,j)=>v!==before[i][j]));
 const frozenUnchanged=model.model.getLayer('cnn_encoder').weights.every((w,i)=>Array.from(w.read().dataSync()).every((v,j)=>v===frozen[i][j]));
 if(!changed || !frozenUnchanged) throw Error('Expected estimator update and unchanged encoder');
 const tensorsAfterFirst=tf.memory().numTensors;
 await tracker.adapt(eyes,heads,origins,labels);
 const tensorsAfterSecond=tf.memory().numTensors;
 if(tensorsAfterSecond!==tensorsAfterFirst) throw Error('Adaptation tensor count grew');
 // The synthetic support test bypasses FaceMesh: supply its constant normalization explicitly.
 tracker.faceWidthComputed=true; tracker.faceWidthCm=15;
 const serialized=JSON.parse(JSON.stringify(tracker.exportCalibration()));
 const restored=new WebEyeTrack(); await restored.blazeGaze.loadModel(`http://127.0.0.1:${server.address().port}`);
 const tensorsBeforeRestore=tf.memory().numTensors;
 restored.restoreCalibration(serialized);
 const tensorsAfterRestore=tf.memory().numTensors;
 restored.restoreCalibration(serialized);
 if(tf.memory().numTensors!==tensorsAfterRestore)throw Error('Repeated restore leaked tensors');
 const restoredState=restored.exportCalibration();
 if(JSON.stringify(restoredState)!==JSON.stringify(serialized))throw Error('Restored learned tensors/affine/normalization differ');
 let maximumRestoredOffset=0;
 for(let n=0;n<7;n++) {
   const values=tf.tidy(()=>{
     const eye=tf.fill([1,128,512,3],n/10), head=tf.tensor2d([[n*.01,-n*.01,1]]), origin=tf.tensor2d([[n*.02,n*.01,60]]);
     const a=tracker.blazeGaze.predict(eye,head,origin).dataSync(), b=restored.blazeGaze.predict(eye,head,origin).dataSync();
     const output=(v,affine)=>[affine[0]*v[0]+affine[1]*v[1]+affine[2],affine[3]*v[0]+affine[4]*v[1]+affine[5]];
     return [output(a,serialized.affine),output(b,restoredState.affine)];
   });
   maximumRestoredOffset=Math.max(maximumRestoredOffset,...values[0].map((v,i)=>Math.abs(v-values[1][i])));
 }
 if(maximumRestoredOffset>1e-7 || restored.faceWidthCm!==tracker.faceWidthCm || !restored.faceWidthComputed)throw Error('Restored estimator or normalization differs');
 const serializedBytes=JSON.stringify(serialized).length;
 if(serializedBytes>512000 || serialized.weights.length!==6)throw Error('Estimator persistence is not bounded/minimal');
 restored.dispose(); tracker.dispose();
 const end=tf.memory().numTensors;
 const report={scope:'Actual pinned BlazeGaze model, synthetic input tensor patches and explicit synthetic labels; no human accuracy inference.',backend:tf.getBackend(),samples:27,changed,frozenUnchanged,baseline,tensorsAfterFirst,tensorsAfterSecond,end,serializedBytes,restoredSyntheticInputs:7,maximumRestoredOffset,tensorsBeforeRestore,tensorsAfterRestore};
 await writeFile(`${evidenceRoot}/model-training.json`,JSON.stringify(report,null,2)+'\n');
 if(end!==baseline) throw Error(`Tensor leak ${baseline} -> ${end}`);
 console.log('PASS: shipped model updates gaze estimator, preserves frozen encoder, repeats adaptation without tensor growth, round-trips only six estimator tensors plus affine/normalization with equal synthetic predictions, and disposes all tensors.');
} finally { await new Promise(resolve=>server.close(resolve)); }
