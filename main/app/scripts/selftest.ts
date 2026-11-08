/**
 * Self-test for the shared engine. Run with: node main/app/scripts/selftest.ts
 * No DOM needed. Exits non-zero on the first failure.
 */
import { GazeEngine } from '../src/core/gaze.ts';
import { groupLetters, signatureOf } from '../src/core/decoder.ts';
import { EMPTY_COMPOSITION, glyphsForWord, messageText, reduce } from '../src/core/composer.ts';
import { actionIn, quadrantAt, quadrantRect, quadrantsOf, validateLayout } from '../src/core/quadrants.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const viewport = { width: 1440, height: 900 };

check('Q1 is the top-left cell', JSON.stringify(quadrantRect('Q1', viewport)) === JSON.stringify({ left: 0, top: 0, right: 360, bottom: 450 }));
check('Q8 is the bottom-right cell', JSON.stringify(quadrantRect('Q8', viewport)) === JSON.stringify({ left: 1080, top: 450, right: 1440, bottom: 900 }));
check('point in Q6', quadrantAt(500, 600, viewport) === 'Q6');
check('point off screen is null', quadrantAt(-5, 10, viewport) === null && quadrantAt(10, 900, viewport) === null);

const fullWidthTop = { id: 'top', rect: { left: 0, top: 0, right: 1440, bottom: 300 } };
check('a wide element spans Q1..Q4', quadrantsOf(fullWidthTop.rect, viewport).join() === 'Q1,Q2,Q3,Q4');
const centre = { id: 'centre', rect: { left: 520, top: 300, right: 920, bottom: 600 } };
check('a centred element touches the four inner quadrants', quadrantsOf(centre.rect, viewport).join() === 'Q2,Q3,Q6,Q7');
check('a 1px bleed over a grid line is ignored', quadrantsOf({ left: 0, top: 0, right: 361, bottom: 449 }, viewport).join() === 'Q1');

const style1 = [
  { id: 'mode', rect: { left: 20, top: 20, right: 340, bottom: 240 } },
  { id: 'autocomplete', rect: { left: 380, top: 20, right: 700, bottom: 240 } },
  { id: 'delete', rect: { left: 740, top: 20, right: 1060, bottom: 240 } },
  { id: 'flip', rect: { left: 1100, top: 20, right: 1420, bottom: 240 } },
  { id: 'G1', rect: { left: 20, top: 660, right: 340, bottom: 880 } },
  { id: 'G2', rect: { left: 380, top: 660, right: 700, bottom: 880 } },
  { id: 'G3', rect: { left: 740, top: 660, right: 1060, bottom: 880 } },
  { id: 'G4', rect: { left: 1100, top: 660, right: 1420, bottom: 880 } },
];
check('style 1 layout is valid', validateLayout(style1, viewport).length === 0);
check('Q6 selects G2', actionIn('Q6', style1, viewport)?.id === 'G2');
check('centre button plus a top row is a violation', validateLayout([...style1.slice(0, 4), centre], viewport).map((v) => v.quadrant).join() === 'Q2,Q3');
check('centre button alone with corner groups is valid', validateLayout([centre, style1[4], style1[7], { id: 'x', rect: { left: 1100, top: 20, right: 1420, bottom: 240 } }, { id: 'y', rect: { left: 20, top: 20, right: 340, bottom: 240 } }], viewport).length === 0);

