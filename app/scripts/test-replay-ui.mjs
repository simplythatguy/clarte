import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(60000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.utterances=[];Object.defineProperty(speechSynthesis,'getVoices',{value:()=>[{lang:'en-US'}]});Object.defineProperty(speechSynthesis,'speak',{value:u=>{window.utterances.push({text:u.text,rate:u.rate,lang:u.lang});u.onstart?.();setTimeout(()=>u.onend?.(),300);}});});
 await page.goto(`${process.argv[2] ?? 'http://localhost:5200'}/?input=mouse&onboarding=off&engine=off`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.clarteDebug); 
 for(const key of ['8','5','6','8'])await page.keyboard.press(key);
 await page.getByRole('button',{name:/^Options:/}).click();
 await page.getByRole('button',{name:'Accept want',exact:true}).click();
 await page.getByRole('button',{name:'Speak',exact:true}).click();
 const replay=page.getByRole('button',{name:/^Speak again: Want/});await replay.waitFor(); 
 const original=await page.evaluate(()=>window.utterances.at(-1));
 const count=await page.locator('.rest-entering .turn-me').count();
 await replay.click();await page.getByRole('button',{name:'Stop',exact:true}).waitFor();assert.equal(await replay.isDisabled(),true);
 await page.getByRole('button',{name:'Say again',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.utterances.at(-1)),original);
 assert.equal(await page.locator('.rest-entering .turn-me').count(),count);
 await page.keyboard.press('5');const draft=await page.locator('.rest-entering .now').innerText();
 for(const key of ['Enter','Space']){
 await replay.focus();await page.keyboard.press(key);await page.getByRole('button',{name:'Stop',exact:true}).waitFor();
 if(key==='Enter')await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.rest-entering .turn-replay:disabled'));
 assert.equal(await page.locator('.rest-entering .now').innerText(),draft);
 assert.deepEqual(await page.evaluate(()=>window.utterances.at(-1)),original);
 assert.equal(await page.locator('.rest-entering .turn-me').count(),count);
 }
 assert.deepEqual(await page.evaluate(()=>window.clarteDebug.validate()),[]);
 for(const [width,height] of [[1440,900],[1280,720]]){await page.setViewportSize({width,height});await page.screenshot({path:`evidence/replay-${width}.png`});}
 assert.deepEqual(errors,[]);console.log('PASS: click/Enter/Space replay matches original speech; Stop, draft, history and gaze mapping preserved.');
}finally{await browser.close();}



