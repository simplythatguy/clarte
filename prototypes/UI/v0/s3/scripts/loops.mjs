#!/usr/bin/env node
/**
 * MOTION acceptance 10, the 50th-use test: the compose loop ten times in a row at real speed, with
 * the mouse as gaze. Each loop: the partner speaks (scripted) → Done → type "are"/"body" by gaze
 * (the decoder changes its candidate as groups arrive) → accept → Done → Speak → Spoken → Listen.
 * Writes evidence/loops.webm and evidence/loops.txt (loop start times, words, candidate changes).
 *
 *   node scripts/loops.mjs http://localhost:5103 evidence
 */
import { mkdirSync, renameSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5103', out = 'evidence'] = process.argv.slice(2);
const W = 1440, H = 900;
const tmp = join(out, '.video-loops');
mkdirSync(tmp, { recursive: true });
const Q = (n) => [W * (((n - 1) % 4) + 0.5) / 4, H * (n > 4 ? 0.75 : 0.25)];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: 720, height: 450 } } });
await context.addInitScript(() => localStorage.setItem('clarte.style3.calibrated', '1'));
const page = await context.newPage();
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1);
const wait = (ms) => page.waitForTimeout(ms);
const move = async (x, y) => page.mouse.move(x, y, { steps: 8 });
const look = async (n, ms) => { const [x, y] = Q(n); await move(x, y); await wait(ms); };
const rest = async (ms = 400) => { await move(W / 2, H * 0.12); await wait(ms); };
const phase = () => page.evaluate(() => window.clarteDebug.phase());
const until = async (prefix, ms = 15000) => page.waitForFunction((p) => window.clarteDebug.phase().startsWith(p), prefix, { timeout: ms });
const wip = () => page.evaluate(() => [...document.querySelectorAll('.layer[data-live] .wip .glyph-cell > .glyph')].map((g) => (g.textContent || '•') + (g.classList.contains('glyph--ghost') ? '~' : '')).join(''));

await page.goto(`${url}/?partner=script&phase=listen`, { waitUntil: 'networkidle' });
await page.keyboard.press('Shift');
await rest(600);
const log = [];
const words = [['are', [5, 7, 5]], ['body', [5, 7, 5, 8]]];
for (let loop = 1; loop <= 10; loop++) {
  const start = Number(at());
  await wait(4500);                              // the partner speaks
  await look(6, 1500);                           // Done (the wide card owns Q5–Q8)
  await until('compose');
  await rest(500);
  const [target, groups] = words[loop % 2];
  const seen = [];
  for (const n of groups) { await look(n, 1100); seen.push(await wip()); await rest(350); }
  await look(1, 1100);                           // accept the candidate
  await rest(500);
  await look(1, 1500);                           // Done → Speak
  await until('speak');
  await rest(500);
  await look(7, 1500);                           // Speak
  await until('spoken', 15000);
  await rest(600);
  await look(1, 1500);                           // Listen
  await until('listen');
  await rest(300);
  log.push(`loop ${String(loop).padStart(2)}  ${String(start).padStart(6)} s → ${at().padStart(6)} s  typed for "${target}": ${seen.join(' → ')}`);
}

await context.close();
await browser.close();
const video = readdirSync(tmp).find((f) => f.endsWith('.webm'));
renameSync(join(tmp, video), join(out, 'loops.webm'));
rmSync(tmp, { recursive: true, force: true });
const lines = ['Ten compose loops in a row (seconds into evidence/loops.webm; ~ marks a ghost letter):', ...log];
writeFileSync(join(out, 'loops.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
