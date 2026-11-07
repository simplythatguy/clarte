// Reproduces only Chromium fake-device identity rotation; never accesses a physical camera.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const root=process.argv.find(arg=>arg.startsWith('--evidence-root='))?.split('=')[1]??'evidence/reading-pause';
await mkdir(root,{recursive:true});
const server=http.createServer((_request,response)=>response.end('<!doctype html><title>Synthetic camera geometry probe</title>'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({permissions:['camera']}),page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const capture=()=>page.evaluate(async()=>{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});try{return stream.getVideoTracks()[0].getSettings();}finally{stream.getTracks().forEach(track=>track.stop());}});
 const first=await capture(),sameDocument=await capture();await page.reload();const reloaded=await capture();
 const report={scope:'Chromium fake video device only, ephemeral context with granted permission. No physical camera.',first,sameDocument,reloaded,sameGeometry:first.width===reloaded.width&&first.height===reloaded.height,sameDocumentIdentity:first.deviceId===sameDocument.deviceId,reloadIdentityRotated:first.deviceId!==reloaded.deviceId,fix:'Only routed-worker browser tests normalize the fake video deviceId. Real camera identity/facing/aspect compatibility guards remain.'};
 await writeFile(`${root}/camera-fixture-geometry.json`,JSON.stringify(report,null,2)+'\n');
 if(!report.sameGeometry||!report.sameDocumentIdentity||!report.reloadIdentityRotated)throw Error('This browser did not reproduce the recorded fake-ID reload failure; inspect the receipt.');
 console.log('PASS: same 640x480 fake camera keeps its ID inside a document and rotates its ID after reload. Real camera guard unchanged.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
