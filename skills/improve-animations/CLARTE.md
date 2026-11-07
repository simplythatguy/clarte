# improve-animations in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core** for auditing a whole prototype.

## Where plans go

Write plans beside the surface they change: `prototypes/UI/v0/plans/`, `prototypes/Voice/plans/`, and so on. Don't write them at the repository root. Each prototype is a separate app, and the plan's executor works inside one.

## Recon facts to hand every subagent

- **Stack:** Vite, React 19 and TypeScript; plain CSS with tokens in `:root`; no motion library and no UI kit in UI v0.
- **Motion tokens:** the `MOTION.md` token block. The voice prototype has its own tokens in `src/styles.css`.
- **Frequency map:** the Clarte tiers in [Skills for Clarte](../../docs/skills-for-clarte.md#motion-translated).
- **Settled decisions:** `BRIEF.md` and `MOTION.md` (upstream Hard Rule 5). Don't report the dwell arc's length, the 450 ms bloom, the absence of staggers, or fades without a transform.
- **Ownership:** `shared/` belongs to the v0 brief. A plan that needs an engine change proposes it and doesn't edit `shared/`.

## A ninth audit category: gaze safety

Run it on every gaze screen. Check for: motion while armed; idle motion; luminance change; footprint change (press scale, hover lift, relabel before gaze leaves); motion crossing backend quadrants; and the `MOTION.md` acceptance list. Any hit is **HIGH**, alongside the upstream feel-breaking class.

## Execute

`improve-animations execute` starts an executor subagent in a worktree. Run it only when the user asks for execution. UI v0 work stays uncommitted for team review (BRIEF deliverables).
