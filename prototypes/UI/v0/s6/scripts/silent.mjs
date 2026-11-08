// Checks never make a sound: Chromium runs muted, and speechSynthesis (which speaks through the system
// voice, past --mute-audio) only reports that it started and finished.
const SILENT_SPEECH = () => {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.speak = (u) => {
    setTimeout(() => { u.onstart?.(new Event('start')); u.dispatchEvent?.(new Event('start')); }, 10);
    setTimeout(() => { u.onend?.(new Event('end')); u.dispatchEvent?.(new Event('end')); }, 60 * Math.max(1, String(u.text).split(/\s+/).length));
  };
  synth.cancel = () => {};
};

export async function silentBrowser(chromium) {
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await newContext(options);
    await ctx.addInitScript(SILENT_SPEECH);
    return ctx;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  return browser;
}