check('signature of hello', signatureOf('hello').join() === 'G2,G1,G2,G2,G3');
check('group letters print every letter', groupLetters('G2') === 'G H I J K L M N' && groupLetters('G1', '') === 'ABCDEF');
let c = EMPTY_COMPOSITION;
for (const g of signatureOf('hello')) c = reduce(c, { type: 'group', group: g });
check('pending glyphs show the shown word\'s letters per typed group', glyphsForWord(c.pending, 'hello').map((g) => g.letter).join('') === 'hello' && glyphsForWord(c.pending, 'hello').every((g) => g.typed));
{
  const glyphs = glyphsForWord(signatureOf('wh'), 'what');
  check('pending glyphs append the completion as ghosts', glyphs.length === 4 && glyphs.slice(0, 2).every((g) => g.typed) && glyphs.slice(2).every((g) => !g.typed), glyphs.map((g) => `${g.letter}${g.typed ? '' : '?'}`).join(''));
}
c = reduce(c, { type: 'accept', word: 'hello', rank: 0 });
check('accept commits the shown word', messageText(c) === 'hello' && c.pending.length === 0);
c = reduce(c, { type: 'group', group: 'G4' });
c = reduce(c, { type: 'delete' });
check('delete removes a pending group first', c.pending.length === 0 && messageText(c) === 'hello');
c = reduce(c, { type: 'delete' });
check('delete with nothing pending reopens the word at the next rank', messageText(c) === '' && c.pending.length === 5 && c.candidateIndex === 1 && c.reopened);
c = reduce(c, { type: 'accept', word: 'gelli', rank: 1 });
check('accepting again commits the word at that rank', messageText(c) === 'gelli' && c.words[0].candidateIndex === 1);
c = reduce(c, { type: 'delete' });
check('a second reopen moves one rank further', c.candidateIndex === 2);
c = reduce(c, { type: 'delete' });
check('delete straight after a reopen removes the whole word', c.words.length === 0 && c.pending.length === 0 && !c.reopened);
c = reduce(c, { type: 'clear' });
c = reduce(c, { type: 'phrase', text: 'thank you' });
check('phrase commits whole text', messageText(c) === 'thank you');
c = reduce(c, { type: 'delete' });
check('delete removes a phrase outright', messageText(c) === '' && c.pending.length === 0);

const style2 = [
  { id: 'G1', rect: { left: 20, top: 20, right: 340, bottom: 430 } },
  { id: 'G2', rect: { left: 1100, top: 20, right: 1420, bottom: 430 } },
  { id: 'G3', rect: { left: 20, top: 470, right: 340, bottom: 880 } },
  { id: 'G4', rect: { left: 1100, top: 470, right: 1420, bottom: 880 } },
  { id: 'accept', rect: { left: 380, top: 470, right: 700, bottom: 880 } },
  { id: 'delete', rect: { left: 740, top: 470, right: 1060, bottom: 880 } },
];
check('style 2 layout leaves Q2 and Q3 as rest zones', validateLayout(style2, viewport).length === 0 && actionIn('Q2', style2, viewport) === null && actionIn('Q3', style2, viewport) === null);
const engine = new GazeEngine({ dwellMs: 500, holdMs: 100, rearmMs: 200 });
engine.setViewport(viewport);
engine.setActionables(style2);
const events: string[] = [];
engine.subscribe((_, event) => { if (event) events.push(`${event.type}:${event.action}`); });
engine.sample(500, 800, 0);
engine.sample(500, 800, 120);
check('after holdMs the quadrant is current', engine.snapshot.quadrant === 'Q6' && engine.snapshot.action === 'accept', JSON.stringify(engine.snapshot));
engine.sample(500, 800, 400);
check('progress grows while dwelling', engine.snapshot.state === 'dwelling' && engine.snapshot.progress > 0.5 && engine.snapshot.progress < 1, `${engine.snapshot.progress.toFixed(2)}`);
engine.sample(500, 800, 700);
check('dwell selects after dwellMs', events.includes('select:accept') && engine.snapshot.state === 'selected', events.join(' '));
engine.sample(500, 800, 1500);
check('a long look does not fire twice', events.filter((e) => e === 'select:accept').length === 1);
engine.sample(700, 200, 1600);
engine.sample(700, 200, 1750);
engine.sample(700, 200, 2000);
check('over the rest zone the latched action is still reported', engine.snapshot.quadrant === 'Q2' && engine.snapshot.looked === null && engine.snapshot.state === 'selected', JSON.stringify(engine.snapshot));
engine.sample(700, 200, 2400);
check('after rearmMs off the action it returns to idle', engine.snapshot.state === 'idle' && engine.snapshot.action === null, JSON.stringify(engine.snapshot));
engine.sample(500, 800, 2500);
engine.sample(500, 800, 2650);
engine.sample(500, 800, 2800);
engine.sample(500, 800, 3300);
check('returning selects again', events.filter((e) => e === 'select:accept').length === 2, events.join(' '));

