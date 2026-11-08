"""Paired quick-calibration test: Q8 (8 cell-centre dots, ~18 s, shadow worker with the pose rows frozen and the geometric
share capped) against the shipped C0 calibration (~50 s) on the same validation frames of one live gaze-lab session.

Usage: .venv/bin/python -I analysis/quick.py sessions/<id>

Frames: record-phase frames of a block with a face present and eyes open, final attempt per block, exactly as analyze.py
counts them; px = CSS px of the recorded viewport (cm from the screen diagonal when known). Streams:
  quick blend      = quick.rawNormPog  (the Q8 network blended with the Q8 geometric fit at the capped share)
  quick network    = quick.network     (the Q8 head alone)
  shipped blend    = rawNormPog        (C0, the shipped weight)
  shipped network  = network           (the C0 head alone)
  (quick / shipped geometric are listed as extra rows; no paired call is made on them)
Per dot: the median estimate over the dot's usable frames (what a 1.6 s look gives the decoder) scored against the dot;
cell = the 4×2 navigation cell, row = top/bottom half, column = quarter of the width. Paired difference = quick − shipped
per dot for the same kind of stream, mean with a 95 % bootstrap interval over dots (5000 resamples, seed 7); negative Δ
error and non-negative Δ hit rate are better. Writes quick.md, quick.json and quick.png into the session folder.

Caveats stated in the report: Q8 ran first (any recency advantage went to C0); the C0 baseline ran in the shipped worker
without the freezePose fix, so a Q8 gain mixes the calibration design with the freeze (budget.py separates them offline).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory from sys.path
from analyze import Session  # noqa: E402

N_BOOT = 5000
STREAMS = {
    "quick blend": lambda r: (r.get("quick") or {}).get("rawNormPog"),
    "quick network": lambda r: (r.get("quick") or {}).get("network"),
    "shipped blend": lambda r: r.get("rawNormPog"),
    "shipped network": lambda r: r.get("network"),
    "quick geometric": lambda r: (r.get("quick") or {}).get("geometric"),
    "shipped geometric": lambda r: r.get("geometric"),
}
PAIRS = [("quick blend", "shipped blend"), ("quick network", "shipped network")]
CENTRE_ROWS = (1, 2)  # validation grid rows at 25 % / 75 %: the Q8 dots


def finite2(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def boot_mean(d, rng):
    d = np.asarray(d, float)
    d = d[~np.isnan(d)]
    if d.size < 2:
        return {"mean": float(np.mean(d)) if d.size else float("nan"), "lo": float("nan"), "hi": float("nan"), "n": int(d.size), "better": int(np.sum(d < 0))}
    idx = rng.integers(0, d.size, size=(N_BOOT, d.size))
    means = d[idx].mean(axis=1)
    return {"mean": float(d.mean()), "lo": float(np.percentile(means, 2.5)), "hi": float(np.percentile(means, 97.5)), "n": int(d.size), "better": int(np.sum(d < 0))}


def ci(b, unit="px", scale=1.0, digits=0):
    if not b or math.isnan(b.get("mean", float("nan"))):
        return "—"
    f = f"{{:+.{digits}f}}"
    s = f"{f.format(b['mean'] * scale)} [{f.format(b['lo'] * scale)}, {f.format(b['hi'] * scale)}] {unit}"
    return s + (f" ({b['better']}/{b['n']})" if unit == "px" else "")


def verdict(b):
    if not b or math.isnan(b.get("lo", float("nan"))):
        return "no call"
    return "quick better" if b["hi"] < 0 else "quick worse" if b["lo"] > 0 else "no call"


def dots_of(s: Session, block):
    """Per dot of one block: target, per-stream median estimate (px) and the frames it came from."""
    key = block.get("key", block["id"])
    usable = [r for r in s.usable(key) if r.get("target")]
    by_point = {}
    for r in usable:
        by_point.setdefault(r["point"], []).append(r)
    dots = []
    for point, frs in sorted(by_point.items()):
        t = frs[0]["target"]
        target_meta = next((x for x in s.targets if x["index"] == point), None)
        est = {}
        for name, get in STREAMS.items():
            pts = [get(r) for r in frs]
            pts = [s.to_px(p) for p in pts if finite2(p)]
            est[name] = (np.median(np.array(pts), axis=0), len(pts)) if pts else (None, 0)
        dots.append({"block": block["id"], "point": point, "target": np.array([t["x"], t["y"]], float), "centre": bool(target_meta and target_meta["row"] in CENTRE_ROWS),
                     "cell": target_meta["cell"] if target_meta else None, "column": target_meta["column"] if target_meta else None, "frames": len(frs), "est": est})
    return dots


def score(dot, name, w, h):
    e, n = dot["est"][name]
    if e is None:
        return {"err": float("nan"), "cell": float("nan"), "row": float("nan"), "col": float("nan"), "frames": 0}
    t = dot["target"]
    cell = int(min(1, max(0, e[1] // (h / 2))) * 4 + min(3, max(0, e[0] // (w / 4))))
    col = int(min(3, max(0, e[0] // (w / 4))))
    return {"err": float(np.linalg.norm(e - t)), "cell": float(cell == dot["cell"]), "row": float((e[1] >= h / 2) == (t[1] >= h / 2)), "col": float(col == dot["column"]), "frames": n}


def aggregate(dots, name, w, h, cm):
    sc = [score(d, name, w, h) for d in dots]
    errs = np.array([x["err"] for x in sc])
    ok = ~np.isnan(errs)
    out = {"dots": int(ok.sum()), "median_px": float(np.nanmedian(errs)) if ok.any() else float("nan"), "p90_px": float(np.nanpercentile(errs, 90)) if ok.any() else float("nan"),
           "cell": float(np.nanmean([x["cell"] for x in sc])) if ok.any() else float("nan"), "row": float(np.nanmean([x["row"] for x in sc])) if ok.any() else float("nan"),
           "col": float(np.nanmean([x["col"] for x in sc])) if ok.any() else float("nan"), "errs": errs.tolist(), "cells": [x["cell"] for x in sc], "cols": [x["col"] for x in sc], "rows": [x["row"] for x in sc]}
    out["median_cm"] = out["median_px"] * cm if cm else None
    return out


def paired(dots, a, b, w, h, rng):
    sa = [score(d, a, w, h) for d in dots]
    sb = [score(d, b, w, h) for d in dots]
    pairs = [(x, y) for x, y in zip(sa, sb) if not (math.isnan(x["err"]) or math.isnan(y["err"]))]
    return {"err": boot_mean([x["err"] - y["err"] for x, y in pairs], rng), "cell": boot_mean([x["cell"] - y["cell"] for x, y in pairs], rng),
            "row": boot_mean([x["row"] - y["row"] for x, y in pairs], rng), "col": boot_mean([x["col"] - y["col"] for x, y in pairs], rng)}


def pct(v):
    return "—" if v is None or math.isnan(v) else f"{100 * v:.0f} %"


def fmt_s(ms):
    return "—" if ms is None else f"{ms / 1000:.1f} s"


def main(folder: Path):
    s = Session(folder)
    session = s.session
    quick = session.get("quick")
    if not quick or not any(r.get("quick") for r in s.rows):
        print("no quick-calibration stream in this session (Setup → Quick calibration test, or ?quick=1)")
        return
    w, h, cm = s.w, s.h, s.cm_per_px
    rng = np.random.default_rng(7)
    blocks = [b for b in s.blocks if b["status"] == "complete"]
    init = quick.get("init") or {}
    report = quick.get("trainingReport") or {}
    c0 = quick.get("c0") or {}
    c0_report = (session.get("calibration") or {}).get("trainingReport") or {}
    q8_rows = s.block_rows(quick.get("block", "Q8"))
    label_rows = [r for r in q8_rows if r.get("phase") == "quick:label"]
    labels_per_dot = {}
    for r in label_rows:
        labels_per_dot.setdefault(r["point"], []).append(r["t"])
    spans = [max(v) - min(v) for v in labels_per_dot.values() if len(v) > 1]

    out = {"session": folder.name, "viewport": [w, h], "cmPerCssPx": cm, "order": quick.get("order"), "timing": quick.get("timing"), "worker": quick.get("worker"), "init": init,
           "q8": {"wallMs": quick.get("wallMs"), "labels": quick.get("labels"), "labelRows": len(label_rows), "labelsPerDot": {str(k): len(v) for k, v in labels_per_dot.items()},
                  "collectSpanMs": {"median": float(np.median(spans)) if spans else None, "min": float(min(spans)) if spans else None, "max": float(max(spans)) if spans else None},
                  "pauses": quick.get("pauses"), "trainingReport": report, "error": quick.get("error")},
           "c0": {**c0, "trainingReport": c0_report}, "blocks": {}, "pooled": {}}

    L = [f"# Quick-calibration test · {folder.name}", "",
         f"Tester: {session.get('tester', '?')}. Viewport {w}×{h} CSS px" + (f", {cm:.4f} cm per px" if cm else "") + f". Order: {quick.get('order', 'Q8 before C0')}: "
         "the quick calibration ran first in a shadow worker, then the shipped calibration in the primary worker; every validation frame went through both, so all "
         "numbers are paired per dot. Frames: record-phase frames with a face present and eyes open, final attempt per block. Per dot: the median estimate over the "
         "dot's usable frames scored against the dot. Cells: the 4×2 navigation grid; rows: top/bottom half; columns: quarter of the width. Paired difference = "
         f"quick − shipped per dot (same kind of stream), mean with a 95 % bootstrap interval over dots ({N_BOOT} resamples). Negative Δ error and non-negative Δ hit rate are better.", "",
         "## Two calibrations, one session", "",
         "| calibration | wall time (intro → trained) | dots | labels | network held-out MSE before → after (best/steps) | geometric held-out | geometric share of the blend | worker flags |", "|---|---|---|---|---|---|---|---|"]
    q_flags = f"freezePose {str(init.get('fixes', {}).get('freezePose', '?')).lower()}, limits {json.dumps(init.get('limits'))}, geometric share cap {init.get('blend', {}).get('geometricShareMax', '?')}"
    g = report.get("geometric") or {}
    L.append(f"| Q8 quick | {fmt_s(quick.get('wallMs'))}{' · ' + str(quick.get('pauses')) + ' pause(s)' if quick.get('pauses') else ''} | {len(quick.get('targets') or [])} | {quick.get('labels')} "
             f"({len(label_rows)} rows; per dot {min(labels_per_dot.values(), key=len).__len__() if labels_per_dot else '—'}–{max(labels_per_dot.values(), key=len).__len__() if labels_per_dot else '—'}; window span median {fmt_s(out['q8']['collectSpanMs']['median'])}) | "
             f"{report.get('heldOutBefore', float('nan')):.4f} → {report.get('heldOutAfter', float('nan')):.4f} ({report.get('bestStep', '—')}/{report.get('stepsUsed', '—')}) | "
             f"{g.get('heldOutMse') if g.get('heldOutMse') is None else f'{g['heldOutMse']:.4f}'} | {g.get('weight', '—') if not isinstance(g.get('weight'), float) else f'{g['weight']:.2f}'} | {q_flags} |")
    g0 = c0_report.get("geometric") or {}
    wait = c0.get("headStageWaitMs")
    L.append(f"| C0 shipped | {fmt_s(c0.get('wallMs'))}{f' (incl. {fmt_s(wait)} waiting for the key press before the head stage)' if wait is not None else ''} | 14 | {c0.get('labels')} | "
             f"{c0_report.get('heldOutBefore', float('nan')):.4f} → {c0_report.get('heldOutAfter', float('nan')):.4f} ({c0_report.get('bestStep', '—')}/{c0_report.get('stepsUsed', '—')}) | "
             f"{g0.get('heldOutMse') if g0.get('heldOutMse') is None else f'{g0['heldOutMse']:.4f}'} | {g0.get('weight', '—') if not isinstance(g0.get('weight'), float) else f'{g0['weight']:.2f}'} | shipped (no fixes, 42-sample cap, share ≤ 0.85) |")
    L.append("")
    if quick.get("error"):
        L += [f"**The quick calibration failed: {quick['error']}.** The quick streams below are empty.", ""]

    all_dots = []
    for b in blocks:
        dots = dots_of(s, b)
        all_dots.extend(dots)
        shift = b.get("headShift") or {}
        L.append(f"## {b['id']} {b.get('title', '')} · {len(dots)} dots · head shift x {shift.get('dx', float('nan')):+.1f} y {shift.get('dy', float('nan')):+.1f} z {shift.get('dz', float('nan')):+.1f} cm, "
                 f"yaw {shift.get('yawDeg', float('nan')):+.1f}° pitch {shift.get('pitchDeg', float('nan')):+.1f}°")
        L += ["", "| stream | dots | median px" + (" (cm)" if cm else "") + " | p90 px | cell | row | column |", "|---|---|---|---|---|---|---|"]
        table = {}
        for name in STREAMS:
            a = aggregate(dots, name, w, h, cm)
            table[name] = {k: v for k, v in a.items() if k not in ("errs", "cells", "cols", "rows")}
            L.append(f"| {name} | {a['dots']} | {a['median_px']:.0f}" + (f" ({a['median_cm']:.1f})" if cm and a["median_cm"] is not None else "") + f" | {a['p90_px']:.0f} | {pct(a['cell'])} | {pct(a['row'])} | {pct(a['col'])} |")
        L.append("")
        diffs = {}
        for a_name, b_name in PAIRS:
            p = paired(dots, a_name, b_name, w, h, rng)
            diffs[f"{a_name} − {b_name}"] = p
            L.append(f"- Paired {a_name} − {b_name}: error {ci(p['err'])} · cell {ci(p['cell'], 'pp', 100)} · row {ci(p['row'], 'pp', 100)} · column {ci(p['col'], 'pp', 100)} → **{verdict(p['err'])}** on error.")
        L.append("")
        out["blocks"][b["id"]] = {"key": b.get("key"), "dots": len(dots), "table": table, "paired": diffs, "headShift": shift}

    # Pooled over blocks: all 16 dots per block, and the 8 cell-centre dots (where Q8 was trained).
    for title, sel in [("all dots of all blocks", all_dots), ("cell-centre dots only (rows at 25 % / 75 %, the Q8 dots)", [d for d in all_dots if d["centre"]])]:
        L += [f"## Pooled · {title} · {len(sel)} dots over {len(blocks)} blocks", "", "| stream | dots | median px" + (" (cm)" if cm else "") + " | p90 px | cell | row | column |", "|---|---|---|---|---|---|---|"]
        table = {}
        for name in STREAMS:
            a = aggregate(sel, name, w, h, cm)
            table[name] = {k: v for k, v in a.items() if k not in ("errs", "cells", "cols", "rows")}
            L.append(f"| {name} | {a['dots']} | {a['median_px']:.0f}" + (f" ({a['median_cm']:.1f})" if cm and a["median_cm"] is not None else "") + f" | {a['p90_px']:.0f} | {pct(a['cell'])} | {pct(a['row'])} | {pct(a['col'])} |")
        L.append("")
        diffs = {}
        for a_name, b_name in PAIRS:
            p = paired(sel, a_name, b_name, w, h, rng)
            diffs[f"{a_name} − {b_name}"] = p
            L.append(f"- Paired {a_name} − {b_name}: error {ci(p['err'])} · cell {ci(p['cell'], 'pp', 100)} · row {ci(p['row'], 'pp', 100)} · column {ci(p['col'], 'pp', 100)} → **{verdict(p['err'])}** on error.")
        L.append("")
        out["pooled"][title] = {"dots": len(sel), "table": table, "paired": diffs}

    # Per-block verdict table for the blend (what the app uses).
    L += ["## Per block · blend · paired Δ error (quick − shipped, mean over dots, 95 % bootstrap)", "", "| block | dots | quick blend px | shipped blend px | Δ error | Δ cell | call |", "|---|---|---|---|---|---|---|"]
    for bid, B in out["blocks"].items():
        p = B["paired"]["quick blend − shipped blend"]
        L.append(f"| {bid} | {B['dots']} | {B['table']['quick blend']['median_px']:.0f} | {B['table']['shipped blend']['median_px']:.0f} | {ci(p['err'])} | {ci(p['cell'], 'pp', 100)} | {verdict(p['err'])} |")
    L.append("")
    L += ["## Reading this", "",
          "- Q8 ran **first**, so fatigue and any recency advantage favour the shipped C0 calibration, not the quick one.",
          "- The C0 baseline is the shipped worker **without** the freezePose fix, while Q8 ran with it. A Q8 gain therefore mixes two things: the 8-dot design with "
          "longer collection windows, and the frozen pose input rows. The offline `budget.py` run on recorded data separates them (shipped vs frozen head per design); this live "
          "test only settles whether the whole quick package beats what ships.",
          "- Q8's blend runs at a capped geometric share (see the flags above); the C0 blend uses the shipped inverse-MSE weight. `quick network` vs `shipped network` compares the heads alone.",
          "- One tester, one session: intervals are over 15–16 dots per block; pooled intervals over all dots are the ones to read.", ""]
    (folder / "quick.md").write_text("\n".join(L) + "\n")

    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            return None
        if isinstance(o, np.generic):
            return clean(o.item())
        return o
    (folder / "quick.json").write_text(json.dumps(clean(out), indent=1))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        names = list(out["blocks"].keys()) + ["pooled"]
        x = np.arange(len(names)); wd = .2
        fig, axes = plt.subplots(2, 1, figsize=(max(8, 1.3 * len(names) + 3), 7.5), gridspec_kw={"height_ratios": [3, 2]})
        ax = axes[0]
        series = [("shipped blend", "#7a7a76"), ("quick blend", "#1c5e9e"), ("shipped network", "#bdbdb8"), ("quick network", "#7fb0dc")]
        pooled = out["pooled"]["all dots of all blocks"]["table"]
        for i, (name, color) in enumerate(series):
            vals = [out["blocks"][b]["table"][name]["median_px"] for b in names[:-1]] + [pooled[name]["median_px"]]
            ax.bar(x + (i - 1.5) * wd, vals, wd, label=name, color=color)
        titles = {b["id"]: b.get("title", "") for b in blocks}
        ax.set_xticks(x); ax.set_xticklabels([f"{b}\n{titles.get(b, '')}" for b in names[:-1]] + ["all"], fontsize=8)
        ax.set_ylabel("median per-dot error (px)")
        ax.set_ylim(0, 1.3 * max(v for name, _ in series for v in ([out["blocks"][b]["table"][name]["median_px"] for b in names[:-1]] + [pooled[name]["median_px"]]) if not math.isnan(v)))
        ax.set_title(f"Q8 quick ({fmt_s(quick.get('wallMs'))}, ran first) vs shipped C0 ({fmt_s(c0.get('wallMs'))}) on the same frames · {session.get('tester', '')}", fontsize=10)
        ax.legend(fontsize=8, ncol=4)
        ax = axes[1]
        for i, (pair, color) in enumerate([("quick blend − shipped blend", "#1c5e9e"), ("quick network − shipped network", "#7fb0dc")]):
            ps = [out["blocks"][b]["paired"][pair]["err"] for b in names[:-1]] + [out["pooled"]["all dots of all blocks"]["paired"][pair]["err"]]
            m = np.array([p["mean"] for p in ps]); lo = np.array([p["lo"] for p in ps]); hi = np.array([p["hi"] for p in ps])
            ax.errorbar(x + (i - .5) * .25, m, yerr=[m - lo, hi - m], fmt="o", color=color, capsize=3, label=pair)
        ax.axhline(0, color="#8a8a87", lw=1)
        ax.set_xticks(x); ax.set_xticklabels(names[:-1] + ["all"], fontsize=8)
        ax.set_ylabel("paired Δ error px\n(quick − shipped, 95 % CI)")
        ax.legend(fontsize=8)
        fig.tight_layout(); fig.savefig(folder / "quick.png", dpi=130)
    except Exception as e:  # plotting is optional
        print("plot skipped:", e)
    print("wrote", folder / "quick.md", folder / "quick.json", folder / "quick.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
