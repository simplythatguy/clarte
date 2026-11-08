#!/usr/bin/env python3
"""gaze-lab offline analysis.

Usage: .venv/bin/python -I analysis/analyze.py <session_dir>

Reads session.json and frames.jsonl, writes report.md, PNG plots and candidate.json into the session folder.
Every number states what it measures, its units, and which frames count. Unless a table says otherwise,
frames are record-phase frames with a face present and eyes open ("usable"), and a block's rows are the
final attempt of that block (redone attempts are ignored). Pixels are CSS pixels of the recorded viewport.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REFERENCE_DEPTH_CM = 60.0
SHIPPED_RIDGE = {"eye": 1e-3, "rotation": 3e-3, "depth": 1e-3}
SHIPPED12 = ["r_iris_x", "r_iris_y", "r_upper", "r_lower", "l_iris_x", "l_iris_y", "l_upper", "l_lower", "z", "z_fwd_x", "z_fwd_y", "one"]
ESTIMATORS = {"network": "network", "geometric": "geometric", "blend": "rawNormPog", "normPog": "normPog", "candidate": None}


def median(v):
    v = np.asarray([x for x in v if x is not None and np.isfinite(x)], dtype=float)
    return float(np.median(v)) if v.size else float("nan")


def p90(v):
    v = np.asarray([x for x in v if x is not None and np.isfinite(x)], dtype=float)
    return float(np.sort(v)[min(v.size - 1, max(0, math.ceil(0.9 * v.size) - 1))]) if v.size else float("nan")


def fmt(v, digits=0):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "—"
    return f"{v:.{digits}f}"


def head_angles(rt):
    if not rt or len(rt) != 16 or not all(np.isfinite(rt)):
        return None
    fx, fy, fz = rt[8], rt[9], rt[10]
    n = math.hypot(fx, fy, fz)
    if n < 1e-6:
        return None
    return math.degrees(math.atan2(fx / n, fz / n)), math.degrees(math.asin(max(-1, min(1, fy / n))))


class Session:
    def __init__(self, folder: Path):
        self.folder = folder
        self.session = json.loads((folder / "session.json").read_text())
        self.rows = [json.loads(line) for line in (folder / "frames.jsonl").read_text().splitlines() if line.strip()]
        self.viewport = self.session["viewport"]
        self.w, self.h = self.viewport["width"], self.viewport["height"]
        self.cm_per_px = (self.session.get("screen") or {}).get("cmPerCssPx")
        self.targets = self.session["targets"]
        # Final attempt per block id, in session order; skipped blocks are reported as such.
        kept = {}
        for b in self.session["blocks"]:
            if b["status"] in ("complete", "skipped"):
                kept[b["id"]] = b
        self.blocks = list(kept.values())
        self.by_block = {}
        for r in self.rows:
            self.by_block.setdefault(r["block"], []).append(r)
        ref = (self.session.get("calibration") or {}).get("reference")
        self.reference = ref
        self.label_fix = self._fix_calibration_labels()

    def _fix_calibration_labels(self):
        """Harness builds before 2026-11-07 13:00 annotated the third accepted label of each calibration dot with the
        NEXT dot's target in frames.jsonl (the logger read the calibration state after it had advanced). The worker
        received the right label; eyestrips/replay.json holds it. Rewrite `target` of C0 label rows from replay.json
        (joined by the frame time `at`), else by the three-labels-per-dot rule. Returns what was done."""
        rows = [r for r in self.block_rows("C0") if (r.get("phase") or "").endswith(":label")]
        if not rows:
            return {"source": "none", "corrected": 0}
        labels = {}
        replay = self.folder / "eyestrips" / "replay.json"
        if replay.exists():
            try:
                for e in json.loads(replay.read_text()).get("entries", []):
                    if e.get("kind") == "calibration" and e.get("label") and len(e["label"]) == 2:
                        labels[round(float(e["at"]), 3)] = (float(e["label"][0]), float(e["label"][1]))
            except (ValueError, KeyError, TypeError):
                labels = {}
        corrected = 0
        if labels:
            matched = 0
            for r in rows:
                lab = labels.get(round(float(r["t"]), 3))
                if lab is None:
                    continue
                matched += 1
                t = r.get("target") or {}
                if t and abs(t.get("nx", 9) - lab[0]) < 1e-6 and abs(t.get("ny", 9) - lab[1]) < 1e-6:
                    continue
                r["target"] = {"x": (lab[0] + .5) * self.w, "y": (lab[1] + .5) * self.h, "nx": lab[0], "ny": lab[1]}
                corrected += 1
            if matched:
                return {"source": "eyestrips/replay.json", "matched": matched, "corrected": corrected}
        for i in range(2, len(rows), 3):
            prev = rows[i - 1].get("target")
            if prev:
                rows[i]["target"] = dict(prev)
                corrected += 1
        return {"source": "three-per-dot rule", "corrected": corrected}

    def block_rows(self, key):
        return self.by_block.get(key, [])

    def usable(self, key):
        return [r for r in self.block_rows(key) if r["screen"] == "block" and r["phase"] == "record" and r["facePresent"] and r["eyeState"] == "open"]

    def calibration_labels(self):
        return [r for r in self.block_rows("C0") if (r["phase"] or "").endswith(":label") and r["facePresent"] and r["eyeState"] == "open"]

    def to_px(self, p):
        return np.array([(p[0] + .5) * self.w, (p[1] + .5) * self.h])

    def estimate_px(self, row, name):
        if name == "candidate":
            c = row.get("candidate")
            p = c and c.get("final")
        elif name == "pointer":
            p = row.get("pointer")
            return np.array(p, dtype=float) if p else None
        else:
            p = row.get(ESTIMATORS[name])
        if not p or len(p) != 2 or not all(isinstance(v, (int, float)) and np.isfinite(v) for v in p):
            return None
        return self.to_px(p)

    def target_px(self, row):
        t = row.get("target")
        return np.array([t["x"], t["y"]]) if t else None

    def head_shift(self, rows):
        if not self.reference:
            return None
        ro = self.reference["origin"]
        d = [(r["faceOrigin3D"][0] - ro[0], r["faceOrigin3D"][1] - ro[1], r["faceOrigin3D"][2] - ro[2]) for r in rows if r.get("faceOrigin3D")]
        ang = [head_angles(r.get("faceRt")) for r in rows]
        ang = [a for a in ang if a]
        if not d:
            return None
        return {"dx": median([x[0] for x in d]), "dy": median([x[1] for x in d]), "dz": median([x[2] for x in d]),
                "yaw": median([a[0] - self.reference.get("yawDeg", 0) for a in ang]) if ang else float("nan"),
                "pitch": median([a[1] - self.reference.get("pitchDeg", 0) for a in ang]) if ang else float("nan"), "samples": len(d)}


def stats(pairs, cm_per_px):
    if not pairs:
        return None
    p = np.array([a for a, _ in pairs]); t = np.array([b for _, b in pairs])
    d = p - t
    e = np.hypot(d[:, 0], d[:, 1])
    out = {"frames": len(pairs), "median_px": float(np.median(e)), "abs_dx_px": float(np.median(np.abs(d[:, 0]))), "abs_dy_px": float(np.median(np.abs(d[:, 1]))),
           "bias_dx_px": float(np.median(d[:, 0])), "bias_dy_px": float(np.median(d[:, 1])), "p90_px": p90(e), "p90_dx_px": p90(np.abs(d[:, 0])), "p90_dy_px": p90(np.abs(d[:, 1]))}
    if cm_per_px:
        out["median_cm"] = out["median_px"] * cm_per_px
        out["abs_dx_cm"] = out["abs_dx_px"] * cm_per_px
        out["abs_dy_cm"] = out["abs_dy_px"] * cm_per_px
    return out


def cell_of(p, w, h):
    if not (0 <= p[0] < w and 0 <= p[1] < h):
        return None
    return int(p[1] / h * 2) * 4 + int(p[0] / w * 4)


# ---------------- features for refits ----------------
def feature_row(row, names):
    """Values for feature names, mirroring src/lab/candidate.ts candidateFeatures; None when unusable."""
    g = row.get("gaze")
    f12 = row.get("features12")
    if not g or not f12:
        return None
    o = row.get("faceOrigin3D")
    z = o[2] if o and o[2] > 0 else float("nan")
    ang = head_angles(row.get("faceRt"))
    values = dict(zip(SHIPPED12, f12))
    values.update({"origin_x_over_z": o[0] / z if o else float("nan"), "origin_y_over_z": o[1] / z if o else float("nan"), "openness": g["openness"],
                   "head_yaw": ang[0] / 30 if ang else float("nan"), "head_pitch": ang[1] / 30 if ang else float("nan")})
    out = [values[n] for n in names]
    return out if all(np.isfinite(out)) else None


def penalty_for(names, eye=SHIPPED_RIDGE["eye"], rotation=SHIPPED_RIDGE["rotation"], depth=SHIPPED_RIDGE["depth"], extra=1e-3):
    pen = []
    for n in names:
        if n in ("r_iris_x", "r_iris_y", "r_upper", "r_lower", "l_iris_x", "l_iris_y", "l_upper", "l_lower"):
            pen.append(eye)
        elif n in ("z_fwd_x", "z_fwd_y"):
            pen.append(rotation)
        elif n == "z":
            pen.append(depth)
        elif n == "one":
            pen.append(0.0)
        else:
            pen.append(extra)
    return np.array(pen)


def ridge_fit(X, Y, penalty_x, penalty_y):
    """Separate ridge per axis; returns 2×k weights."""
    XtX = X.T @ X
    wx = np.linalg.solve(XtX + np.diag(penalty_x), X.T @ Y[:, 0])
    wy = np.linalg.solve(XtX + np.diag(penalty_y), X.T @ Y[:, 1])
    return np.vstack([wx, wy])


def fit_geometric(X, Y, penalty_x, penalty_y, outlier_pass=True):
    """The shipped fit: ridge, one outlier pass (residual > max(0.02, 4×median)), refit."""
    W = ridge_fit(X, Y, penalty_x, penalty_y)
    if outlier_pass and len(X) >= 12:
        r = np.hypot(*(X @ W.T - Y).T)
        limit = max(0.02, 4 * np.median(r))
        keep = r <= limit
        if keep.sum() >= 12 and keep.sum() < len(X):
            W = ridge_fit(X[keep], Y[keep], penalty_x, penalty_y)
    return W


def design(rows, names, label_from="target"):
    X, Y, keep = [], [], []
    for r in rows:
        f = feature_row(r, names)
        t = r.get("target")
        if f is None or not t:
            continue
        X.append(f); Y.append([t["nx"], t["ny"]]); keep.append(r)
    return np.array(X), np.array(Y), keep


# ---------------- analysis ----------------
def main(folder: Path):
    s = Session(folder)
    lines = []
    L = lines.append
    L(f"# gaze-lab report · {s.session.get('id')}")
    L("")
    L(f"Tester: {s.session.get('tester')} · demo: {s.session.get('demo')} · viewport {s.w}×{s.h} CSS px · screen {s.session.get('screen', {}).get('diagonalIn')} in, dpr {s.session.get('screen', {}).get('devicePixelRatio')} → {fmt(s.cm_per_px, 4)} cm per CSS px · camera {s.session.get('camera')} · backend {s.session.get('backend')} · source commit {s.session.get('source', {}).get('commit')}")
    L("")
    L("Frames counted everywhere below: record-phase frames of a block with a face present and eyes open (\"usable\"), final attempt of each block. Calibration refits use the frames the worker accepted as labels (phase `*:label`). Units: px = CSS pixels of the recorded viewport, cm from the screen diagonal; degrees from the face transformation matrix.")
    L("")
    tr = (s.session.get("calibration") or {}).get("trainingReport")
    if tr:
        g = tr.get("geometric") or {}
        L(f"Calibration (C0): {tr.get('samples')} labels, network held-out MSE {fmt(tr.get('heldOutBefore'), 4)} → {fmt(tr.get('heldOutAfter'), 4)} (normalized units², {tr.get('bestStep')}/{tr.get('stepsUsed')} Adam steps); geometric fit {g.get('samples')} samples on {g.get('targets')} dots, {g.get('outliers')} outliers, held-out MSE {fmt(g.get('heldOutMse'), 4)}, shipped blend weight (geometric share) {fmt(g.get('weight'), 2)}.")
        L("")

    # 1. Per-block table.
    L("## 1. Per-block error")
    L("")
    L("Median Euclidean error, median |dx| and |dy|, median signed bias, 90th percentile, all in px (cm in brackets where the screen size is known). `blend` is the shipped rawNormPog; `normPog` is the worker's clipped blend (or the Kalman-filtered network when no geometric fit exists); `pointer` is the One Euro-filtered cursor; `candidate` only when a candidate.json was loaded. Cells: dots whose record-phase median blend estimate lands in the dot's 4×2 navigation cell. Head shift: median over the block's usable frames of faceOrigin3D minus the calibration reference (cm; +x image right = tester's left on an unmirrored webcam, +y image down, +z farther) and yaw/pitch from the face matrix (deg).")
    L("")
    per_block = {}
    for b in s.blocks:
        key = b["key"]
        rows = s.usable(key)
        rec = [r for r in s.block_rows(key) if r["screen"] == "block" and r["phase"] == "record"]
        head = s.head_shift(rows)
        est = {}
        for name in ["network", "geometric", "blend", "normPog", "pointer", "candidate"]:
            pairs = [(s.estimate_px(r, name), s.target_px(r)) for r in rows]
            pairs = [(p, t) for p, t in pairs if p is not None and t is not None]
            est[name] = stats(pairs, s.cm_per_px)
        hits = points = 0
        for t in s.targets:
            ps = [s.estimate_px(r, "blend") for r in rows if r["point"] == t["index"]]
            ps = [p for p in ps if p is not None]
            if not ps:
                continue
            points += 1
            if cell_of(np.median(np.array(ps), axis=0), s.w, s.h) == t["cell"]:
                hits += 1
        per_block[key] = {"block": b, "rows": rows, "estimators": est, "cells": (hits, points), "head": head, "camera_moved": sum(1 for r in s.block_rows(key) if (r.get("camera") or {}).get("moved"))}
        L(f"### {b['id']} {b['title']} · {b['status']} · {len(rows)}/{len(rec)} usable record frames · cells {hits}/{points}" + (f" · head shift x {fmt(head['dx'], 1)} y {fmt(head['dy'], 1)} z {fmt(head['dz'], 1)} cm, yaw {fmt(head['yaw'], 1)}° pitch {fmt(head['pitch'], 1)}°" if head else " · no head measurement") + (f" · camera moved ×{per_block[key]['camera_moved']}" if per_block[key]['camera_moved'] else ""))
        L("")
        L("| estimator | median px (cm) | median \\|dx\\| px | median \\|dy\\| px | bias dx px | bias dy px | p90 px | p90 \\|dx\\| | p90 \\|dy\\| | frames |")
        L("|---|---|---|---|---|---|---|---|---|---|")
        for name, st in est.items():
            if st is None:
                if name in ("candidate",):
                    continue
                L(f"| {name} | — | — | — | — | — | — | — | — | 0 |")
                continue
            cm = f" ({st['median_cm']:.1f})" if "median_cm" in st else ""
            L(f"| {name} | {st['median_px']:.0f}{cm} | {st['abs_dx_px']:.0f} | {st['abs_dy_px']:.0f} | {st['bias_dx_px']:+.0f} | {st['bias_dy_px']:+.0f} | {st['p90_px']:.0f} | {st['p90_dx_px']:.0f} | {st['p90_dy_px']:.0f} | {st['frames']} |")
        L("")

    keys = [k for k, v in per_block.items() if v["rows"]]
    # 2. Scatter plots per axis.
    for axis, name in ((0, "x"), (1, "y")):
        n = max(1, len(keys))
        fig, axes = plt.subplots(1, n, figsize=(4 * n, 4), squeeze=False)
        for ax, key in zip(axes[0], keys):
            for est, color in (("network", "tab:blue"), ("geometric", "tab:green"), ("blend", "tab:red")):
                pts = [(s.target_px(r)[axis], s.estimate_px(r, est)[axis]) for r in per_block[key]["rows"] if s.estimate_px(r, est) is not None]
                if pts:
                    ax.scatter(*zip(*pts), s=6, alpha=.4, color=color, label=est)
            lim = s.w if axis == 0 else s.h
            ax.plot([0, lim], [0, lim], "k--", lw=.8)
            ax.set_xlim(0, lim); ax.set_ylim(-lim * .25, lim * 1.25)
            ax.set_title(f"{per_block[key]['block']['id']} {per_block[key]['block']['title']}")
            ax.set_xlabel(f"true {name} (px)"); ax.set_ylabel(f"predicted {name} (px)")
        axes[0][0].legend(fontsize=8)
        fig.suptitle(f"Predicted vs true {name}, usable record frames, by block")
        fig.tight_layout(); fig.savefig(folder / f"scatter_{name}.png", dpi=110); plt.close(fig)

    # 3. Quiver: target → median blend estimate per dot.
    n = max(1, len(keys))
    cols = min(4, n); rws = math.ceil(n / cols)
    fig, axes = plt.subplots(rws, cols, figsize=(4.2 * cols, 3 * rws), squeeze=False)
    for i, key in enumerate(keys):
        ax = axes[i // cols][i % cols]
        for t in s.targets:
            ps = [s.estimate_px(r, "blend") for r in per_block[key]["rows"] if r["point"] == t["index"]]
            ps = [p for p in ps if p is not None]
            ax.plot(t["x"], t["y"], "o", color="k", ms=3)
            if ps:
                m = np.median(np.array(ps), axis=0)
                ax.annotate("", xy=(m[0], m[1]), xytext=(t["x"], t["y"]), arrowprops=dict(arrowstyle="->", color="tab:red", lw=1))
        ax.set_xlim(0, s.w); ax.set_ylim(s.h, 0); ax.set_aspect("equal")
        ax.set_title(f"{per_block[key]['block']['id']} {per_block[key]['block']['title']}", fontsize=9)
    for j in range(len(keys), rws * cols):
        axes[j // cols][j % cols].axis("off")
    fig.suptitle("Offset map: dot → median shipped blend estimate (px)")
    fig.tight_layout(); fig.savefig(folder / "quiver.png", dpi=110); plt.close(fig)

    # 4. Error vs measured head shift.
    fig, axes = plt.subplots(1, 5, figsize=(18, 3.6))
    for ax, (field, unit) in zip(axes, (("dx", "cm"), ("dy", "cm"), ("dz", "cm"), ("yaw", "deg"), ("pitch", "deg"))):
        for key in keys:
            v = per_block[key]
            st = v["estimators"]["blend"]
            if not v["head"] or not st:
                continue
            ax.plot(v["head"][field], st["abs_dx_px"], "s", color="tab:blue")
            ax.plot(v["head"][field], st["abs_dy_px"], "^", color="tab:orange")
            ax.annotate(v["block"]["id"], (v["head"][field], st["abs_dy_px"]), fontsize=7)
        ax.set_xlabel(f"measured head shift {field} ({unit})"); ax.set_ylabel("median |error| px (blend)")
    axes[0].plot([], [], "s", color="tab:blue", label="|dx|"); axes[0].plot([], [], "^", color="tab:orange", label="|dy|"); axes[0].legend(fontsize=8)
    fig.suptitle("Per-axis blend error vs measured head shift, one point per block")
    fig.tight_layout(); fig.savefig(folder / "error_vs_shift.png", dpi=110); plt.close(fig)

    # 5. Offline refits.
    L("## 2. Offline refits")
    L("")
    cal = s.calibration_labels()
    L(f"Calibration label frames available for refits: {len(cal)} (the worker accepted {s.session.get('calibration', {}).get('labels')} labels).")
    L(f"Label annotation check: {s.label_fix.get('corrected', 0)} of these rows had their logged target rewritten to the label the worker received (source: {s.label_fix.get('source')}).")
    L("")
    refits = {}
    variants = {
        "shipped12 (ridge as shipped)": (SHIPPED12, dict()),
        "shipped12 + perspective (origin x/z, y/z)": (SHIPPED12 + ["origin_x_over_z", "origin_y_over_z"], dict()),
        "shipped12 + openness": (SHIPPED12 + ["openness"], dict()),
        "shipped12 + perspective + openness + head angles": (SHIPPED12 + ["origin_x_over_z", "origin_y_over_z", "openness", "head_yaw", "head_pitch"], dict()),
        "no lids (iris only + z, rotation, one)": ([n for n in SHIPPED12 if "upper" not in n and "lower" not in n], dict()),
    }
    for lam in (1e-4, 1e-2, 1e-1):
        variants[f"shipped12, eye ridge {lam:g} on x and y"] = (SHIPPED12, dict(eye=lam))
    variants["shipped12, eye ridge 1e-3 on x / 1e-1 on y"] = (SHIPPED12, dict(eye_y=1e-1))

    def evaluate(W, names, blocks):
        out = {}
        for key in blocks:
            rows = per_block[key]["rows"]
            X, Y, kept = design(rows, names)
            if not len(X):
                out[key] = None; continue
            P = X @ W.T
            pairs = [(s.to_px(p), s.to_px(y)) for p, y in zip(P, Y)]
            out[key] = stats(pairs, s.cm_per_px)
        return out

    Xc, Yc, _ = design(cal, SHIPPED12)
    if len(Xc) >= 12 and keys:
        L("### 2a. Geometric ridge variants, fitted on the calibration labels only, evaluated per block")
        L("")
        L("Median px per block (|dx| / |dy| in brackets). The `recorded geometric` row is the worker's own estimate on the same frames; `shipped12` refit should match it closely (the difference is reported) — it is the sanity check that the offline fit reproduces the shipped math.")
        L("")
        header = "| variant | " + " | ".join(per_block[k]["block"]["id"] for k in keys) + " | mean |"
        L(header); L("|---|" + "---|" * (len(keys) + 1))
        rec = {k: per_block[k]["estimators"]["geometric"] for k in keys}
        L("| recorded geometric | " + " | ".join(f"{st['median_px']:.0f} ({st['abs_dx_px']:.0f}/{st['abs_dy_px']:.0f})" if st else "—" for st in rec.values()) + f" | {fmt(np.nanmean([st['median_px'] if st else np.nan for st in rec.values()]))} |")
        for name, (names, opts) in variants.items():
            X, Y, _ = design(cal, names)
            if len(X) < 12:
                L(f"| {name} | too few calibration frames with these features |")
                continue
            px = penalty_for(names, **{k: v for k, v in opts.items() if k != "eye_y"})
            py = penalty_for(names, eye=opts.get("eye_y", opts.get("eye", SHIPPED_RIDGE["eye"])))
            W = fit_geometric(X, Y, px, py)
            ev = evaluate(W, names, keys)
            refits[name] = {"features": names, "weights": W.tolist(), "eval": ev, "trained_on": "C0 labels"}
            means = [v["median_px"] for v in ev.values() if v]
            L(f"| {name} | " + " | ".join(f"{v['median_px']:.0f} ({v['abs_dx_px']:.0f}/{v['abs_dy_px']:.0f})" if v else "—" for v in ev.values()) + f" | {fmt(np.mean(means)) if means else '—'} |")
        # Sanity: shipped12 refit vs recorded geometric per frame.
        W = np.array(refits["shipped12 (ridge as shipped)"]["weights"])
        diffs = []
        for key in keys:
            for r in per_block[key]["rows"]:
                f = feature_row(r, SHIPPED12)
                if f is None or not r.get("geometric"):
                    continue
                p = W @ np.array(f)
                diffs.append(float(np.hypot(*(s.to_px(p) - s.to_px(r["geometric"])))))
        L("")
        cond = float(np.linalg.cond(Xc.T @ Xc))
        L(f"Sanity: median |refit − recorded geometric| over usable block frames = {fmt(median(diffs), 1)} px over {len(diffs)} frames. Design-matrix condition number of the 42 calibration rows: {cond:.2e} (above ~1e12 the ridge solution is not unique and two numerically different weight vectors fit the labels equally well, as happens with a static synthetic face).")
        learned_file = folder / "calibration.json"
        if learned_file.exists():
            try:
                Wk = np.array(json.loads(learned_file.read_text())["learned"]["geometric"]["weights"])
                dk = []
                for key in keys:
                    for r in per_block[key]["rows"]:
                        if r.get("features12") and r.get("geometric"):
                            dk.append(float(np.hypot(*(s.to_px(Wk @ np.array(r["features12"])) - s.to_px(r["geometric"])))))
                L(f"Pipeline fidelity: the worker's exported geometric weights (calibration.json) applied to the logged `features12` reproduce the recorded geometric estimate with median |difference| = {median(dk):.2e} px over {len(dk)} frames; the logged inputs are the worker's inputs.")
            except (KeyError, TypeError, ValueError):
                pass
        L("")
    else:
        L("Not enough calibration label frames with geometric features to refit (need 12).")
        L("")

    # 2b. Per-axis blend weights and screen corrections, fitted on the neutral block and leave-one-block-out.
    def blend_frames(rows):
        out = []
        for r in rows:
            n, g, t = r.get("network"), r.get("geometric"), r.get("target")
            if n and g and t:
                out.append((np.array(n), np.array(g), np.array([t["nx"], t["ny"]])))
        return out

    def best_axis_weights(frames):
        if not frames:
            return None
        N = np.array([f[0] for f in frames]); G = np.array([f[1] for f in frames]); T = np.array([f[2] for f in frames])
        grid = np.linspace(0, 1, 21)
        best = {}
        for axis, scale in ((0, s.w), (1, s.h)):
            errs = [np.median(np.abs((N[:, axis] * (1 - w) + G[:, axis] * w - T[:, axis]) * scale)) for w in grid]
            best["xy"[axis]] = float(grid[int(np.argmin(errs))])
        return best

    def apply_blend(frames, w):
        return [(np.array([n[0] * (1 - w["x"]) + g[0] * w["x"], n[1] * (1 - w["y"]) + g[1] * w["y"]]), t) for n, g, t in frames]

    def fit_correction(pairs, kind):
        if len(pairs) < 6:
            return None
        P = np.array([p for p, _ in pairs]); T = np.array([t for _, t in pairs])
        basis = (lambda p: np.column_stack([p[:, 0], p[:, 1], np.ones(len(p))])) if kind == "affine" else (lambda p: np.column_stack([p[:, 0], p[:, 1], np.ones(len(p)), p[:, 0] ** 2, p[:, 0] * p[:, 1], p[:, 1] ** 2]))
        B = basis(P)
        ridge = np.diag([0, 0, 0] + ([0.002] * 3 if kind == "quadratic" else []))
        W = np.linalg.solve(B.T @ B + ridge, B.T @ T)
        return {"kind": kind, "x": W[:, 0].tolist(), "y": W[:, 1].tolist(), "apply": lambda p: basis(np.atleast_2d(p)) @ W}

    L("### 2b. Per-axis blend weights and screen corrections")
    L("")
    L("Fitted on the shipped network and geometric estimates of usable block frames. `fit on B1` uses only the neutral block (what a calibration at the neutral pose could learn), evaluated on every block including B1 itself (in-sample there). `leave-one-block-out` fits on all other kept blocks and scores the held-out one. Median px per block.")
    L("")
    b1 = next((k for k in keys if per_block[k]["block"]["id"] == "B1"), None)
    corrections = {}
    if keys:
        header = "| model | " + " | ".join(per_block[k]["block"]["id"] for k in keys) + " | mean |"
        L(header); L("|---|" + "---|" * (len(keys) + 1))
        shipped_w = (tr or {}).get("geometric", {}) or {}
        w0 = shipped_w.get("weight", 0) or 0
        def score_rows(fn):
            res = {}
            for k in keys:
                pairs = fn(k)
                res[k] = stats([(s.to_px(p), s.to_px(t)) for p, t in pairs], s.cm_per_px) if pairs else None
            return res
        row_out = lambda name, res: L(f"| {name} | " + " | ".join(f"{v['median_px']:.0f}" if v else "—" for v in res.values()) + f" | {fmt(np.mean([v['median_px'] for v in res.values() if v])) if any(res.values()) else '—'} |")
        res = score_rows(lambda k: apply_blend(blend_frames(per_block[k]["rows"]), {"x": w0, "y": w0}))
        row_out(f"shipped blend (w={w0:.2f} both axes)", res)
        if b1:
            wb = best_axis_weights(blend_frames(per_block[b1]["rows"]))
            if wb:
                res = score_rows(lambda k: apply_blend(blend_frames(per_block[k]["rows"]), wb))
                row_out(f"per-axis blend fit on B1 (wx={wb['x']:.2f}, wy={wb['y']:.2f})", res)
                corrections["blend_b1"] = wb
                for kind in ("affine", "quadratic"):
                    c = fit_correction(apply_blend(blend_frames(per_block[b1]["rows"]), wb), kind)
                    if c:
                        res = score_rows(lambda k, c=c: [(c["apply"](p)[0], t) for p, t in apply_blend(blend_frames(per_block[k]["rows"]), wb)])
                        row_out(f"per-axis blend + {kind} correction, both fit on B1", res)
                        corrections[f"{kind}_b1"] = {"kind": kind, "x": c["x"], "y": c["y"], "eval": {k: (v["median_px"] if v else None) for k, v in res.items()}}
        if len(keys) >= 3:
            lobo = {}
            for k in keys:
                others = [f for o in keys if o != k for f in blend_frames(per_block[o]["rows"])]
                wb = best_axis_weights(others)
                if not wb:
                    lobo[k] = None; continue
                c = fit_correction(apply_blend(others, wb), "affine")
                pairs = apply_blend(blend_frames(per_block[k]["rows"]), wb)
                if c:
                    pairs = [(c["apply"](p)[0], t) for p, t in pairs]
                lobo[k] = stats([(s.to_px(p), s.to_px(t)) for p, t in pairs], s.cm_per_px) if pairs else None
            row_out("per-axis blend + affine, leave-one-block-out", lobo)
        L("")

    # 2c. Pose-diverse calibration: geometric ridge trained on C0 labels plus other blocks' usable frames (leave-one-block-out).
    if len(Xc) >= 12 and len(keys) >= 2:
        L("### 2c. Simulated pose-diverse calibration (geometric ridge)")
        L("")
        L("The shipped 12-feature ridge and the perspective variant, trained on the calibration labels plus the usable frames of every other kept block (their dot positions as labels), scored on the held-out block. This simulates calibrating at several poses. Median px (|dx| / |dy|).")
        L("")
        header = "| variant | " + " | ".join(per_block[k]["block"]["id"] for k in keys) + " | mean |"
        L(header); L("|---|" + "---|" * (len(keys) + 1))
        for name in ("shipped12 (ridge as shipped)", "shipped12 + perspective (origin x/z, y/z)", "shipped12 + perspective + openness + head angles"):
            names = variants[name][0]
            res = {}
            for k in keys:
                train_rows = cal + [r for o in keys if o != k for r in per_block[o]["rows"]]
                X, Y, _ = design(train_rows, names)
                if len(X) < 12:
                    res[k] = None; continue
                W = fit_geometric(X, Y, penalty_for(names), penalty_for(names), outlier_pass=False)
                res[k] = evaluate(W, names, [k])[k]
            refits[f"LOBO: {name}"] = {"features": names, "eval": res, "trained_on": "C0 labels + other blocks"}
            means = [v["median_px"] for v in res.values() if v]
            L(f"| {name} | " + " | ".join(f"{v['median_px']:.0f} ({v['abs_dx_px']:.0f}/{v['abs_dy_px']:.0f})" if v else "—" for v in res.values()) + f" | {fmt(np.mean(means)) if means else '—'} |")
        L("")

    # 6. candidate.json: best calibration-only geometric variant (by mean median px over blocks other than B1 when possible) + B1 blend/affine.
    candidate = None
    scored = [(name, np.mean([v["median_px"] for k, v in r["eval"].items() if v and (k != b1 or len(keys) == 1)])) for name, r in refits.items() if not name.startswith("LOBO") and any(r["eval"].values())]
    if scored:
        best_name, best_score = min(scored, key=lambda x: x[1])
        r = refits[best_name]
        candidate = {"format": "GAZE-LAB-CANDIDATE-1", "name": f"{best_name}" + (" + per-axis blend/affine from B1" if "affine_b1" in corrections else ""),
                     "createdFrom": s.session.get("id"), "geometric": {"features": r["features"], "weights": r["weights"]},
                     "blend": corrections.get("blend_b1"), "correction": ({"kind": "affine", "x": corrections["affine_b1"]["x"], "y": corrections["affine_b1"]["y"]} if "affine_b1" in corrections else None), "head": None,
                     "evaluation": {"geometric_mean_median_px_excluding_B1": best_score, "note": "Prospective re-test: load this file in Setup → Candidate and run the blocks again; the candidate stream is recorded next to the shipped one."}}
        (folder / "candidate.json").write_text(json.dumps(candidate, indent=1) + "\n")
        L("## 3. candidate.json")
        L("")
        L(f"Written: `{best_name}` geometric weights (fit on calibration labels; chosen by mean median px over blocks other than B1), per-axis blend {corrections.get('blend_b1')} and the affine correction fitted on B1. Load it in Setup → Candidate to re-test prospectively.")
        L("")
    L("## 4. Not done here")
    L("")
    L("Retraining the network head offline from the exported eye strips (dev/team-training.ts path) is not part of this script; eyestrips/replay.json plus calibration.json (the learned head and affine) hold everything needed. Numbers from a synthetic camera fixture say nothing about gaze accuracy.")
    (folder / "report.md").write_text("\n".join(lines) + "\n")
    (folder / "analysis.json").write_text(json.dumps({"per_block": {k: {"estimators": v["estimators"], "cells": v["cells"], "head": v["head"], "camera_moved": v["camera_moved"], "frames": len(v["rows"])} for k, v in per_block.items()}, "refits": {k: {kk: vv for kk, vv in v.items() if kk != "weights"} for k, v in refits.items()}, "corrections": {k: (v if k == "blend_b1" else {kk: vv for kk, vv in v.items()}) for k, v in corrections.items()}, "candidate": candidate is not None}, indent=1, default=lambda o: None) + "\n")
    print(f"wrote {folder / 'report.md'}, scatter_x.png, scatter_y.png, quiver.png, error_vs_shift.png" + (", candidate.json" if candidate else ""))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
