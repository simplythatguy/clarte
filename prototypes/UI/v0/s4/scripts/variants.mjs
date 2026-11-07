#!/usr/bin/env node
/** Screens under the settings that change layout pressure: 200% text, dark theme, 1280×720. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [url = 'http://localhost:5104', outDir = 'evidence'] = process.argv.slice(2);
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const cases = [
  { name: 'speech-error-200-1280', w: 1280, h: 720, phase: 'composing-ready', scale: 2, notice: true },
  { name: 'text200-composing-pending', w: 1440, h: 900, phase: 'composing-pending', scale: 2 },
  { name: 'text200-listening', w: 1440, h: 900, phase: 'listening', scale: 2 },
  { name: 'text200-menu-phrases', w: 1440, h: 900, phase: 'menu-phrases', scale: 2 },
  { name: 'text200-more-1280', w: 1280, h: 720, phase: 'more', scale: 2 },
  { name: 'text200-speaking-1280', w: 1280, h: 720, phase: 'speaking', scale: 2 },
  { name: 'dark-composing-pending', w: 1440, h: 900, phase: 'composing-pending', theme: 'dark' },
  { name: 'dark-speaking', w: 1440, h: 900, phase: 'speaking', theme: 'dark' },
  { name: 'spell-pairs', w: 1440, h: 900, phase: 'spell-pairs' },
  { name: 'calibration-ready', w: 1440, h: 900, phase: 'calibration-ready' },
  { name: '1280-composing-ready', w: 1280, h: 720, phase: 'composing-ready' },
];
// Every phase at 200% on the smaller viewport: the strictest height budget.
const PHASES = ['idle', 'listening', 'composing-pending', 'composing-unknown', 'composing-ready', 'more', 'more-idle', 'speaking', 'spoken', 'menu', 'menu-settings', 'menu-settings-more', 'menu-demo', 'menu-phrases', 'menu-phrases-more', 'spell', 'spell-pairs', 'spell-letters', 'calibration-ready'];
for (const phase of PHASES) cases.push({ name: `all200-${phase}`, w: 1280, h: 720, phase, scale: 2, quiet: true });
let failures = 0;
for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h }, reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((c) => {
    window.clarteDebug.setPhase(c.phase);
    window.clarteDebug.settings({ ...(c.scale ? { textScale: c.scale } : {}), ...(c.theme ? { theme: c.theme } : {}) });
  }, c);
  await page.waitForTimeout(250);
  if (c.notice) await page.evaluate(() => window.clarteDebug.replace({ ...window.clarteDebug.state(), notice: 'speech-failed' }));
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => window.clarteDebug.phase());
  if (shown !== c.phase) { console.log(`FAIL ${c.name}: expected phase ${c.phase}, showing ${shown}`); failures++; }
  // Overlap check: every label stays inside its tile; the rest content stays inside the rest zone.
  const problems = await page.evaluate(() => {
    const out = [];
    for (const tile of document.querySelectorAll('.tile')) {
      const t = tile.getBoundingClientRect();
      for (const el of tile.querySelectorAll('.content-in .label, .content-in .value, .content-in .ring, .content-in .letters, .content-in .pips')) {
        const r = el.getBoundingClientRect();
        if (r.left < t.left - 1 || r.right > t.right + 1 || r.top < t.top - 1 || r.bottom > t.bottom + 1) out.push(`${tile.dataset.action}: ${el.className} overflows`);
      }
    }
    // The rest zone: its children stay inside it, and no word in the message is cut by the clip.
    const rest = document.querySelector('.rest')?.getBoundingClientRect();
    if (rest) for (const el of document.querySelectorAll('.rest-inner > *')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > rest.bottom + 1 || r.right > rest.right + 1) out.push(`${el.className} leaves the rest zone`);
    }
    const message = document.querySelector('.message');
    if (message && message.textContent && message.clientHeight < parseFloat(getComputedStyle(message).lineHeight) - 1) out.push(`the message shows less than one line (${message.clientHeight}px)`);
    if (message) {
      const m = message.getBoundingClientRect();
      for (const el of message.querySelectorAll('.m-word, .glyph')) {
        for (const r of el.getClientRects()) {
          const inside = r.top >= m.top - 1 && r.bottom <= m.bottom + 1;
          const outside = r.bottom <= m.top + 1 || r.top >= m.bottom - 1;
          if (!inside && !outside) { out.push(`"${el.textContent}" is cut by the message edge`); break; }
        }
      }
    }
    const v = window.clarteDebug.validate();
    if (v.length) out.push(`violations ${JSON.stringify(v)}`);
    return out;
  });
  if (problems.length) failures++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? ' ' + problems.join('; ') : ''}`);
  if (!c.quiet || problems.length) await page.screenshot({ path: join(outDir, `${c.name}.png`) });
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
