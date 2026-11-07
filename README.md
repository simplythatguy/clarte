# clarte

Skills for planning, inline HTML design, codebase cleanup, Sol review, and readable pull requests.

| Skill | Purpose | Source |
| --- | --- | --- |
| `office-hours` | Understand the problem, challenge premises, compare approaches | [gstack](https://github.com/garrytan/gstack/tree/main/office-hours) |
| `autoplan` | Sequential CEO → design → DX → engineering plan review | [gstack](https://github.com/garrytan/gstack/tree/main/autoplan) |
| `design-html` | Generate and refine Pretext-native inline HTML/CSS | [gstack design-html](https://github.com/garrytan/gstack/tree/main/design-html) |
| `untangle-codebase` | Reduce hidden dependencies and unnecessary structure | [Caldo](https://github.com/caldoai/skills/tree/main/skills/untangle-codebase) |
| `sol-loop` | Bounded GPT Sol review and repair loop | [tstack](https://github.com/t3dotgg/tstack/tree/main/skills/sol-loop) |
| `pr` | Visual summary, concrete evidence, merge risk | [Matt Pocock](https://www.aihero.dev/skills-pr) |
| `lintapple-ui` | Check implemented web UI against its design policy | [Lint Apple](https://lintapple.vercel.app/) |

Also included: `plan-ceo-review`, `plan-design-review`, `plan-devex-review`, and `plan-eng-review` (autoplan prerequisites), plus `setup-matt-pocock-skills` with all its templates (Matt's recommended per-repo setup).

## Install

Select skills with the skills CLI:

```sh
npx skills@latest add simplythatguy/clarte
```

For one skill:

```sh
npx skills@latest add simplythatguy/clarte --skill design-html
```

The CLI copies skill instructions; it does **not** install external runtimes or automatically resolve sibling skills. Install `lintapple-ui` alongside `design-html`. For `autoplan`, select all four `plan-*-review` skills and `office-hours` as well. Select `setup-matt-pocock-skills` alongside `pr` if you want Matt's recommended setup. See [dependencies and setup](docs/dependencies.md) before using the gstack skills.

### gstack runtime is required

The gstack planning and design skills are faithful upstream copies, including their sections, manifests, and skill-local helpers. They contain absolute gstack paths and are **not standalone prompt files**. Their shell helpers, publication guards, runtime state, and host-specific review machinery require the full pinned gstack installation. Merely installing these folders with the skills CLI is insufficient.

Follow the [pinned setup instructions](docs/dependencies.md#gstack-runtime). Codex users should use gstack's `--host codex` generated entrypoints instead of installing these raw Claude-oriented planning and design copies. Avoid duplicate registrations when gstack and this collection expose the same planning and design skills. Clarte does not run installation, onboarding, telemetry, or configuration changes on your machine just by being cloned.

### Inline HTML and UI

`design-html` retains the original gstack workflow: design analysis, Pretext-native HTML/CSS generation, browser preview, and refinement. Its sections and bundled `vendor/pretext.js` are included. Like the planning skills, it requires the full pinned gstack runtime. Use `lintapple-ui` to check the rendered HTML against the project's design policy.

`sol-loop` improves correctness through independent reviews; it does not tune the writer model or promise better results on every task. It requires access to an actual Sol reviewer through supported delegation.

## Sources and verification

Read [the source/dependency audit](docs/dependencies.md) for mandatory versus optional dependencies, upstream website findings, and integration limits. [sources.lock.json](sources.lock.json) pins upstream commits and hashes of copied files. The upstream planning, inline HTML design, cleanup, Sol, PR, and Matt setup files are preserved; `lintapple-ui` is Clarte's integration skill.

```sh
python3 scripts/validate.py
```

This validates copied-file integrity, skill metadata, bundled phase/section files, and local Markdown links. It does not prove a live gstack review, HTML generation session, or rendered UI audit. No application UI is implemented in this repository.

Upstream copyright, license texts, and third-party notices are retained in `licenses/` and each distributed skill. Clarte's original additions are MIT licensed; upstream material retains its original notices.
