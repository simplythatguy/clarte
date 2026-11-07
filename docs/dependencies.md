# Source and dependency audit

Audited from the commits recorded in `sources.lock.json` and the first-party pages below. This is a collection of upstream skills with two explicit adaptations, not a replacement gstack runtime.

## Dependency decisions

| Requested skill | Required skill files | Runtime / project prerequisites | Included decision |
| --- | --- | --- | --- |
| office-hours | Its phase sections and shared preamble | Full gstack setup for brain/context, design discovery, runtime helpers, and host integration | Generated skill files copied, including all sections and local helpers; generator templates omitted |
| autoplan | plan-ceo-review; plan-eng-review; plan-design-review when UI is in scope; plan-devex-review when DX is in scope | Full gstack setup, Bun, host review tools, phase publication guard, snapshots and gate helpers | All four review directories and their section files included; office-hours included for its prerequisite offer |
| design-pen | pen.dev's live built-in design skill, loaded using `read_skill`; lintapple-ui for implemented web output | pen.dev app/document and connected MCP tools; available service usage | Adapted from design-html; no HTML or Pretext runtime required for canvas work |
| untangle-codebase | None named | Repository access; suitable checks; subagents for its final structural review | Original skill preserved; it asks separately about optional comment/test cleanup |
| sol-loop | None named | Git, gh for PR context, an actual GPT Sol reviewer through T3/native supported delegation | Original skill preserved; no full-send, council, or babysit-pr needed |
| pr | None hard-required | Project language from GLOSSARY.md if present; real change/evidence | Original skill, agents metadata, and CREDITS.md included |
| setup-matt-pocock-skills | Its tracker, label, and domain templates | Write access to the target repo; gh/glab only for a chosen hosted tracker | Included with all templates and agents metadata; not executed here |
| lintapple-ui | None | Node >=22, Lint Apple/browser runner, running web app and matching policy | Original integration guidance with upstream README; npm version 0.1.24 verified during preparation |

The planning folders include their local `bin` helpers where upstream provides them. Shared `gstack/bin`, libraries, browser engine, state, hooks, and compiled tools are external runtime dependencies. The runtime is intentionally installed from the exact upstream commit rather than copied piecemeal into a misleading partial installation.

## gstack runtime

