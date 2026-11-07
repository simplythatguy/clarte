import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice('--origin='.length) ?? 'http://localhost:4318';
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length) ?? '.artifacts/http-check.json';
const url = new URL(origin);
assert(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === origin, 'Use a loopback HTTP origin without a trailing slash.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=await fetch(origin);assert(root.ok);
const html=await root.text();
assert.equal(hash(html),hash(await readFile('dist/index.html')),'Preview is not serving this dist');
const build=JSON.parse(await readFile('public/vendor/webeyetrack/BUILD.json','utf8'));
const paths=await Promise.all([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(async m=>({path:m[1],sha256:hash(await readFile('dist'+m[1]))})));
paths.push(...build.files.filter(f=>!f.path.endsWith('.map')).map(f=>({path:f.path.replace('public',''),sha256:f.sha256})));
const results=[];
for(const file of paths){
 const response=await fetch(origin+file.path);assert(response.ok,`${file.path}: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());const sha256=hash(bytes);
 if(file.sha256)assert.equal(sha256,file.sha256,file.path);
 if(file.path.endsWith('.wasm'))assert(response.headers.get('content-type')?.includes('application/wasm'));
 results.push({path:file.path,status:response.status,sha256,bytes:bytes.length});
}
const csp=root.headers.get('content-security-policy');
const runtimeReady=!!csp?.includes("worker-src 'self'");
const head = await fetch(origin, { method: 'HEAD' });
const post = await fetch(origin, { method: 'POST', body: 'synthetic method check' });
assert(head.ok && post.status === 405 && post.headers.get('allow') === 'GET, HEAD', 'Expected static GET/HEAD service and POST rejection.');
const report={origin,checkedAt:new Date().toISOString(),distServed:true,assetsPass:true,runtimeReady,csp,files:results,headStatus:head.status,postStatus:post.status,
 limitation:'HTTP hash/policy checks only; separate browser and physical-camera verification apply.'};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(`PASS: current dist and ${results.length} local app/model/runtime/license assets served with matching hashes; HEAD ${head.status}, POST ${post.status}.`);
if(!runtimeReady){console.error(`BLOCKED: ${origin} must send worker-src 'self'. See ${output}.`);process.exitCode=2;}
