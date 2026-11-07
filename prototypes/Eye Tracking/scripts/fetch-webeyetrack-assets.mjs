// Development-time restoration only. Does not run in the app or download unpinned updates.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest=JSON.parse(await readFile('vendor/webeyetrack/ASSETS.json','utf8'));
for(const asset of manifest.files){
 let bytes;
 if(asset.source.startsWith('npm:')){
  const relative=asset.source.replace('npm:@mediapipe/tasks-vision@0.10.18/','');
  bytes=await readFile(`node_modules/@mediapipe/tasks-vision/${relative}`);
 }else{
  const url=asset.source.replace('https://github.com/RedForestAI/WebEyeTrack/blob/','https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/');
  const response=await fetch(url);if(!response.ok)throw Error(`Asset fetch failed: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());
 }
 if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error(`Upstream asset differs from the reviewed pin: ${asset.path}`);
 await mkdir(path.dirname(asset.path),{recursive:true});await writeFile(asset.path,bytes);
}
console.log('Restored only checksum-matching pinned WebEyeTrack assets.');