Read the pinned upstream [README](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/README.md), [installation docs](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/docs/install.md), and [model policy](https://github.com/garrytan/gstack/blob/1970da59c4dc5a56109acb0368ce3113a6e7dd09/docs/model-policy.md) before setup. The source calls for Git and Bun (tested 1.4.2+, minimum 1.3.3); Windows also requires Node. Use the supported host-specific setup and configured model policy, not an assumed Claude executable inside a Codex session.

For a **new Claude Code installation only**, with no existing gstack directory:

```sh
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
git -C ~/.claude/skills/gstack checkout 1970da59c4dc5a56109acb0368ce3113a6e7dd09
cd ~/.claude/skills/gstack
./setup
```

For Codex use `./setup --host codex` from a separately cloned checkout at the pinned commit. It generates host-adapted `gstack-*` skills. Use those generated entrypoints rather than registering Clarte's raw Claude-oriented planning copies with Codex. For another supported host, follow that pinned README's **Other AI Agents** section and its setup flags. Do not blindly use the Claude paths above. Existing installations should be inspected and backed up before an intentional version change; do not overwrite them or run two registrations of the same skill. gstack setup may create hooks, host registrations, dependencies, and state. Review its current prompts and choices.

The full pinned gstack install supplies every shared helper referenced by the bundled planning files. Those files deliberately retain upstream absolute paths, models, hooks, onboarding and consent rules. Clarte does not claim that the skills CLI installs this runtime, or that copying a skill into an arbitrary directory relocates those paths.

## Matt Pocock: prerequisites versus related skills

First-party sources reviewed:

- [Skills repository and installation flow](https://github.com/mattpocock/skills).
- [AI Hero skill catalog](https://www.aihero.dev/skills).
- [The /pr Skill](https://www.aihero.dev/skills-pr).
- [The /setup-matt-pocock-skills Skill](https://www.aihero.dev/skills-setup-matt-pocock-skills).
- The pinned `pr/SKILL.md`, `pr/CREDITS.md`, and setup skill with all template links.

`pr` formats a PR body: Summary, Evidence, Merge Danger. It does not open, push, merge, or monitor a PR. Its CREDITS.md explicitly says `show-me` is **not a dependency**: the visual guidance was copied with attribution. No show-me installation is needed.

Matt recommends running setup once per repo before his engineering skills. The `pr` source itself does not invoke setup or read issue-tracker configuration, so this is a recommended suite setup, not a hard transitive dependency. It is included because the user asked to check prerequisites. `code-review` is a recommended preceding workflow on the website, not a called dependency of `pr`; this collection already supplies `sol-loop` for review. Neither `ask-matt` nor the entire engineering suite is necessary to format a PR body.

The setup skill conditionally uses `triage` only if it is already installed; it does not require installing triage. All five referenced template files are bundled. Setup creates project-specific docs in the **consumer repo**; Clarte does not preconfigure a user's project or fabricate its GLOSSARY.md.

Where the website and pinned source differ, use the pinned source for executable behavior. For example the website says setup does not create labels, but the current setup source explicitly creates missing labels after the relevant confirmation. This is one reason to retain exact commits rather than rely on prose alone.

## pen.dev adaptation

First-party [website](https://www.pen.dev/) and [documentation](https://docs.pen.dev/) describe an editable canvas, components, variables, MCP integration, and .pen documents. `design-pen` retains design analysis, supplied-reference fidelity, UX doctrine, craft, responsive/state review, and refinement from gstack, while changing the artifact and operations:

| Upstream design-html | Clarte design-pen |
| --- | --- |
| Finalized inline HTML | Native editable pen.dev frames and saved .pen document |
| Pretext text layout/API routing | pen.dev's documented text/layout operations |
| Local HTTP server / HTML preview | Render/inspect the actual canvas through pen.dev tools |
| gstack design helpers and detector | Live pen.dev skill, project design tokens, visual inspection |
| HTML lint at design time | Canvas inspection first; Lint Apple after web implementation |

The original entrypoint and section files are retained as reference material. `ux-principles.md` is the copied doctrine; `craft.md` removes the gstack lint command in favor of the sibling integration. HTML-specific implementation criteria apply only at code handoff. The design entrypoint explicitly identifies the archived upstream procedures as historical references, not commands to run.

The live `pencil/read_skill` call during preparation returned a **plan usage limit**. No canvas edits or .pen writes were attempted. The adaptation was checked against public documentation and available tool descriptions, but a successful live read/edit/save session remains unverified. It discovers live schemas at use time rather than embedding an invented execute API.

The planning skills remain upstream copies, so their optional visual-design handoffs can still mention gstack HTML/design skills. In a Clarte-led session, instruct the agent to use `design-pen` for those visual deliverables. The collection does not silently rewrite upstream planning methodology or pretend gstack itself has adopted pen.dev.

## Lint Apple

Reviewed [the supplied website](https://lintapple.vercel.app/), [upstream repository](https://github.com/gholtzap/lintapple), its README/package exports, and npm metadata (`npm view lintapple version engines --json`). Version 0.1.24 requires Node >=22. The integration covers CLI and existing Playwright sessions, policy matching, frame/annotation coverage, and exit-code interpretation. Lint Apple is software, not an upstream prompt skill; `lintapple-ui` is Clarte's authored adapter.

No application UI exists in this repository, so there is no rendered page to lint or demo. Neither pen.dev designs nor a successful Lint Apple app audit are claimed as tested outcomes of this repository publication.

## Other first-party sources

- [gstack README](https://github.com/garrytan/gstack) and the requested office-hours, autoplan, and design-html folders. The gstack.dev homepage was unavailable through web fetch; the repository supplied the authoritative source/docs.
- [Caldo README and skill](https://github.com/caldoai/skills).
- [tstack README and Sol loop](https://github.com/t3dotgg/tstack).

All repositories were read from shallow Git clones pinned in the lockfile. No upstream install script or skill workflow was executed merely to inspect its content. License texts, Matt's PR credits, and gstack's notices (including downstream design-source notices) are retained.
