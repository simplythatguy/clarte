/**
 * The local fallback decoder (`src/local.ts`): exact-length pages for the Other words chooser,
 * and a word for groups that match nothing. Run with: node prototypes/UI/v0/s6/scripts/test-local.ts
 */
import { signatureOf } from '../../shared/decoder.ts';
import { fallbackFor, predictLocal } from '../src/local.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const code = (word: string) => signatureOf(word).map((g) => g.slice(1)).join('');
const base = { history: [] as [never, string][], message: [] as string[], offset: 0 };

const go = predictLocal({ ...base, groups: '23', complete: true, limit: 4 });
check('complete pages hold only exact-length words', go.words.length === 4 && go.words.every((w) => w.complete && code(w.word) === '23'));
check('complete total counts exact-length words only', go.total > 4 && go.total < predictLocal({ ...base, groups: '23' }).total);
const page2 = predictLocal({ ...base, groups: '23', complete: true, limit: 4, offset: 4 });
check('page 2 continues where page 1 ended', page2.words.length === 4 && !page2.words.some((w) => go.words.some((x) => x.word === w.word)));
const past = predictLocal({ ...base, groups: '23', complete: true, limit: 4, offset: go.total * 4 + 4 });
check('an offset past the end wraps', past.offset === 4 % go.total || past.words.length > 0);
check('no fallback on a complete page that is empty', !predictLocal({ ...base, groups: '414141414141', complete: true, limit: 4 }).fallback);

const slip = fallbackFor(code('suzy').replace(/^(..)4/, '$13'));
check('one digit off: a correction', Boolean(slip) && slip!.kind === 'corrected', JSON.stringify(slip));
const junk = fallbackFor('414141414141414141414141414141');
check('thirty groups of nothing: the best word for the longest matching prefix', Boolean(junk) && junk!.kind === 'prefix' && junk!.word.length > 0, JSON.stringify(junk));
check('a single group always has a word', Boolean(fallbackFor('1')) || predictLocal({ ...base, groups: '1' }).words.length > 0);
const none = predictLocal({ ...base, groups: '3434343434' });
check('a prediction for groups matching nothing carries a fallback', none.total === 0 && Boolean(none.fallback), JSON.stringify(none.fallback));
const after = predictLocal({ ...base, message: ['i', 'want', 'to'], history: [['partner', 'Where would you like to go for dinner tonight?']] as never, groups: '' });
check('the next word is never the word just accepted', after.words.length > 0 && !after.words.some((w) => w.word === 'to'), after.words.slice(0, 3).map((w) => w.word).join(' '));
check('the word still counts while typing', predictLocal({ ...base, message: ['to'], groups: '43' }).words.some((w) => w.word === 'to'));
// Round 4: the partner's content words count at every rank; names the lexicon lacks are candidates with their written form.
const tea = (k: number) => predictLocal({ ...base, history: [['partner', 'Do you want tea or coffee?']] as never, groups: signatureOf('tea').slice(0, k).map((g) => g.slice(1)).join('') });
check('typing after "Do you want tea or coffee?": tea by the second group', tea(2).words[0]?.word === 'tea' && tea(3).words[0]?.word === 'tea', `${tea(1).words[0]?.word} → ${tea(2).words[0]?.word} → ${tea(3).words[0]?.word}`);
const coffee = predictLocal({ ...base, history: [['partner', 'Do you want tea or coffee?']] as never, groups: '13' });
check('typing "co" after it: coffee', coffee.words[0]?.word === 'coffee', coffee.words.slice(0, 3).map((w) => w.word).join(' '));
const cold = predictLocal({ ...base, history: [['partner', 'Are you cold?']] as never, message: ['i', 'am'], groups: '1' });
check('typing "c" after "Are you cold?" and "I am": cold', cold.words[0]?.word === 'cold', cold.words.slice(0, 3).map((w) => w.word).join(' '));
const priya = predictLocal({ ...base, history: [['partner', 'Your sister Priya is coming at four with Marcus.']] as never, message: ['is'], groups: '33' });
check('a name the lexicon lacks is offered with its written form', priya.words[0]?.word === 'priya' && priya.words[0]?.display === 'Priya', JSON.stringify(priya.words[0]));
const plain = predictLocal({ ...base, history: [['partner', 'Where would you like to go for dinner tonight?']] as never, groups: '43' });
check('a word the partner did not say carries no display form', plain.words.every((w) => !w.display));
const generic = predictLocal({ ...base, history: [['partner', 'Do you want tea or coffee?']] as never, message: ['i'], groups: '' });
check('the next word after "I" is a known continuation, not a bare echo ("I coffee")', !['tea', 'coffee'].includes(generic.words[0]?.word ?? ''), generic.words.slice(0, 3).map((w) => w.word).join(' '));
const t0 = performance.now();
for (let i = 0; i < 5; i++) fallbackFor('3434343434343434'.slice(0, 16));
check('a 16-group slip search is quick', performance.now() - t0 < 1500, `${((performance.now() - t0) / 5).toFixed(0)} ms each`);

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('local ok');
