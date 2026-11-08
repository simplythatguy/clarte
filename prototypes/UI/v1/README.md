# UI v1

UI v1 holds the prototypes that carry the owner's chosen direction forward from [UI v0](../v0/README.md), where the layout styles were explored side by side.

| Folder | What it is | Port |
| -- | -- | -- |
| `s1/` | The conversation screen as of 2026-11-08, from v0's style 8. It has the mesh-gradient ball that docks beside the thread, grey cards on one 32 px grid with the vibrant letter colours, a dwell line that traces each card's edge and a circle that fills on selection, the Options screen for close words, and the grouped menu. See [s1/DESIGN.md](s1/DESIGN.md). | 5201 |

Each prototype is a self-contained Vite + React + TypeScript app (`npm install && npm run dev` inside its folder). For now they share UI v0's engine in [`../v0/shared`](../v0/shared) and keep its rules: the fixed 2 × 4 backend grid ([backend quadrants](../v0/README.md)), the letter groups G1–G4, and the layout check (`npm run check`).
