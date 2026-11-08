// Against a running app: PLAYWRIGHT_CHANNEL=msedge node scripts/test-options-ui.mjs [origin] [evidence-dir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.argv[2] ?? 'http://127.0.0.1:5200';
const out = process.argv[3] ?? 'evidence/options';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const errors = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  const open = async () => {
    await page.goto(`${origin}/?input=mouse&onboarding=off&engine=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.clarteDebug), null, { timeout: 60000 });
    await page.mouse.move(700, 200);
  };
  const typeWant = async () => {
    for (const key of ['8', '5', '6', '8']) await page.keyboard.press(key);
    await page.getByRole('button', { name: /^Options:/ }).waitFor();
  };
  const primary = () => page.locator('[data-action="primary"]');
  await open();
  await typeWant();
  assert.equal(await page.locator('.rest-entering .in-progress .typed').count(), 4);
  await page.screenshot({ path: path.join(out, 'want-options.png') });
  await primary().click();
  await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
  assert.equal(await page.locator('.rest-entering .word:not(.in-progress)').count(), 0, 'opening Options must not accept anything');
  await page.locator('[data-action="back"]').click();
  await page.getByRole('button', { name: /^Options:/ }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.in-progress .typed').length === 4);
  assert.equal(await page.locator('.rest-entering .in-progress .typed').count(), 4, 'Back preserves the full input');
  await primary().click();
  await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
  // Replacing prediction cache entries while reading must not change the frozen chooser.
  const visible = await page.locator('[data-action^="pick-"]').evaluateAll(els => els.map(el => [el.dataset.action, el.getAttribute('aria-label')]));
  await page.evaluate(async () => {
    const { seed } = await import('/src/prediction/prediction.ts');
    const changed = { source: 'engine', offset: 0, total: 2, longer: 0, branch: false,
      words: [{ word: 'wait', p: 0.999, complete: true }, { word: 'want', p: 0.001, complete: true }] };
    seed({ history: [], message: [], groups: '4124', offset: 0 }, changed);
    seed({ history: [], message: [], groups: '4124', offset: 0, complete: true, limit: 20 }, changed);
    // Notify through the same subscription path as a late engine answer.
    const { setEngine } = await import('/src/prediction/prediction.ts');
    setEngine('http://127.0.0.1:1');
    setEngine(null);
  });
  assert.deepEqual(await page.locator('[data-action^="pick-"]').evaluateAll(els => els.map(el => [el.dataset.action, el.getAttribute('aria-label')])), visible);
  await page.getByRole('button', { name: 'Accept want', exact: true }).click();
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  assert.match(await page.locator('.rest-entering .word:not(.in-progress)').first().innerText(), /^Want$/);
  results.push('Choosing the displayed word is stable despite a late reordered prediction.');
  await page.locator('[data-action="delete"]').click();
  await page.getByRole('button', { name: /^Options:/ }).waitFor();
  assert.equal(await page.locator('.rest-entering .in-progress .typed').count(), 4);
  await page.locator('[data-action="delete"]').click();
  await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
  results.push('Accepted-word reopen and second delete preserve existing behavior.');

  await open();
  await typeWant();
  await primary().click();
  await page.waitForFunction(() => window.clarteDebug.phase() === 'options');
  const wait = page.getByRole('button', { name: 'Accept wait', exact: true });
  // The existing two-card pager reaches wait one step after want | went.
  if (await wait.evaluate(el => Boolean(el.closest('[inert]')))) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await wait.click();
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  await page.mouse.move(700, 200);
  assert.match(await page.locator('.rest-entering .word:not(.in-progress)').first().innerText(), /^Wait$/);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'wait-accepted.png') });
  results.push('The real fallback want/wait collision is recoverable through the existing pager.');
  await page.locator('[data-action="delete"]').click();
  await page.getByRole('button', { name: /^Options:/ }).waitFor();
  const offset = await page.evaluate(() => window.clarteDebug.words().prediction.offset);
  assert.ok(offset > 0);
  const next = await page.evaluate(() => window.clarteDebug.words().options[0]);
  await primary().click();
  await page.getByRole('button', { name: `Accept ${next}`, exact: true }).click();
  await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
  await page.mouse.move(700, 200);
  await page.waitForTimeout(100);
  await page.locator('[data-action="delete"]').click();
  await page.getByRole('button', { name: /^Options:/ }).waitFor();
  assert.equal(await page.evaluate(() => window.clarteDebug.words().prediction.offset), offset + 1,
    'accepting from a reopened ranking must retain its absolute rank for the next Delete');
  results.push('Repeated accept/reopen advances the absolute candidate rank instead of wrapping back.');

  // Walk every existing debug phase: first run, voice, menus, speaking, long text and chooser.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const scale of [1, 2]) {
      await page.evaluate(n => localStorage.setItem('clarte.v1', JSON.stringify({ setupDone: true, settings: { textScale: n, sound: 'off' } })), scale);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.clarteDebug));
      const phases = await page.evaluate(() => window.clarteDebug.phases);
      for (const phase of phases) {
        await page.evaluate(name => window.clarteDebug.setPhase(name), phase);
        await page.waitForTimeout(500);
        const violations = await page.evaluate(() => window.clarteDebug.validate());
        assert.deepEqual(violations, [], `${viewport.width}, text ${scale}, phase ${phase}`);
      }
      await page.evaluate(() => window.clarteDebug.setPhase('composing-options'));
      await page.waitForFunction(() => window.clarteDebug.phase() === 'composing-options');
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${viewport.width}-${scale}x.png`) });
      results.push(`All ${phases.length} debug phases: zero quadrant collisions at ${viewport.width}x${viewport.height}, text ${scale}x.`);
    }
  }
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(out, 'failure.png') });
    await writeFile(path.join(out, 'failure.txt'), await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
