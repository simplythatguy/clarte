# diagram in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.** It renders nothing without `gstack-render` and the diagram bundle. Without them, write the Mermaid or ASCII source into the Markdown it belongs to and say that no SVG, PNG or `.excalidraw` file was produced.

## Clarte's standard diagrams

Keep these consistent wherever they appear.

- **Backend quadrants:** 2 rows × 4 columns, Q1–Q8 in reading order (Q1–Q4 on top). Never renumber, and never draw a different count. Mark rest zones as empty cells. Matches `docs/design/QUADRANTS.md` and `docs/design/reference/01-backend-quadrants.png`.
- **Conversation flow:** Listen (partner speaks, transcript as context) → Respond (letter groups, autocomplete, delete) → Speak (with Say again) → Listen. One moment and Menu sit beside the loop, not inside it.
- **Gaze pipeline:** webcam → WebEyeTrack worker (gaze network) plus the geometric estimator → blend → backend quadrant with hysteresis → dwell or blink engine → the action that owns the quadrant.
- **Decoding:** G1–G4 group sequence plus partner context → Word Prediction engine (Light, or Deployable with fallback to Light) → candidate → accepted only by a selection.
- **Voice:** recordings from before or speech today → segmenting and scoring → speaker check → 10–15 s reference → Chatterbox Turbo (Like my recordings, or Steadier) → Perth watermark → per-voice phrase cache.

Every arrow out of the device must be absent. If one appears, the design has a privacy problem, and the diagram should show it, not hide it.

## Rules

Diagrams describe systems. Never embed a face, an eye crop, a recording or a transcript as an image. Use Clarte's vocabulary from the Glossary in `AGENTS.md`.
