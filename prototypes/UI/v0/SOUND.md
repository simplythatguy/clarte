# Clarte sound system

Clarte's sounds are calm, soft and quiet. They confirm what the eyes just did, and then they get out of the way. They should feel like a quiet studio, not a game: warm chords that swell in and fade out like a gradient, with an open, exploring feel. Tracked in Linear as NAT-24, project Sound system.

The engine is [`shared/sound.ts`](shared/sound.ts). Every sound is generated with the Web Audio API, so there are no audio files. Style 8 uses it, and the listening page plays every cue side by side: run style 8 (`npm run dev` in `s8/`, or `node s_all/serve.mjs`) and open http://localhost:5108/sounds.html.

## Rules

1. **No startle, no distraction.** Many people who use Clarte (ALS, cerebral palsy, stroke) have a strong startle reflex. Every note fades in over at least 20 ms, and the larger cues over 45–450 ms. Nothing clicks. The most frequent actions have the quietest sound or none: choosing a letter group is silent.
2. **The voice comes first.** When Clarte starts speaking, a short "breath in" plays and then every cue drops to about a fifth of its level (−13 dB) until the voice ends. Cue energy stays below 1 kHz, so the 1–4 kHz band that makes speech clear is left to the voice.
3. **Never sound only.** Every cue has a visual state as well. Sound confirms what you see; it never carries meaning alone.
4. **The person decides.** Menu → Settings → More → More (the **Sound** page) holds **Sounds** (All, Fewer, Off) and **Volume** (25, 50, 75, 100%). A new level or volume plays its confirming cue at the new setting, so changing it previews it.
5. **Pleasant on the hundredth play.** Each play is slightly different: a few cents of detune, uneven strum timing, and chords that sometimes leave out an inner note. Touch and Ease are the quietest and shortest cues, because they are the most frequent.
6. **One key, one family.** Everything is in F major with an open lydian colour, played by the same soft voice: a sine with a breath of triangle a few cents apart, through a warm low-pass filter and a dark, soft room.

## Harmony

Each accepted word moves one step round a slow four-chord cycle. A conversation drifts through the chords instead of repeating one chime. That is the "explorative" part of the brief:

| Step | Chord | Notes |
| --- | --- | --- |
| 1 | Fmaj9 | F3 C4 E4 G4 A4 |
| 2 | Dm9 | D3 A3 C4 E4 F4 |
| 3 | B♭maj9♯11 | B♭2 F3 A3 E4 B4 |
| 4 | Cadd9 | C3 G3 D4 E4 G4 |

When Clarte finishes speaking, or calibration completes, the cycle returns home to F.

## Cue map

| Cue | Name | When | How it sounds | Fewer |
| --- | --- | --- | --- | --- |
| `listen-start` | Opening | Clarte starts listening to the partner | An open fifth (F, C) that swells in slowly; the notes arrive together, so there is no melody | kept |
| `listen-stop` | Settling | Listening stops | The same fifth, quieter, with the filter closing as it fades | kept |
| `word` | Bloom | A word, a suggested reply or an alternative is accepted | The current chord, strummed upward, long fade; the cycle moves one step | kept |
| `delete` | Ease | Delete, undo, or "Not now" on a suggestion | No pitch: a short, quiet breath of low filtered noise, dry (no reverb), gone in a quarter of a second | — |
| `control` | Touch | A button, menu page or setting | One low, muffled note from the current chord, gone in a third of a second | — |
| `speak-start` | Breath in | Clarte starts speaking, including "One moment" | A short swell that is already fading when the voice begins; then everything ducks | kept |
| `speak-end` | Breath out | The voice ends, or speaking is stopped | The lowest, simplest F voicing, with a long tail; the cycle returns home | kept |
| `unsure` | Hush | No word fits the groups typed so far | A suspended pair that neither rises nor falls. It plays one second late, and only if "No word" is still showing, so a passing state stays silent | — |
| `calibration-step` | Step | A calibration point is captured | One note, climbing the pentatonic scale point by point | — |
| `calibrated` | Arrival | Calibration is complete | A wide Fmaj9 over two octaves, the longest tail in the set | kept |

**Silent on purpose:** choosing a letter group, a look that only rests on a card, the dwell ring filling, live transcript words, the Cloud's faces, and screen changes that are not a choice. The dwell swell (a faint chord that opens while the ring fills) is on the listening page as an experiment, but no style uses it yet. Play it to decide.

## Measured

Every cue was rendered offline at 75% volume (the default) and measured in Chromium:

| Cue | Peak | Rise to full | Energy above 1 kHz |
| --- | --- | --- | --- |
| Opening | −27 dBFS | 337 ms | 0.0% |
| Settling | −25 dBFS | 316 ms | 0.0% |
| Bloom | −16 dBFS | 155 ms | 0.1% |
| Ease | −37 dBFS | 68 ms | 1.9% |
| Touch | −31 dBFS | 46 ms | 0.0% |
| Breath in | −22 dBFS | 202 ms | 0.2% |
| Breath out | −18 dBFS | 179 ms | 0.0% |
| Hush | −25 dBFS | 125 ms | 0.0% |
| Step | −25 dBFS | 27 ms | 0.1% |
| Arrival | −17 dBFS | 423 ms | 0.4% |

Peaks vary by about ±1 dB from play to play, because each play is slightly different.

No sample-to-sample jump is larger than 0.008, so no cue clicks. A limiter on the output keeps overlapping chords from adding up past the ceiling.

## Owner review (2026-11-07)

- **Kept as built:** Arrival, Hush, Breath in, Breath out, Bloom.
- **Removed:** Petal, the note per letter group. It was distracting, so choosing a group is now silent.
- **Replaced:** Glass and Ebb were distracting. Touch replaces Glass: one low, muffled note with no melody, 7 dB quieter. Ease replaces Ebb. It was first a low note too, but that still distracted, so it now has no pitch at all: a quiet, dry breath, 13 dB quieter than Ebb.
- **Calmer:** Opening and Settling. They were rising and falling arpeggios. Now each is one slow swell of an open fifth, about 6 dB quieter.
- **Removed from the listening page:** the "In context" sequences.

## Open questions

1. Step (calibration) was not reviewed. It is a single rising note per point, close to Petal in character. Keep it or silence it?
2. Should the dwell swell replace silence during a dwell? It makes the "gradient" literal, but it adds sound to every look.
3. Browsers keep audio locked until the first click or key. A pure-gaze session in a fresh tab starts silent until then. The product app will need a start gesture (for example during calibration) or a native wrapper.
