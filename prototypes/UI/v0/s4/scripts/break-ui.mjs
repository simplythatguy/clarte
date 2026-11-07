#!/usr/bin/env node
/**
 * break-ui: the realistic worst case for every value the screen renders, through the same
 * boundary the demo data uses (the app state), with a check and a screenshot for each.
 *
 *   node scripts/break-ui.mjs http://localhost:5104 evidence/break-ui
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104', outDir = 'evidence/break-ui'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(outDir, { recursive: true });

const groupsOf = (w) => [...w.toLowerCase()].map((c) => ('abcdef'.includes(c) ? 'G1' : 'ghijklmn'.includes(c) ? 'G2' : 'opqrs'.includes(c) ? 'G3' : 'G4'));
const word = (text) => ({ text, groups: groupsOf(text), candidateIndex: 0, source: 'decoded' });
const LONG_PARTNER = 'The nurse said the appointment with the neurologist moved to Thursday at a quarter past three, and she asked whether you would rather go in the morning instead because the afternoon clinic is always running late, so should I call them back?';
const cases = {
  'longest-candidate': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'ready' }, composition: { words: [word('i'), word('feel')], pending: groupsOf('uncomfortable'), candidateIndex: 0, reopened: false } }),
  'twelve-groups-no-word': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'ready' }, composition: { words: [word('call')], pending: Array(12).fill('G4'), candidateIndex: 0, reopened: false } }),
  'long-spelled-name': (s) => ({ ...s, view: { kind: 'spell', word: 'Wisniewskakowalczyk', level: { kind: 'groups' }, from: 'menu' }, activity: { kind: 'ready' } }),
  'long-partner-turn': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'ready' }, partner: LONG_PARTNER, composition: { words: ['yes', 'please', 'call', 'them'].map(word), pending: [], candidateIndex: 0, reopened: false } }),
  'long-partner-listening': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'listening', scripted: true, held: true }, partner: `${LONG_PARTNER} ${LONG_PARTNER}`, composition: { words: [], pending: [], candidateIndex: 0, reopened: false } }),
  'long-message': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'ready' }, composition: { words: 'i would rather go in the morning because the afternoon makes me very tired and my legs hurt more after lunch so please ask them for nine'.split(' ').map(word), pending: [], candidateIndex: 0, reopened: false } }),
  'one-letter-message': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'ready' }, partner: '', composition: { words: [word('i')], pending: [], candidateIndex: 0, reopened: false } }),
  'speaking-long-message-late-word': (s) => ({ ...s, view: { kind: 'talk' }, activity: { kind: 'speaking', held: true, index: 24, text: 'i would rather go in the morning because the afternoon makes me very tired and my legs hurt more after lunch so please ask them for nine' }, composition: { words: [], pending: [], candidateIndex: 0, reopened: false } }),
};

const browser = await chromium.launch();
const results = [];
for (const [scale, viewport] of [[1, { width: 1440, height: 900 }], [2, { width: 1280, height: 720 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${url}/?phase=idle`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const [name, build] of Object.entries(cases)) {
    const base = await page.evaluate(() => window.clarteDebug.state());
    const next = build(base);
    await page.evaluate((state) => window.clarteDebug.replace(state), { ...next, settings: { ...next.settings, textScale: scale } });
    await page.waitForTimeout(450);
    const problems = await page.evaluate(() => {
      const out = [];
      for (const tile of document.querySelectorAll('.tile')) {
        const t = tile.getBoundingClientRect();
        for (const el of tile.querySelectorAll('.content-in .label, .content-in .value, .content-in .letters')) {
          const r = el.getBoundingClientRect();
          if (r.left < t.left - 1 || r.right > t.right + 1 || r.bottom > t.bottom + 1) out.push(`${tile.dataset.action} "${el.textContent}" overflows its card`);
        }
      }
      const rest = document.querySelector('.rest')?.getBoundingClientRect();
      if (rest) for (const el of document.querySelectorAll('.rest-inner *')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > rest.right + 2 || r.left < rest.left - 0.16 * parseFloat(getComputedStyle(el).fontSize) - 1)) { out.push(`"${el.textContent.slice(0, 30)}" leaves the rest zone horizontally`); break; }
      }
      const spoken = document.querySelector('.is-spoken');
      const message = document.querySelector('.message')?.getBoundingClientRect();
      if (spoken && message) { const r = spoken.getBoundingClientRect(); if (r.top < message.top - 1 || r.bottom > message.bottom + 1) out.push('the spoken word is out of view'); }
      return out;
    });
    const file = `${name}-${viewport.width}-${scale * 100}.png`;
    await page.screenshot({ path: join(outDir, file) });
    results.push({ name, viewport: `${viewport.width}x${viewport.height}`, scale, problems });
    console.log(`${problems.length ? 'BREAK' : 'ok   '} ${name} ${viewport.width}x${viewport.height} ${scale * 100}%${problems.length ? ': ' + problems.join('; ') : ''}`);
  }
  await page.close();
}
await browser.close();
