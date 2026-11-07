---
name: apple-hig-ui
description: Apple Human Interface Guidelines distilled for Clarte's gaze-controlled, minimal UI. Use when designing, building or reviewing any Clarte screen, component, state, motion, copy or colour, and when a question arises about targets, feedback, modes, predictions, calibration, permissions or accessibility. Read the matching section before deciding; run the verify list before handing off.
---

# Apple HIG for Clarte

What Apple's Human Interface Guidelines say that makes Clarte's screens cleaner and easier to use, adapted to a laptop webcam gaze app with a fixed 2×4 backend grid. All 173 HIG pages were read on 2026-11-07 (crawled from Apple's documentation data endpoint and converted to Markdown); six readers extracted 249 cited rules with Clarte adaptations, conflicts and "not applicable" lists. Those notes are the evidence behind this page and live in `references/` (`b1-foundations.md`, `b2-inputs.md`, `b3-patterns.md`, `b4-components-controls.md`, `b5-components-layout-platforms.md`, `b6-technologies-and-rest.md`; `hig-page-index.tsv` lists every page). Open a note when you need the exact HIG wording, the page citation or the reasoning behind a rule here.

Two caveats carry through everything below. Apple's point sizes, spacing values and delay tiers describe touch, pointer and headset input; none of them is a webcam-gaze threshold, and the HIG games page even contradicts itself on the touch minimum (44×44 pt in prose, 28×28 pt in its table). Clarte's own numbers come from `prototypes/UI/v0/RESEARCH.md`. And Apple writes for products that can show onboarding copy, tab bars and panels; the owner's `minimal-ui` rules win wherever they disagree about how much is on screen or what colour is for.

Precedence when rules collide: the owner's newest explicit decision, then `minimal-ui`, then the backend quadrant contract in `prototypes/UI/v0/README.md`, then this skill, then generic polish advice.

## How to use

1. Find the section for what you are designing (a target, a state change, a menu, a prediction, calibration, copy). Apply its rules as written; each ends with the HIG page it comes from.
2. Where a rule says "Clarte:", that is the adaptation to gaze and the fixed grid, not Apple's text.
3. Before handing off, run **Verify a screen** at the end against real screenshots.

## Hierarchy and layout

- Make the current task recognisable in one glance: the message while composing, the transcript while listening, the sentence while speaking. Supporting status stays visibly quieter. [Design principles, Layout, Designing for watchOS]
- Group with alignment and whitespace before adding containers. Aligned items read as related; a box, bezel or card around every control is not needed to show the grid. [Layout, Boxes, Toolbars]
- Keep actions in the same place across states and phases. A function may relabel; it never moves. Spatial memory replaces search. [Design principles, Layout, Collections, Home Screen quick actions]
- Disclose secondary capability behind one clearly named, gaze-reachable control with a return path; never remove a capability to simplify a screen, and never put essential recovery behind hover. [Layout, Disclosure controls, Sidebars]
- Design for the available space and check the extremes: both supported viewports, 200% text, long words. Mac guidance warns against critical content at a window's bottom edge; check the lower row is fully visible. [Layout, Designing for iPhone Duo, Mac Catalyst]
- A location label is a word or short phrase describing the view, never the app name, never a subtitle or eyebrow above it. [Toolbars]
- Use a surface only when it clarifies function and keeps text legible. Decorative translucency and nested panels earn no place. [Materials]

## Gaze targets

- Give each action exclusive, generous space; crowded targets are hard to isolate because of small involuntary eye movements. Clarte: one action per backend quadrant is that rule; the drawn tile may be any size inside its quadrant. [Eyes, Spatial layout]
- Round the shape. Corners attract the eye away from a target's centre; circles, pills and rounded rectangles are easier to aim at. Keep shapes flat and avoid thick outlines or effects that call attention to edges. [Eyes, Buttons]
- Centre the label or glyph with generous padding so the target has a natural focus point; without one the eyes wander. [Eyes]
- Treat a label and its icon as one target with one encompassing highlight. Never make the icon and the caption separate selectable things. [Eyes]
- Keep the main content in the centre of the field of view; edges tire the eyes, so use them for things not needed all the time. Clarte: reading content belongs in the centre rest quadrants; rare controls go to corners. [Eyes, Spatial layout]
- Separate the size of the visible glyph from the space that selects it. A calm, small mark can label a large hit region. [Accessibility, Layout, Pointing devices]
- Looking identifies a candidate; it never commits. Activation needs a completed dwell or an explicit confirm. [Eyes, Remotes, Focus and selection]

## Feedback and states

- Put feedback on the target and keep the target's position, size and label unchanged while it appears; change ink, add a marker or a progress cue in place. Revealing content beside a looked-at button makes people look at the new content instead. [Eyes, Apple Pencil and Scribble, Focus and selection]
- Make targeting, dwell progress, commit, persistent selection and unavailability distinguishable; a looked-at word must not appear accepted, and a progress ring must not imply speech has started. [Focus and selection, Buttons, Controls]
- Give feedback in more than one channel: visual plus text for assistive technology, optional sound; never colour or sound alone. [Feedback, Accessibility]
- Match interruption to consequence: routine status is passive, critical actionable problems interrupt. Do not confirm every reversible selection; confirm speech because it cannot be unheard. [Feedback, Alerts]
- Explain a blocked action where it happens, with the reason and a reachable next step. A silent no-op is a defect. [Feedback, Writing]
- Show the stage actually reached: accepted, selected, preparing speech, speaking, done. Clear "Recording" and "Speaking" the moment they stop. [Tap to Pay on iPhone, Wallet, Live Activities]
- Use one authoritative progress presentation per operation; no spinner plus banner plus toast for the same work. Progress must be honest: measured when known, indeterminate when not. [Apple Pay, Progress indicators]
- When tracking is lost, stop showing a live-looking target, suspend the pending selection, show a short tracking state, and never complete an old dwell on reacquisition. [Gestures, Immersive experiences, Augmented reality]
- Never attach anything to the gaze point itself; a cursor that follows the eye is chased. A raw gaze dot is a diagnostic, off by default. [Focus and selection, Eyes]

## Motion

- Do not add motion for its own sake, avoid animating frequent interactions, keep feedback brief and precise, and let people cancel motion. [Motion]
- Avoid peripheral movement, large moving objects and sustained oscillation; people are especially sensitive around 0.2 Hz. Nothing moves while a target is armed. [Motion, Eyes]
- Keep a stationary frame of reference; prefer a fade to relocating objects. Phase changes happen in place. [Motion, Fluent-adjacent guidance in Immersive experiences]
- Motion is never the only carrier of information. Under reduced motion remove bounce, zoom, depth changes and repetition and keep a static state plus an announcement. [Motion, Accessibility]
- Hover-style delays are tiers of purpose, not dwell thresholds: subtle cues immediately, expansion after a short delay, extra information after a long one. [Eyes]

## Typography and legibility

- Use few typefaces and a small consistent hierarchy; let the message dominate and keep settings labels from competing. [Typography]
- Prefer regular to bold weights; thin strokes vanish at small sizes and at distance. [Typography, Complications, Live Activities]
- Support enlargement to at least 200% and test the whole task at that size, not just headings; icons that carry meaning scale with text. [Accessibility, Typography]
- Give multi-line text comfortable leading; three or more lines is a paragraph. [Typography]
- Render essential text as real text, never in images; never truncate words whose absence could change meaning before the person accepts or speaks them. [Widgets, Wallet, Lists and tables]
- Check legibility from the user's seat and the partner's position, in dim and bright rooms. A design-tool view proves nothing. [Typography, Color, CarPlay]

## Colour and appearance

- Colour is never the only cue for state, identity or interactivity. Clarte: the four groups carry their range label, position and a glyph as well as a hue. [Color, Accessibility, Complications]
- Give each functional colour one job; reusing an interaction colour for inert text misleads. [Color, Inclusion]
- Measure contrast in the real state combinations (idle, armed, selected, disabled) on the real surfaces. Apple's Dark Mode page asks for 4.5:1 minimum and suggests 7:1 for custom pairs. [Dark Mode, Accessibility]
- Define colours by role as tokens with light, dark and increased-contrast variants; dark is not inverted light. [Color, Dark Mode]
- Respect the system appearance preference and keep content, positions and usable states intact when it changes. [Dark Mode]
- Branding defers to the person's message: a small mark, consistent voice, no repeated logo, no broad accent washes, no launch animation. [Branding]

## Writing and labels

- Short verbs that name the result: Speak, Delete, Listen. Never internal identifiers such as AC, D, R1 or Q6 in the UI or in accessible names. [Writing, Buttons, Action button]
- Distinguish an action's name from a setting's current state; a bare "Record" highlight must not carry both meanings. Settings show their value in the control. [Menus, Toggles, Controls]
- Errors state what is blocked and how to fix it, near the problem, without blame or jokes, and preserve the draft. [Writing, Apple Pay]
- An empty or waiting state makes the next action apparent without filler, counts of zero or an instructional paragraph. [Writing]
- Address adults plainly; never infer abilities, literacy or wishes from a diagnosis; avoid patronising praise and stereotyped imagery. [Inclusion, Accessibility]
- Keep optional learning out of the live screen: a practice run or on-demand help, not tooltips on every control or subtitles that explain the UI. Tips suit features of three actions or fewer and one or two sentences. [Offering help, Onboarding, Virtual keyboards]

## Controls

- One prominent, non-destructive primary action per view; a destructive action never takes the primary role. [Buttons]
- Peers look alike: equal-size letter groups, equal-width segments; size difference encodes importance, not likelihood. [Buttons, Segmented controls]
- Toggles are for two-state settings and show their state without colour alone (a check, a dot, a changed inner detail); commands are buttons. Never one control that is both a setting and an unrelated action. [Toggles]
- Group only closely related choices, few enough to take in at a glance; use nouns for alternatives and verbs for commands. [Segmented controls, Toggles]
- Choosers show their current value before opening, keep a predictable order and a sensible default. Offer likely choices while preserving a route to a custom value. [Pickers, Pop-up buttons, Combo boxes]
- Adjust values with a readout and coarse steps: quadrant-sized increase and decrease or a few presets, never a draggable thumb or dozens of repeated dwells. Minimum on the leading side, maximum trailing. [Sliders, Steppers]
- Keep the full value readable without hover. [Combo boxes, Text fields]
- Menus are short, grouped by placement, at most one level deep, with unavailable items kept in place but inert rather than removed, so nothing shifts under a pending selection. Every item needs its own quadrant. [Menus, Context menus, The menu bar]
- Done finishes, Cancel leaves without saving, Back steps; never show all three; always provide an explicit gaze-reachable exit. Incidental dismissal preserves work. [Sheets, Popovers]
- Use a choice view for an intentional action and an alert only for a critical interruption; no alert on launch, none for routine undoable deletes; one sheet or popover at a time; alert buttons one or two words, up to three buttons. [Action sheets, Alerts, Sheets, Popovers]
- Progress indicators stay local and geometrically stable and disappear when done; interruptible work has a reachable stop that preserves composed text. [Progress indicators]
- Every action-shaped element is a real, available capability; distinguish unsupported from temporarily blocked. [HomeKit, Top Shelf, Widgets]

## Patterns

- Launch into the useful state: restore the draft and place without a branding interstitial; show whether gaze and recording are ready rather than resuming an old selection or capture. [Launching, App Clips]
- Onboard by doing one safe action; a skipped tutorial stays available and never recurs on every launch; defer setup that the next useful action does not need. [Onboarding]
- A modal task is short, clearly named, owns all input (previous actions deactivated, pending dwell cleared), and has an obvious exit; never a stack of dialogs. [Modality]
- Undo is predictable and visible: distinguish removing a pending group, replacing an accepted word and clearing the draft; repairs are themselves repairable; speech already heard cannot be undone. [Undo and redo, Edit menus]
- Keep task-time options close and rarely changed preferences one step away; honour system accessibility preferences and make the scope of any app override clear. [Settings]
- Nothing interrupts an active conversation for ratings, announcements or routine completions; coalesce, never nag. [Managing notifications, Ratings and reviews, CareKit]
- Full screen is the person's choice and keeps every essential control reachable by gaze; an edge hover or Escape alone is not an exit. [Going full screen]
- On a task switch or hidden tab, preserve the draft, clear pending dwell, let a started decode finish but never let a late response commit or speak. [Multitasking, Windows]
- Autosave drafts without making retention a hidden promise; sensitive transcript retention is a separate decision. [File management, Generative AI]
- Every drag has a discrete alternative; nothing requires precision dragging, a continuous hold or spring loading. [Drag and drop]
- Keep the person's own entry route when offering suggestions; suggestions are not the whole space of what they can say. [Entering data, Combo boxes]
- Bounded pages with large controls beat scrollbars; one scroll region per axis; content moves only enough to support the person's action, never to chase new text. [Scroll views, Mac Catalyst]
- Scope and placement make a search's target clear; a result is a candidate, not an utterance. [Searching, Search fields]

## Predictions and language models

- The decoder is essential, not an optional enhancement: plan for outages by preserving entered groups and providing a verified alternative route such as exact spelling or saved phrases. [Machine learning, Generative AI]
- Candidate text is visibly distinct from accepted text; nothing is committed or spoken by being shown, read, ranked or received. A high score waives nothing. [Generative AI, Machine learning]
- Offer few, distinct, legible choices with a genuinely likely one first; first is not accepted by default. [Machine learning: multiple options]
- Update candidates on deliberate input; freeze the candidate under an armed dwell and during review; a late result never changes the word under an accept action; reset selection when the choice set changes. [Machine learning: implicit feedback, Token fields]
- Do not show confidence unless it is validated to track quality; a "97%" badge is Apple's example of an unhelpful presentation. [Machine learning: confidence]
- Constrain generation to the person's groups and permitted context; never invent facts, beliefs or an intended reply; check that negation, names, time and tone survive. [Generative AI]
- Guided repair (another word, remove a group, replace a word) sits beside, not instead of, a route to the exact wording. Count reading, choosing, cycling and repair when claiming a policy is faster. [Machine learning: corrections, mistakes]
- Failure is recoverable and explained only as far as known: keep pending groups, offer retry or an alternative, never loop the same failed request. [Generative AI, Machine learning: limitations]
- Personal-context use is specific, minimal and controllable; permission to use the partner's words for this reply is not permission to retain or train on them, and a partner-visible screen must not surface private past context. [Generative AI: privacy]
- Behaviour is ambiguous evidence: a drift-induced dwell or an accepted convenient phrase is not preference or consent. Explicit feedback is optional, specific and visibly effective, never a rating on every word. [Machine learning: implicit and explicit feedback]

## Calibration and tracking

- Calibrate only for a real access dependency, with essential information, one current target, visible progress, a valid cancel and explicit completion. [Machine learning: calibration]
- When calibration stalls, offer non-blaming, actionable help (light, camera position), allow pause and cancel, and confirm only genuine success; never imply the person failed because of their disability. [Machine learning: calibration, limitations]
- Reuse a saved profile only when a current check supports it; posture, light and drift justify recalibration, and the person can update or clear the profile by gaze. [Machine learning: calibration]
- A tracking loss of even half a second deserves a visible state; stop accepting uncertain selections, preserve the draft, offer retry or pause. [Augmented reality]
- Design for a comfortable posture with opportunities to rest; targets stay stationary and nothing requires head movement. [Augmented reality]

## Privacy, permissions, audio

- Request camera access when gaze setup needs it and microphone access when the person starts listening, each with a brief specific sentence; never bundle, never fake a system prompt, never pre-prompt with a dead-end. [Privacy, CareKit, HealthKit]
- Minimise collection, keep processing local where the feature permits, say what leaves the device, and never label something "on-device" because a local UI renders it. [Privacy, Generative AI]
- Stop microphone capture when its stated purpose ends; a changed icon is not a stopped recording; capture permission is not retention permission. [ShazamKit, Playing audio]
- The person decides when audio starts: no auto-speak on focus, navigation or a candidate arriving; a reachable stop; deliberate resumption after interruption; never a microphone restarted on tab return. [CarPlay, AirPlay, Playing audio]
- Interface sounds are optional and visually redundant; essential information never depends on hearing a cue. [Playing audio, Notifications, Playing haptics]
- Separate shared status from private content: a partner sees the agreed message and the state, not the working draft or past context, unless the person chose to share it. [Always On, Live Activities, SharePlay]

## Accessibility beyond gaze

- Every control has a precise, current accessible name that updates when its function changes (Listen becomes Stop). [VoiceOver]
- Structure and reading order survive without visual proximity: a transcript stays with its speaker, a candidate with its accept action, an error with the function it blocks. [VoiceOver]
- Report meaningful changes (accepted word, phase change, recording state, error) to assistive technology without flooding it with every gaze sample. [VoiceOver]
- Keyboard, screen reader and switch access keep working beside gaze, and the gaze route stays complete on its own. [Accessibility, Keyboards, Pointing devices]
- Two confirmations for hard-to-recover actions is Assistive Access advice; apply it to speaking to a stranger or clearing a draft, not to every selection. [Accessibility]
- Localise alignment and mirror navigation meaning for right-to-left languages, never the physical quadrant identities or the decoder's alphabet. [Right to left]

## Where the HIG and Clarte part ways

- Native target sizes (28, 44, 60 pt), 16 pt margins and 60 pt centre spacing are touch and headset references. They neither override one action per backend quadrant nor prove a webcam target is usable. [Accessibility, Buttons, Eyes, Spatial layout, Designing for games]
- Eye-plus-pinch activation is not gaze-only access; copying it, or assuming a blink, leaves an unevidenced path. Dwell or an explicit confirm stays the activation. [Eyes, Gestures]
- Hover-revealed labels, tooltips, context menus, long press, secondary click, swipes, drags and keyboard shortcuts are supplementary routes, never the only one. [Toolbars, Tab bars, Context menus, Undo and redo, Drag and drop]
- Tab bars, sidebars, split views, ornaments and panels assume screens that can hold several jobs; `minimal-ui` keeps one major thing, so these transfer as principles of stable placement, not as components. [Tab bars, Sidebars, Split views, Ornaments, Panels]
- Onboarding copy, inline tips, setting explanations and educational empty states are HIG-permitted and `minimal-ui`-forbidden on routine screens; keep labels, errors, blocked reasons and consent boundaries. [Onboarding, Offering help, Writing]
- Container shapes, separators, materials, brand colour, animated symbols, gauge gradients and tvOS focus expansion are optional platform styling that conflicts with neutral surfaces, purposeful colour and stationary targets. [Boxes, Materials, Branding, SF Symbols, Gauges, Designing for tvOS]
- Selecting the first prediction by default, immediate suggestion updates and implicit-feedback personalisation are HIG options that are unsafe for a dwell interface without the freezes and rearms described above. [Machine learning]
- An app-specific appearance setting is discouraged by the HIG; a low-luminance theme is still a medical accommodation for light-sensitive users and stays available. [Dark Mode, Accessibility]
- The HIG's warning about controls at a window's bottom edge pulls against a bottom row of letter groups; verify visibility rather than relocating by reflex. [Layout]

## Reference values (not gaze thresholds)

| HIG value | Where it applies | Use in Clarte |
| --- | --- | --- |
| 44×44 pt default, 28×28 pt minimum (iOS); 60×60 pt (visionOS); 28/20 pt (macOS) | touch and headset controls; the games page prose says 44 is the iOS minimum | reference only; gaze targets are backend quadrants |
| ≥16 pt margin around items or ≥60 pt between centres | visionOS eye targets | keep the separation principle; measure Clarte's gutters in degrees |
| 4.5:1 minimum, 7:1 suggested | custom colour pairs in Dark Mode | floor; Clarte uses APCA Lc 90 / 75 / 60 from RESEARCH.md |
| ≥200% text enlargement | accessibility | required |
| ~0.2 Hz | oscillation people are most sensitive to | never oscillate ambient indicators |
| 1–2 sentences, ≤3 actions | a tip | optional help only |
| ≤3 buttons, 1–2 word labels, ≤2-line title | alerts | critical interruptions only |
| 1 modal at a time, ≤1 submenu level, ≤3 menu groups | modality and menus | hard limits here too |
| >0.5 s face-tracking loss | ARKit warning example | show a tracking state at least this fast |

## Verify a screen

Run on real screenshots of every state, at both viewports and at 200% text.

1. Name the one major thing. Supporting status is visibly quieter.
2. Every action: inside one backend quadrant (or owning all it spans), rounded, label centred, no outline or effect at its edges, same position in every state.
3. Every state: targeting, dwell progress, commit, selected, disabled and tracking-lost look different, in place, with a text equivalent for assistive technology.
4. Nothing moves while a target is armed; phase changes fade in place; reduced motion keeps the information.
5. No text explains the UI; labels are verbs that name results; no internal identifiers; errors say what is blocked and how to fix it.
6. Colour has a job and a non-colour twin; contrast measured per state on its real surface.
7. Predictions: distinct from accepted text; nothing commits or speaks on its own; the candidate under an armed action never changes; an alternative entry route exists.
8. Permissions asked in context with a specific sentence; recording stops when it says it stops; the partner sees state and the agreed message only.
9. Accessible names are current; keyboard and screen reader paths work; text scales to 200% without overlap or truncation that changes meaning.
