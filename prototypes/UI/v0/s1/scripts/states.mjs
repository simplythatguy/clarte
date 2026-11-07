#!/usr/bin/env node
/**
 * Extra states the layout checker does not reach: a long pending word at 200% text on the
 * smaller viewport, the voice-failure band, the dark theme, and dwell under reduced motion.
 *
 *   node scripts/states.mjs http://localhost:5101 evidence/states
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [url = 'http://localhost:5101', out = 'evidence/states'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function open(viewport, settings, options = {}) {
  const page = await browser.newPage({ viewport, ...options });
  await page.goto(`${url}/?partner=script`);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('clarte.style1.calibrated', '1'); localStorage.setItem('clarte.style1.settings', JSON.stringify(s)); }, settings);
  await page.reload();
  await page.waitForFunction(() => window.clarteDebug);
  return page;
}

// "appointment" is eleven groups: at 200% on 1280×720 the word in progress must wrap, not clip.
{
  const page = await open({ width: 1280, height: 720 }, { textScale: 2 });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-empty'));
  for (const key of ['5', '7', '7', '7', '6', '6', '8', '6', '5', '6', '8']) { await page.keyboard.press(key); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  const fit = await page.evaluate(() => {
    const band = document.querySelector('.middle').getBoundingClientRect();
    const tokens = [...document.querySelectorAll('.message .glyph')].map((t) => t.getBoundingClientRect());
    const partner = document.querySelector('.partner')?.getBoundingClientRect();
    return { tokens: tokens.length, outside: tokens.filter((r) => r.right > band.right + 1 || r.left < band.left - 1).length, partnerVisible: Boolean(partner && partner.top >= band.top - 1 && partner.bottom <= band.bottom + 1) };
  });
  console.log('200% long word at 1280×720:', JSON.stringify(fit));
  await page.screenshot({ path: join(out, 'text-200-long-word-1280.png') });
  await page.close();
}

// A voice failure keeps the message and says so in the band.
{
  const page = await open({ width: 1440, height: 900 }, {});
  await page.evaluate(() => window.clarteDebug.setPhase('page2'));
  await page.evaluate(() => {
    const original = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => { setTimeout(() => u.onerror?.({ error: 'synthesis-failed' }), 50); void original; };
  });
  await page.keyboard.press('1');
  await page.waitForTimeout(800);
  console.log('after voice failure:', await page.evaluate(() => [window.clarteDebug.phase(), document.querySelector('.pill')?.textContent, document.querySelector('.message')?.textContent?.slice(0, 20)].join(' · ')));
  await page.screenshot({ path: join(out, 'voice-failed.png') });
  await page.close();
}

// Dark theme, and dwell under reduced motion (a colour ramp, no shape change).
{
  const page = await open({ width: 1440, height: 900 }, { theme: 'dark' }, { reducedMotion: 'reduce' });
  await page.evaluate(() => window.clarteDebug.setPhase('composing-pending'));
  for (let t = 0; t < 8; t++) { await page.mouse.move(540 + (t % 2) * 4, 775); await page.waitForTimeout(60); }
  await page.screenshot({ path: join(out, 'dark-reduced-motion-dwell.png') });
  await page.evaluate(() => window.clarteDebug.setPhase('listening'));
  await page.mouse.move(720, 470);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'dark-listening.png') });
  await page.close();
}
await browser.close();
