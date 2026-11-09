// Suggested replies (NAT-53): social formulas only, never an answer about the person.
import assert from 'node:assert/strict';
import { suggestReply } from '../src/suggest.ts';

const none = [
  'Are you in pain?',
  'Are you allergic to anything?',
  'Are you sure?',
  'Do you want more water?',
  'Do you want to go outside for a bit? It is sunny.',
  'Shall we go?',
  'Did you take your medicine?',
  'Is it okay if I leave now?',
  'Hi! Are you hungry?',
  'Hey, how are you feeling this morning?',
  'How is your back?',
  'How are you feeling?',
  'Thank you. Do you need anything else?',
  'Good morning! Did you sleep well?',
  'What would you like for dinner?',
  'Hi, the doctor called about your appointment',
  'The nurse is coming at three',
  '',
];
for (const turn of none) assert.equal(suggestReply(turn), null, `no suggestion for "${turn}"`);

const formulas: [string, string][] = [
  ['How are you?', "I'm okay, thanks"],
  ['Hey, how are you doing?', "I'm okay, thanks"],
  ['Hi! How are you today?', "I'm okay, thanks"],
  ["How's it going?", "I'm okay, thanks"],
  ['Good morning!', 'Good morning'],
  ['Morning, Sam', 'Good morning'],
  ['Hello', 'Hello'],
  ['Hi there!', 'Hello'],
  ['Thank you so much.', "You're welcome"],
  ['Thanks for waiting with me.', "You're welcome"],
  ['Okay, bye!', 'Bye, see you soon'],
  ['See you tomorrow, take care.', 'Bye, see you soon'],
  ['Good night', 'Good night'],
];
for (const [turn, reply] of formulas) assert.equal(suggestReply(turn), reply, turn);

console.log(`Suggested replies: ${none.length} questions and statements get none, ${formulas.length} social formulas get theirs.`);
