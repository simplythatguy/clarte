#!/usr/bin/env python3
"""Paired comparison of the replay variants of one gaze-lab session.

Usage: .venv/bin/python -I analysis/replay-compare.py sessions/<id>

Reads replay-none.jsonl, replay-layout.jsonl, replay-freeze.jsonl, replay-both.jsonl (scripts/replay-blocks.mjs). Frames:
record-phase frames of a final block attempt with a face present and eyes open in the replay (the same frames in every
variant: the landmarker does not depend on the fixes; the script checks this). Per dot: the median estimate over the dot's
frames scored against the dot (px, CSS px of the recorded viewport). Paired difference = variant − none per dot, 95 %
interval = bootstrap over dots (5000 resamples, seed 7), per block and pooled over all blocks and over the block groups
(translation B2/B3/B5/B6/B7, pitch B10/B11/B13, yaw B8/B9, neutral B1/B12; B4 is reported alone: up 8 cm with a pitch).
Streams: blend (rawNormPog, what the app uses), network, geometric (control: the fixes should not move it).
Writes replay-compare.md, replay-compare.json and replay-compare.png (grouped bars per block) into the session folder.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

VARIANTS = ["none", "layout", "freeze", "both"]
STREAMS = {"blend": "rawNormPog", "network": "network", "geometric": "geometric"}
GROUPS = {"translation (B2 B3 B5 B6 B7)": ["B2", "B3", "B5", "B6", "B7"], "pitch (B10 B11 B13)": ["B10", "B11", "B13"], "yaw (B8 B9)": ["B8", "B9"], "neutral (B1 B12)": ["B1", "B12"], "up (B4)": ["B4"]}
# Reference palette slots (dataviz skill): none = secondary ink, layout = blue, freeze = orange, both = aqua.
COLORS = {"none": "#52514e", "layout": "#2a78d6", "freeze": "#eb6834", "both": "#1baf7a"}
N_BOOT = 5000


def finite2(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def load(folder, name):
    f = folder / f"replay-{name}.jsonl"
    if not f.exists():
        return None, None
    rows = [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    summary = json.loads((folder / f"replay-{name}.json").read_text())
    return rows, summary


def boot_ci(d, rng):
    d = np.asarray(d, float)
    if d.size < 2:
        return (float("nan"), float("nan"))
    idx = rng.integers(0, d.size, size=(N_BOOT, d.size))
    means = d[idx].mean(axis=1)
    return (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))


def main(folder: Path):
    session = json.loads((folder / "session.json").read_text())
    w, h = session["viewport"]["width"], session["viewport"]["height"]
    cm = (session.get("screen") or {}).get("cmPerCssPx")
    blocks = [b for b in session["blocks"] if b["status"] == "complete"]
    data = {}
    for v in VARIANTS:
        rows, summary = load(folder, v)
        if rows is None:
            print(f"missing replay-{v}.jsonl"); continue
        data[v] = (rows, summary)
    if "none" not in data:
        sys.exit("replay-none.jsonl is required")
    rng = np.random.default_rng(7)
    none_rows = data["none"][0]
    # Pairing check: every variant stepped the same live rows with the same face / eye state.
    key = lambda rows: [(r["i"], r["facePresent"], r["eyeState"]) for r in rows]
    pairing = {v: key(rows) == key(none_rows) for v, (rows, _) in data.items()}
    usable = lambda rows: [r for r in rows if r["screen"] == "block" and r["phase"] == "record" and r["facePresent"] and r["eyeState"] == "open" and r.get("target")]
    # Per block, per stream, per variant: per-dot median estimate errors (dict point → error).
    per_dot = {}
    for v, (rows, _) in data.items():
        us = usable(rows)
        for b in blocks:
            fr = [r for r in us if r["block"] == b["key"]]
            for s, field in STREAMS.items():
                dots = {}
                for r in fr:
                    if finite2(r[field]):
                        dots.setdefault(r["point"], []).append(((r[field][0] + .5) * w, (r[field][1] + .5) * h, r["target"]["x"], r["target"]["y"]))
                errs = {}
                for pt, lst in dots.items():
                    a = np.array(lst); m = np.median(a[:, :2], axis=0)
                    errs[pt] = float(math.hypot(m[0] - a[0, 2], m[1] - a[0, 3]))
                per_dot[(v, b["id"], s)] = errs
    out = {"session": folder.name, "viewport": [w, h], "cmPerCssPx": cm, "variants": list(data), "pairing_identical_frames": pairing,
           "offsets": {v: data[v][1].get("offsetMs") for v in data}, "training": {v: data[v][1].get("trainingReport", {}).get("replay") for v in data}, "blocks": {}, "pooled": {}, "groups": {}}
    L = [f"# Replay variants · paired comparison · {folder.name}", "",
         f"Variants: {', '.join(data)}. Frames: record-phase frames of a final block attempt with a face present and eyes open in the replay; the same {len(usable(none_rows))} frames in every variant (identical stepped frames and face/eye states: {pairing}). Per dot: median estimate over the dot's frames scored against the dot, CSS px of the {w}×{h} viewport" + (f" ({cm:.4f} cm/px)" if cm else "") + f". Paired difference = variant − none per dot; 95 % interval = bootstrap over dots ({N_BOOT} resamples). Negative = the variant is better. Clock offsets used: {out['offsets']}.", ""]
    L += ["## Training reports (replay)", "", "| variant | heldOutBefore | heldOutAfter | bestStep | stepsUsed | geometric heldOutMse | blend weight |", "|---|---|---|---|---|---|---|"]
    for v in data:
        tr = out["training"][v] or {}
        g = tr.get("geometric") or {}
        L.append(f"| {v} | {tr.get('heldOutBefore', float('nan')):.6f} | {tr.get('heldOutAfter', float('nan')):.6f} | {tr.get('bestStep')} | {tr.get('stepsUsed')} | {g.get('heldOutMse', float('nan')):.6f} | {g.get('weight', float('nan')):.3f} |")
    L.append("")
    variants = [v for v in VARIANTS if v in data]
    others = [v for v in variants if v != "none"]
    for s in STREAMS:
        L += [f"## {s}: per-dot median error per block (px) and paired difference vs none", "",
              "| block | dots | " + " | ".join(variants) + " | " + " | ".join(f"Δ {v} [95 %]" for v in others) + " |", "|---|---|" + "---|" * len(variants) + "---|" * len(others)]
        pooled = {v: [] for v in others}
        for b in blocks:
            base = per_dot[("none", b["id"], s)]
            cells = [f"{np.median(list(per_dot[(v, b['id'], s)].values())):.0f}" if per_dot[(v, b["id"], s)] else "—" for v in variants]
            dcells = []
            entry = {"dots": len(base), "median_error_px": {v: float(np.median(list(per_dot[(v, b["id"], s)].values()))) if per_dot[(v, b["id"], s)] else None for v in variants}, "paired": {}}
            for v in others:
                e = per_dot[(v, b["id"], s)]
                d = [e[pt] - base[pt] for pt in base if pt in e]
                pooled[v] += d
                lo, hi = boot_ci(d, rng)
                entry["paired"][v] = {"n": len(d), "mean_diff_px": float(np.mean(d)) if d else None, "median_diff_px": float(np.median(d)) if d else None, "ci95": [lo, hi], "dots_better": int(sum(1 for x in d if x < 0))}
                dcells.append(f"{np.mean(d):+.0f} [{lo:+.0f}, {hi:+.0f}] ({sum(1 for x in d if x < 0)}/{len(d)} better)" if d else "—")
            out["blocks"].setdefault(b["id"], {})[s] = entry
            L.append(f"| {b['id']} {b['title']} | {len(base)} | " + " | ".join(cells) + " | " + " | ".join(dcells) + " |")
        prow = []
        out["pooled"][s] = {}
        for v in others:
            d = pooled[v]; lo, hi = boot_ci(d, rng)
            out["pooled"][s][v] = {"n": len(d), "mean_diff_px": float(np.mean(d)) if d else None, "median_diff_px": float(np.median(d)) if d else None, "ci95": [lo, hi], "dots_better": int(sum(1 for x in d if x < 0))}
            prow.append(f"{np.mean(d):+.0f} [{lo:+.0f}, {hi:+.0f}] ({sum(1 for x in d if x < 0)}/{len(d)} better)" if d else "—")
        allv = [f"{np.median([e for b in blocks for e in per_dot[(v, b['id'], s)].values()]):.0f}" for v in variants]
        L.append(f"| **all blocks (pooled dots)** | {sum(len(per_dot[('none', b['id'], s)]) for b in blocks)} | " + " | ".join(allv) + " | " + " | ".join(prow) + " |")
        L.append("")
        # Block groups.
        L += [f"### {s}: block groups (pooled dots, mean paired difference vs none, 95 % bootstrap)", "", "| group | blocks present | dots | " + " | ".join(f"Δ {v}" for v in others) + " |", "|---|---|---|" + "---|" * len(others)]
        out["groups"][s] = {}
        for gname, ids in GROUPS.items():
            present = [b for b in blocks if b["id"] in ids]
            if not present:
                continue
            cells = []
            out["groups"][s][gname] = {"blocks": [b["id"] for b in present]}
            for v in others:
                d = [per_dot[(v, b["id"], s)][pt] - per_dot[("none", b["id"], s)][pt] for b in present for pt in per_dot[("none", b["id"], s)] if pt in per_dot[(v, b["id"], s)]]
                lo, hi = boot_ci(d, rng)
                out["groups"][s][gname][v] = {"n": len(d), "mean_diff_px": float(np.mean(d)) if d else None, "ci95": [lo, hi], "dots_better": int(sum(1 for x in d if x < 0))}
                cells.append(f"{np.mean(d):+.0f} [{lo:+.0f}, {hi:+.0f}] ({sum(1 for x in d if x < 0)}/{len(d)})" if d else "—")
            L.append(f"| {gname} | {' '.join(b['id'] for b in present)} | {sum(len(per_dot[('none', b['id'], s)]) for b in present)} | " + " | ".join(cells) + " |")
        L.append("")
    # Figure: blend per-dot median error per block (grouped bars) and the paired difference with intervals.
    fig, axes = plt.subplots(2, 1, figsize=(max(7, 1.1 * len(blocks) + 3), 7.5), sharex=True)
    x = np.arange(len(blocks)); wbar = .8 / len(variants)
    ax = axes[0]
    for k, v in enumerate(variants):
        vals = [np.median(list(per_dot[(v, b["id"], "blend")].values())) if per_dot[(v, b["id"], "blend")] else np.nan for b in blocks]
        ax.bar(x + (k - (len(variants) - 1) / 2) * wbar, vals, width=wbar * .9, color=COLORS[v], label=v, linewidth=0)
    ax.set_ylabel("per-dot median error, blend (px)"); ax.legend(frameon=False, ncol=4, fontsize=9); ax.grid(axis="y", color="#e5e4e0", linewidth=.6); ax.set_axisbelow(True)
    for sp in ("top", "right"): ax.spines[sp].set_visible(False)
    ax.set_title(f"{folder.name}: replayed per-dot median error per block", fontsize=11, loc="left")
    ax = axes[1]; wbar2 = .8 / max(1, len(others))
    for k, v in enumerate(others):
        means = [out["blocks"][b["id"]]["blend"]["paired"][v]["mean_diff_px"] or np.nan for b in blocks]
        cis = np.array([out["blocks"][b["id"]]["blend"]["paired"][v]["ci95"] for b in blocks], float)
        pos = x + (k - (len(others) - 1) / 2) * wbar2
        ax.bar(pos, means, width=wbar2 * .9, color=COLORS[v], label=f"{v} − none", linewidth=0)
        ax.errorbar(pos, means, yerr=[np.array(means) - cis[:, 0], cis[:, 1] - np.array(means)], fmt="none", ecolor="#0b0b0b", elinewidth=1, capsize=2)
    ax.axhline(0, color="#52514e", linewidth=.8); ax.set_ylabel("paired Δ per dot vs none (px)\nmean, 95 % bootstrap"); ax.legend(frameon=False, ncol=3, fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels([b["id"] for b in blocks]); ax.grid(axis="y", color="#e5e4e0", linewidth=.6); ax.set_axisbelow(True)
    for sp in ("top", "right"): ax.spines[sp].set_visible(False)
    fig.patch.set_facecolor("#fcfcfb")
    for a in axes: a.set_facecolor("#fcfcfb")
    fig.tight_layout(); fig.savefig(folder / "replay-compare.png", dpi=120); plt.close(fig)
    (folder / "replay-compare.md").write_text("\n".join(L) + "\n")
    (folder / "replay-compare.json").write_text(json.dumps(out, indent=1, default=lambda o: None if isinstance(o, float) and not math.isfinite(o) else str(o)) + "\n")
    print(f"wrote {folder / 'replay-compare.md'}, replay-compare.json, replay-compare.png · pairing {pairing}")
    for s in ("blend", "network"):
        print(f"  {s} pooled: " + "; ".join(f"{v} {p['mean_diff_px']:+.1f} px [{p['ci95'][0]:+.1f}, {p['ci95'][1]:+.1f}] ({p['dots_better']}/{p['n']} dots better)" for v, p in out["pooled"][s].items()))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
