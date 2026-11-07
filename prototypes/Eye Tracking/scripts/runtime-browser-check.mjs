// Isolated test server only; the shared preview process is never changed or stopped.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const evidenceRoot = process.argv.find(arg => arg.startsWith('--evidence-root='))?.split('=')[1] ?? 'evidence/minimal-flow';
await mkdir(evidenceRoot, {recursive:true});
const savedKey='still.local-calibration.v1';
const fixtureLearned={weights:[[518,16],[16],[16,16],[16],[16,2],[2]].map(shape=>Array(shape.reduce((a,b)=>a*b,1)).fill(.01)),affine:[1,0,0,0,1,0],faceWidthCm:15};
const fixtureWorker = `self.fixture={face:true,eyeState:'open',point:[0,0],raw:[0,0],trainDelay:1200};self.audit={labels:0,trains:0,restores:0,collects:[]};self.onmessage=async({data})=>{let value=null;const facePresent=self.fixture.face;const eyeState=facePresent?self.fixture.eyeState:'unknown';const valid=facePresent&&eyeState==='open';if(data.type==='step')value={at:data.payload.at,face:valid,open:valid,facePresent,eyeState,normPog:valid?self.fixture.point:[0,0],rawNormPog:valid?self.fixture.raw:null};if(data.type==='collect'){value=true;self.audit.labels++;self.audit.collects.push(data.payload);}if(data.type==='train'){self.audit.trains++;await new Promise(resolve=>setTimeout(resolve,self.fixture.trainDelay));}if(data.type==='exportCalibration')value=${JSON.stringify(fixtureLearned)};if(data.type==='restoreCalibration'){value=true;self.audit.restores++;}self.postMessage({id:data.id,value});};`;
// Chromium's ephemeral fake device IDs rotate on reload. Keep only this synthetic identity stable.
function stableSyntheticCameraIdentity() {
  const original=MediaStreamTrack.prototype.getSettings;
  MediaStreamTrack.prototype.getSettings=function(){const settings=original.call(this);return this.kind==='video'?{...settings,deviceId:'playwright-synthetic-camera'}:settings;};
}


