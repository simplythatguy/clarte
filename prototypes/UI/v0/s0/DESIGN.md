# Clarte light visual direction (2026-11-07)

Decided by the owner (abdelrahman), 2026-11-07: the app takes the look of a reference dark finance-app shot (Dribbble; soft oversized radii, pastel ice-blue and lavender cards, geometric sans, pill highlights, thin outline icons, generous empty space), **in light mode**, with colours inspired by apple.com. The owner supplied the light neutrals `#F5F5F7` (canvas) and `#FFFFFF` (surface).

The mapping below is the agent's proposal implementing that decision. A mock is at `/private/tmp/claude-501/-Users-aamia-clarte/319bb004-9eff-459e-8690-1a7221c1d847/scratchpad/s0/static.html` (style 2 Corners geometry at 1440×900).

## Tokens

| Token | Value | Use |
|---|---|---|
| canvas | `#F5F5F7` | Page (apple.com section grey) |
| surface | `#FFFFFF` | Neutral targets (e.g. Delete) and sheets |
| ink | `#1D1D1F` | Text; fill of the one primary target |
| ink-2 | `#6E6E73` | Partner's words, hints |
| ink-3 | `#86868B` | Ghost prediction, status dot |
| hairline | `#D2D2D7` | The single rule between partner and message |
| accent | `#0071E3` | Dwell progress only (apple.com link/CTA blue) |
| G1 A–F | face `#E3F0FA`, ink `#1E5A82` | Ice blue (reference card 1) |
| G2 G–N | face `#ECE4F8`, ink `#59409A` | Lavender (reference card 2) |
| G3 O–S | face `#E2F3EA`, ink `#2B6A4C` | Mint |
| G4 T–Z | face `#FBEADD`, ink `#8A4A22` | Peach |

Group colour exists to tell the four groups apart and to tie each pending token in the message to its tile. That is the only use of hue besides the dwell accent.

## Shape and type

- Target radius 40 px at 1440×900 (about 13% of a 304 px tile), no borders, no shadows: the face step from canvas is the target's extent.
- Type: Satoshi (Fontshare, free licence) 500/700, with SF Pro / system fallback. Group range 64 px/700, letters 22 px/500 tracked +0.18em, message 52 px/700 tracked −0.025em, partner 26 px/500, labels 44 px/700, hints 20 px/500.
- Motif: the reference card's two overlapping circles. First circle = solid group ink (identity). Second circle = the dwell ring, a track at 30% of the group ink that fills clockwise in accent blue while dwelling. The motif carries information, so it passes minimal-ui rule 3.
- Primary target: ink fill with white label, the strongest contrast on screen (minimal-ui rule 7). Secondary targets: white surface.
- Icons: thin outline, 1.6 stroke at 24 px grid, rounded caps (like the reference's nav icons).
- Rest zone (Q2+Q3): no box. Status line, partner words in ink-2, one hairline, then the message in ink with pending tokens as group-ink dots and the predicted word in ink-3.

## Measured contrast (WCAG 2 ratios)

Group ink on its face: G1 6.38, G2 6.48, G3 5.58, G4 5.81. Ink on canvas 15.46. Ink-2 on canvas 4.66. Ink-3 on canvas 3.33 (used only for the 52 px ghost word, large text, passes 3:1). White on primary 16.83. Hint on surface 5.07. Dwell ring on G2 face 3.81.

Known limit: pastel faces against the canvas are 1.06:1, so a target's edge is found by hue, not luminance. For low-vision users, test either deeper faces (about 1.25:1 or more against canvas) or a 1.5 px group-ink outline on the dwelt or armed tile only. Validate against the webcam tracker too: the earlier style 2 notes say the tracker prefers light pages.

## Live

`clarte-light-live.html` is the same screen wired to the real word-prediction engine, for trying the direction with real decoding (2026-11-07, at the owner's request). Visuals and the quadrant map are unchanged except that the group tiles follow the owner's later decision and print their letters as the primary label instead of a range.

Start the engine (the ported prototype, no API keys; set it up once as `prototypes/Word Prediction/v0/README.md` describes; it loads in about 25 s and prints `Serving http://127.0.0.1:8765`). `node prototypes/UI/v0/s_all/serve.mjs` starts it for you, or run it alone:

```sh
cd 'prototypes/Word Prediction/v0'
.venv/bin/python server.py --port 8765   # Windows: .venv\Scripts\python server.py --port 8765
```

Then open `clarte-light-live.html` in Chrome (file:// is fine; CORS is open on the engine). The Accept card shows `likely[0]` from `POST /api/predict` with `{history, message, groups}`; groups are digits 1–4 for the four tiles. Look at a tile (hover) to dwell, or click; keys 1 2 3 4 select a group, Enter or Space accepts, Backspace deletes the last group or the last word, S sends the reply (speaks it and adds it to the history), P adds the partner's next line, R resets, G shows the backend quadrant grid. The status dot reads "Replying" when the engine answers and "Engine offline" when it does not.
