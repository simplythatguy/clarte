#!/usr/bin/env python3
"""Two-row decision metrics for a gaze-lab session.

Usage:
  .venv/bin/python -I analysis/rows.py <session_dir> [--calibration-predictions FILE]
  .venv/bin/python -I analysis/rows.py score-fixed <session_dir> <predictions.json>

Product decision under test: the user only looks along the two row-centre lines (rows at 25 % and 75 % of the
viewport height; the 10 % / 90 % dots count as top / bottom as well). For every block and every estimator stream
(network, geometric, blend = rawNormPog, pointer) this reports the row decision accuracy with a fixed boundary at the
screen midline, with a personal boundary learned from the calibration labels, and with an online two-component
boundary tracker applied causally over the whole recording; the margin (d') between the rows; and the 4-column
decision accuracy within the correctly decided row.

Frames: record-phase frames with a face present and eyes open ("usable"), final attempt per block, exactly as
analyze.py. Units: px = CSS pixels of the recorded viewport, seconds from the frame clock (`t`, performance.now).
Calibration labels: frames.jsonl logs the dot *after* the calibration state machine advanced on the third accepted
label of each dot, so 12 of 42 label rows carry the next dot's target. The labels the worker was given are in
eyestrips/replay.json (joined by `at`); without that file the rows are corrected by the three-labels-per-dot rule.

`score-fixed` reads {"h": px, "streams": {name: [[at, y_px, true_ny], ...]}} and prints per-stream fixed-boundary
row accuracy as JSON; analysis/rerun_head.mjs uses it so the boundary definition lives in one place.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory from sys.path
from analyze import Session, fmt, median  # noqa: E402

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

STREAMS = ("network", "geometric", "blend", "pointer")
COLUMN_BOUNDARIES_FRAC = (0.25, 0.5, 0.75)
TRACKER = {"window_s": 20.0, "dead_zone_frac": 0.10, "integrate_ms": 400.0, "min_cluster_share": 0.15, "min_window_s": 2.0}
RECOVERY = {"horizon_s": 2.0, "threshold": 0.9, "min_frames": 5}
NEAR_BOUNDARY_PX = 100.0


# ---------------- pure decision helpers ----------------
def row_of_ny(ny):
    """'top' for dots above the centre line, 'bottom' below, None on the centre line (normalized y, +down)."""
    if ny is None or not np.isfinite(ny) or abs(ny) < 1e-9:
        return None
    return "top" if ny < 0 else "bottom"


def column_of_x(x_px, boundaries):
    """0..3 from three increasing boundaries (px)."""
    return int(sum(1 for b in boundaries if x_px >= b))


def midpoint_boundary(y_top, y_bottom):
    y_top, y_bottom = np.asarray(y_top, float), np.asarray(y_bottom, float)
    if not y_top.size or not y_bottom.size:
        return float("nan")
    return float((y_top.mean() + y_bottom.mean()) / 2)


def lda_boundary(y_top, y_bottom):
    """1-D LDA with a pooled variance and priors from the class counts: the y where the two posteriors are equal."""
    a, b = np.asarray(y_top, float), np.asarray(y_bottom, float)
    if a.size < 2 or b.size < 2:
        return float("nan")
    mu_a, mu_b = a.mean(), b.mean()
    var = ((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (a.size + b.size - 2)
    if not var > 0 or abs(mu_b - mu_a) < 1e-12:
        return float((mu_a + mu_b) / 2)
    return float((mu_a + mu_b) / 2 + var / (mu_b - mu_a) * math.log(a.size / b.size))


def logistic_boundary(y, is_bottom, iterations=50, ridge=1e-6):
    """1-D logistic regression P(bottom | y) by Newton's method; returns the y where P = 0.5."""
    y = np.asarray(y, float); z = np.asarray(is_bottom, float)
    if y.size < 4 or z.min() == z.max():
        return float("nan")
    scale = y.std() or 1.0
    x = (y - y.mean()) / scale
    w = np.zeros(2)
    X = np.column_stack([np.ones_like(x), x])
    for _ in range(iterations):
        p = 1 / (1 + np.exp(-(X @ w)))
        g = X.T @ (p - z) + ridge * w
        H = X.T @ (X * (p * (1 - p))[:, None]) + ridge * np.eye(2)
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-10:
            break
    if abs(w[1]) < 1e-12:
        return float("nan")
    return float(-w[0] / w[1] * scale + y.mean())


