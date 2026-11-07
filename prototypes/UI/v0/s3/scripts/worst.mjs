#!/usr/bin/env node
/**
 * break-ui: render the worst-case data (`?data=worst`) on every content screen at both viewports
 * and at 200% text, check that no tile label or rest-zone text leaves its box, and save shots.
 *
 *   node scripts/worst.mjs http://localhost:5103 out-dir
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out = 'evidence/worst'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const phases = ['listen', 'compose-pending', 'compose-message', 'speak', 'speaking', 'spoken', 'spell', 'spell-letters', 'menu-selection'];
const browser = await chromium.launch();
let broken = 0;
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`${url}/?partner=script&data=worst`, { waitUntil: 'networkidle' });
    if (scale === 2) {
      await page.evaluate(() => window.clarteDebug.setPhase('menu-display'));
      for (let i = 0; i < 4; i += 1) { await page.keyboard.press('1'); await page.waitForTimeout(120); }
    }
    for (const phase of phases) {
      await page.evaluate((p) => window.clarteDebug.setPhase(p), phase);
      await page.waitForTimeout(350);
      const problems = await page.evaluate(() => {
        const found = [];
        const layer = document.querySelector('.layer[data-live]');
        for (const t of layer.querySelectorAll('.tile')) {
          const r = t.getBoundingClientRect();
          for (const l of t.querySelectorAll('.swap:not(.swap--leaving) .tile__label, .tile__name')) {
            const b = l.getBoundingClientRect();
            if (b.left < r.left - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1) found.push(`label "${l.textContent}" leaves tile ${t.dataset.action}`);
          }
        }
        const rest = layer.querySelector('.rest');
        if (rest) {
          const r = rest.getBoundingClientRect();
          for (const el of rest.querySelectorAll('.text-window, .partner, .problem, .menu-title, .spelled')) {
            const b = el.getBoundingClientRect();
            if (b.right > r.right + 1 || b.bottom > r.bottom + 1) found.push(`${el.className} leaves the rest zone`);
          }
        }
        return found;
      });
      if (problems.length) broken += problems.length;
      console.log(`${problems.length ? 'BROKE' : 'held '} ${w}x${h} ${scale * 100}% ${phase}${problems.length ? ': ' + problems.join('; ') : ''}`);
      if (['compose-pending', 'speak', 'listen', 'spell'].includes(phase)) await page.screenshot({ path: join(out, `${w}x${h}-${scale * 100}-${phase}.png`) });
    }
    await page.close();
  }
}
await browser.close();
console.log(broken ? `${broken} break(s)` : 'worst case held everywhere');
