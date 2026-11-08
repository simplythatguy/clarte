# plan-devex-review in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.** Most Clarte plans are end-user UI. The applicability gate should send those to the design review.

## Clarte's developer-facing surfaces

| Surface | Product type |
| --- | --- |
| The prediction engine (`main/engine`): `/api/v1/predict` (CONTRACT.md), the `/api/predict` compatibility route and the `wordpred` package it builds on | Library/SDK and API |
| The voice service HTTP API (`/voices`, `/voices/{id}/speak`, …) | API/Service |
| `node prototypes/UI/v0/s_all/serve.mjs`, each prototype's run steps, `npm run test:sessions` | CLI Tool and Documentation |
| `skills/`, the `CLARTE.md` overlays, `scripts/validate.py` | Claude Code Skill |

## Personas

Clarte contributors and the agents working with them, on macOS, often running several prototypes at once. Don't invent outside adopters.

## Time to hello world

Measure from a fresh clone to a running `s_all` preview with real predictions, and to a first spoken phrase in a made voice. Count the real steps:

- per-style `npm ci`
- the Python environments
- building the Word Prediction native libraries and fetching its model artifacts
- the voice weights (about 3 GB on first start)

Missing artifacts should fail with the next command to run (DX principle 5, "agent-ready errors"). Light fallback is an escape hatch and should say that it is one.

## Agents are users

Errors from the voice service and the engines should name the missing piece and the command that fixes it, so an agent can repair or escalate without reading the source.
