// Against the Vite dev server: PLAYWRIGHT_CHANNEL=msedge node scripts/test-pinned-options-ui.mjs [origin] [evidence-dir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.argv[2] ?? 'http://127.0.0.1:5200';
const out = process.argv[3] ?? 'evidence/pinned-options';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const results = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__spoken = 0;
    window.speechSynthesis.speak = () => { window.__spoken += 1; };
    localStorage.setItem('clarte.v1', JSON.stringify({ setupDone: true, settings: { sound: 'off', mode: sessionStorage.getItem('pinned-test-mode') ?? 'dwell' } }));
  });
  const open = async () => {
    await page.goto(`${origin}/?input=mouse&onboarding=off&engine=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.clarteDebug), null, { timeout: 60000 });
    await page.mouse.move(700, 200);
    for (const key of ['8', '5', '6', '8']) await page.keyboard.press(key);
    await page.getByRole('button', { name: /^Options:/ }).waitFor();
  };
  const q4 = page.locator('.cell-q4 button');
  await open();
  const box = await q4.boundingBox();
  assert.ok(box);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, { delay: 90 });
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  assert.equal(await page.locator('.rest-entering .word:not(.in-progress)').first().innerText(), 'Want');
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.clarteDebug.phase()), 'composing-ready');
  assert.equal(await page.evaluate(() => window.__spoken), 0);
  results.push('Two clicks at the same Q4 coordinates open Options and accept the first word exactly once, without speech.');

  // Real dwell opens Options; continuing to look must not count as the second activation.
  await open();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.clarteDebug.phase()), 'options');
  assert.equal(await q4.getAttribute('data-action'), 'pick-0');
  assert.equal(await q4.getAttribute('aria-label'), 'Accept want');
  assert.equal(await page.evaluate(() => window.__spoken), 0);
  results.push('A continuous gaze opens the chooser once and cannot auto-accept the pinned word.');

  // A switch sending Space can make a fresh confirmation without moving gaze out of Q4.
  await page.keyboard.down('Space');
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  await page.keyboard.down('Space'); // native repeated keydown, not a fresh press
  await page.keyboard.up('Space');
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.clarteDebug.phase()), 'composing-ready');
  assert.equal(await page.evaluate(() => window.__spoken), 0);
  results.push('An explicit Space confirmation accepts the pinned choice with stationary gaze; key repeat cannot speak it.');

  for (const count of [1, 5, 6]) {
    await open();
    const choices = ['want', 'went', 'wait', 'tent', 'vent', 'welt'].slice(0, count);
    await page.evaluate(async words => {
      const { seed, setEngine } = await import('/src/prediction/prediction.ts');
      const prediction = { source: 'engine', offset: 0, total: words.length, longer: 0, branch: false,
        words: words.map((word, i) => ({ word, p: 1 / (i + 1), complete: true })) };
      seed({ history: [], message: [], groups: '4124', offset: 0 }, prediction);
      seed({ history: [], message: [], groups: '4124', offset: 0, complete: true, limit: 20 }, prediction);
      setEngine('http://127.0.0.1:1');
      setEngine(null);
    }, choices);
    await page.waitForFunction(n => window.clarteDebug.words().options.length === n, count);
    await page.keyboard.press('4');
    await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
    await page.waitForTimeout(700);
    assert.equal(await q4.getAttribute('data-action'), 'pick-0');
    assert.equal(await q4.getAttribute('aria-label'), 'Accept want');
    assert.equal(await page.locator('.pager [data-action="pick-0"]').count(), 0, 'pinned choice must not repeat below');
    if (count <= 5) {
      assert.equal(await page.locator('[data-action="page-next"]').count(), 0);
      for (let i = 1; i < count; i++) assert.equal(await page.locator(`.cell-q${i + 4} [data-action]`).getAttribute('data-action'), `pick-${i}`);
    } else {
      assert.equal(await page.locator('.cell-q8 [data-action]').getAttribute('data-action'), 'page-next');
      for (let i = 0; i < count - 3; i++) {
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.waitForTimeout(400);
        assert.equal(await q4.getAttribute('aria-label'), 'Accept want', 'paging must not move or replace the best word');
      }
      assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).getAttribute('aria-disabled'), 'true');
      assert.equal(await page.getByRole('button', { name: 'Previous', exact: true }).getAttribute('aria-disabled'), null);
    }
    assert.deepEqual(await page.evaluate(() => window.clarteDebug.validate()), []);
    await page.mouse.move(700, 200);
    await page.screenshot({ path: path.join(out, `choices-${count}.png`) });
    results.push(`${count} choices: pinned first word, correct bottom capacity/paging, no duplicated first choice or quadrant collision.`);
  }
  // Exercise two separate confirmations from a preview, including a held first key.
  await page.evaluate(() => sessionStorage.setItem('pinned-test-mode', 'confirm'));
  await open();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.clarteDebug.engine.snapshot.state === 'previewed');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
  await page.keyboard.down('Space');
  assert.equal(await page.evaluate(() => window.clarteDebug.phase()), 'options', 'held first confirmation must not accept');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.clarteDebug.engine.snapshot.looked === 'pick-0');
  assert.equal(await page.evaluate(() => window.clarteDebug.engine.settings.mode), 'confirm');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__spoken), 0);
  results.push('Two fresh Space confirmations from a gaze preview open and accept in Q4; holding the first key does not.');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'pinned-results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(out, 'pinned-failure.png') });
    await writeFile(path.join(out, 'pinned-failure.txt'), await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
