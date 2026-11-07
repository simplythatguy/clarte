# plan-design-review in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.** Read [apple-hig-ui](../apple-hig-ui/SKILL.md) before scoring. Its "Verify a screen" list is the per-screen check.

## Classification

Gaze screens and the voice screens are **OPERATE**. Clarte has no Persuade surface in scope.

## Design principles, translated

| Upstream | In Clarte |
| --- | --- |
| 1. Empty states are features: warmth, primary action, context | The empty state makes the next action apparent, with no filler, instructional paragraph or count of zero (`minimal-ui`, apple-hig-ui). No warmth copy. |
| 6. Responsive means designed per viewport | 1440×900 and 1280×720 at 200% text for gaze screens. Phones are not a target unless the plan says so. |
| 7. Accessibility in the plan | Plus a complete gaze route on its own, keyboard and switch beside it, and a screen reader that gets announced changes, not every gaze sample. |
| Krug: 44 px targets, trunk test, persistent navigation | One action per backend quadrant, with rest zones. One major thing per screen. A location label only when it names the view. |

## Passes, Clarte coverage

- **Pass 2, interaction states.** Every action needs: idle, intent delay, focus cue, dwell progress, commit, re-arm, disabled, unavailable with reason, and tracking lost. Every phase needs: Listen, Respond, Speak, Say again, One moment, Menu, and Spell where designed.
- **Pass 3, journey.** Storyboard a whole turn with the partner across the table, including the 50th reply of the day and a tired person.
- **Pass 4, AI slop.** Compare against the owner's mock (`reference/11-light-direction-mock-1440x900.png`). Matching or beating it is the bar (BRIEF § Visual direction).
- **Pass 5, design system.** `s0/DESIGN.md`, `BRIEF.md` § Visual direction, and the `MOTION.md` tokens. Note the open conflicts listed in [Skills for Clarte](../../docs/skills-for-clarte.md#open-conflicts-in-the-sources).

## Mockups

The designer sends prompts and images to an outside model. Never include camera frames, faces, real transcripts or voice data. Use the mock and real UI copy only.