def dprime(y_top, y_bottom):
    """(mean bottom − mean top) / pooled SD; a per-block separation margin."""
    a, b = np.asarray(y_top, float), np.asarray(y_bottom, float)
    if a.size < 2 or b.size < 2:
        return float("nan")
    sd = math.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (a.size + b.size - 2))
    return float((b.mean() - a.mean()) / sd) if sd > 0 else float("inf")


def two_means(values, m_top, m_bottom, iterations=20):
    """1-D Lloyd k-means with two centres seeded at (m_top, m_bottom); returns (means, shares)."""
    v = np.asarray(values, float)
    for _ in range(iterations):
        assign = v > (m_top + m_bottom) / 2
        n_bottom = int(assign.sum()); n_top = v.size - n_bottom
        if n_top == 0 or n_bottom == 0:
            break
        nt, nb = v[~assign].mean(), v[assign].mean()
        if abs(nt - m_top) < 1e-9 and abs(nb - m_bottom) < 1e-9:
            m_top, m_bottom = nt, nb
            break
        m_top, m_bottom = nt, nb
    assign = v > (m_top + m_bottom) / 2
    return (float(m_top), float(m_bottom)), (float(1 - assign.mean()), float(assign.mean()))


class BoundaryTracker:
    """Causal two-row boundary: 2-means over the last `window_s` seconds of the vertical stream (seeded from the
    calibration rows), a dead zone of ±`dead_zone_frac` of the estimated row separation and a median over the last
    `integrate_ms` of the stream. `update` returns (decision, boundary, integrated_y); decision is 'top', 'bottom' or
    the previous decision while inside the dead zone (None before the first decision)."""

    def __init__(self, seed_top, seed_bottom, window_s=TRACKER["window_s"], dead_zone_frac=TRACKER["dead_zone_frac"], integrate_ms=TRACKER["integrate_ms"],
                 min_cluster_share=TRACKER["min_cluster_share"], min_window_s=TRACKER["min_window_s"]):
        self.means = (float(seed_top), float(seed_bottom))
        self.window_s, self.dead_zone_frac, self.integrate_ms = window_s, dead_zone_frac, integrate_ms
        self.min_cluster_share, self.min_window_s = min_cluster_share, min_window_s
        self.times, self.values = [], []
        self.decision = None

    @property
    def boundary(self):
        return (self.means[0] + self.means[1]) / 2

    @property
    def dead_zone(self):
        return self.dead_zone_frac * abs(self.means[1] - self.means[0])

    def update(self, t_s, y):
        self.times.append(t_s); self.values.append(float(y))
        while self.times and t_s - self.times[0] > self.window_s:
            self.times.pop(0); self.values.pop(0)
        if self.times[-1] - self.times[0] >= self.min_window_s:
            means, shares = two_means(self.values, *self.means)
            if min(shares) >= self.min_cluster_share and means[1] > means[0]:
                self.means = means
        recent = [v for tt, v in zip(self.times, self.values) if t_s - tt <= self.integrate_ms / 1000]
        y_int = float(np.median(recent)) if recent else float(y)
        b, dz = self.boundary, self.dead_zone
        if y_int < b - dz:
            self.decision = "top"
        elif y_int > b + dz:
            self.decision = "bottom"
        return self.decision, b, y_int


def recovery_time(times_s, correct, start_s, horizon_s=RECOVERY["horizon_s"], threshold=RECOVERY["threshold"], min_frames=RECOVERY["min_frames"]):
    """Seconds after `start_s` until the accuracy over the trailing `horizon_s` window (≥ min_frames decided frames)
    exceeds `threshold`; None when it never does. `correct` holds True/False per decided frame, None for undecided."""
    times_s = list(times_s); correct = list(correct)
    for i, t in enumerate(times_s):
        if t - start_s < horizon_s:
            continue  # the trailing window must span the whole horizon before it can count
        window = [c for tt, c in zip(times_s[: i + 1], correct[: i + 1]) if t - tt <= horizon_s and c is not None]
        if len(window) >= min_frames and sum(window) / len(window) > threshold:
            return float(t - start_s)
    return None


