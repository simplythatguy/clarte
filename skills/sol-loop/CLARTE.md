# sol-loop in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: core**, when the user says "sol loop".

## Scope

Clarte often has untracked prototype folders in the working tree (a new prototype before its first commit). Include untracked files only when they belong to the change under review, and list the paths in the brief. Never include, and never ask Sol to read:

- `sessions/` and replay sets, which hold face video
- `~/.clarte/voices` or any voice recording or cloned clip
- `.venv/`, `node_modules/`, downloaded model weights

## Checks to run and report in the brief

Use the per-surface table in [Skills for Clarte § Checks per surface](../../docs/skills-for-clarte.md#checks-per-surface). Run only the rows the change touches. Say which checks need hardware that the reviewer can't use: a camera, a microphone, the 3 GB voice weights, or the Word Prediction artifacts.

## Budget extension

Extend to 5 rounds for Clarte's equivalents of the upstream security and data-loss class:

- consent capture and storage
- recording and transcript retention
- camera and microphone lifecycle (release on Stop, no restart on tab return)
- CSP, CORS and loopback binding
- voice deletion
- anything that could commit or speak without a selection

## Out of scope by default

Upstream-copied skill files, `prototypes/Eye Tracking` source copied from its pinned import, and vendored code. A finding in those is a follow-up, not a fix in this loop.
