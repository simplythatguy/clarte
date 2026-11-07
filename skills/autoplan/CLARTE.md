# autoplan in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: needs the gstack runtime.** It loads the four plan reviews from the runtime; read their Clarte overlays too: [CEO](../plan-ceo-review/CLARTE.md), [design](../plan-design-review/CLARTE.md), [eng](../plan-eng-review/CLARTE.md) and [DX](../plan-devex-review/CLARTE.md).

## Decision principles, Clarte limits

The six principles stand, with these limits:

- **P1 completeness and P2 boil lakes** stop at the prototype boundary. UI v0's brief says to fight scope creep: "the deliverable is this style, not a product". A plan for one style doesn't auto-expand into `shared/` or another prototype.
- **P6 bias toward action** never covers the gaze contract or speech. These are always **User Challenges**, never auto-decided:
  - any change to what commits or speaks, or when
  - changes to the backend quadrant rules, rest zones or dwell timing defaults
  - consent, retention or deletion of recordings and voices
  - anything that sends data off the device
  - removing a capability from the six in `BRIEF.md`
- **Taste decisions** that touch the decided visual direction (`BRIEF.md` § Visual direction) are also User Challenges. The owner already decided them.

## Phases

- **Design phase** runs for every plan with a screen, including the voice screens.
- **DX phase** runs only for developer-facing surfaces: the Word Prediction `Predictor` API and `/api/predict`, the voice service HTTP API, the `s_all` launcher, run instructions, the session replay tooling, `scripts/validate.py`, and the skills themselves.

## Outside reviewer

The upstream Codex reviewer maps to the team's practice of a GPT Sol reviewer via `delegate_task` (see [sol-loop](../sol-loop/CLARTE.md)). Use it only when the host exposes it. Never substitute a different model silently.