def row_accuracy(y_px, true_rows, boundary):
    pairs = [(y, r) for y, r in zip(y_px, true_rows) if r is not None and np.isfinite(y)]
    if not pairs:
        return float("nan"), 0
    hits = sum(1 for y, r in pairs if ("top" if y < boundary else "bottom") == r)
    return hits / len(pairs), len(pairs)


# ---------------- session helpers shared with measurements.py / headvector.py ----------------
def calibration_label_rows(s: Session):
    """C0 label frames (face present, eyes open) with the label the worker received as `label_nx`/`label_ny`.
    Prefers eyestrips/replay.json (joined by `at`); otherwise corrects the logged target by the three-labels-per-dot
    rule. Returns (rows, corrected_count, source)."""
    rows = s.calibration_labels()
    replay = s.folder / "eyestrips" / "replay.json"
    labels = {}
    if replay.exists():
        try:
            for e in json.loads(replay.read_text()).get("entries", []):
                if e.get("kind") == "calibration" and e.get("label"):
                    labels[e["at"]] = (e["label"][0], e["label"][1])
        except (ValueError, KeyError, TypeError):
            labels = {}
    corrected = 0
    out = []
    if labels:
        for r in rows:
            lab = labels.get(r["t"])
            if lab is None:
                continue
            if abs(lab[0] - r["target"]["nx"]) > 1e-9 or abs(lab[1] - r["target"]["ny"]) > 1e-9:
                corrected += 1
            out.append({**r, "label_nx": lab[0], "label_ny": lab[1]})
        return out, corrected, "eyestrips/replay.json"
    # Three labels per dot: when a label frame's point differs from the previous one and that point has only two
    # labels so far, the frame belongs to the previous dot.
    counts = {}
    prev = None
    for r in sorted(rows, key=lambda r: r["t"]):
        nx, ny = r["target"]["nx"], r["target"]["ny"]
        if prev is not None and r["point"] != prev["point"] and counts.get(prev["point"], 0) == 2:
            nx, ny = prev["label_nx"], prev["label_ny"]
            counts[prev["point"]] = 3
            corrected += 1
            row = {**r, "label_nx": nx, "label_ny": ny}
        else:
            counts[r["point"]] = counts.get(r["point"], 0) + 1
            row = {**r, "label_nx": nx, "label_ny": ny}
            prev = row
        out.append(row)
    return out, corrected, "frames.jsonl (three-labels-per-dot rule)"


def geometric_weights(s: Session):
    f = s.folder / "calibration.json"
    if not f.exists():
        return None
    try:
        return np.array(json.loads(f.read_text())["learned"]["geometric"]["weights"], float)
    except (KeyError, TypeError, ValueError):
        return None


def stream_y_px(s: Session, row, name):
    p = s.estimate_px(row, name)
    return float(p[1]) if p is not None else float("nan")


def stream_xy_px(s: Session, row, name):
    p = s.estimate_px(row, name)
    return (float(p[0]), float(p[1])) if p is not None else (float("nan"), float("nan"))


def calibration_stream_estimates(s: Session, cal_rows, name, predictions):
    """Post-training estimates of a stream on the calibration label frames, in px: geometric from the exported weights
    on the logged features12 (exact), network / blend from a rerun_head_calibration.json (`--calibration-predictions`),
    pointer never (filter state). Returns list of (x_px, y_px, label_nx, label_ny) or None when unavailable."""
    W = geometric_weights(s)
    w_blend = (s.session.get("calibration") or {}).get("blendWeight")
    out = []
    for r in cal_rows:
        g = None
        if W is not None and r.get("features12"):
            g = W @ np.array(r["features12"], float)
        n = None
        if predictions and str(r["t"]) in predictions:
            n = np.array(predictions[str(r["t"])], float)
        if name == "geometric":
            est = g
        elif name == "network":
            est = n
        elif name == "blend":
            est = None if n is None or g is None or w_blend is None else n * (1 - w_blend) + g * w_blend
        else:
            est = None
        if est is None or not np.all(np.isfinite(est)):
            continue
        p = s.to_px(est)
        out.append((float(p[0]), float(p[1]), r["label_nx"], r["label_ny"]))
    return out if out else None


