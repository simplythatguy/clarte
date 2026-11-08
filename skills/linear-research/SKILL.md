---
name: linear-research
description: Read and write Clarte's shared research in the natHacks Linear workspace. Use before researching anything about Clarte (dysarthria, speech ML, datasets, decoding, gaze input, UI, prior art, architecture), before choosing between options, and before ending any turn that found sourced information or made or proposed a choice. Also use to import a past conversation's research into Linear.
---

# Clarte research in Linear

Linear workspace **natHacks**, team **NatHacks (NAT)**, is the team's shared research memory. Each teammate's agent reads it before working and writes findings and decisions back. Then no agent has to find the same information twice, and the team can pull data from it later.

Entry point: [Start here](https://linear.app/nathacks/document/start-here-8f7baf0146fe). The full rules are in the `[Start] Agent protocol: read and write research` doc linked from it. When this file and that doc disagree, follow the Linear doc.

## Connect

Check for Linear MCP tools first (`list_documents`, `get_document`, `save_document`). If they're missing:

- Codex: `codex mcp add linear --url https://mcp.linear.app/mcp`, then `codex mcp login linear`.
- Claude Code: `claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp`, then authenticate in `/mcp`.
- Claude or ChatGPT on the web: connect the Linear connector in settings.

Never ask for passwords or API keys in chat. If you can't reach Linear, say so before you start, and say that your answer was not checked against shared research.

## Layout

Projects are folders, numbered to sort: `Clarte · 00 Start here`, `01 Decisions`, `02 Problem & users`, `03 Speech ML & datasets`, `04 Language decoding`, `05 Gaze input`, `06 UI & UX`, `07 Prior art`, `08 Architecture & implementation`, `09 Team process & tooling`, `10 Learning`, `99 Source archive`.

Every project has a `[<Area>] README` doc with one row per doc and a one-line summary. Each topic doc opens with a header block that ends in a **Summary** line. Decisions are `DEC-###` docs in `01 Decisions`, listed in `[Decisions] Decision log`.

## Read only what you need

1. Read `Start here`. Pick the areas your task touches.
2. Read those areas' READMEs. Open only the docs whose summaries matter. For a keyword, use `list_documents(query=…)`, filtered by project if you can.
3. Before choosing between options, check the Decision log.
4. Skip `99 Source archive` unless you must verify a quote. It holds about 10M characters of raw transcripts.
5. In your reply, name the docs you read: `Context checked: Start here, [Gaze] README, DEC-004`.

## Write back before you finish

Only the top-level agent the person talks to writes to Linear. A subagent or delegated child writes only when its parent's brief names it the Linear writer, and only for the docs the brief assigns. Otherwise it reads freely but doesn't write. Put your findings and choices in your final report, in a form your parent can file. The parent writes them once, so two agents never edit the same doc at once.

Write back whenever the turn found sourced information or made or proposed a choice:

- **Finding**: patch the matching topic doc's section and add a `## Change log` line. If no doc fits, create one in the right project. Title it `[<Area>] <topic>` and start it with the header block from the Agent protocol.
- **Choice between options**: create the next free `DEC-###` with the options table, the criteria, what was chosen, who chose it, and why the others lost. Add a row to the Decision log. A recommendation nobody accepted gets status `proposed`. Only a person decides.
- Update the area README row. Update `Start here` if current state or recent decisions changed.
- Keep source URLs. Mark claims without a source *(unverified)*. Never overwrite a teammate's finding. Add yours with attribution and note the disagreement.
- Never paste raw transcripts into topic docs. Raw text goes to `99 Source archive`.
- Don't file research as issues. The workspace is on Linear Free, capped at 250 issues.

Report what you wrote: `Linear updated: [Gaze] WebGazer calibration (patched), DEC-012 (new)`.

## Import a past conversation

Pull out sourced findings, datasets, papers, experiments, specs, decisions, and option comparisons. Merge them into existing topic docs instead of adding near-duplicates. Read the target README first so you don't add something that's already there.
