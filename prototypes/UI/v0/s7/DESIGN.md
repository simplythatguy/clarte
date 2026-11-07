# Style 7 · Cloud

A copy of style 6 · Orb, so the changes below can be compared without touching style 6. Style 6 v1 (PR #14) stays as the reference. Everything not mentioned here is style 6's: the grid, the cards, the thread, the branch, setup, calibration, type and motion. See [../s6/DESIGN.md](../s6/DESIGN.md).

In `s_all` (http://localhost:5100) style 7 has two entries: **S7** (Soft palette) and **S7V** (Vibrant palette). On its own, it runs at `http://localhost:5107/?onboarding=off&palette=soft` or `&palette=vibrant`. `?gallery&palette=…` shows every face.

## What the owner asked for (2026-11-07)

1. Copies with variations to compare, like `s_all`, not changes to the current UI.
2. The cloud in the middle only while that space is blank. It fades out as soon as new text appears and back in when the text is gone, with a face animation on the way out and on the way in.
3. More reactions, added to the first eight.
4. A vibrant palette next to the faded one: solid blue, purple, green and orange letter cards with white letters, for more contrast.

Tried and removed at the owner's review (2026-11-07): a 2D speech-bubble character, a 3D ball in three.js, a Deep palette, and a switcher menu at the top right. Only the Cloud and the Soft and Vibrant palettes remain.

## When the Cloud is there (`App.tsx`, `Companion.tsx`)

The Cloud is there only while the middle is blank. "Blank" means no live text: no words heard from the partner yet, no message being typed, nothing being spoken, and no menu title. History does not count, because it is old text above the live line.

| What happens | The Cloud |
| --- | --- |
| A turn ends (heard or spoken) | comes back, wearing the turn's reaction for 8 s, then At rest |
| Listen, before any words | stays, wearing Listening |
| The first words are heard, the first group is typed, Speak, or Menu | leaves |

- **Leaving:** the face's strokes erase themselves in reverse, the last drawn first, each one retracting to where the pen started (140 ms each, 40 ms apart). Then the orb fades and shrinks to 88% over 420 ms.
- **Entering:** the orb fades in and returns to full size with a soft overshoot. The pen starts at 260 ms and draws the face stroke by stroke.
- **Changing face:** the old face erases, then the new one draws.
- **Reduced motion:** the faces cross-fade over 150 ms.

The face rides the orb's lean, drift and swell. In the light theme it is drawn in a deep shade of the orb's own hue and multiplied into the gradient. In the dark theme (owner, 2026-11-07: the pale screen-blended line looked wrong) it is a warm glowing line in the mood's own hue, with a faint glow, about 5:1 on each mood's deepest point: peach `#FFB48A` at rest, coral when listening, apricot when replying, and mint `#8FE3AE` when speaking. It sits in the Q2–Q3 rest zone, has no action and is `aria-hidden`. `check-layout.mjs` reports no backend quadrant violations in any phase.

## Faces (`expressions.ts`, `sentiment.ts`, `SketchFace.tsx`)

There are 20 hand-drawn faces: 2 states, 7 positive, 7 negative and 4 neutral.

| Group | Faces (the cues that trigger them, abridged) |
| --- | --- |
| States | At rest; Listening (Listen pressed, nothing heard yet) |
| Positive | Content (thanks, okay, fine), Happy (great, sunny, glad), Loving (love, miss you), Laughing (haha, funny), **Excited** (excited, can't wait, yay), **Proud** (proud, did it, well done), **Silly** (kidding, joke, cheeky) |
| Negative | Sad (sorry, upset, bad news), In pain (hurts, ache, sore), Tired (tired, didn't sleep), Worried (scared, nervous), **Cross** (angry, annoyed, fed up), **Unwell** (sick, dizzy, fever), **Cold** (cold, freezing, shivering) |
| Neutral | **Surprised** (wow, no way; "Really?"), **Curious** (hmm, I wonder, maybe), **Confused** (huh, "What do you mean?"), **Hungry or thirsty** (hungry, starving, thirsty, a drink) |

New faces are in bold. The rules are style 6's:

- Only statements react, except that surprise and confusion also react to questions.
- The most specific feeling in a sentence wins.
- The last sentence that reacts wins.
- A negated cue turns over: "not hungry" is Content.
- "Good!" is Happy.

A model should replace this word list.

## Palettes (`variant.ts`: `?palette=`)

| | Soft (style 6) | Vibrant |
| --- | --- | --- |
| Letter cards | 8% tints, coloured letters | Solid fill, white letters |
| Blue, purple, green, orange | `#1E5A82` `#59409A` `#2B6A4C` `#8A4A22` | `#2563EB` `#7C3AED` `#16A34A` `#EA580C` |
| White letters on the fill | not applicable | 5.2, 5.7, 3.3 and 3.6 : 1 |
| Orb | light orange, 60% | saturated orange, 72% |
| Greys | style 6 | secondary ink a step darker |

The letters are 36 px and bold, so they count as large text, with a 3:1 floor. Green and orange pass that floor but not 4.5:1.

**The dwell on a solid card.** It cannot turn the card white, because white letters would vanish. On Vibrant the look deepens the card instead: the focus step darkens it by 8%, and a dark wash (26% black) rises over the remaining dwell, so the letters only gain contrast. A selection adds a white inner ring and an ink outer ring. While letters are unavailable (listening or speaking), the card falls back to a pale tint with coloured letters, so off reads differently from on.

**On the orb**, Vibrant's deepest points keep ink at 6.9:1 or more, and secondary ink (partner turns) at 4.4–5.7:1, lowest on Listening's coral.

## Open questions for the owner

1. Should the Cloud leave for the menu too (it does now, because the title is text), or stay behind the blurred thread as the orb did in style 6?
2. Should it react while the partner is still talking, not only when the turn ends? Today the first heard word sends it away.
3. Is 8 s right for a reaction, or should it stay until the next turn?

## Evidence

In `evidence/`, real renders of the running app at 1440×900:

- `cloud-idle`, `cloud-idle-vibrant` and `cloud-idle-dark`: the seeded conversation, wearing In pain for "My back hurts";
- `cloud-suggested-vibrant`: Happy for "It is sunny", with the Vibrant letter cards;
- `leave-enter-frames`: the Cloud leaving as text appears, then entering as it clears;
- `gallery-cloud`: every face.