const bandEngine = new GazeEngine({ dwellMs: 500, holdMs: 0, deadBand: 0.03, smoothing: 1 });
bandEngine.setViewport(viewport);
bandEngine.setActionables(style2);
bandEngine.sample(100, 100, 0);
bandEngine.sample(370, 100, 50);
check('a sample inside the dead band keeps the current quadrant', bandEngine.snapshot.quadrant === 'Q1', JSON.stringify(bandEngine.snapshot.quadrant));
bandEngine.sample(420, 100, 100);
check('a sample past the dead band moves on', bandEngine.snapshot.quadrant === 'Q2');

const graceEngine = new GazeEngine({ dwellMs: 600, holdMs: 0, graceMs: 150, blinkGraceMs: 200, smoothing: 1, deadBand: 0 });
graceEngine.setViewport(viewport);
graceEngine.setActionables(style2);
const graceEvents: string[] = [];
graceEngine.subscribe((_, event) => { if (event) graceEvents.push(event.type); });
graceEngine.sample(100, 100, 0);
graceEngine.sample(700, 200, 300);
graceEngine.sample(100, 100, 400);
check('a 100 ms excursion does not cancel the dwell', !graceEvents.includes('cancel') && graceEngine.snapshot.state === 'dwelling' && graceEngine.snapshot.progress > 0.5, `${graceEngine.snapshot.state} ${graceEngine.snapshot.progress.toFixed(2)} ${graceEvents.join(' ')}`);
graceEngine.sample(null, null, 450);
graceEngine.sample(null, null, 550);
check('a 100 ms blink does not change the quadrant', graceEngine.snapshot.quadrant === 'Q1' && graceEngine.snapshot.state === 'dwelling');
graceEngine.sample(100, 100, 650);
check('the dwell completes after the blink', graceEvents.includes('select'), graceEvents.join(' '));
graceEngine.sample(700, 200, 1200);
graceEngine.sample(700, 200, 1600);
graceEngine.sample(100, 100, 1700);
graceEngine.sample(700, 200, 1800);
graceEngine.sample(700, 200, 2100);
check('a 300 ms excursion cancels the dwell', graceEvents.filter((e) => e === 'cancel').length >= 1 && graceEngine.snapshot.state === 'idle', `${graceEngine.snapshot.state} ${graceEvents.join(' ')}`);

const repeatEngine = new GazeEngine({ dwellMs: 400, holdMs: 0, repeat: 'redwell' });
repeatEngine.setViewport(viewport);
repeatEngine.setActionables(style2);
const repeatEvents: string[] = [];
repeatEngine.subscribe((_, event) => { if (event?.type === 'select') repeatEvents.push(event.action); });
repeatEngine.sample(100, 100, 0);
repeatEngine.sample(100, 100, 450);
repeatEngine.sample(100, 100, 800);
repeatEngine.sample(100, 100, 1100);
check('redwell fires again after 1.5 × dwell on the same action', repeatEvents.length === 2, repeatEvents.join(' '));

const confirmEngine = new GazeEngine({ mode: 'confirm', dwellMs: 300, holdMs: 0 });
confirmEngine.setViewport(viewport);
confirmEngine.setActionables(style1);
const confirmEvents: string[] = [];
confirmEngine.subscribe((_, event) => { if (event) confirmEvents.push(event.type); });
confirmEngine.sample(100, 100, 0);
confirmEngine.sample(100, 100, 350);
check('confirm mode previews instead of selecting', confirmEvents.includes('preview') && !confirmEvents.includes('select') && confirmEngine.snapshot.state === 'previewed');
confirmEngine.confirm(400);
check('confirm selects the preview', confirmEvents.includes('select') && confirmEngine.snapshot.state === 'selected');