def personal_boundaries(samples):
    """Row boundaries (midpoint, LDA, logistic) in px and a linear map nx→x_px for column boundaries, from
    (x_px, y_px, label_nx, label_ny) samples."""
    top = [y for _, y, _, ny in samples if row_of_ny(ny) == "top"]
    bottom = [y for _, y, _, ny in samples if row_of_ny(ny) == "bottom"]
    ys = top + bottom; z = [0] * len(top) + [1] * len(bottom)
    xs = np.array([(nx, x) for x, _, nx, _ in samples if np.isfinite(x)], float)
    col_map = None
    if len(xs) >= 2 and xs[:, 0].std() > 1e-9:
        slope, intercept = np.polyfit(xs[:, 0], xs[:, 1], 1)
        if slope > 0:
            col_map = (float(slope), float(intercept))
    return {"midpoint": midpoint_boundary(top, bottom), "lda": lda_boundary(top, bottom), "logistic": logistic_boundary(ys, z),
            "n_top": len(top), "n_bottom": len(bottom), "column_map": col_map}


def column_boundaries(w, col_map=None):
    fixed = [f * w for f in COLUMN_BOUNDARIES_FRAC]
    if col_map is None:
        return fixed
    slope, intercept = col_map
    return [slope * (f - 0.5) + intercept for f in COLUMN_BOUNDARIES_FRAC]


# ---------------- score-fixed subcommand ----------------
def score_fixed(folder: Path, predictions: Path):
    s = Session(folder)
    data = json.loads(predictions.read_text())
    h = data.get("h", s.h)
    out = {}
    for name, triples in data["streams"].items():
        ys = [t[1] for t in triples]; rows = [row_of_ny(t[2]) for t in triples]
        acc, n = row_accuracy(ys, rows, h / 2)
        out[name] = {"row_accuracy_fixed": acc, "frames": n, "boundary_px": h / 2}
    print(json.dumps(out))


