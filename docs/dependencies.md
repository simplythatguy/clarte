# Source and dependency audit

These skills are development tools for building Clarte, an application for giving back clarity of speech to people with dysarthria and motor disabilities. Sources were audited from the commits recorded in `sources.lock.json` and the first-party pages below. The bundled files do not replace the gstack runtime.

## Dependency decisions

| Requested skill | Required skill files | Runtime / project prerequisites | Included decision |
| --- | --- | --- | --- |
| office-hours | Its phase sections and shared preamble | Full gstack setup for brain/context, design discovery, runtime helpers, and host integration | Generated skill files copied, including all sections and local helpers; generator templates omitted |
| autoplan | plan-ceo-review; plan-eng-review; plan-design-review when UI is in scope; plan-devex-review when DX is in scope | Full gstack setup, Bun, host review tools, phase publication guard, snapshots and gate helpers | All four review directories and their section files included; office-hours included for its prerequisite offer |
| design-html | Its shared preamble, UX doctrine, craft, Pretext patterns, and conditional detector-offer sections | Full gstack runtime and browser tools; bundled Pretext for standalone HTML; project package for framework integration | Original entrypoint, all generated sections, and vendor/pretext.js included |
| frontend-design | None named; skill-local LICENSE.txt | Project brief and implementation environment | Original skill and Apache-2.0 license copied unchanged |
| better-ui | surfaces.md, animations.md, enter-exit.md, icon-transitions.md, performance.md, icons.md | Existing UI/project conventions; browser for live verification | Entire skill folder including all recipes and agents/openai.yaml; upstream MIT license retained |
| untangle-codebase | None named | Repository access; suitable checks; subagents for its final structural review | Original skill preserved; it asks separately about optional comment/test cleanup |
| sol-loop | None named | Git, gh for PR context, an actual GPT Sol reviewer through T3/native supported delegation | Original skill preserved; no full-send, council, or babysit-pr needed |
| pr | None hard-required | Project language from GLOSSARY.md if present; real change/evidence | Original skill, agents metadata, and CREDITS.md included |
| setup-matt-pocock-skills | Its tracker, label, and domain templates | Write access to the target repo; gh/glab only for a chosen hosted tracker | Included with all templates and agents metadata; not executed here |
| lintapple-ui | None | Node >=22, Lint Apple/browser runner, running web app and matching policy | Original integration guidance with upstream README; npm version 0.1.24 verified during preparation |
| emilkowalski/skills (17 skills: animate, animate-expo, animation-performance, animation-vocabulary, apple-design, ask-sonner, break-ui, choreograph, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, remove-animations, review-animations, write-swift) | Each skill's own SKILL.md plus its sibling reference files (RECIPES.md, STANDARDS.md, AUDIT.md, PLAN-TEMPLATE.md, CATALOG.md, PICKER.md, API.md) | A UI codebase to review or build; Motion, Base UI or Sonner only where a skill names them | Entire `skills/` tree of the upstream repository copied unchanged at the pinned commit; the upstream root MIT LICENSE copied into each skill folder as LICENSE.txt; root cheat sheets and README not copied |

The planning and design folders include their local `bin` helpers where upstream provides them. Shared `gstack/bin`, libraries, browser engine, state, hooks, and compiled tools are external runtime dependencies. The runtime is intentionally installed from the exact upstream commit rather than copied piecemeal into a misleading partial installation.

## gstack runtime

Read the pinned upstream [README](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/README.md), [installation docs](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/docs/install.md), and [model policy](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/docs/model-policy.md) before setup. The source calls for Git and Bun (tested 1.4.2+, minimum 1.3.3); Windows also requires Node. Use the supported host-specific setup and configured model policy, not an assumed Claude executable inside a Codex session.

For a **new Claude Code installation only**, with no existing gstack directory:

```sh
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
git -C ~/.claude/skills/gstack checkout 1970da59c4dc5a56109acb0368ce3113a6e7dd09
cd ~/.claude/skills/gstack
./setup
```

For Codex use `./setup --host codex` from a separately cloned checkout at the pinned commit. It generates host-adapted `gstack-*` skills. Use those generated entrypoints rather than registering Clarte's raw Claude-oriented planning and design copies with Codex. For another supported host, follow that pinned README's **Other AI Agents** section and its setup flags. Do not blindly use the Claude paths above. Existing installations should be inspected and backed up before an intentional version change; do not overwrite them or run two registrations of the same skill. gstack setup may create hooks, host registrations, dependencies, and state. Review its current prompts and choices.

The full pinned gstack install supplies every shared helper referenced by the bundled planning and design files. Those files deliberately retain upstream absolute paths, models, hooks, onboarding and consent rules. Clarte does not claim that the skills CLI installs this runtime, or that copying a skill into an arbitrary directory relocates those paths.

## Matt Pocock: prerequisites versus related skills

First-party sources reviewed:

