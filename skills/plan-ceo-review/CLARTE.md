# plan-ceo-review in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.**

## Mode

Prototypes exist "to decide, not to ship" (`prototypes/UI/v0/README.md`). Default to **HOLD SCOPE** for work on an existing prototype and **SCOPE REDUCTION** when a plan grows past one prototype. Use **EXPANSION** only when the owner asks for a product-level vision. No mode may trade away the gaze contract, consent, or local-only processing for scope.

## Prime directives, Clarte failure map

Directive 1 ("zero silent failures") matches Clarte's rule that a silent no-op is a defect. Trace each of these for any plan that touches them:

| Failure | What the person must see |
| --- | --- |
| Tracking lost, or face not detected | a tracking state within about 0.5 s; pending dwell suspended; draft kept |
| Camera or microphone permission denied | where to fix it, reachable by gaze |
| Decoder or server unavailable | groups kept, Light fallback or exact spelling, retry |
| Speech synthesis fails | the message kept; Say again or retry |
| Voice service offline, or weights missing | the offline prompt; nothing half-made |
| A late response after the person moved on | never commits and never speaks |
| Saved calibration stale for this camera or window | not reused without a check |

Directive 5 ("dashboards, alerts and runbooks are launch scope") becomes local evidence for Clarte: selftest and layout checks, session replay reports, voice evaluation metrics, and run instructions in each README. There is no telemetry, by design.

## Dream state

The 12-month ideal comes from `prototypes/UI/v0/RESEARCH.md` §11 (about 10 wpm, a cap near 20) and the BRIEF's "what a good session feels like". Measure plans against that, not against generic growth metrics.