const builtHtml = await readFile('dist/index.html','utf8');
const policy = builtHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
if(!policy)throw Error('Built CSP missing');
const csp = policy[1] + "; frame-ancestors 'none'";
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.txt':'text/plain' };
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', csp); res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const file = path.resolve('dist', '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if (!file.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const bytes = await readFile(file); res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, debugPage;
const requests=[], errors=[], captures=[], results=[];
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const capture=async(page,label)=>{const file=`${evidenceRoot}/${label}.png`;await page.screenshot({path:file});captures.push(file);};
try {
  browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1280,height:800},permissions:['camera'],hasTouch:true});
  context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const page=await context.newPage();debugPage=page;page.on('pageerror',e=>errors.push(e.message));
  const openMenu=async()=>{await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();};
  const settings=async()=>{await openMenu();await page.getByRole('button',{name:'Settings',exact:true}).click();};
  await page.goto(origin);await capture(page,'desktop-start');
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await page.getByRole('heading',{name:'Calibrate',exact:true}).waitFor({timeout:90000});
  await page.waitForTimeout(1500);
  const tracks=await page.evaluateHandle(()=>document.querySelector('video').srcObject.getTracks());
  const stores=await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,db:(await indexedDB.databases()).length}));
  ensure(!stores.local&&!stores.session&&!stores.db,'Unexpected runtime storage');
  await settings();await page.getByRole('dialog').getByRole('button',{name:'Recalibrate',exact:true}).click();await page.getByRole('heading',{name:'Calibrate',exact:true}).waitFor({timeout:90000});
  ensure(await tracks.evaluate(tracks=>tracks.every(t=>t.readyState==='live'&&document.querySelector('video').srcObject.getTracks().includes(t))),'Reset lost owned camera tracks');
  const denied=await page.evaluate(async()=>(await Promise.allSettled([fetch('https://example.com/forbidden'),fetch('/api/upload',{method:'POST',body:'synthetic boundary check'})])).every(r=>r.status==='rejected'));
  ensure(denied,'Network guard failed');
  await openMenu();await page.getByRole('button',{name:'Stop',exact:true}).click();
  ensure(await tracks.evaluate(tracks=>tracks.every(t=>t.readyState==='ended')),'Stop leaked owned tracks');await tracks.dispose();
  ensure(await page.locator('video').count()===0,'Stop leaked video');
  results.push({scope:'Real shipped worker/model with synthetic camera; no human face/accuracy',modelLoaded:true,resetKeptTracks:true,stopReleasedTracks:true,stores,networkGuard:denied});
  console.log('PASS actual local worker/model load, owned track reset/stop, storage and network guard');
  if(process.argv.includes('--ui')){
    await context.addInitScript(stableSyntheticCameraIdentity);await page.evaluate(stableSyntheticCameraIdentity);
    await page.route('**/vendor/webeyetrack/worker.js',route=>route.fulfill({contentType:'text/javascript',body:fixtureWorker}));
    const audit=()=>page.workers()[0].evaluate(()=>self.audit);
    const setWorker=values=>page.workers()[0].evaluate(values=>Object.assign(self.fixture,values),values);
    const visibleText=()=>page.locator('main').innerText();
    const dotOnly=async(kind)=>{
      ensure((await visibleText()).trim()==='',`${kind} has visible content`);
      ensure(await page.locator('.dot-stage > div').count()===1,`${kind} needs exactly one circle`);
      ensure(await page.locator('video:visible').count()===0,`${kind} camera preview is visible`);
      ensure(await page.locator('main button:visible').count()===0,`${kind} toolbar is visible`);
      ensure(await page.getByRole('button',{name:'Toggle gaze diagnostics'}).count()===1,'Diagnostic toggle missing');
    };
    const geometry=()=>page.locator('[data-dwell]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.dwell,x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight})));
    const viewports=[['desktop',{width:1280,height:800}],['narrow',{width:390,height:844}]].filter(([label])=>!process.argv.includes('--only-narrow')||label==='narrow');
    for(const [label,size] of viewports){
      await page.setViewportSize(size);await page.reload();await page.getByRole('button',{name:'Start camera',exact:true}).waitFor();
      await page.evaluate(()=>localStorage.clear());await page.reload();await capture(page,`${label}-start`);
      await page.getByRole('button',{name:'Start camera',exact:true}).click();await page.getByRole('heading',{name:'Calibrate',exact:true}).waitFor();await page.waitForTimeout(900);await capture(page,`${label}-calibrate`);
      const firstStart=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'Calibrate',exact:true}).click();await page.getByRole('heading',{name:/Calibrate screen dimensions/}).waitFor();
      await capture(page,`${label}-screen-intro`);ensure((await audit()).labels===0,'Labels during three-second intro');
      await page.locator('.calibration-point').waitFor();ensure(await page.evaluate(()=>performance.now())-firstStart>=2900,'Short screen intro');await dotOnly('eye');await capture(page,`${label}-eyes-off`);
      const diagnostic=page.getByRole('button',{name:'Toggle gaze diagnostics'});ensure(await diagnostic.getAttribute('aria-pressed')==='false','Diagnostics default is not off');
      if(label==='narrow'){const icon=await diagnostic.boundingBox();await page.touchscreen.tap(icon.x+22,icon.y+22);}else{await diagnostic.focus();await page.keyboard.press('Space');}await page.locator('.gaze-area').waitFor();await dotOnly('eye with diagnostics');await capture(page,`${label}-eyes-diagnostics-on`);
      const point=await page.locator('.calibration-point').boundingBox(),icon=await diagnostic.boundingBox();ensure(point.y>icon.y+icon.height||point.x+point.width<icon.x,'Diagnostic control overlaps calibration target');
      await diagnostic.click();ensure(await page.locator('.gaze-area').count()===0,'Toggle off left marker');
      // Touch on the empty calibration background is a deliberate pause.
      await page.touchscreen.tap(10,100);await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();const paused=await audit();await page.waitForTimeout(800);ensure((await audit()).labels===paused.labels,'Paused capture advanced');await capture(page,`${label}-paused`);
      await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('.calibration-point').waitFor();await page.waitForTimeout(1000);ensure((await audit()).labels===paused.labels,'Resume skipped full movement/settle');
      await page.getByRole('heading',{name:'Calibrate head movement',exact:true}).waitFor({timeout:45000});const eyes=await audit();ensure(eyes.labels===27&&eyes.trains===0,'Eye stage training/count incorrect');await capture(page,`${label}-head-ready`);
      console.log(`PASS ${label} eye stage: 27 labels, circle-only, touch pause, diagnostics`);
      await page.waitForTimeout(700);const headStart=await page.evaluate(()=>performance.now());await page.getByRole('button',{name:'Calibrate',exact:true}).click();await page.getByRole('heading',{name:/Follow with your head/}).waitFor();await capture(page,`${label}-head-intro`);
      await page.locator('.calibration-point').waitFor();ensure(await page.evaluate(()=>performance.now())-headStart>=2900,'Short head intro');await dotOnly('head');await capture(page,`${label}-head-off`);
      await diagnostic.click();await page.locator('.gaze-area').waitFor();await capture(page,`${label}-head-diagnostics-on`);await diagnostic.click();
      await page.getByRole('heading',{name:'Calibrating',exact:true}).waitFor({timeout:30000});await capture(page,`${label}-training`);ensure(await page.locator('[data-dwell]').count()===0,'Navigation before training ack');
      await page.getByRole('heading',{name:'Calibrate free flow movement',exact:true}).waitFor();const trained=await audit();ensure(trained.labels===42&&trained.trains===1,'Training count incorrect');
      const calls=trained.collects;ensure(new Set(calls.map(c=>c.at)).size===42,'Reused label frame');
      ensure(new Set(calls.slice(0,27).map(c=>`${c.x},${c.y}`)).size===9&&new Set(calls.slice(27).map(c=>`${c.x},${c.y}`)).size===5,'Missing 9+5 references');
      for(let i=0;i<14;i++){const group=calls.slice(i*3,i*3+3);ensure(group[1].at-group[0].at>=400&&group[2].at-group[1].at>=400,'Skipped fresh label spacing');if(i!==9&&i>0)ensure(group[0].at-calls[i*3-1].at>=1700,'Skipped movement/settle');}
      await capture(page,`${label}-freeflow-ready`);await page.getByRole('button',{name:'Calibrate',exact:true}).click();await page.getByRole('heading',{name:/Calibrate free flow movement ·/}).waitFor();await capture(page,`${label}-freeflow-intro`);
      await page.locator('.validation-dot').waitFor();await dotOnly('free flow');await capture(page,`${label}-freeflow-off`);
      await diagnostic.click();await page.locator('.gaze-area').waitFor();await capture(page,`${label}-freeflow-diagnostics-on`);
      await setWorker({eyeState:'closed'});await page.waitForTimeout(240);ensure(await page.locator('.gaze-area').count()===0,'Closed eyes left diagnostic marker');
      await setWorker({eyeState:'open'});await page.locator('.gaze-area').waitFor();await diagnostic.click();
      if(label==='narrow'){await page.locator('body').click({position:{x:10,y:70}});await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();await page.waitForTimeout(300);await page.getByRole('button',{name:'Continue',exact:true}).click();}
      console.log(`PASS ${label} head stage/training: 42 labels, three-second stages; frozen free flow running`);
      await page.locator('.navigation-grid').waitFor({timeout:65000});ensure((await audit()).labels===42&&(await audit()).trains===1,'Free flow trained model');
      ensure((await visibleText()).trim()==='','Navigation has visible text');ensure(await page.locator('[data-dwell]').count()===9,'Navigation target count');ensure(await page.locator('h1').count()===0,'Navigation heading visible');
      ensure(await page.locator('[data-dwell]').evaluateAll(nodes=>nodes.every(n=>n.tagName==='BUTTON'&&!n.textContent.trim()&&n.getAttribute('aria-label'))),'Blank targets lack names or have content');
      ensure(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),'Viewport overflows');
      const before=await geometry();await capture(page,`${label}-navigation-off`);const top=page.getByRole('button',{name:'Top target',exact:true});
      const box=await top.boundingBox();const pointNorm=[(box.x+box.width/2)/size.width-.5,(box.y+box.height/2)/size.height-.5];await setWorker({point:pointNorm,raw:pointNorm});await page.waitForTimeout(2350);
      ensure(await top.getAttribute('aria-pressed')==='false'&&!(await top.getAttribute('class')).includes('is-previewed'),'Preblink selection changed');
      await diagnostic.click();await page.locator('.gaze-area').waitFor();await capture(page,`${label}-navigation-diagnostics-on`);await diagnostic.click();
      const blink=async()=>{await setWorker({eyeState:'closed'});await page.waitForTimeout(180);await setWorker({eyeState:'open'});await page.waitForTimeout(650);};
      await blink();ensure((await top.getAttribute('class')).includes('is-previewed'),'First blink did not preview');ensure(await top.getAttribute('aria-pressed')==='false','First blink committed');await capture(page,`${label}-preview`);
      await blink();ensure(await top.getAttribute('aria-pressed')==='true','Second blink did not select');await capture(page,`${label}-selected`);
      const serial=await top.getAttribute('data-activation');await page.waitForTimeout(2300);await blink();ensure(await top.getAttribute('data-activation')===serial,'Latched blink repeated selection');
      ensure(JSON.stringify(await geometry())===JSON.stringify(before),'Selection moved target geometry');
      for(const target of await page.locator('[data-dwell]').all()){await target.click();ensure(await target.getAttribute('aria-pressed')==='true','Mouse target failed');}
      const touchTarget=page.getByRole('button',{name:'Left target',exact:true}),touchBox=await touchTarget.boundingBox();await page.touchscreen.tap(touchBox.x+touchBox.width/2,touchBox.y+touchBox.height/2);ensure(await touchTarget.getAttribute('aria-pressed')==='true','Touch target failed');
      await page.getByRole('button',{name:'Center target',exact:true}).focus();await page.keyboard.press('Enter');ensure(await page.getByRole('button',{name:'Center target',exact:true}).getAttribute('aria-pressed')==='true','Keyboard target failed');
      await diagnostic.focus();await page.keyboard.press('Enter');ensure(await diagnostic.getAttribute('aria-pressed')==='true','Keyboard diagnostic toggle failed');await page.locator('.gaze-area').waitFor();
      await setWorker({face:false});await page.waitForTimeout(250);ensure(await page.locator('.gaze-area').count()===0,'Loss left diagnostic marker');
      await page.getByRole('heading',{name:'Face not detected',exact:true}).waitFor({timeout:10000});await capture(page,`${label}-face-error`);await setWorker({face:true});await page.waitForTimeout(800);ensure(await page.getByRole('heading',{name:'Face not detected',exact:true}).count()===1,'Recovery resumed automatically');
      await page.getByRole('button',{name:'Continue',exact:true}).click();await diagnostic.click();
      await settings();await page.getByRole('button',{name:'Full screen',exact:true}).evaluate(button=>{document.documentElement.requestFullscreen=()=>Promise.reject(Error('Fixture denied fullscreen'));button.click();});
      await page.getByRole('button',{name:'Full screen unavailable',exact:true}).waitFor();await capture(page,`${label}-settings`);
      await page.getByRole('button',{name:'Stop',exact:true}).click();ensure(await page.locator('video').count()===0,'Fixture stop leaked video');
      await page.getByRole('button',{name:'Start camera',exact:true}).click();await page.getByRole('button',{name:'Use saved calibration',exact:true}).waitFor();await capture(page,`${label}-saved-choice`);
      await page.getByRole('button',{name:'Use saved calibration',exact:true}).click();await page.locator('.navigation-grid').waitFor();ensure((await audit()).restores===1&&(await audit()).labels===0,'Restore did not use worker learned weights');
      await settings();await page.getByRole('button',{name:'Delete saved calibration',exact:true}).click();ensure(await page.evaluate(key=>localStorage.getItem(key),savedKey)===null,'Delete retained saved model');await page.getByRole('button',{name:'Stop',exact:true}).click();
      results.push({viewport:label,size,labels:42,eyeReferences:9,headReferences:5,trainCalls:1,heldOutFrozen:true,blankTargets:9,touchPause:true,diagnostics:true,keyboard:true,positionsStable:true,savedRestoreAndDelete:true});
      console.log(`PASS ${label} navigation: blank 3x3, two blinks, latch, keyboard, diagnostics, recovery, saved restore/delete`);
    }
    // Real application camera error page, isolated from other context ownership.
    const errorPage=await context.newPage();await errorPage.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Fixture denied','NotAllowedError'));});
    for(const [label,viewport] of [['desktop',{width:1280,height:800}],['narrow',{width:390,height:844}]]){await errorPage.setViewportSize(viewport);await errorPage.goto(origin);await errorPage.getByRole('button',{name:'Start camera',exact:true}).click();await errorPage.getByRole('heading',{name:'Camera unavailable',exact:true}).waitFor();await capture(errorPage,`${label}-camera-error`);}
    await errorPage.close();
  }
  ensure(errors.length===0,`Browser errors: ${errors.join('; ')}`);ensure(requests.every(r=>r.url.startsWith(origin)&&r.method==='GET'),'External or write runtime request');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const build={htmlSha256:sha(builtHtml),assets:await Promise.all([...builtHtml.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(async match=>({path:match[1],sha256:sha(await readFile('dist'+match[1]))})))};
  await writeFile(`${evidenceRoot}/browser-report.json`,JSON.stringify({build,scope:'Actual local model load plus explicitly synthetic worker/camera UI fixtures; no physical gaze acceptance',origin,results,captures,errors,requests:[...new Map(requests.map(r=>[r.url,r])).values()]},null,2)+'\n');
  console.log(`PASS browser verification; ${captures.length} screenshots in ${evidenceRoot}`);
} catch(error) {
  if(debugPage&&!debugPage.isClosed()){await capture(debugPage,'failure');const state=await debugPage.evaluate(()=>({text:document.querySelector('main')?.innerText,hidden:document.hidden,focus:document.hasFocus(),video:document.querySelector('video')?.readyState}));console.error('Failure state',JSON.stringify(state),'workers',debugPage.workers().length,'errors',errors);}
  throw error;
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
