# apple-design in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional.** For Apple's interface rules applied to Clarte, read [apple-hig-ui](../apple-hig-ui/SKILL.md) first. This skill is the WWDC motion-and-gesture companion, and most of its gesture physics has no gaze equivalent.

## Sections that don't apply to gaze screens

- **§1 Response: "respond on pointer-down, kill latency."** Gaze inverts this. Feedback is deliberately withheld for 150 ms on groups and 250 ms on controls (the intent delay), so a glance lights nothing up (the Midas touch problem; BRIEF, RESEARCH §2–3). The ceiling is 250 ms, with 100 ms preferred, *after* the intent delay.
- **§2, §5, §6, §9, §10: direct manipulation, velocity handoff, momentum projection, rubber-banding, gesture hysteresis.** Gaze has no drag and no flick. The gaze engine's quadrant hysteresis plays the role of §10's hysteresis; tune it in `shared/gaze.ts` settings, not with these formulas.
- **§3–4 springs and interruptibility.** The principle holds: the dwell arc retargets from its current value and drains on cancel. Springs do not; nothing on a gaze screen bounces.
- **§12 materials and translucency.** Not used: no translucent layers, no backdrop blur, no shadows, no dimming scrims. They spend luminance and draw the eye to edges (BRIEF luminance and colour rules).

## Sections that apply

- **§13 multimodal harmony.** The commit click (≤100 ms) plays on the same frame as the solid ring and the bloom (`MOTION.md`). Sound is optional and never the only cue.
- **§14 reduced motion, transparency, contrast.** Applies. Also avoid oscillation near 0.2 Hz and abrupt brightness changes. In Clarte, avoid brightness changes entirely.
- **§15 typography.** Tracking by size, leading inverse to size, and weight before size all match `MOTION.md`'s craft rules. Clarte uses Satoshi 500/700 rather than the system font, by decision.
- **§16 the eight principles.** Agency: nothing happens on its own, and the person can always leave. Responsibility: consent for voice cloning, local-only processing, and never inferring wishes from behaviour. Simplicity, not minimalism: never remove a capability to look simpler (BRIEF § Capability).

## Voice prototype

It is a pointer surface for people with tremor, so §1 and §10 apply, with 64 px targets and nothing on a timer.
