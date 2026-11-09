# break-ui in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core.** `docs/design/BRIEF.md` requires a break-ui pass on every style, with its table in `REPORT.md`. Use it on the voice screens too.

## Where the toggle goes

Upstream puts a segmented control fixed at the bottom centre. On a gaze screen that spot is inside backend quadrants Q6 and Q7. It would either break the one-action-per-quadrant rule or be selected by gaze. So:

- On gaze screens, switch fixtures with a URL parameter (`?data=worst`, `?data=empty`, …) and the Menu's Demo section. Never add a `data-action` element for it, and run `check-layout.mjs` with each fixture.
- On the voice screens, the upstream bottom-centre toggle is fine. Keep it dev-only.

## What Clarte renders (start Phase 1 from this)

| Field | Source | Worst realistic cases |
| --- | --- | --- |
| Partner transcript | `shared/speech.ts` (Web Speech or the scripted fallback) | one long unpunctuated run-on; ASR mistakes; numbers and times; a name the decoder doesn't know; silence; two speakers in one turn |
| Message in progress | `shared/composer.ts` (`pendingGlyphs`) | 10+ pending groups; no candidate (one dot per group); a long word such as "responsibilities"; a double letter in one group |
| Autocomplete candidate | `shared/decoder.ts`, `vocabulary.ts`, or the Word Prediction engine | the longest vocabulary word, which must fit without moving a target (`MOTION.md`: reserve space for it); no candidate; a candidate that changes while the slot is armed |
| Accepted message | composer | a whole sentence that wraps to three lines at 200% text; a single word; empty |
| Saved phrases, Menu items | Menu | zero, one, more items than quadrants allow |
| Voice names | `app/src/myvoice/` (Menu › My voice) | long, emoji, non-Latin, duplicate, empty |
| Voice sources | upload and record screens | a 2-hour video; a file at the 300 MB cap; a clip with music or a second speaker; a 1-second recording; no usable speech |

## States that aren't datasets

Add these as extra toggle positions: tracking lost mid-dwell; camera or microphone permission denied; decoder offline (the engines fall back to Light); speech synthesis unavailable; voice service offline; model weights still downloading (about 3 GB on first start); dark theme; reduced motion.

## Environments

Gaze screens: 1440×900 and 1280×720 (the BRIEF's quality gate), each at 200% text. Voice: its real widths, plus 200% zoom.

## Truncation

Never truncate words the person might speak: candidate, message or saved phrase. Wrap, or reserve the room. A truncated transcript must stay readable in full by some gaze-reachable route.