// Switching cards waits until the eyes have settled (owner, 2026-11-08).
const settleEngine = new GazeEngine({ dwellMs: 600, holdMs: 1000, holdShare: 0.65, graceMs: 300, smoothing: 1, deadBand: 0 });
settleEngine.setViewport(viewport);
settleEngine.setActionables(style1);
const settleEvents: string[] = [];
settleEngine.subscribe((_, event) => { if (event) settleEvents.push(`${event.type}:${event.action}`); });
const feed = (from: number, to: number, at: (t: number) => [number, number]) => { for (let t = from; t <= to; t += 33) settleEngine.sample(...at(t), t); };
feed(0, 300, () => [100, 100]);
check('the first card needs a settled look too', settleEngine.snapshot.quadrant === null, String(settleEngine.snapshot.quadrant));
feed(333, 700, () => [100, 100]);
check('a steady first look settles after 650 ms', settleEngine.snapshot.quadrant === 'Q1', String(settleEngine.snapshot.quadrant));
feed(733, 1700, () => [100, 100]);
feed(1733, 2300, () => [500, 100]);
check('a clean move to the next card waits', settleEngine.snapshot.quadrant === 'Q1' && settleEngine.snapshot.state !== 'dwelling', `${settleEngine.snapshot.quadrant} ${settleEngine.snapshot.state}`);
feed(2333, 2500, () => [500, 100]);
check('and moves once the new card holds 65% of the last second', settleEngine.snapshot.quadrant === 'Q2', `${settleEngine.snapshot.quadrant} ${settleEngine.snapshot.state}`);
feed(2533, 3500, () => [500, 100]);
check('then the new card is selected', settleEvents.includes('select:autocomplete'), settleEvents.join(' '));
const before = settleEvents.length;
feed(2533, 5000, (t) => (Math.floor(t / 33) % 2 ? [100, 100] : [500, 100]));
check('a look split between two cards never jumps', settleEngine.snapshot.quadrant === 'Q2' && !settleEvents.slice(before).some((e) => e.startsWith('select:') && e !== `select:${settleEngine.snapshot.looked}`), `${settleEngine.snapshot.quadrant} ${settleEvents.slice(before).join(' ')}`);
const leaveEngine = new GazeEngine({ dwellMs: 600, holdMs: 1000, holdShare: 0.65, graceMs: 300, smoothing: 1, deadBand: 0 });
leaveEngine.setViewport(viewport);
leaveEngine.setActionables(style1);
const leaveEvents: string[] = [];
leaveEngine.subscribe((_, event) => { if (event) leaveEvents.push(event.type); });
for (let t = 0; t <= 800; t += 33) leaveEngine.sample(100, 100, t);
for (let t = 833; t <= 1400; t += 33) leaveEngine.sample(500, 100, t);
check('leaving a card stops its line before the next card is chosen', leaveEngine.snapshot.quadrant === 'Q1' && leaveEngine.snapshot.state === 'focused' && !leaveEvents.includes('select'), `${leaveEngine.snapshot.quadrant} ${leaveEngine.snapshot.state} ${leaveEvents.join(' ')}`);
const wideEngine = new GazeEngine({ dwellMs: 600, holdMs: 1000, holdShare: 0.65, smoothing: 1, deadBand: 0 });
wideEngine.setViewport(viewport);
wideEngine.setActionables([{ id: 'wide', rect: { left: 740, top: 470, right: 1420, bottom: 880 } }]);
for (let t = 0; t <= 700; t += 33) wideEngine.sample(Math.floor(t / 33) % 2 ? 1250 : 900, 700, t);
check('a wide card split across its quadrants still settles', wideEngine.snapshot.looked === 'wide', JSON.stringify(wideEngine.snapshot));

// Confirm mode needs no look away between selections (no dwell, #32).
const againEngine = new GazeEngine({ mode: 'confirm', dwellMs: 300, holdMs: 0, rearmMs: 300, smoothing: 1, deadBand: 0 });
againEngine.setViewport(viewport);
againEngine.setActionables(style1);
const againEvents: string[] = [];
againEngine.subscribe((_, event) => { if (event?.type === 'select') againEvents.push(event.action); });
for (let t = 0; t <= 400; t += 33) againEngine.sample(100, 100, t);
againEngine.confirm(420);
for (let t = 433; t <= 900; t += 33) againEngine.sample(100, 100, t);
check('a steady look is ready again after a confirmation', againEngine.snapshot.state === 'previewed', againEngine.snapshot.state);
againEngine.confirm(910);
check('a second confirmation selects again without looking away', againEvents.length === 2, againEvents.join(' '));
againEngine.setActionables(style1.map((a) => (a.id === 'mode' ? { ...a, id: 'next-screen' } : a)));
for (let t = 943; t <= 1400; t += 33) againEngine.sample(100, 100, t);
check('a new card in the same place previews without looking away', againEngine.snapshot.state === 'previewed' && againEngine.snapshot.action === 'next-screen', JSON.stringify(againEngine.snapshot));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all checks passed');