- [Skills repository and installation flow](https://github.com/mattpocock/skills).
- [AI Hero skill catalog](https://www.aihero.dev/skills).
- [The /pr Skill](https://www.aihero.dev/skills-pr).
- [The /setup-matt-pocock-skills Skill](https://www.aihero.dev/skills-setup-matt-pocock-skills).
- The pinned `pr/SKILL.md`, `pr/CREDITS.md`, and setup skill with all template links.

`pr` formats a PR body: Summary, Evidence, Merge Danger. It does not open, push, merge, or monitor a PR. Its CREDITS.md explicitly says `show-me` is **not a dependency**: the visual guidance was copied with attribution. No show-me installation is needed.

Matt recommends running setup once per repo before his engineering skills. The `pr` source itself does not invoke setup or read issue-tracker configuration, so this is a recommended suite setup, not a hard transitive dependency. It is included because the user asked to check prerequisites. `code-review` is a recommended preceding workflow on the website, not a called dependency of `pr`; the development tools already include `sol-loop` for review. Neither `ask-matt` nor the entire engineering suite is necessary to format a PR body.

The setup skill conditionally uses `triage` only if it is already installed; it does not require installing triage. All five referenced template files are bundled. Setup creates project-specific docs in the repository where it is run; bundling the skill does not configure Clarte or create its GLOSSARY.md.

Where the website and pinned source differ, use the pinned source for executable behavior. For example the website says setup does not create labels, but the current setup source explicitly creates missing labels after the relevant confirmation. This is one reason to retain exact commits rather than rely on prose alone.

## Inline HTML design

`design-html` is the original upstream skill from the same pinned gstack commit as the planning skills. Its generated entrypoint, every section and manifest, and `vendor/pretext.js` are copied unchanged. Generator templates are omitted, as with the planning skills. Pretext's upstream license and third-party notices are also included beside the bundled code, with the license source revision recorded in the lockfile.

The workflow generates Pretext-native HTML/CSS, opens a browser preview, captures verification screenshots, and refines the result. Its framework-integration path uses the project's package manager for `@chenglou/pretext`; the standalone path can embed the bundled vendor file. Shared gstack design, browser, configuration, and lint helpers remain runtime prerequisites supplied by the full pinned installation.

Use `lintapple-ui` on the actual rendered page in addition to the upstream checks. Its reports supplement visual inspection and functional verification. No live HTML-generation or browser-preview session was performed while packaging this skill.

## Frontend design and UI polish

Reviewed Anthropic's [requested frontend-design source](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), its skill-local license, Jakub Krehel's [skills repository](https://github.com/jakubkrehel/skills), [website](https://jakub.kr/skills), and the better-ui entrypoint with all local links. Exact commits and file hashes are in `sources.lock.json`.

`frontend-design` is self-contained and covers a visual direction grounded in the subject, token planning, implementation, and critique. Its `LICENSE.txt` is Apache-2.0 and ships with the skill. No other skill files are invoked or required.

`better-ui` supplies surface, optical alignment, icon, and motion details. All six linked recipes and the upstream agent metadata are included. The entrypoint names `better-typography`, `better-accessibility`, `better-layout`, and `better-colors` as companion domains, and refers to `better-interface`'s severity rules. It does not require loading those skills to execute its own polish checks, so they are not installed as transitive dependencies. Reduced-motion guidance and fallback recipes are already included; accessibility obligations still apply. Framework-specific snippets are alternatives for the consumer's existing stack, not a requirement to install every demonstrated library.

Use `frontend-design` to establish visual direction, `design-html` for the inline HTML workflow, `better-ui` for detailed polish, and `lintapple-ui` for rendered measurements. The user's brief and deliberate project conventions take precedence over generic defaults. These are packaged instructions; no live UI build, browser inspection, or visual quality claim was produced while adding them.

## Emil Kowalski's design-engineering skills

Reviewed the [skills repository](https://github.com/emilkowalski/skills) README and every `skills/*/SKILL.md` at the commit recorded in `sources.lock.json`. The seventeen skills are prompt instructions for animation, motion review, choreography, performance, Apple-style design, UI breakage testing, prototyping and library choice; they call no runtime and install nothing. Each skill folder is an exact copy of the upstream folder with the upstream MIT license added as `LICENSE.txt`. The root cheat sheets are not copied because they duplicate the skills.

Use `review-animations`, `choreograph`, `animation-performance` and `emil-design-eng` when reviewing or building the UI prototypes, alongside `better-ui`, `frontend-design` and the owner's `minimal-ui`. Where these skills and minimal-ui disagree about how much is on screen or what colour is for, minimal-ui wins; where they and the Clarte gaze research disagree about motion near armed targets, the research wins (nothing moves while a target is armed).

## Lint Apple

Reviewed [the supplied website](https://lintapple.vercel.app/), [upstream repository](https://github.com/gholtzap/lintapple), its README/package exports, and npm metadata (`npm view lintapple version engines --json`). Version 0.1.24 requires Node >=22. The integration covers CLI and existing Playwright sessions, policy matching, frame/annotation coverage, and exit-code interpretation. Lint Apple is software, not an upstream prompt skill; `lintapple-ui` is Clarte's authored adapter.

No application UI exists in this repository, so there is no rendered page to lint or demo. A successful HTML-generation session or Lint Apple app audit is not claimed as a tested outcome of this repository publication.

## Other first-party sources

- [gstack README](https://github.com/garrytan/gstack) and the requested office-hours, autoplan, and design-html folders. The gstack.dev homepage was unavailable through web fetch; the repository supplied the authoritative source/docs.
- [Caldo README and skill](https://github.com/caldoai/skills).
- [tstack README and Sol loop](https://github.com/t3dotgg/tstack).

All repositories were read from shallow Git clones pinned in the lockfile. No upstream install script or skill workflow was executed merely to inspect its content. License texts, Matt's PR credits, and gstack's notices (including downstream design-source notices) are retained.

## Maintaining development skills

`sources.lock.json` is the source of the skill inventory. Copied `skills/<name>/SKILL.md` records identify upstream skills; `authored_skills` lists Clarte-authored skill directories. Add or rename entries there alongside the actual files; the validator does not keep a second catalog in Python.

Run `python3 scripts/validate.py` after a tooling change. It checks copied-file hashes, the declared inventory, entrypoint metadata, licenses, sections, and local links in repository docs and each skill's top-level Markdown. Archived reference documents retain their upstream link context and are covered by file hashes. The gstack source marks `runtime_relative_links` because its unmodified files reference its external installation; those links require the full runtime rather than the Clarte checkout.
