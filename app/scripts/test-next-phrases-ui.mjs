import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openPhrases } from '../phrase-store.mjs';

const origin = process.argv[2] ?? 'http://localhost:5200';
const out = '../../.scratch/next-phrases';
await mkdir(out, { recursive: true });
const lint = process.env.LINTAPPLE_MODULE ? await import(pathToFileURL(process.env.LINTAPPLE_MODULE).href) : null;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  for (const [width, height] of [[1440, 900], [1280, 720]]) for (const scale of [1, 2]) {
    const store = openPhrases(':memory:');
    const saved = [];
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: process.env.TEST_MOTION === 'normal' ? 'no-preference' : 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      // Use the app's real speech timer, without emitting audio during tests.
      Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], cancel() {}, addEventListener() {} } });
      // This test checks that Listen stays reachable, not recognition/permission services.
      class Recognition {
        start() { queueMicrotask(() => this.onstart?.()); }
        stop() {}
        abort() {}
      }
      Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: Recognition, configurable: true });
    });
    await page.route('**/api/phrases', async (route) => {
      if (route.request().method() === 'POST') {
        const { text, id } = route.request().postDataJSON();
        store.record(text, id);
        saved.push(text);
      }
      await route.fulfill({ json: store.snapshot() });
    });
    try {
      await page.goto(`${origin}/?input=mouse&onboarding=off&engine=off`);
      await page.waitForFunction(() => Boolean(window.clarteDebug));
      await page.waitForFunction(() => window.clarteDebug.words().phrases?.length === 3);
      await page.locator('.rest-entering .phrase-preview').waitFor();
      assert.equal(saved.length, 0, 'fresh starter suggestions require no prior speech');
      await page.evaluate((s) => document.documentElement.style.setProperty('--scale', String(s)), scale);
      const typeAndSpeak = async (text) => {
        const words = text.toLowerCase().split(' ');
        const history = saved.map((s) => ['user', s]);
        for (let at = 0; at < words.length; at++) {
          const word = words[at];
          const groups = [...word].map((c) => String(['abcdef', 'ghijklmn', 'opqrs', 'tuvwxyz'].findIndex((g) => g.includes(c)) + 1)).join('');
          // Fix only the word decoder; phrase learning, regression, speech completion and UI are real.
          await page.evaluate(async ({ history, message, groups, word }) => {
            const { seed } = await import('/src/prediction/prediction.ts');
            const prediction = { source: 'local', offset: 0, total: 1, longer: 0,
              words: [{ word, p: 1, complete: true }] };
            seed({ history, message, groups, offset: 0 }, prediction);
            seed({ history, message, groups, offset: 0, complete: true, limit: 20 }, prediction);
          }, { history, message: words.slice(0, at), groups, word });
          for (const group of groups) await page.keyboard.press(String(Number(group) + 4));
          // The centre now accepts a whole phrase when one matches. Pick the literal word
          // through Options so this fixture still composes its intended training sequence.
          await page.locator('[data-action="primary"]').click();
          const literal = page.getByRole('button', { name: `Accept ${word}`, exact: true });
          if (!await literal.count()) await page.locator('[data-action="page-next"]').click();
          await literal.click();
        }
        const before = saved.length;
        await page.getByRole('button', { name: 'Speak', exact: true }).click();
        await page.mouse.move(width / 2, 100); // Leave the old action before its label can change.
        await page.waitForFunction(() => !document.querySelector('[aria-label="Stop"]'));
        await page.waitForFunction(() => Boolean(document.querySelector('.phrase-preview')));
        assert.equal(saved.length, before + 1, 'completed speech is recorded exactly once');
      };
      await typeAndSpeak('hi');
      await typeAndSpeak('i am good');
      await typeAndSpeak('hi');
      await page.waitForFunction(() => document.querySelector('.rest-entering .phrase-preview')?.textContent?.includes('I am good'));
      assert.equal(store.snapshot().sort((a, b) => b.probability - a.probability)[0].text, 'I am good.');
      if (process.env.PHRASE_RNN_TEST_ORIGIN) {
        const reply = page.waitForResponse(r => r.url().endsWith('/api/v1/phrases') && r.request().method() === 'POST');
        await page.evaluate(async (base) => {
          const { setEngine } = await import('/src/prediction/prediction.ts');
          setEngine(base);
        }, process.env.PHRASE_RNN_TEST_ORIGIN);
        const response = await reply;
        assert.equal((await response.json()).available, true, 'actual trained phrase model answered');
        await page.waitForTimeout(750); // Reproduce the late replacement window reported by the user.
        assert.equal(await page.evaluate(() => window.clarteDebug.words().phrases[0]), 'I am good', 'learned successor survives late RNN');
        await page.evaluate(async () => { const { setEngine } = await import('/src/prediction/prediction.ts'); setEngine(null); });
      }
      assert.equal(await page.locator('.rest-entering .in-progress').count(), 0, 'next prediction requires no typed groups');
      const audit = async (state) => {
        // Inspect the settled screen rather than measuring cross-fade glyphs in transit.
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
            .map((a) => a.finished.catch(() => {})));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await page.screenshot({ path: `${out}/${width}-${scale}-${state}.png` });
        if (!lint) return;
        const report = await lint.checkPage(page, { fonts: ['Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', 'sans-serif'],
          fontSizes: [20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96], typeRules: [], minControlSize: 20,
          viewports: [{ width, height }], colorSchemes: ['light'] });
        await writeFile(`${out}/${width}-${scale}-${state}-lint.json`, JSON.stringify(report, null, 2));
      };
      await audit('preview');
      await page.locator('[data-action="primary"]').click();
      for (let i = 0; i < 3; i++) await page.locator(`[data-action="pick-${i}"]`).waitFor();
      assert.deepEqual(await page.evaluate(() => window.clarteDebug.validate()), []);
      await audit('options');
      const total = saved.length;
      await page.locator('[data-action="back"]').click();
      await page.keyboard.press('8'); // Continue typing instead of accepting the prediction.
      await page.locator('.rest-entering .in-progress').waitFor();
      await page.keyboard.press('1');
      await page.locator('[data-action="primary"]').click();
      await page.locator('[data-action="pick-0"]').click();
      await page.getByRole('button', { name: 'Speak', exact: true }).waitFor();
      assert.equal(saved.length, total, 'preview and acceptance do not train or speak');
      assert.equal(await page.locator('.rest-entering .word:not(.in-progress)').innerText(), 'I am good');
      await page.reload();
      await page.waitForFunction(() => Boolean(document.querySelector('.phrase-preview')));
      await page.locator('[data-action="primary"]').click();
      await page.locator('[data-action="listen-next"]').click();
      await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
      assert.equal(saved.length, total, 'listening is not personal speech');
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: `${out}/failure.png` });
      await writeFile(`${out}/failure.txt`, await page.locator('body').innerText());
      throw error;
    } finally { await page.close(); store.close(); }
  }
  console.log('Hi -> I am good learned through real speech completion, next top three without typing, reload, Listen and continued typing passed at both sizes and 200% text.');
} finally { await browser.close(); }
