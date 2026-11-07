---
name: design-pen
description: Ideate, compare, and refine UI designs as editable pen.dev canvas frames and saved .pen documents. Use for visual concepts, screen design, or adapting an approved product plan into a design.
---

# Design in pen.dev

Adapted from Garry Tan's gstack `design-html`. The deliverable is an editable pen.dev design, saved through pen.dev tools, plus inspected exports and implementation notes. Keep the design analysis, UX principles, craft checks, reference fidelity, and refinement loop; replace inline HTML, Pretext text layout, and local preview servers with pen.dev canvas operations.

## Connect and understand the document

Discover the installed pen.dev MCP tools (commonly the `pencil` namespace). Call `get_app_state` and `read_skill` before canvas work. Read the actual tool documentation and any references returned by the built-in skill for the operations you need. Tool names and schemas may evolve: never invent canvas APIs or execute calls copied from an old example.

An active pen.dev app/document, its MCP connection, and available plan usage are required. If connection, authentication, or quota prevents work, report the specific blocker. Preserve existing work. Do not bypass a service limit, edit .pen bytes directly, or silently substitute HTML. The built-in pen.dev skill is a live tool prerequisite, not a static skill redistributed by Clarte.

Inspect the selected document, existing frames, components, variables, and the user's selection. Work in a new named area unless the user requests changes to existing frames. Never clear the canvas to start over.

## Ground the design

Read the user's brief, relevant project instructions, `DESIGN.md`, existing components/tokens, supplied images, prior plans, and approved references. An approved design and the project's design contract take precedence over generic defaults. Identify the audience, primary task, target device, information hierarchy, and states. Ask only for consequential missing choices; infer the rest and state assumptions briefly.

Read [UX principles](references/ux-principles.md) before layout decisions and [craft criteria](references/craft.md) before composing frames. Apply the latter as design criteria: HTML semantics, browser motion, form submission, and head metadata are implementation requirements to record for handoff, not operations to fabricate on a canvas. Ignore that reference's upstream `approved.json` machinery; use the user's approved direction or selected pen.dev frame instead.

For a reference-led request, preserve its composition, type hierarchy, spacing rhythm, imagery treatment, and density. For an open ideation request, propose two or three materially different directions (for example editorial, compact utility, or image-led), explain their tradeoffs, and create named comparison frames through the documented tools. Do not multiply variants when the user already chose the direction.

Use real supplied claims, prices, logos, and testimonials only. Mark illustrative data as illustrative in the handoff. Leave unsupported proof out.

## Build editable designs

Use documented pen.dev operations to create native editable frames, text, components, and instances. Prefer layout constraints and reusable components over individually positioned copies. Map existing brand tokens to variables; define a small coherent type, color, spacing, and radius system when no contract exists. Use the app's supported style resources only when they fit the brief.

Build in reading order, one major section or task at a time. Give layers meaningful names. Establish hierarchy through typography and space. Make the primary action and navigation discoverable; avoid decorative controls that imply unsupported behavior.

Design the relevant desktop and mobile widths as separate named frames or supported responsive variants. Adapt hierarchy and layout; do not shrink the desktop screen. Include loading, empty, validation, error, success, selection, and focus states when the flow needs them. State labels belong outside the actual product frame where possible.

Record interaction intent and component behavior in a short handoff. A canvas state is a design specification, not proof of a working interaction or accessible DOM.

## Inspect, refine, save

Use the current pen.dev tools to render/screenshot the actual frames. Personally inspect those images for clipping, overflow, text wrapping, contrast, alignment, spacing, image crops, and hierarchy. Inspect narrow mobile layouts and relevant themes/states. Correct visible defects and recapture the changed frames.

Use documented `save` to persist the .pen document. Verify the returned document/path and save status. Export images with supported tools when available; return the actual saved document or share link, frame names, and inspected exports. Never claim an unsaved canvas or an unseen screenshot is verified.

Refine the selected direction through targeted edits. Preserve user choices and reusable components. If implementation is requested, translate the approved design into the project's existing stack, then use the sibling `lintapple-ui` skill on the rendered web app. Lint Apple cannot evaluate a .pen document or a screenshot; canvas checks remain visual until a real web page exists.

## Handoff

Deliver the editable design, inspected views, chosen direction and tokens, interaction/state notes, and unresolved assumptions. Distinguish canvas inspection from browser, keyboard, accessibility, and backend verification. Do not start implementation or publish an app unless the user requested it.

The original HTML entrypoint and its sections are archived under `references/` for attribution and comparison. They are not instructions to run gstack helpers, install Pretext/impeccable, generate HTML, or start a server in this skill.
