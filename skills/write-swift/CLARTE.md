# write-swift in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: not in use.** Clarte has no Swift code. The prototypes are TypeScript in the browser, with Python services.

If a native macOS or iOS target is started (for example, native gaze capture or system speech), use this skill together with the Clarte contract:

- Processing stays on device.
- The camera and microphone are released when their purpose ends.
- Nothing commits or speaks without a selection, including after a late async result. Its §3 rules on actor reentrancy apply directly to that case.
