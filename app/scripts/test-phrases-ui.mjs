import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const lint = process.env.LINTAPPLE_MODULE ? await import(pathToFileURL(process.env.LINTAPPLE_MODULE).href) : null;
const origin = process.argv[2] ?? 'http://localhost:5200';
const out = '../../.scratch/phrase-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  for (const [width, height] of [[1440, 900], [1280, 720]]) for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/phrases', (route) => route.fulfill({ json: [
      { text: 'Please help me.', uses: 4, prior: 1, follows: 2 },
      { text: 'Please hold.', uses: 2, prior: 0, follows: 1 },
      { text: 'Please hurry.', uses: 1, prior: 0, follows: 0 },
    ] }));
    await page.goto(`${origin}/?input=mouse&onboarding=off&engine=off`);
    await page.waitForFunction(() => Boolean(window.clarteDebug));
    await page.evaluate((s) => document.documentElement.style.setProperty('--scale', String(s)), scale);
    await page.keyboard.press('7'); // First group of "please".
    await page.waitForFunction(() => window.clarteDebug.words().phrases?.includes('Please hold'));
    const preview = page.locator('.rest-entering .phrase-preview:not([inert] *)');
    await preview.waitFor();
    assert.match(await preview.innerText(), /Please help me/);
    assert.equal(await preview.locator('button.centre-activate').count(), 1, 'phrase preview is directly selectable');
    assert.doesNotMatch(await preview.innerText(), /[.!?"“”]/);
    assert.equal(await page.locator('.rest-entering .word:not(.in-progress)').count(), 0);
    await page.screenshot({ path: `${out}/${width}-${scale}-preview.png` });
    const audit = async (state) => {
      if (!lint) return;
      const report = await lint.checkPage(page, {
        fonts: ['Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', 'sans-serif'],
        fontSizes: [20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96], typeRules: [],
        minControlSize: 20, viewports: [{ width, height }], colorSchemes: ['light'],
      });
      await writeFile(`${out}/${width}-${scale}-${state}-lint.json`, JSON.stringify(report, null, 2));
    };
    await audit('preview');
    await page.locator('[data-action="primary"]').click();
    await page.locator('[data-action="pick-0"]').waitFor();
    assert.match(await page.locator('[data-action="pick-0"]').innerText(), /Please help me/);
    assert.match(await page.locator('[data-action="pick-1"]').innerText(), /Please hold/);
    assert.match(await page.locator('[data-action="pick-2"]').innerText(), /Please hurry/);
    const third = await page.locator('[data-action="pick-2"]').boundingBox();
    assert.ok(third && third.x >= width / 2 && third.x + third.width <= width && third.y >= height / 2, 'all three phrases are visible together');
    assert.deepEqual(await page.evaluate(() => window.clarteDebug.validate()), []);
    await page.locator('[data-action="page-next"]').click();
    await page.locator('[data-action="page-prev"]').waitFor();
    await page.locator('[data-action="page-prev"]').click();
    await page.locator('[data-action="pick-2"]').waitFor();
    await page.screenshot({ path: `${out}/${width}-${scale}-options.png` });
    await audit('options');
    await page.locator('[data-action="back"]').click();
    await page.keyboard.press('8'); // No starter phrase begins P/T.
    await preview.waitFor({ state: 'hidden' });
    await page.keyboard.press('1'); // Delete extra group.
    await preview.waitFor();
    await page.locator('[data-action="primary"]').click();
    await page.locator('[data-action="pick-0"]').click();
    await page.waitForFunction(() => window.clarteDebug.phase() === 'composing-ready');
    assert.equal(await page.locator('.rest-entering .word:not(.in-progress)').innerText(), 'Please help me');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Phrase preview, three choices, acceptance, continued input and quadrant layout passed at both sizes and 200% text.');
} finally { await browser.close(); }
