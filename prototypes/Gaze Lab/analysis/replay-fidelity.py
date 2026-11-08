#!/usr/bin/env python3
"""Fidelity of a replay against the live recording, per block.

Usage: .venv/bin/python -I analysis/replay-fidelity.py sessions/<id> [variant=none]

Reads replay-<variant>.jsonl (scripts/replay-blocks.mjs), where every stepped frame carries the live row's estimates.
Frames: record-phase frames of a final block attempt with a face present and eyes open in both the live run and the
replay. For blend (rawNormPog), network and geometric: live and replayed per-frame median error against the dot, median
signed bias, and the per-dot medians (median estimate over the dot's frames) of both runs with the distribution of
|replayed − live| per-dot error and of the distance between the two per-dot estimates. Also the per-frame |Δ| between the
two runs and, as the noise reference, the live run's own frame-to-frame |Δ| on consecutive frames of the same dot.
Units: CSS px of the recorded viewport. Writes replay-fidelity-<variant>.md and .json into the session folder.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

STREAMS = {"blend": "rawNormPog", "network": "network", "geometric": "geometric"}


def finite2(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def main(folder: Path, variant: str):
    session = json.loads((folder / "session.json").read_text())
    w, h = session["viewport"]["width"], session["viewport"]["height"]
    px = lambda p: np.array([(p[0] + .5) * w, (p[1] + .5) * h])
    rows = [json.loads(l) for l in (folder / f"replay-{variant}.jsonl").read_text().splitlines() if l.strip()]
    blocks = [b for b in session["blocks"] if b["status"] == "complete"]
    us = [r for r in rows if r["screen"] == "block" and r["phase"] == "record" and r["facePresent"] and r["eyeState"] == "open" and r["live"]["facePresent"] and r["live"]["eyeState"] == "open" and r.get("target")]
    out = {"session": folder.name, "variant": variant, "frames": len(us), "blocks": {}, "overall": {}}
    L = [f"# Replay fidelity · {folder.name} · variant {variant}", "",
         f"{len(us)} record-phase frames usable in both runs (final attempts). px = CSS px of the {w}×{h} viewport. Per frame: median error vs the dot and median signed bias, live vs replayed. Per dot: the median estimate over the dot's frames in each run; |Δ err| = |replayed per-dot error − live per-dot error|; dist = distance between the two per-dot median estimates. Frame |Δ| = replayed − live estimate on the same frame; the live run's own consecutive-frame |Δ| on the same dot is the noise reference.", ""]
    agg = {s: {"d_err": [], "dist": [], "frame": [], "noise": [], "live_err": [], "rep_err": []} for s in STREAMS}
    for b in blocks:
        fr = [r for r in us if r["block"] == b["key"]]
        if not fr:
            continue
        L += [f"## {b['id']} {b['title']} · {len(fr)} frames", "", "| stream | live median px | replay median px | live bias dx/dy | replay bias dx/dy | frame \\|Δ\\| median / p90 | live consecutive \\|Δ\\| median | dots | per-dot \\|Δ err\\| median / max | per-dot dist median / max | live cells | replay cells |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        out["blocks"][b["id"]] = {}
        for s, f in STREAMS.items():
            pairs = [(px(r[f]), px(r["live"][f]), np.array([r["target"]["x"], r["target"]["y"]]), r["point"], r["i"]) for r in fr if finite2(r[f]) and finite2(r["live"][f])]
            if not pairs:
                continue
            rep = np.array([p[0] for p in pairs]); liv = np.array([p[1] for p in pairs]); tg = np.array([p[2] for p in pairs])
            e_rep = np.hypot(*(rep - tg).T); e_liv = np.hypot(*(liv - tg).T); frame_d = np.hypot(*(rep - liv).T)
            b_rep = np.median(rep - tg, axis=0); b_liv = np.median(liv - tg, axis=0)
            noise = [np.hypot(*(liv[k + 1] - liv[k])) for k in range(len(pairs) - 1) if pairs[k][3] == pairs[k + 1][3] and pairs[k + 1][4] - pairs[k][4] <= 2]
            dots = {}
            for k, p in enumerate(pairs):
                dots.setdefault(p[3], []).append(k)
            d_err, dist, cells_l, cells_r = [], [], 0, 0
            cell = lambda q: (int(q[1] / h * 2) * 4 + int(q[0] / w * 4)) if 0 <= q[0] < w and 0 <= q[1] < h else None
            tcell = {t["index"]: t["cell"] for t in session["targets"]}
            for pt, idx in dots.items():
                mr = np.median(rep[idx], axis=0); ml = np.median(liv[idx], axis=0); t = tg[idx[0]]
                d_err.append(abs(np.hypot(*(mr - t)) - np.hypot(*(ml - t)))); dist.append(np.hypot(*(mr - ml)))
                cells_l += cell(ml) == tcell[pt]; cells_r += cell(mr) == tcell[pt]
            st = {"frames": len(pairs), "live_median_px": float(np.median(e_liv)), "replay_median_px": float(np.median(e_rep)), "live_bias": b_liv.tolist(), "replay_bias": b_rep.tolist(),
                  "frame_delta_median": float(np.median(frame_d)), "frame_delta_p90": float(np.percentile(frame_d, 90)), "live_consecutive_delta_median": float(np.median(noise)) if noise else None,
                  "dots": len(dots), "per_dot_abs_err_delta_median": float(np.median(d_err)), "per_dot_abs_err_delta_max": float(np.max(d_err)), "per_dot_distance_median": float(np.median(dist)), "per_dot_distance_max": float(np.max(dist)), "live_cells": cells_l, "replay_cells": cells_r}
            out["blocks"][b["id"]][s] = st
            a = agg[s]; a["d_err"] += d_err; a["dist"] += dist; a["frame"] += frame_d.tolist(); a["noise"] += noise; a["live_err"].append(st["live_median_px"]); a["rep_err"].append(st["replay_median_px"])
            L.append(f"| {s} | {st['live_median_px']:.0f} | {st['replay_median_px']:.0f} | {b_liv[0]:+.0f}/{b_liv[1]:+.0f} | {b_rep[0]:+.0f}/{b_rep[1]:+.0f} | {st['frame_delta_median']:.0f} / {st['frame_delta_p90']:.0f} | {st['live_consecutive_delta_median']:.0f} | {len(dots)} | {st['per_dot_abs_err_delta_median']:.0f} / {st['per_dot_abs_err_delta_max']:.0f} | {st['per_dot_distance_median']:.0f} / {st['per_dot_distance_max']:.0f} | {cells_l}/{len(dots)} | {cells_r}/{len(dots)} |")
        L.append("")
    L += ["## Over all blocks", "", "| stream | blocks | per-block median px: median \\|replay − live\\| / max | per-dot \\|Δ err\\| median / p90 / max | per-dot dist median / p90 | frame \\|Δ\\| median / p90 | live consecutive \\|Δ\\| median |", "|---|---|---|---|---|---|---|"]
    for s, a in agg.items():
        if not a["d_err"]:
            continue
        bd = np.abs(np.array(a["rep_err"]) - np.array(a["live_err"]))
        o = {"blocks": len(a["live_err"]), "block_median_abs_delta_median": float(np.median(bd)), "block_median_abs_delta_max": float(np.max(bd)), "per_dot_abs_err_delta": {"median": float(np.median(a["d_err"])), "p90": float(np.percentile(a["d_err"], 90)), "max": float(np.max(a["d_err"]))},
             "per_dot_distance": {"median": float(np.median(a["dist"])), "p90": float(np.percentile(a["dist"], 90))}, "frame_delta": {"median": float(np.median(a["frame"])), "p90": float(np.percentile(a["frame"], 90))}, "live_consecutive_delta_median": float(np.median(a["noise"])) if a["noise"] else None}
        out["overall"][s] = o
        L.append(f"| {s} | {o['blocks']} | {o['block_median_abs_delta_median']:.0f} / {o['block_median_abs_delta_max']:.0f} | {o['per_dot_abs_err_delta']['median']:.0f} / {o['per_dot_abs_err_delta']['p90']:.0f} / {o['per_dot_abs_err_delta']['max']:.0f} | {o['per_dot_distance']['median']:.0f} / {o['per_dot_distance']['p90']:.0f} | {o['frame_delta']['median']:.0f} / {o['frame_delta']['p90']:.0f} | {o['live_consecutive_delta_median']:.0f} |")
    L.append("")
    (folder / f"replay-fidelity-{variant}.md").write_text("\n".join(L) + "\n")
    (folder / f"replay-fidelity-{variant}.json").write_text(json.dumps(out, indent=1) + "\n")
    print("\n".join(L[-len(STREAMS) - 2:]))


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve(), sys.argv[2] if len(sys.argv) == 3 else "none")
