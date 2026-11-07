# Motion and craft bar

The owner's bar for every style: **equal to or better than the Neuralink Link app's calibration flow** (`reference/08-calibration-motion-reference.webm`, stills in `reference/calibration-frames/`). Not "inspired by". Equal, minimum. This page says what that flow actually does, with timings measured from the video at 20 frames per second, and how each property translates to Clarte's light surface. The rules of `skills/review-animations`, `skills/choreograph`, `skills/animation-performance`, `skills/emil-design-eng` and `skills/apple-design` apply on top; where the gaze research in `RESEARCH.md` is stricter (nothing moves while a target is armed, no idle motion, luminance constant), the research wins.

## What the reference does

Watch it twice before building anything. What makes it feel the way it does:

1. **Stillness is the default.** Between events the screen is completely static: no breathing, no ambient motion, no cursor trails. Motion happens only when something happens, and then only to the one thing it happened to.
2. **One thing at a time.** One title, one caption, one active target. Other targets are quiet 1 px outlines. Nothing competes.
3. **Tiny, exact geometry.** 1 px rings, perfectly concentric circles, one caption pill with one highlighted word, a cursor ring that never changes. The precision is the luxury.
4. **One colour per meaning.** Blue means click, orange means dwell, green means follow. A colour never means two things.
5. **The only celebration is the bloom.** When a target is achieved it blooms outward and fades. Everything else is a fade or a fill.
6. **Captions type themselves**, fast, one line at a time, with the key word highlighted in the meaning's colour.
7. **Pacing breathes.** After every achieved target there is a beat of stillness before the next target appears.

## Measured timings

Frame analysis of the reference (20 fps, changed-pixel counts and target-region colour per frame; script in the research scratch, numbers rounded to 50 ms):

| Moment | Measured | Form |
| --- | --- | --- |
| New target appears | ≤ 200 ms | opacity in, no movement |
| Target saturates as the cursor approaches (click targets) | about 600 ms, gradual | fill brightens from dim to full with proximity |
| Click achieved | about 450 ms | bloom: the filled disc scales to roughly 2.5× while its opacity falls to 0, soft edge |
| Dwell target fills | about 800 ms, even | the disc fills from inside; the ring brightens at completion |
| Dwell target leaves | about 300 ms | shrink and fade |
| Pursuit ring draws | about 700 ms | four arcs draw simultaneously from four dots |
| Pursuit ring holds, then dissolves | about 500 ms + about 500 ms | arcs shorten and fade |
| Caption line appears | instant | pill appears whole, then text types |
| Caption typing | about 32 ms per character (950 ms for 30 characters) | typewriter, keyword highlighted |
| Beat of stillness after an achieved target | 1.5 to 3 s (user paced) | nothing moves |
| Screen to screen | about 300 ms | cross-fade |

## Translation to Clarte

The reference is dark; Clarte is light (RESEARCH §4). Everything else carries over.

### Tokens

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* enters, exits, releases */
  --ease-move: cubic-bezier(0.77, 0, 0.175, 1);     /* the one thing that travels: the calibration guide dot */
  --ease-state: cubic-bezier(0.2, 0, 0, 1);         /* in-place state changes */
  --dur-press: 120ms;      /* commit cue on a tile */
  --dur-cue: 150ms;        /* focus cue, label cross-fade, cancel drain */
  --dur-settle: 180ms;     /* glyphs settling into the word */
  --dur-enter: 200ms;      /* a target or caption appearing */
  --dur-phase: 300ms;      /* phase cross-fade; exit 150ms, enter starts at 100ms */
  --dur-bloom: 450ms;      /* the one celebration */
  --type-ms: 32;           /* caption typing, per character */
}
```

Never `ease-in`. Never `transition: all`. Never a keyframe on anything that can be interrupted; the dwell ring, the cancel drain and every state change are transitions or Web Animations that retarget from the current value. Progress is `linear`, because it encodes time.

### The dwell indicator

The two-circle motif from the visual direction: a solid dot in the group ink (identity, static) and a ring around the label (the dwell).

- Ring: 1.5 px stroke, tertiary ink at 30%, radius so it clears the label by 12 px. It is present on every tile at rest, which is what makes it an instrument rather than a box: no second surface, no border.
- Intent delay: nothing changes for 150 ms on groups and 250 ms on controls.
- Focus cue at the end of the delay: the tile face steps one shade (`--dur-cue`, `--ease-state`) and the ring's track becomes fully opaque. One static step, not a pulse.
- Progress: an accent `#0071E3` arc, 3 px, draws clockwise from 12 o'clock, `linear`, over the remaining dwell. Implement it as a CSS transition on a registered `--progress` custom property feeding `stroke-dashoffset` or a conic mask, so it drains back over 150 ms when gaze leaves instead of snapping.
- Commit: the arc completes, the ring becomes solid accent for 120 ms, the click plays on that frame, and the bloom runs: a copy of the ring scales from 1 to 2.4 with opacity 0.35 to 0 over 450 ms `--ease-out`, on a pseudo-element with `transform` and `opacity` only, overflow visible, so layout never moves. The label does not move. The face returns to rest over 150 ms.
- Re-arm: the ring stays solid accent while gaze remains; it fades to the track over 150 ms once gaze has left and the engine re-arms.
- Reduced motion: no bloom. The arc is replaced by the ring's opacity stepping 0.3 → 1 in four steps across the dwell; commit is the 120 ms colour step.

