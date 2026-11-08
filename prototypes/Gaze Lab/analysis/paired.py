"""Paired comparison of the shipped tracker and a loaded candidate on one gaze-lab session.

Usage: .venv/bin/python -I analysis/paired.py sessions/<id>

Same frames, two estimators, so every statistic is paired per dot. Frames: record-phase frames of a block with a face
present and eyes open ("usable"), final attempt per block, exactly as analyze.py counts them. Units: CSS px of the
recorded viewport (cm from the screen diagonal when known). Streams:
  shipped blend   = rawNormPog (network blended with the geometric estimate at the shipped weight)
  candidate final = the candidate's head blended with the session's own geometric estimate at the candidate's blend share
  shipped network / candidate head = the two gaze heads alone
Per dot: the median estimate over the dot's usable frames (what a 1.6 s look gives the decoder) scored against the dot.
Paired difference = candidate − shipped per dot; the 95 % interval is a bootstrap over dots (5000 resamples).
Writes paired.md, paired.json and paired.png into the session folder.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

STREAMS = {
    "shipped blend": lambda r: r.get("rawNormPog"),
    "candidate final": lambda r: (r.get("candidate") or {}).get("final"),
    "shipped network": lambda r: r.get("network"),
    "candidate head": lambda r: ((r.get("candidate") or {}).get("head") or {}).get("network"),
    "candidate head blend": lambda r: ((r.get("candidate") or {}).get("head") or {}).get("rawNormPog"),
}
PAIRS = [("candidate final", "shipped blend"), ("candidate head", "shipped network")]


def finite2(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def main(folder: Path):
    session = json.loads((folder / "session.json").read_text())
    rows = [json.loads(line) for line in (folder / "frames.jsonl").read_text().splitlines() if line.strip()]
    w, h = session["viewport"]["width"], session["viewport"]["height"]
    cm = (session.get("screen") or {}).get("cmPerCssPx")
    blocks = {}
    for b in session["blocks"]:
        if b["status"] == "complete":
            blocks[b["id"]] = b
    if not any((r.get("candidate") or {}).get("final") for r in rows):
        print("no candidate stream in this session"); return
    rng = np.random.default_rng(7)
    out = {"session": folder.name, "viewport": [w, h], "cmPerCssPx": cm, "blocks": {}, "overall": {}}
    L = [f"# Paired comparison · {folder.name}", "",
         f"Candidate: `{(session.get('settings') or {}).get('candidate', {}).get('name', '?')}`. Viewport {w}×{h} CSS px"
         + (f", {cm:.4f} cm per px" if cm else "") + ". Per-dot medians over usable record frames (final attempt per block); "
         "paired difference = candidate − shipped per dot, 95 % bootstrap interval over dots. Cells: the dot's median estimate "
         "falls in the dot's 4×2 cell; rows: same for the top/bottom half.", ""]
    all_dots = {name: [] for name in STREAMS}
    all_targets = []

    def cell(p):
        return (min(3, max(0, int(p[0] // (w / 4)))), min(1, max(0, int(p[1] // (h / 2)))))

    for bid, b in blocks.items():
        key = b.get("key", bid)
        usable = [r for r in rows if r.get("block") == key and r.get("screen") == "block" and r.get("phase") == "record"
                  and r.get("facePresent") and r.get("eyeState") == "open" and r.get("target")]
        dots = {}
        for r in usable:
            dots.setdefault(r["point"], []).append(r)
        per_stream = {}
        targets = []
        for point, frs in sorted(dots.items()):
            t = frs[0]["target"]; tp = np.array([t["x"], t["y"]], dtype=float)
            targets.append(tp)
            for name, get in STREAMS.items():
                pts = [get(r) for r in frs]
                pts = [np.array([(p[0] + .5) * w, (p[1] + .5) * h]) for p in pts if finite2(p)]
                per_stream.setdefault(name, []).append(np.median(np.array(pts), axis=0) if pts else None)
        table = {}
        for name, ests in per_stream.items():
            errs = np.array([np.linalg.norm(e - t) if e is not None else np.nan for e, t in zip(ests, targets)])
            dx = np.array([abs(e[0] - t[0]) if e is not None else np.nan for e, t in zip(ests, targets)])
            dy = np.array([abs(e[1] - t[1]) if e is not None else np.nan for e, t in zip(ests, targets)])
            cells = [cell(e) == cell(t) for e, t in zip(ests, targets) if e is not None]
            rws = [(e[1] > h / 2) == (t[1] > h / 2) for e, t in zip(ests, targets) if e is not None]
            table[name] = {"dots": int(np.sum(~np.isnan(errs))), "median_px": float(np.nanmedian(errs)), "median_dx": float(np.nanmedian(dx)),
                           "median_dy": float(np.nanmedian(dy)), "p90_px": float(np.nanpercentile(errs, 90)),
                           "cells": f"{sum(cells)}/{len(cells)}", "rows": f"{sum(rws)}/{len(rws)}", "errs": errs}
            all_dots[name].extend(errs.tolist())
        all_targets.extend(targets)
        diffs = {}
        for a, s in PAIRS:
            d = table[a]["errs"] - table[s]["errs"]; d = d[~np.isnan(d)]
            if len(d):
                boots = np.array([np.median(rng.choice(d, size=len(d), replace=True)) for _ in range(5000)])
                diffs[f"{a} − {s}"] = {"median": float(np.median(d)), "lo": float(np.percentile(boots, 2.5)), "hi": float(np.percentile(boots, 97.5)),
                                       "candidate_better": int(np.sum(d < 0)), "n": int(len(d))}
        shift = (b.get("headShift") or b.get("shift") or {})
        L.append(f"## {bid} {b.get('title', '')} · {len(usable)} usable frames · {len(targets)} dots · head shift "
                 f"x {shift.get('dx', float('nan')):+.1f} y {shift.get('dy', float('nan')):+.1f} z {shift.get('dz', float('nan')):+.1f} cm, "
                 f"yaw {shift.get('yawDeg', float('nan')):+.1f}° pitch {shift.get('pitchDeg', float('nan')):+.1f}°")
        L += ["", "| stream | median px" + (" (cm)" if cm else "") + " | median \\|dx\\| | median \\|dy\\| | p90 px | cells | rows |", "|---|---|---|---|---|---|---|"]
        for name, v in table.items():
            L.append(f"| {name} | {v['median_px']:.0f}" + (f" ({v['median_px'] * cm:.1f})" if cm else "") +
                     f" | {v['median_dx']:.0f} | {v['median_dy']:.0f} | {v['p90_px']:.0f} | {v['cells']} | {v['rows']} |")
        L.append("")
        for k, d in diffs.items():
            L.append(f"- Paired {k}: median {d['median']:+.0f} px [{d['lo']:+.0f}, {d['hi']:+.0f}], candidate better on {d['candidate_better']}/{d['n']} dots.")
        L.append("")
        out["blocks"][bid] = {"table": {k: {kk: vv for kk, vv in v.items() if kk != "errs"} for k, v in table.items()}, "paired": diffs, "shift": shift}
    # Overall across blocks (all dots pooled, still paired).
    L += ["## All blocks pooled", ""]
    for a, s in PAIRS:
        ea, es = np.array(all_dots[a]), np.array(all_dots[s]); d = ea - es; m = ~np.isnan(d); d = d[m]
        boots = np.array([np.median(rng.choice(d, size=len(d), replace=True)) for _ in range(5000)])
        rec = {"median_candidate": float(np.nanmedian(ea)), "median_shipped": float(np.nanmedian(es)), "median_diff": float(np.median(d)),
               "lo": float(np.percentile(boots, 2.5)), "hi": float(np.percentile(boots, 97.5)), "candidate_better": int(np.sum(d < 0)), "n": int(len(d))}
        out["overall"][f"{a} − {s}"] = rec
        L.append(f"- {a} {rec['median_candidate']:.0f} px vs {s} {rec['median_shipped']:.0f} px (per-dot medians); paired difference "
                 f"{rec['median_diff']:+.0f} px [{rec['lo']:+.0f}, {rec['hi']:+.0f}], candidate better on {rec['candidate_better']}/{rec['n']} dots.")
    L += ["", "Caveat: one tester, one session; the candidate head was trained on the previous session's calibration while the shipped head was calibrated in this session."]
    (folder / "paired.md").write_text("\n".join(L) + "\n")
    (folder / "paired.json").write_text(json.dumps(out, indent=1))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        names = list(out["blocks"].keys()); x = np.arange(len(names)); wd = .38
        fig, ax = plt.subplots(figsize=(10, 4))
        for i, (name, color) in enumerate([("shipped blend", "tab:gray"), ("candidate final", "tab:blue")]):
            vals = [out["blocks"][b]["table"][name]["median_px"] for b in names]
            ax.bar(x + (i - .5) * wd, vals, wd, label=name, color=color)
            for xi, v in zip(x + (i - .5) * wd, vals):
                ax.text(xi, v + 8, f"{v:.0f}", ha="center", fontsize=8)
        ax.set_xticks(x); ax.set_xticklabels([f"{b}\n{blocks[b].get('title', '')}" for b in names], fontsize=8)
        ax.set_ylabel("median per-dot error (px)"); ax.set_title("Same frames: freshly calibrated shipped tracker vs retrained head with frozen pose inputs")
        ax.legend(); fig.tight_layout(); fig.savefig(folder / "paired.png", dpi=130)
    except Exception as e:  # plotting is optional
        print("plot skipped:", e)
    print("wrote", folder / "paired.md", folder / "paired.json", folder / "paired.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
