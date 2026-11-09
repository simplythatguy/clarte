# pr in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core** for writing PR bodies. It only formats the body; opening and pushing a PR are separate decisions.

## Domain language

There is no `GLOSSARY.md`. Clarte's vocabulary lives in the Glossary section of `AGENTS.md` and in `docs/design/QUADRANTS.md`. Use those terms as defined:

- backend quadrant and Q1–Q8 in reading order; frontend quadrant; rest zone
- G1–G4 with their letter ranges
- Listen, Respond, Speak
- UI v0, s0–s5

In prose, never call a backend quadrant a "cell", "zone" or "tile".

## Evidence that counts here

| Change | S-tier | A-tier |
| --- | --- | --- |
| Gaze UI | screenshots at 1440×900 with the developer overlay showing zero violations, before and after | `selftest.ts` and `check-layout.mjs` output for every phase |
| Motion | a recording scrubbed against the `MOTION.md` acceptance list | `review-animations` table |
| Tracker accuracy | the session replay report from `npm run test:sessions` on recorded sessions | unit and model checks. Synthetic fixtures don't show accuracy; say so. |
| Voice | a listening note plus `scripts/evaluate.py` similarity, rate and WER | `pytest` and `npm test`. Synthetic impairment doesn't prove intelligibility. |
| Skills | — | `python3 scripts/validate.py` |

**Never put a face, eye crop, session video, voice recording, cloned clip or partner transcript in a PR.** Use the replay report's numbers, a screenshot with the camera preview off, or a described result.

## Merge Danger in Clarte

One-way doors include:

- changing what is stored or retained (calibration storage keys such as `still.local-calibration.v1`, the voice folder layout, consent records)
- anything that deletes voices or recordings
- loosening the CSP, CORS or loopback binding
- replacing an exact upstream copy in `skills/` or the imported tracker source
- changing what can auto-commit or auto-speak

Name the blast radius in Clarte terms: the gaze route, speech output, the partner's view, stored calibrations.

End PR descriptions with the attribution line the session's instructions specify.
