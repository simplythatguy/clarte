/**
 * Self-test for the shared engine. Run with: node prototypes/UI/v0/shared/selftest.ts
 * No DOM needed. Exits non-zero on the first failure.
 */
import { GazeEngine } from './gaze.ts';
import { decode, groupLetters, signatureOf, vocabularySize } from './decoder.ts';
import { EMPTY_COMPOSITION, candidates, currentCandidate, messageText, pendingGlyphs, reduce } from './composer.ts';
import { actionIn, quadrantAt, quadrantRect, quadrantsOf, validateLayout } from './quadrants.ts';

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

check('vocabulary loaded', vocabularySize() > 1000, `${vocabularySize()} words`);
check('signature of hello', signatureOf('hello').join() === 'G2,G1,G2,G2,G3');
const hello = decode(signatureOf('hello'));
check('hello decodes to hello first', hello[0]?.word === 'hello', hello.slice(0, 3).map((c) => c.word).join(', '));
const partial = decode(['G4', 'G2']);
check('partial sequence returns completions', partial.length > 0 && partial.some((c) => !c.complete), partial.map((c) => c.word).join(', '));
check('context boosts a word', decode(signatureOf('water'), { context: ['water'] })[0]?.word === 'water');

check('group letters print every letter', groupLetters('G2') === 'G H I J K L M N' && groupLetters('G1', '') === 'ABCDEF');
let c = EMPTY_COMPOSITION;
for (const g of signatureOf('hello')) c = reduce(c, { type: 'group', group: g });
check('composer shows the candidate while pending', currentCandidate(c)?.word === 'hello');
check('pending glyphs show the candidate letters per typed group', pendingGlyphs(c).map((g) => g.letter).join('') === 'hello' && pendingGlyphs(c).every((g) => g.typed));
{
  let p = EMPTY_COMPOSITION;
  for (const g of signatureOf('wh')) p = reduce(p, { type: 'group', group: g });
  const glyphs = pendingGlyphs(p);
  check('pending glyphs append the completion as ghosts', glyphs.length > 2 && glyphs.slice(0, 2).every((g) => g.typed) && glyphs.slice(2).every((g) => !g.typed), glyphs.map((g) => `${g.letter}${g.typed ? '' : '?'}`).join(''));
}
c = reduce(c, { type: 'accept' });
check('accept commits the word', messageText(c) === 'hello' && c.pending.length === 0);
c = reduce(c, { type: 'group', group: 'G4' });
c = reduce(c, { type: 'delete' });
check('delete removes a pending group first', c.pending.length === 0 && messageText(c) === 'hello');
c = reduce(c, { type: 'delete' });
check('delete with nothing pending removes a word that has one candidate', messageText(c) === '' && c.pending.length === 5 && currentCandidate(c)?.word === 'hello');
c = reduce(c, { type: 'clear' });
for (const g of signatureOf('not')) c = reduce(c, { type: 'group', group: g });
check('ambiguous sequence offers the most frequent word first', currentCandidate(c)?.word === 'not', candidates(c).map((x) => x.word).join(', '));
c = reduce(c, { type: 'accept' });
c = reduce(c, { type: 'delete' });
check('delete after a decode reopens the word at the next candidate', messageText(c) === '' && c.pending.length === 3 && c.candidateIndex === 1 && currentCandidate(c)?.word !== 'not', `${currentCandidate(c)?.word} (index ${c.candidateIndex})`);
c = reduce(c, { type: 'accept' });
check('accepting again commits the next candidate', c.words.length === 1 && c.words[0].text !== 'not', messageText(c));
c = reduce(c, { type: 'delete' });
c = reduce(c, { type: 'delete' });
check('delete twice after a commit removes the whole word', c.words.length === 0 && c.pending.length === 0 && !c.reopened);
c = reduce(c, { type: 'clear' });
c = reduce(c, { type: 'group', group: 'G2' });
check('after one group only exact-length words are offered', candidates(c).length > 0 && candidates(c).every((x) => x.complete), candidates(c).map((x) => x.word).join(', '));
c = reduce(c, { type: 'group', group: 'G1' });
check('from two groups completions are offered', candidates(c).some((x) => !x.complete), candidates(c).map((x) => x.word).join(', '));
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

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all checks passed');
