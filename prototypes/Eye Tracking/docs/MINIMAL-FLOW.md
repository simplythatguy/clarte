# Minimal flow implementation

Adapted from the corrected parent prototype's implementation notes. Packaging removes machine-specific workflow paths and historical verification claims; tracking behavior is unchanged. The imported surface uses light mode as subsequently requested. [Import details](IMPORT.md).

## Decisions

The latest user sequence overrides the old phrase surface and the general minimal-ui restriction on boxed items: **blank buttons are the navigation test targets**. The attached reference was opened with `view_image`. Its 1:2:1 columns, 1:2.25:1 rows, four blue cardinal targets, approximately 20 px gaps and rounded thin borders guide the grid. The subsequent light-mode request changes the surface to white, corners/center to light neutrals, and reference circles/selection to contrasting blues. At narrow widths the same grid fits without scrolling; gaps/radii reduce to 12/22 px. Desktop uses 20/28 px.

The implemented sequence is:

Start camera → Calibrate → Calibrate screen dimensions (three seconds) → nine circle references → Calibrate head movement → Calibrate → Follow with your head (three seconds) → five circle references → Calibrating (real training acknowledgement, Cancel) → Calibrate free flow movement → Calibrate → three-second introduction → 60-active-second held-out check → blank navigation automatically.

The ready free-flow page also offers Skip. Compatible saved weights are an explicit Use saved calibration action on the Calibrate page and restore navigation directly. Active capture shows only the reference circle plus the user’s later explicit exception: one 44 px diagnostic toggle fixed at the top right. There are no numbers, sample marks, instructions, camera previews, status captions, toolbars or result dashboard during capture. Introductions have one title and no paragraph. Errors and paused screens have one title and actions.

Escape/background click/tap opens controls. Background Space pauses capture while focused buttons retain normal Space activation. Continue is explicit, including focus/visibility recovery. Label acknowledgements that finish across a pause cannot silently start automatic training on focus. Prolonged unusable tracking opens a separate Face not detected / Tracking paused screen after eight seconds, without drawing messages over the reference circle. Stop always releases the owned camera resources.

The eye stage retains 9 × 3 distinct fresh labels. Head movement is the normal next stage with 5 × 3 more labels, one three-second introduction, and no per-point reading pauses. Every point retains full movement, settling and sample spacing; resumes retain the full travel/settle window. Training is automatic only after all 42 labels and remains a separate asynchronous stage. No input is enabled before its acknowledgement. The existing session/run/storage leases remain, including the lease taken **before** `await camera.train()`.

Free flow retains the pure raw-estimate validation runner. It never calls collect/train or changes weights, retains held-out target separation and active-time/fresh-frame rules, and automatically opens navigation at completion. Metrics are not shown as a calibration score. Instructed references do not prove eye position or actual head motion.

Navigation contains nine actual, blank buttons with accessible names. They support mouse, touch and native keyboard activation. Existing two-second steady-look/two-blink preview/confirm, lookaway cancellation, raw reopening, no-face/unknown rejection and post-commit latch remain. Preview is an inset border, confirmed selection changes fill/border, and neither changes geometry. There is no speech action, draft, message, letter, icon, caption or visible heading on this page. Optional dwell still uses neutral rearm.

Diagnostics are off by default. The dashed amber area uses the existing recent-estimate visualization, with a small center marker. It is separate from the blue/white selection state. It requires an in-bounds, finite, fresh, open-eye estimate and stays hidden before a usable prediction or during closure/loss/staleness/pause/Settings/Stop. Its overlay uses `pointer-events: none`; it does not change labels, validation data, blink evidence or target resolution. The upper control rail and initial reference geometry keep the icon separate from normal viewport targets. Toggle state and estimates do not persist. Simulation has an explicit camera-off entry title and screen-reader status.

## Parent resolution of independent review

The initial independent review found three P2 lifecycle issues. Fresh calibration now clears saved-choice mode, and only an untouched saved-choice ready screen can use the geometry-only resize shortcut; all active/completed calibration resizes reset the actual model sample owner. Interruption during pending saved restore retains its successful result behind Paused/Continue. Completed free-flow observations also remain behind an explicit pause if interrupted before navigation promotion. Visibility/focus recovery alone cannot remove that gate.

Eight retained regression cases exercise the actual App plus the real worker sample owner, including the 42-sample cap and explicit Continue after restore/check completion. The imported runtime logic and all tests are exact copies of the corrected parent source pin in [IMPORT-SOURCE.json](IMPORT-SOURCE.json). Fresh import verification is described in the [README](../README.md); historical scratch logs and media are not shipped as acceptance evidence. Synthetic gaze/focus fixtures do not establish physical-camera acceptance.