### Choreography of the frequent moments

Cast every event before coding it (lead, support, decoration, static) and write its timeline; `skills/choreograph` has the format. The frequent events are below; they finish within 300 ms and nothing on them is decorative.

| Event | Lead | Support | Static |
| --- | --- | --- | --- |
| Group committed | the new glyph appears in the word in progress, opacity in over 150 ms, no movement | tile commit cue and bloom | every other tile, the band, the transcript |
| Word accepted | glyphs settle from group ink to ink over 180 ms, opacity and colour only | primary tile relabels, but only after gaze has left it | groups |
| Delete | the removed glyph fades out over 120 ms; siblings do not slide | tile commit cue | all |
| Candidate changes while typing | the ghost letters cross-fade, 150 ms | nothing | the typed glyphs, which never move |
| Speak | the highlight steps word to word on the speech boundary, an instant swap | the band colour over 300 ms | all |
| Listening starts or stops | the band colour and label cross-fade over 300 ms; the recording dot appears over 200 ms | tiles quiet or wake over 300 ms by opacity | positions |
| Phase or page change | one cross-fade in place: outgoing 150 ms, incoming 300 ms starting at 100 ms | nothing | the grid, the band |

One entrance per container. No staggered children on anything the person sees more than once a session. No motion at all on keyboard-triggered actions. Every exit is shorter than its enter. Menus and sheets fade in place; nothing slides across quadrants.

### Captions (calibration and first run only)

A white pill (`#FFFFFF`, 1 px hairline `#D2D2D7`, radius 12, padding 10 × 14) holding one line of 20 px/500 ink text. The pill appears whole over 200 ms, then the text types at 32 ms per character with a 180 ms rest after a full stop or comma. The key word is a span with the meaning's colour at 14% behind it and that colour as its ink: accent blue for anything about dwell, the group ink when a caption names a group. One line at a time; when the next line starts, the previous line settles to secondary ink and stays until the step ends. The caret is a 1 px ink bar that does not blink faster than 1 Hz. The caption sits 24 px from the active target, on the side with room, and never covers a target.

### The calibration sequence, step by step

Light canvas throughout, so the working brightness is the calibrated brightness (RESEARCH §10). Every target is a 1.5 px outlined circle, 28 px across at 1440×900, with a 6 px solid dot at its centre when active.

1. **Position.** One ring, 38% of the shorter side, centred. Caption types "Sit so your face fills the circle." When the simulated check passes (1.2 s), the ring's stroke becomes accent over 200 ms and the fill tints to accent at 12%; caption types "Good." Beat of 600 ms.
2. **Nine points.** All nine outlines fade in together over 200 ms at 30% ink, reading order, covering the grid extremes. The guide dot travels to the first point over 1200 ms with `--ease-move`, settles for 1800 ms during which the point's ring fills clockwise in accent (the same ring as the app's dwell indicator, so the person learns it here), then blooms (450 ms) and fades to a 30% outline. Beat of 400 ms. Travel to the next. Caption types "Follow the dot." before the first travel and nothing else until the last point.
3. **Check.** Four different points, same choreography, travel 900 ms, settle 1200 ms. Caption: "One more look."
4. **Ready.** Title "Ready", the result in plain words in secondary ink, the primary action in the style's primary quadrant. Cross-fade into the app over 300 ms with no luminance change.

About 40 s in total. Escape skips for demos. Reduced motion: the guide dot jumps and the rings fill by opacity steps.

## Craft rules that make it read as finished

- Spacing on an 8 px grid; radii concentric (outer radius equals inner radius plus padding); labels optically centred, not geometrically; baselines aligned across a row of tiles.
- Strokes: 1 px hairlines, 1.5 px rings and icon outlines at 1× on a 24 px grid with rounded caps; no shadows; no borders on tiles.
- Type: tracking by size (display −0.02em, labels 0, the letter rows +0.14em); leading tight on display, comfortable on the message; weights 500 and 700 only.
- Nothing changes layout on a state change. Reserve the space for every label variant, the longest candidate word, the band, and the bloom overflow.
- Animate `transform`, `opacity`, `color`, `background-color`, `stroke-dashoffset` and `clip-path` only. `will-change` only on the ring and the bloom. No `filter: blur` on large surfaces.
- Every transition names its properties and its easing token. Every exit is shorter than its enter.
- Record each flow and scrub it at 10% speed in the DevTools Animations panel. Fix what you see, then look again the next hour with fresh eyes.

## Acceptance

A reviewer scrubs the style's recording frame by frame and confirms all of these, or the style is not done:

1. Nothing moves or changes while no event is happening (idle is still).
2. The first 150 ms (groups) / 250 ms (controls) of a look show no change; the focus cue is a single step; the arc then fills evenly with no jitter.
3. Leaving a tile drains the arc; it does not snap.
4. Commit shows the solid ring, the click and the bloom on the same frame; the bloom never shifts a pixel of layout.
5. A phase change is one cross-fade with no sliding, no staggered children, no luminance jump.
6. Captions type at 30 to 35 ms per character; the keyword is highlighted; one line at a time.
7. The calibration guide dot travels with one easing and the ring fills at the same rate as the app's dwell ring.
8. The Performance panel shows no layout or paint work during a dwell beyond the ring's composite.
9. Under reduced motion, every one of the above still conveys the same information without movement.
10. The 50th-use test: watching the compose loop ten times in a row, nothing feels slow and nothing asks to be skipped.
