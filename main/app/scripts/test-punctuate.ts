// The app's own punctuation rule, used when the engine's answer is not there in time (NAT-38, NAT-52).
import assert from 'node:assert/strict';
import { punctuateLocally } from '../src/prediction/punctuate.ts';

const cases: [string, string][] = [
  ['hello what is your name', 'Hello, what is your name?'],
  ['hi what is your name', 'Hi, what is your name?'],
  ['oh hi are you coming', 'Oh hi, are you coming?'],
  ['yes i am fine', 'Yes, I am fine.'],
  ['okay thanks', 'Okay, thanks.'],
  ['what is your name', 'What is your name?'],
  ['are you okay', 'Are you okay?'],
  ['i would love to go', 'I would love to go.'],
  ['no problem', 'No problem.'],
  ['well done', 'Well done.'],
  ['thanks for coming', 'Thanks for coming.'],
  ['hello there', 'Hello there.'],
  ['hello', 'Hello.'],
  ['yes', 'Yes.'],
  ['where is it?', 'Where is it?'],
];
for (const [message, spoken] of cases) assert.equal(punctuateLocally(message.split(' ')), spoken, message);
assert.equal(punctuateLocally([]), '');
console.log(`Punctuation fallback: ${cases.length} messages, greetings get a comma and the question check looks past them.`);
