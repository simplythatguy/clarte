# setup-matt-pocock-skills in Clarte

Overlay for [SKILL.md](SKILL.md), which stays an exact upstream copy. Read that first. Where this page disagrees, this page wins, and [Skills for Clarte](../../docs/skills-for-clarte.md) wins over both.

**Status: occasional, not yet run.** AGENTS.md says not to run setup skills merely because they are present. Run it only when the owner asks.

What exploration will find, so the questions can be short:

- **Remote:** `origin` is `github.com/simplythatguy/clarte`.
- **Instructions file:** `AGENTS.md` exists and there is no `CLAUDE.md`, so the skill edits `AGENTS.md`. Add the `## Agent skills` block after the existing sections; never rewrite the Glossary or the skills guidance above it.
- **Issue tracker:** GitHub is the skill's default, but branch names such as `charoiteset/nat-14-voice-cloning` suggest the team tracks work in Linear (`NAT-14`). Ask; don't assume either. If it is Linear, record it under "Other" with the team's workflow in the owner's words.
- **Triage:** the `triage` skill is not installed here, so Section B is skipped and no labels are created.
- **Domain docs:** there is no `GLOSSARY.md`. Clarte's glossary is the Glossary section of `AGENTS.md`, with the UI vocabulary in `docs/design/QUADRANTS.md`. Point `docs/agents/domain.md` at those, or ask before creating a `GLOSSARY.md` that would duplicate them. There is no `docs/adr/` yet.
- **Monorepo signals:** none. Each prototype has its own `package.json`, but there are no workspaces, so single-context is right.
