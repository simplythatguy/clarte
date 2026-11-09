import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin=process.argv[2]??'http://localhost:5200';
const out=process.argv[3]??'../../reports/centre-implementation';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined,args:['--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[];
const trackerStub=`export * from '/src/eyes/session.ts?centre-real';export const eyesDrive=()=>true;export const faceInView=()=>true;export const eyesStatus=()=>({kind:'tracking',calibratedAt:1});export const useEyesStatus=eyesStatus;export const cancelRun=async()=>{};export const prepareRun=async()=>{};export const startEyes=async()=>{};`;
async function pageFor(gaze=false,denied=false){
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.setDefaultNavigationTimeout(60000);page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));
 if(gaze)await page.route('**/src/eyes/session.ts',route=>route.fulfill({contentType:'application/javascript',body:trackerStub}));
 await page.addInitScript(({denied})=>{
  window.__spoken=0;window.speechSynthesis.speak=()=>window.__spoken++;
  localStorage.setItem('clarte.v1',JSON.stringify({setupDone:true,settings:{mode:'dwell',sound:'off',orbMotion:'still'}}));
  window.__captures=0;window.__stops=0;
  navigator.mediaDevices.getUserMedia=async()=>{
   window.__captures++;
   if(denied)throw new DOMException('Microphone denied','NotAllowedError');
   const audio=new AudioContext(),gain=audio.createGain(),tone=audio.createOscillator(),dest=audio.createMediaStreamDestination();
   tone.frequency.value=500;gain.gain.value=0.00005;tone.connect(gain).connect(dest);tone.start();await audio.resume();
   window.__level=v=>gain.gain.setValueAtTime(v,audio.currentTime);
   for(const track of dest.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.__stops++;stop();void audio.close()}};
   return dest.stream;
  };
 },{denied});
 await page.goto(`${origin}/?${gaze?'':'input=mouse&'}onboarding=off&engine=off`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.clarteDebug));
 return page;
}
async function typeWant(p){for(const key of ['8','5','6','8'])await p.keyboard.press(key);await p.locator('.centre-word').waitFor();}
async function gazeAt(p,x,y){await p.evaluate(({x,y})=>{clearInterval(window.__sample);const e=window.clarteDebug.engine;e.configure({holdMs:0,smoothing:1,deadBand:0});e.sample(x,y);window.__sample=setInterval(()=>e.sample(x,y),25)},{x,y});}
try{
 console.log('pointer');const p=await pageFor();
 assert.equal(await p.locator('.centre-word').count(),0);
 await typeWant(p);await p.mouse.move(700,300);await p.waitForTimeout(1900);
 assert.equal(await p.evaluate(()=>window.clarteDebug.phase()),'composing-options');
 assert.equal(await p.evaluate(()=>window.__captures),0,'pointer input must not start the microphone');
 assert.equal(await p.locator('.centre-activate').getAttribute('aria-label'),'Accept want');
 const idle=await p.locator('.centre-word').evaluate(el=>{
  const read=node=>({outline:getComputedStyle(node).outlineWidth,radius:getComputedStyle(node).borderRadius,handle:getComputedStyle(node,'::before').width,height:node.getBoundingClientRect().height});
  const reference=document.createElement('span');reference.className='word in-progress';reference.textContent='Want';el.parentElement.append(reference);
  const original=read(reference),actual=read(el);reference.remove();return{original,actual};
 });
 assert.deepEqual(idle.actual,idle.original,'the reference outline and handles stay intact');
 assert.deepEqual(await p.evaluate(()=>window.clarteDebug.validate()),[]);
 await p.locator('.centre-word').click();await p.getByRole('button',{name:'Speak',exact:true}).waitFor();
 assert.equal(await p.locator('.centre-word').count(),0);assert.equal(await p.evaluate(()=>window.__spoken),0);
 await p.waitForTimeout(1100);assert.equal(await p.evaluate(()=>window.clarteDebug.phase()),'composing-ready');
 results.push('Pointer: no shortcut before entry, no dwell acceptance or microphone capture, one click accepts once without speech; original outline/handles unchanged.');
 await p.close();

 console.log('gaze');const g=await pageFor(true);await typeWant(g);
 await g.waitForFunction(()=>typeof window.__level==='function');
 await gazeAt(g,100,650);await g.waitForTimeout(120);await g.evaluate(()=>window.__level(.06));await gazeAt(g,700,300);
 await g.waitForFunction(()=>document.querySelector('.centre-word')?.hasAttribute('data-centre-ready'));
 assert.equal(await g.evaluate(()=>window.clarteDebug.phase()),'composing-options','an ongoing sound begun outside the centre cannot carry into acceptance');
 await g.evaluate(()=>window.__level(.00005));await g.waitForTimeout(750);
 const frozen=await g.locator('.centre-activate').getAttribute('aria-label');
 await g.evaluate(async()=>{const {seed,setEngine}=await import('/src/prediction/prediction.ts');const prediction={source:'engine',offset:0,total:2,longer:0,words:[{word:'wait',p:.99,complete:true},{word:'want',p:.01,complete:true}]};seed({history:[],message:[],groups:'4124',offset:0},prediction);seed({history:[],message:[],groups:'4124',offset:0,complete:true,limit:20},prediction);setEngine('http://127.0.0.1:1');setEngine(null)});
 await g.waitForTimeout(100);assert.equal(await g.locator('.centre-activate').getAttribute('aria-label'),frozen,'late predictions cannot replace the armed word');
 await g.screenshot({path:path.join(out,'ready.png')});
 await g.evaluate(()=>window.__level(.06));
 await g.getByRole('button',{name:'Speak',exact:true}).waitFor();
 assert.equal(await g.locator('.rest-entering .word:not(.in-progress)').first().innerText(),'Want');
 assert.equal(await g.evaluate(()=>window.__spoken),0);
 assert.equal(await g.evaluate(()=>window.__captures),1,'centre and card controls share one microphone');await g.waitForTimeout(1100);
 assert.equal(await g.evaluate(()=>window.clarteDebug.phase()),'composing-ready');
 results.push('Synthetic gaze + real Web Audio graph: readiness waits without auto-accepting in dwell mode; late ranking stays frozen; one tone onset accepts the displayed word once through the shared matcher and microphone.');
 await g.close();

 console.log('denied');const denied=await pageFor(true,true);await typeWant(denied);await denied.getByText('Sound confirmation unavailable. Use Options.',{exact:true}).waitFor();
 await gazeAt(denied,700,300);await denied.waitForTimeout(1900);assert.equal(await denied.evaluate(()=>window.clarteDebug.phase()),'composing-options');
 await denied.getByRole('button',{name:/^Options:/}).click();await denied.waitForFunction(()=>window.clarteDebug.phase()==='options');
 assert.equal(await denied.locator('.rest-entering .centre-word').count(),0);
 assert.equal(await denied.evaluate(async()=>{const{collectActionables}=await import('/src/core/quadrants.ts');return collectActionables().some(a=>a.id==='accept-centre')}),false);
 results.push('Denied microphone never falls back to centre dwell; Options remains available and the outgoing word is inert.');await denied.close();

 for(const viewport of [{width:1440,height:900},{width:1280,height:720}])for(const scale of [1,2]){
  const page=await pageFor();await page.setViewportSize(viewport);await typeWant(page);
  await page.evaluate(async scale=>{document.documentElement.style.setProperty('--scale',String(scale));document.documentElement.toggleAttribute('data-large',scale>1);const{fitCards}=await import('/src/fit.ts');fitCards()},scale);
  await page.waitForTimeout(500);assert.deepEqual(await page.evaluate(()=>window.clarteDebug.validate()),[]);
  const rect=await page.locator('.centre-word').boundingBox();assert.ok(rect&&rect.x>=viewport.width/4&&rect.x+rect.width<=viewport.width*3/4&&rect.y+rect.height<=viewport.height/2);
  await page.mouse.move(viewport.width*.1,viewport.height*.49);
  await page.screenshot({path:path.join(out,`${viewport.width}-centre-${scale}x.png`)});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'results.json'),JSON.stringify({results,errors,limits:'Camera stream is stubbed; audio is a synthetic oscillator through a real MediaStream and analyser. No participant or real-room sound accuracy measured.'},null,2));console.log(results.join('\n'));
}finally{if(errors.length)console.error(errors);await browser.close()}
