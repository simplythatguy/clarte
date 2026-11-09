import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
 const page = await browser.newPage();
 // Keep the isolated fixture on one module version even when Vite has hot-reload timestamps.
 await page.route('**/src/**', async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace(/(\/src\/[^"'\s]+\.ts)\?t=\d+/g, '$1');
  await route.fulfill({ response, body });
 });
 await page.route('**/__sound-parity', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sound parity test</title>' }));
 await page.goto(`${process.argv[2] ?? 'http://localhost:5200'}/__sound-parity`);
 const results = await page.evaluate(async () => {
  const { microphone } = await import('/src/listen/runtime.ts');
  const { startSoundSelect } = await import('/src/soundSelect.ts');
  const { FeatureStream, RATE } = await import('/src/listen/features.ts');
  const { EventCutter } = await import('/src/listen/events.ts');
  const { enroll, judgeGeneric } = await import('/src/listen/matcher.ts');
  const { saveProfile, forgetProfile } = await import('/src/listen/store.ts');
  const originalSubscribe = microphone.subscribe;
  const subscribers = new Set();
  microphone.subscribe = async subscriber => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); };
  const output = [];
  try {
   for (const amplitude of [.006, .012, .06]) {
    const samples = Float32Array.from({ length: RATE * 2 }, (_, i) => {
     const t = i / RATE;
     const gain = t >= 1 && t < 1.4 ? amplitude * Math.min(1, (t - 1) / .04) : .00005;
     return gain * Math.sin(2 * Math.PI * 250 * t);
    });
    const cutter = new EventCutter();
    const events = [];
    for (const frame of new FeatureStream().push(samples)) cutter.push(frame, events);
    const event = events[0];
    if (!event || !judgeGeneric(event).accept) throw Error('Synthetic quiet voiced sound must pass the real generic matcher');
    for (const taught of [false, true]) {
     forgetProfile();
     if (taught) saveProfile(enroll([[event], [event], [event]], []), 0);
     let ordinary = 0, centre = 0;
     const card = await startSoundSelect(() => ordinary++, () => true);
     const word = await startSoundSelect(() => centre++, () => true, true);
     // Target is ready just before the audible rise; event.start includes earlier quiet lead-in.
     for (const sub of subscribers) sub.onLevel?.(-86, -84, 1);
     for (const sub of subscribers) sub.onEvent?.({ event });
     output.push({ amplitude, taught, ordinary, centre });
     for (const sub of subscribers) sub.onEvent?.({ event });
     if (ordinary !== 1 || centre !== output.at(-1).centre) throw Error('Repeated event bypassed refractory');
     const rejected = { ...event, at: event.at + 1, stats: { ...event.stats, voiced: 0, peakDb: -120, riseDb: 0 } };
     for (const sub of subscribers) sub.onEvent?.({ event: rejected });
     if (ordinary !== 1 || centre !== output.at(-1).centre) throw Error('Rejected quiet/unvoiced audio selected a target');
     card.stop(); word.stop();
     let disabled = 0;
     const inactive = await startSoundSelect(() => disabled++, () => false, true);
     for (const sub of subscribers) sub.onEvent?.({ event });
     if (disabled) throw Error('Disabled centre received confirmation');
     inactive.stop();
     let late = 0;
     const outside = await startSoundSelect(() => late++, () => true, true);
     for (const sub of subscribers) sub.onLevel?.(-86, -84, 1.2);
     for (const sub of subscribers) sub.onEvent?.({ event });
     if (late) throw Error('Sound begun before targeting carried into centre');
     outside.stop();
    }
   }
  } finally { microphone.subscribe = originalSubscribe; forgetProfile(); }
  return output;
 });
 for (const result of results) assert.equal(result.centre, result.ordinary, `Same sound must confirm both targets: ${JSON.stringify(result)}`);
 console.log('Sound parity passes at three amplitudes with generic and taught profiles; pre-target sound and refractory guards pass.');
} finally { await browser.close(); }
