// What we ask people to say today. Bottalico et al. (J Voice 2026) cloned
// each speaker from about a minute of the Rainbow Passage plus the CAPE-V
// sentences; we use the same public clinical material, in short pieces so
// nobody has to read for long. The CAPE-V sentences each stress one sound
// class, which gives the model a spread of articulations to learn from.

export interface Prompt {
  id: string;
  text: string;
  hint?: string;
}

export const PROMPTS: Prompt[] = [
  { id: 'ah', text: 'Ahhh', hint: 'Hold a comfortable "ah" for as long as feels easy.' },
  { id: 'cape-1', text: 'The blue spot is on the key again.' },
  { id: 'cape-2', text: 'How hard did he hit him?' },
  { id: 'cape-3', text: 'We were away a year ago.' },
  { id: 'cape-4', text: 'We eat eggs every Easter.' },
  { id: 'cape-5', text: 'My mama makes lemon muffins.' },
  { id: 'cape-6', text: 'Peter will keep at the peak.' },
  {
    id: 'rainbow-1',
    text: 'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.',
  },
  {
    id: 'rainbow-2',
    text: 'The rainbow is a division of white light into many beautiful colors.',
  },
  {
    id: 'rainbow-3',
    text: 'These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon.',
  },
  {
    id: 'own-words',
    text: 'Say anything you like.',
    hint: 'Your name, the weather, what you had for breakfast. Your everyday voice helps most.',
  },
];

// ElevenLabs recommends one to two minutes for an instant clone. Recorded
// time includes pauses, so aim for about a minute and allow 15 s as a floor
// (which still leaves the service's 10 s of speech after trimming).
export const ENOUGH_SECONDS = 60;
export const MINIMUM_SECONDS = 15;

export const QUICK_PHRASES = [
  'Yes, please.',
  'No, thank you.',
  'Could you give me a minute?',
  'I love you.',
  'I need some help, please.',
  "I'm tired. Can we talk later?",
];