# ---------------- main analysis ----------------
def main(folder: Path, predictions_file: Path | None):
    s = Session(folder)
    predictions = None
    if predictions_file and predictions_file.exists():
        predictions = json.loads(predictions_file.read_text()).get("calibration")
    cal_rows, corrected, label_source = calibration_label_rows(s)
    synthetic = bool(s.session.get("demo")) or "e2e" in str(s.session.get("tester", "")).lower()
    keys = [b["key"] for b in s.blocks if s.usable(b["key"])]
    per_block = {k: s.usable(k) for k in keys}
    block_of = {b["key"]: b for b in s.blocks}
    h, w = s.h, s.w
    fixed_b = h / 2
    row_sep_px = 0.5 * h

    L = []
    L.append(f"# Two-row decision metrics · {s.session.get('id')}")
    L.append("")
    if synthetic:
        L.append("**Synthetic session** (demo stream or photo camera): the numbers only prove the code runs; they say nothing about gaze accuracy.")
        L.append("")
    L.append(f"Frames: record-phase frames with a face present and eyes open (usable), final attempt per block; viewport {w}×{h} CSS px. Rows: top = dots with normalized y < 0 (10 % and 25 % lines), bottom = y > 0 (75 % and 90 %). Fixed boundary = screen midline ({fixed_b:.0f} px). Personal boundaries from the {len(cal_rows)} calibration label frames (labels from {label_source}; {corrected} logged targets corrected): midpoint between the mean estimated y of top-row and bottom-row labels, 1-D LDA (pooled variance, count priors) and 1-D logistic regression. Calibration-frame estimates: geometric = exported weights × logged features12; network/blend only with `--calibration-predictions` (rerun_head.mjs); otherwise, and always for pointer, the personal boundary falls back to the B1 record frames (in-sample for B1, marked `B1`). Tracker: 2-means over the last {TRACKER['window_s']:.0f} s of usable frames seeded from the personal rows, dead zone ±{TRACKER['dead_zone_frac']*100:.0f} % of the estimated row separation, median over the last {TRACKER['integrate_ms']:.0f} ms, run causally over every block attempt in recording order; accuracy counts decided frames, `strict` counts undecided frames as wrong; recovery = seconds from the block's first usable frame until the trailing {RECOVERY['horizon_s']:.0f} s accuracy exceeds {RECOVERY['threshold']*100:.0f} %. d′ = (mean y bottom − mean y top) / pooled SD of the estimates. Near-boundary wrong-row rate: frames whose estimate lies within {NEAR_BOUNDARY_PX:.0f} px of the fixed boundary (no dot of this layout lies within {NEAR_BOUNDARY_PX:.0f} px of the midline). Columns at 12.5/37.5/62.5/87.5 %: fixed boundaries at 25/50/75 % of the width; personal boundaries map 25/50/75 % through a line fitted from label x to estimated x on the calibration frames; column accuracy is over frames whose row was decided correctly with the fixed boundary.")
    L.append("")

    results = {"session": s.session.get("id"), "synthetic": synthetic, "viewport": {"w": w, "h": h}, "fixed_boundary_px": fixed_b, "calibration_labels": {"frames": len(cal_rows), "corrected": corrected, "source": label_source}, "tracker": TRACKER, "recovery": RECOVERY, "streams": {}}
    b1_key = next((k for k in keys if block_of[k]["id"] == "B1"), None)
    plots = {}

    for name in STREAMS:
        res = {"personal": None, "personal_source": None, "blocks": {}}
        cal_est = calibration_stream_estimates(s, cal_rows, name, predictions)
        source = "calibration"
        if cal_est is None and b1_key:
            cal_est = [(x, y, r["target"]["nx"], r["target"]["ny"]) for r in per_block[b1_key] for (x, y) in [stream_xy_px(s, r, name)] if np.isfinite(y)]
            source = "B1"
        personal = personal_boundaries(cal_est) if cal_est else None
        res["personal"], res["personal_source"] = personal, source if personal else None
        # Online tracker over every attempt's usable frames, in time order (seed: personal rows, else layout rows).
        all_usable = sorted((r for b in s.session["blocks"] for r in s.usable(b["key"])), key=lambda r: r["t"])
        if personal and np.isfinite(personal["midpoint"]) and personal["n_top"] and personal["n_bottom"]:
            top_mean = np.mean([y for _, y, _, ny in cal_est if row_of_ny(ny) == "top"]); bottom_mean = np.mean([y for _, y, _, ny in cal_est if row_of_ny(ny) == "bottom"])
        else:
            top_mean, bottom_mean = 0.25 * h, 0.75 * h
        tracker = BoundaryTracker(top_mean, bottom_mean)
        tracked = {}
        for r in all_usable:
            y = stream_y_px(s, r, name)
            if not np.isfinite(y):
                continue
            decision, boundary, y_int = tracker.update(r["t"] / 1000, y)
            tracked[r["t"]] = (decision, boundary, y_int, y)
        plots[name] = tracked
        for k in keys:
            rows = per_block[k]
            ys = [stream_y_px(s, r, name) for r in rows]; xs = [stream_xy_px(s, r, name)[0] for r in rows]
            true_rows = [row_of_ny(r["target"]["ny"]) for r in rows]
            true_cols = [int(r["target"]["nx"] * 4 + 2) if r["target"] else None for r in rows]  # nx −.375 → 0 … .375 → 3
            acc_fixed, n = row_accuracy(ys, true_rows, fixed_b)
            out = {"frames": n, "fixed": acc_fixed}
            for kind in ("midpoint", "lda", "logistic"):
                b = personal[kind] if personal else float("nan")
                out[f"personal_{kind}"] = row_accuracy(ys, true_rows, b)[0] if np.isfinite(b) else float("nan")
                out[f"personal_{kind}_px"] = b if personal else float("nan")
            # Tracker metrics for this block.
            dec = [tracked.get(r["t"]) for r in rows]
            correct = [None if d is None or d[0] is None or tr is None else d[0] == tr for d, tr in zip(dec, true_rows)]
            decided = [c for c in correct if c is not None]
            out["tracker"] = sum(decided) / len(decided) if decided else float("nan")
            out["tracker_strict"] = sum(decided) / len([c for c, tr in zip(correct, true_rows) if tr is not None]) if any(tr is not None for tr in true_rows) else float("nan")
            out["tracker_undecided"] = 1 - len(decided) / max(1, len([tr for tr in true_rows if tr is not None]))
            times = [r["t"] / 1000 for r in rows]
            out["recovery_s"] = recovery_time(times, correct, times[0]) if times else None
            out["tracker_boundary_end_px"] = dec[-1][1] if dec and dec[-1] else float("nan")
            # Margin and near-boundary errors.
            yt = [y for y, tr in zip(ys, true_rows) if tr == "top" and np.isfinite(y)]; yb = [y for y, tr in zip(ys, true_rows) if tr == "bottom" and np.isfinite(y)]
            out["dprime"] = dprime(yt, yb)
            out["mean_y_top_px"], out["mean_y_bottom_px"] = (float(np.mean(yt)) if yt else float("nan")), (float(np.mean(yb)) if yb else float("nan"))
            near = [(y, tr) for y, tr in zip(ys, true_rows) if tr is not None and np.isfinite(y) and abs(y - fixed_b) <= NEAR_BOUNDARY_PX]
            out["near_boundary_frames"] = len(near)
            out["near_boundary_wrong_rate"] = (sum(1 for y, tr in near if ("top" if y < fixed_b else "bottom") != tr) / len(near)) if near else float("nan")
            out["dots_within_100px_of_boundary"] = sum(1 for t in s.targets if abs(t["y"] - fixed_b) <= NEAR_BOUNDARY_PX)
            # Columns within the correctly decided row.
            fixed_cols = column_boundaries(w)
            pers_cols = column_boundaries(w, personal["column_map"]) if personal and personal.get("column_map") else None
            ok = [(x, tc) for x, y, tr, tc in zip(xs, ys, true_rows, true_cols) if tr is not None and np.isfinite(x) and np.isfinite(y) and ("top" if y < fixed_b else "bottom") == tr]
            out["column_fixed"] = (sum(1 for x, tc in ok if column_of_x(x, fixed_cols) == tc) / len(ok)) if ok else float("nan")
            out["column_personal"] = (sum(1 for x, tc in ok if column_of_x(x, pers_cols) == tc) / len(ok)) if ok and pers_cols else float("nan")
            out["column_frames"] = len(ok)
            cell = [(x, y, tr, tc) for x, y, tr, tc in zip(xs, ys, true_rows, true_cols) if tr is not None and np.isfinite(x) and np.isfinite(y)]
            out["cell_fixed"] = (sum(1 for x, y, tr, tc in cell if ("top" if y < fixed_b else "bottom") == tr and column_of_x(x, fixed_cols) == tc) / len(cell)) if cell else float("nan")
            res["blocks"][k] = out
        results["streams"][name] = res

    # Markdown: one table per block.
    pct = lambda v: "—" if v is None or not np.isfinite(v) else f"{100*v:.0f} %"
    for k in keys:
        b = block_of[k]
        L.append(f"## {b['id']} {b['title']} · {len(per_block[k])} usable frames")
        L.append("")
        L.append("| stream | fixed | personal midpoint | personal LDA | personal logistic | tracker (strict) | undecided | recovery s | d′ | near-boundary wrong (frames) | column fixed | column personal | cell fixed |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for name in STREAMS:
            o = results["streams"][name]["blocks"].get(k)
            src = results["streams"][name]["personal_source"]
            if not o or not o["frames"]:
                L.append(f"| {name} | — | — | — | — | — | — | — | — | — | — | — | — |")
                continue
            tag = f" ({src})" if src and src != "calibration" else ""
            L.append(f"| {name} | {pct(o['fixed'])} | {pct(o['personal_midpoint'])}{tag} | {pct(o['personal_lda'])} | {pct(o['personal_logistic'])} | {pct(o['tracker'])} ({pct(o['tracker_strict'])}) | {pct(o['tracker_undecided'])} | {fmt(o['recovery_s'], 1) if o['recovery_s'] is not None else 'never'} | {fmt(o['dprime'], 2)} | {pct(o['near_boundary_wrong_rate'])} ({o['near_boundary_frames']}) | {pct(o['column_fixed'])} | {pct(o['column_personal'])} | {pct(o['cell_fixed'])} |")
        L.append("")
    L.append("## Personal boundaries (px from the top of the viewport)")
    L.append("")
    L.append("| stream | source | midpoint | LDA | logistic | labels top/bottom | column map (px per normalized x, offset) |")
    L.append("|---|---|---|---|---|---|---|")
    for name in STREAMS:
        p = results["streams"][name]["personal"]
        if not p:
            L.append(f"| {name} | — | — | — | — | — | — |"); continue
        cm = p["column_map"]
        L.append(f"| {name} | {results['streams'][name]['personal_source']} | {fmt(p['midpoint'])} | {fmt(p['lda'])} | {fmt(p['logistic'])} | {p['n_top']}/{p['n_bottom']} | {('%.0f, %.0f' % cm) if cm else '—'} |")
    L.append("")
    (folder / "rows.md").write_text("\n".join(L) + "\n")
    (folder / "rows.json").write_text(json.dumps(results, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else str(o)) + "\n")

    # Plot: vertical estimate vs time, true row and tracked boundary, one panel per stream.
    fig, axes = plt.subplots(len(STREAMS), 1, figsize=(14, 2.6 * len(STREAMS)), sharex=True, squeeze=False)
    t0 = min((r["t"] for k in keys for r in per_block[k]), default=0) / 1000
    for ax, name in zip(axes[:, 0], STREAMS):
        tr = plots[name]
        for k in keys:
            rows = per_block[k]
            tt = [r["t"] / 1000 - t0 for r in rows]
            ys = [stream_y_px(s, r, name) for r in rows]
            ax.scatter(tt, ys, s=3, alpha=.35, color="tab:blue")
            ax.plot(tt, [0.25 * h if row_of_ny(r["target"]["ny"]) == "top" else 0.75 * h if row_of_ny(r["target"]["ny"]) == "bottom" else np.nan for r in rows], color="k", lw=1, label="true row centre" if k == keys[0] else None)
            bt = [(r["t"] / 1000 - t0, tr[r["t"]][1]) for r in rows if r["t"] in tr]
            if bt:
                ax.plot(*zip(*bt), color="tab:red", lw=1.2, label="tracked boundary" if k == keys[0] else None)
            ax.axvspan(tt[0], tt[-1], color="grey", alpha=.06)
            ax.text(tt[0], 0.02 * h, block_of[k]["id"], fontsize=8, va="top")
        ax.axhline(fixed_b, color="tab:green", lw=.8, ls="--", label="fixed boundary")
        ax.set_ylim(h * 1.15, -h * .15); ax.set_ylabel(f"{name}\ny (px)")
    axes[0, 0].legend(fontsize=7, loc="upper right")
    axes[-1, 0].set_xlabel("time since first usable frame (s)")
    fig.suptitle(f"Vertical estimate per stream vs time, true row centre (black), fixed boundary (green) and tracked boundary (red) · {s.session.get('id')}" + (" · SYNTHETIC" if synthetic else ""))
    fig.tight_layout(); fig.savefig(folder / "rows.png", dpi=110); plt.close(fig)
    print(f"wrote {folder / 'rows.md'}, rows.json, rows.png" + (f" · {corrected} calibration label rows corrected ({label_source})" if corrected else ""))


if __name__ == "__main__":
    argv = sys.argv[1:]
    if len(argv) == 3 and argv[0] == "score-fixed":
        score_fixed(Path(argv[1]).resolve(), Path(argv[2]).resolve())
    elif argv and argv[0] != "score-fixed":
        folder = Path(argv[0]).resolve()
        pred = None
        if "--calibration-predictions" in argv:
            pred = Path(argv[argv.index("--calibration-predictions") + 1]).resolve()
        elif (folder / "rerun_head_calibration.json").exists():
            pred = folder / "rerun_head_calibration.json"
        main(folder, pred)
    else:
        sys.exit(__doc__)
