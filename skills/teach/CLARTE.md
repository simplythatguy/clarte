# teach in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional, run only when asked.** The skill turns on only when the owner asks to learn something (`disable-model-invocation`). It never starts on its own.

## Where the teaching workspace lives

The skill writes `MISSION.md`, `RESOURCES.md`, `NOTES.md`, `lessons/`, `reference/`, `learning-records/` and `assets/` into the directory it runs in. Never run it at the repository root or inside a prototype folder, because those files would mix with Clarte's code and docs. Ask the owner for a directory outside the repository, or use a git-ignored folder they name.

## Topics that touch Clarte

- Ground lessons in Clarte's own sources first: `AGENTS.md` (Glossary), `prototypes/UI/v0/README.md` (backend quadrants), the gaze contract in [Skills for Clarte](../../docs/skills-for-clarte.md), and each prototype's README. Use Clarte's vocabulary: backend quadrant, rest zone, dwell, G1–G4.
- Lessons and reference pages are HTML pages people read. Follow the type rules Clarte already uses: nothing under 18 px, no thin weights, sentence case and no all caps.

## Privacy

Face video, eye crops, test sessions, voice recordings, cloned speech and partner transcripts never go into a lesson, a reference page, a learning record or a resource list. Use synthetic or sample data, as the UI prototypes' debug phases do. Lessons that need a real tracker or a real voice describe the steps and leave the data on the owner's machine.
