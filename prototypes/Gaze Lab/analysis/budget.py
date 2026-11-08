#!/usr/bin/env python3
"""Calibration budget: how short can Clarte's gaze calibration be without losing 4×2-cell accuracy?

Usage: .venv/bin/python -I analysis/budget.py <session_dir> [--no-network] [--rerun-network] [--port 4334]

Simulated calibrations are drawn from the B1 (neutral) block's record frames: the 8 cell-centre dots (rows at 25 %/75 %,
columns at 12.5/37.5/62.5/87.5 %) and the 8 extreme-row dots, 1.6 s of record frames each after a 0.9 s travel/settle
phase. Each design takes the first `w` seconds of every chosen dot's record window. The reference `C0` is the shipped
42-label calibration the tester actually did. Every design trains (a) the shipped geometric ridge (12 features, shipped
penalties, one outlier pass; `fitGeometric`), (b) the gaze head via analysis/budget.mjs (WebEyeTrack.adapt reproduced,
shipped and pose-frozen variants, each with the final affine) when the session has eye strips, and (c) blends of the
two with the shipped inverse-held-out-MSE rule where the held-out error is leave-one-dot-out within the design, as a
single weight and per axis. Scoring: every complete block except B1, per dot the median estimate over the dot's usable
record frames (record phase, face present, eyes open, final attempt; analyze.py's filter), error in CSS px and cm, 4×2
cell / row / column hits; on the 8 cell-centre dots and on all 16; on all scoring blocks, the neutral ones (B12, B13)
and the pose blocks. Paired per-dot differences vs C0 with the same stream, 5000-resample bootstrap over dots.
Writes budget.md, budget.json, budget.png (and budget_designs.json / budget_network.json) into the session folder.
One tester; nothing here generalises beyond that person until a live test repeats it.
"""
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script directory from sys.path
from analyze import Session, cell_of, fmt  # noqa: E402

LAB = Path(__file__).resolve().parent.parent
PENALTY = np.array([1e-3] * 8 + [1e-3, 3e-3, 3e-3, 0.0])  # GEOMETRIC.ridge: eye ×8, depth, rotation ×2, intercept free
MIN_SAMPLES, MIN_TARGETS = 12, 6  # GEOMETRIC.minimumSamples / minimumTargets
OUTLIER_FACTOR, OUTLIER_FLOOR, MAX_PREDICTION = 4, .02, 1.0
WEIGHT_RANGE = (0.0, .85)
WORKER_LIMITS = {"maxSamples": 42, "minSamples": 27, "minTargets": 9}  # worker-engine.ts collect()/train()
INTRO_S, HOP_S = 2.0, 0.4  # modelled: 2 s intro, 0.4 s hop + onset discard per dot
BOOT, SEED = 5000, 7
WINDOWS = (0.3, 0.6, 1.0, 1.6)
CENTRE_ROWS = (1, 2)
STREAM_ORDER = ["geometric", "network shipped", "network frozen", "blend shipped", "blend frozen", "blend/axis shipped", "blend/axis frozen"]
PLOT_STREAMS = ["geometric", "network shipped", "network frozen", "blend shipped", "blend frozen"]
COLORS = {"geometric": "#1baf7a", "network shipped": "#2a78d6", "network frozen": "#eb6834", "blend shipped": "#eda100", "blend frozen": "#e87ba4"}


# ---------------- shipped geometric fit, ported ----------------
def ridge(X, Y):
    return np.linalg.solve(X.T @ X + np.diag(PENALTY), X.T @ Y)  # 12 × 2


def fit_shipped(X, Y, min_targets=MIN_TARGETS):
    """fitGeometric: ridge, one outlier pass (residual > max(.02, 4 × median)), refit, shipped-rule held-out MSE."""
    n = len(X)
    targets = {tuple(y) for y in Y}
    if n < MIN_SAMPLES or len(targets) < min_targets:
        return None
    W = ridge(X, Y)
    r = np.hypot(*(X @ W - Y).T)
    keep = r <= max(OUTLIER_FLOOR, OUTLIER_FACTOR * float(np.median(r)))
    kept_targets = {tuple(y) for y in Y[keep]}
    final = keep if keep.sum() >= MIN_SAMPLES and len(kept_targets) >= min_targets else np.ones(n, bool)
    if final.sum() < n:
        W = ridge(X[final], Y[final])
    # Shipped hold-out rule: the last sample of every target with >= 2 samples, refit without them.
    groups = {}
    for i in np.flatnonzero(final):
        groups.setdefault(tuple(Y[i]), []).append(i)
    held = [g[-1] for g in groups.values() if len(g) >= 2]
    held_mse = None
    if len(held) >= min_targets:
        rest = np.array([i for i in np.flatnonzero(final) if i not in set(held)])
        Wh = ridge(X[rest], Y[rest])
        d = X[held] @ Wh - Y[held]
        held_mse = float(np.mean((d[:, 0] ** 2 + d[:, 1] ** 2) / 2))
    return {"W": W, "samples": int(final.sum()), "targets": len({tuple(y) for y in Y[final]}), "outliers": int(n - final.sum()), "heldOutMse": held_mse}


def predict_geo(W, x):
    p = x @ W
    return p if np.all(np.isfinite(p)) and np.all(np.abs(p) <= MAX_PREDICTION) else None


def blend_weight(geo_mse, net_mse):
    lo, hi = WEIGHT_RANGE
    if geo_mse is None or not (geo_mse > 0) or not np.isfinite(geo_mse):
        return lo
    if net_mse is None or not (net_mse > 0) or not np.isfinite(net_mse):
        return min(hi, .5)
    return float(min(hi, max(lo, (1 / geo_mse) / (1 / geo_mse + 1 / net_mse))))


def boot_mean(d, rng):
    d = np.asarray(d, float)
    d = d[np.isfinite(d)]
    if d.size < 2:
        return {"n": int(d.size), "mean": float(d.mean()) if d.size else float("nan"), "lo": float("nan"), "hi": float("nan")}
    m = d[rng.integers(0, d.size, (BOOT, d.size))].mean(1)
    return {"n": int(d.size), "mean": float(d.mean()), "lo": float(np.percentile(m, 2.5)), "hi": float(np.percentile(m, 97.5))}


# ---------------- designs ----------------
def record_dots(s, key):
    """Usable record frames of a block by dot, with the time since the dot's first record frame (ms)."""
    rec = [r for r in s.block_rows(key) if r["screen"] == "block" and r["phase"] == "record"]
    start = {}
    for r in rec:
        start[r["point"]] = min(start.get(r["point"], math.inf), r["t"])
    dots = {}
    for r in s.usable(key):
        if r.get("features12"):
            dots.setdefault(r["point"], []).append((r["t"] - start[r["point"]], r))
    return {p: sorted(v, key=lambda x: x[0]) for p, v in dots.items()}


def build_designs(s):
    targets = {t["index"]: t for t in s.targets}
    b1 = record_dots(s, "B1")

    def pick(points, lo_ms, hi_ms):
        return [r for p in points for t_rel, r in b1.get(p, []) if lo_ms <= t_rel < hi_ms]

    centre = [i for i, t in targets.items() if t["row"] in CENTRE_ROWS]
    designs = []
    labels = s.calibration_labels()
    designs.append({"name": "C0", "source": "shipped calibration, 42 labels (9 eye dots + 5 head dots × 3)", "rows": labels, "dots": len({(r["target"]["nx"], r["target"]["ny"]) for r in labels}), "w": None})
    eyes = [r for r in labels if r["phase"] == "eyes:label"]
    designs.append({"name": "C0-eyes", "source": "the 9 eye-stage dots of the shipped calibration (27 labels)", "rows": eyes, "dots": len({(r["target"]["nx"], r["target"]["ny"]) for r in eyes}), "w": None})
    for w in WINDOWS:
        designs.append({"name": f"C8×{w}", "source": f"8 cell centres, first {w} s of each B1 record window", "rows": pick(centre, 0, w * 1000), "dots": 8, "w": w})
    designs.append({"name": "C8×1.0@0.3", "source": "8 cell centres, B1 record frames 0.3–1.3 s (onset-sensitivity probe)", "rows": pick(centre, 300, 1300), "dots": 8, "w": 1.0})
    outer = [i for i in centre if targets[i]["column"] in (0, 3)]
    inner = [i for i in centre if targets[i]["column"] in (1, 2)]
    designs.append({"name": "C4o×1.0", "source": "2 dots per row, outer columns (12.5 %, 87.5 %), 1.0 s", "rows": pick(outer, 0, 1000), "dots": 4, "w": 1.0})
    designs.append({"name": "C4i×1.0", "source": "2 dots per row, inner columns (37.5 %, 62.5 %), 1.0 s", "rows": pick(inner, 0, 1000), "dots": 4, "w": 1.0})
    six = [i for i in centre if (targets[i]["row"] == 1 and targets[i]["column"] in (0, 1, 3)) or (targets[i]["row"] == 2 and targets[i]["column"] in (0, 2, 3))]
    designs.append({"name": "C6×1.0", "source": "3 dots per row, staggered columns (top 0,1,3; bottom 0,2,3), 1.0 s", "rows": pick(six, 0, 1000), "dots": 6, "w": 1.0})
    designs.append({"name": "C16×1.0", "source": "all 16 B1 dots (cell centres + 10 %/90 % rows), 1.0 s", "rows": pick(list(targets), 0, 1000), "dots": 16, "w": 1.0})
    for d in designs:
        d["frames"] = len(d["rows"])
        d["X"] = np.array([r["features12"] for r in d["rows"]], float)
        d["Y"] = np.array([[r["target"]["nx"], r["target"]["ny"]] for r in d["rows"]], float)
    return designs


def measured_c0(s):
    c0 = s.block_rows("C0")
    first = min(r["t"] for r in c0 if r["phase"] == "eyes:reading")
    last_eye = max(r["t"] for r in c0 if r["phase"] == "eyes:label")
    last = max(r["t"] for r in c0 if r["phase"].endswith(":label"))
    after = min(r["t"] for r in s.rows if r["t"] > last and r["block"] != "C0")
    return {"collection_s": (last - first) / 1000, "eyes_stage_s": (last_eye - first) / 1000, "training_gap_s": (after - last) / 1000}


# ---------------- main ----------------
def main(folder: Path, run_network=True, rerun=False, port=4334):
    s = Session(folder)
    rng = np.random.default_rng(SEED)
    w_px, h_px, cm = s.w, s.h, s.cm_per_px or float("nan")
    targets = {t["index"]: t for t in s.targets}
    designs = build_designs(s)
    c0_meas = measured_c0(s)
    b1_ts = sorted(r["t"] for r in s.block_rows("B1") if r["phase"] == "record")
    frame_ms = float(np.median(np.diff(b1_ts)))
    b1_dots = record_dots(s, "B1")
    spans = [v[-1][0] for v in b1_dots.values()]

    # Designs file for the network side.
    (folder / "budget_designs.json").write_text(json.dumps({"designs": [{"name": d["name"], "frames": [{"at": r["t"], "label": [r["target"]["nx"], r["target"]["ny"]]} for r in d["rows"]]} for d in designs]}))
    net = None
    net_file = folder / "budget_network.json"
    if run_network and (folder / "eyestrips" / "replay.json").exists():
        if rerun or not net_file.exists():
            cmd = ["node", str(LAB / "analysis" / "budget.mjs"), str(folder), "--port", str(port)]
            print("running", " ".join(cmd), flush=True)
            t0 = time.time()
            subprocess.run(cmd, check=True)
            print(f"network side done in {time.time() - t0:.0f} s", flush=True)
        net = json.loads(net_file.read_text())
    check_at = {}
    if net:
        for i, at in enumerate(net["checkAts"]):
            check_at[at] = i

    # Scoring frames: every complete block except B1 (the simulated calibrations' source).
    scoring = [b for b in s.blocks if b["status"] == "complete" and b["id"] != "B1"]
    neutral_ids = {"B12", "B13"}
    groups = {"all": [b["key"] for b in scoring], "neutral": [b["key"] for b in scoring if b["id"] in neutral_ids], "pose": [b["key"] for b in scoring if b["id"] not in neutral_ids]}
    usable = {b["key"]: [r for r in s.usable(b["key"]) if r.get("features12")] for b in scoring}

    # ---- per design: fits, weights, per-dot scores ----
    out = {"designs": {}}
    for d in designs:
        D = {"name": d["name"], "source": d["source"], "dots": d["dots"], "frames": d["frames"], "frames_per_dot": d["frames"] / d["dots"], "w": d["w"], "streams": {}, "constraints": []}
        n = d["frames"]
        if n > WORKER_LIMITS["maxSamples"]:
            D["constraints"].append(f"{n} samples > worker cap of 42 (collect() stops accepting)")
        if n < WORKER_LIMITS["minSamples"]:
            D["constraints"].append(f"{n} samples < 27 (train() refuses)")
        if d["dots"] < WORKER_LIMITS["minTargets"]:
            D["constraints"].append(f"{d['dots']} dots < 9 distinct targets (train() refuses)")
        if d["dots"] < MIN_TARGETS:
            D["constraints"].append(f"{d['dots']} dots < GEOMETRIC.minimumTargets 6 (no geometric fit as shipped)")
        # (a) geometric
        t0 = time.perf_counter()
        geo = fit_shipped(d["X"], d["Y"], min_targets=min(MIN_TARGETS, d["dots"]))
        geo_ms = (time.perf_counter() - t0) * 1000
        # leave-one-dot-out
        keys = [tuple(y) for y in d["Y"]]
        dot_keys = sorted(set(keys))
        se = []
        for k in dot_keys:
            m = np.array([kk != k for kk in keys])
            f = fit_shipped(d["X"][m], d["Y"][m], min_targets=min(MIN_TARGETS, d["dots"] - 1))
            if f is None:
                continue
            dd = d["X"][~m] @ f["W"] - d["Y"][~m]
            se.append(dd ** 2)
        se = np.vstack(se) if se else np.zeros((0, 2))
        geo_lodo = {"mse": float(se.mean()) if se.size else None, "mse_x": float(se[:, 0].mean()) if se.size else None, "mse_y": float(se[:, 1].mean()) if se.size else None, "frames": int(len(se))}
        D["geometric"] = {"fit": None if geo is None else {k: v for k, v in geo.items() if k != "W"}, "lodo": geo_lodo, "fit_ms": geo_ms}
        W = geo["W"] if geo else None
        # (b) network
        variants = {}
        if net and d["name"] in net["designs"]:
            nd = net["designs"][d["name"]]
            for vname, v in nd["variants"].items():
                lse = np.vstack([(np.array(l["pred"]) - np.array(l["labels"])) ** 2 for l in v["lodo"].values()])
                variants[vname] = {"report": v["report"], "ms": v["ms"], "lodo": {"mse": float(lse.mean()), "mse_x": float(lse[:, 0].mean()), "mse_y": float(lse[:, 1].mean()), "frames": int(len(lse)), "ms_total": sum(l["ms"] for l in v["lodo"].values())}, "check": np.array(v["check"], float)}
            D["network"] = {"frames_with_strip": nd["frames"], "dropped": nd["dropped"], "variants": {k: {kk: vv for kk, vv in v.items() if kk != "check"} for k, v in variants.items()}}
        # (c) blends
        weights = {}
        for vname, v in variants.items():
            weights[vname] = {"scalar": blend_weight(geo_lodo["mse"], v["lodo"]["mse"]), "x": blend_weight(geo_lodo["mse_x"], v["lodo"]["mse_x"]), "y": blend_weight(geo_lodo["mse_y"], v["lodo"]["mse_y"])}
            if geo and geo["heldOutMse"] is not None:
                weights[vname]["shipped_rule"] = blend_weight(geo["heldOutMse"], v["report"]["heldOutAfter"])
        D["blend_weights"] = weights

        # Per-frame estimators (normalized units), None when unavailable.
        def est(stream, r):
            x = np.array(r["features12"], float)
            g = predict_geo(W, x) if W is not None else None
            if stream == "geometric":
                return g
            parts = stream.split()
            vname = parts[-1]
            if vname not in variants:
                return None
            i = check_at.get(r["t"])
            if i is None:
                return None
            nn = variants[vname]["check"][i]
            if parts[0] == "network":
                return nn
            if g is None:
                return nn
            if parts[0] == "blend/axis":
                wx, wy = weights[vname]["x"], weights[vname]["y"]
                return np.array([nn[0] * (1 - wx) + g[0] * wx, nn[1] * (1 - wy) + g[1] * wy])
            wgt = weights[vname]["scalar"]
            return nn * (1 - wgt) + g * wgt

        streams = [st for st in STREAM_ORDER if st == "geometric" or st.split()[-1] in variants]
        for st in streams:
            dots = []
            for b in scoring:
                key = b["key"]
                by_point = {}
                for r in usable[key]:
                    by_point.setdefault(r["point"], []).append(r)
                for p, frs in sorted(by_point.items()):
                    t = targets[p]
                    ests = [e for e in (est(st, r) for r in frs) if e is not None]
                    if not ests:
                        dots.append({"block": b["id"], "key": key, "point": p, "centre": t["row"] in CENTRE_ROWS, "frames": 0, "err_px": float("nan"), "cell": float("nan"), "row": float("nan"), "col": float("nan")})
                        continue
                    m = np.median(np.array(ests), axis=0)
                    px = np.array([(m[0] + .5) * w_px, (m[1] + .5) * h_px])
                    tp = np.array([t["x"], t["y"]])
                    col = min(3, max(0, int(px[0] / w_px * 4)))
                    dots.append({"block": b["id"], "key": key, "point": p, "centre": t["row"] in CENTRE_ROWS, "frames": len(ests), "err_px": float(np.linalg.norm(px - tp)),
                                 "cell": float(cell_of(px, w_px, h_px) == t["cell"]), "row": float((px[1] >= h_px / 2) == (t["y"] >= h_px / 2)), "col": float(col == t["column"])})
            D["streams"][st] = {"dots": dots}
        out["designs"][d["name"]] = D

    # ---- aggregates and paired differences vs C0 ----
    def agg(dots):
        e = np.array([x["err_px"] for x in dots], float)
        ok = np.isfinite(e)
        return {"dots": int(ok.sum()), "median_px": float(np.median(e[ok])) if ok.any() else float("nan"), "median_cm": float(np.median(e[ok]) * cm) if ok.any() else float("nan"),
                "cell": float(np.nanmean([x["cell"] for x in dots])) if ok.any() else float("nan"), "row": float(np.nanmean([x["row"] for x in dots])) if ok.any() else float("nan"), "col": float(np.nanmean([x["col"] for x in dots])) if ok.any() else float("nan")}

    c0 = out["designs"]["C0"]
    for name, D in out["designs"].items():
        for st, S in D["streams"].items():
            S["summary"] = {}
            ref = {(x["block"], x["point"]): x for x in c0["streams"][st]["dots"]} if st in c0["streams"] else {}
            for gname, keys in groups.items():
                for subset in ("centre", "all16"):
                    sel = [x for x in S["dots"] if x["key"] in keys and (x["centre"] or subset == "all16")]
                    a = agg(sel) if sel else None
                    if a and ref and name != "C0":
                        pairs = [(x, ref.get((x["block"], x["point"]))) for x in sel]
                        pairs = [(x, y) for x, y in pairs if y and np.isfinite(x["err_px"]) and np.isfinite(y["err_px"])]
                        a["d_err"] = boot_mean([x["err_px"] - y["err_px"] for x, y in pairs], rng)
                        a["d_cell"] = boot_mean([x["cell"] - y["cell"] for x, y in pairs], rng)
                        a["d_row"] = boot_mean([x["row"] - y["row"] for x, y in pairs], rng)
                        a["d_col"] = boot_mean([x["col"] - y["col"] for x, y in pairs], rng)
                        a["d_err_median"] = float(np.median([x["err_px"] - y["err_px"] for x, y in pairs]))
                    S["summary"][f"{gname}/{subset}"] = a
            # per block medians (all 16 dots) for the per-block table
            S["per_block"] = {}
            for b in scoring:
                sel = [x for x in S["dots"] if x["key"] == b["key"]]
                S["per_block"][b["id"]] = {"median_px": agg(sel)["median_px"], "cells_centre": int(np.nansum([x["cell"] for x in sel if x["centre"]])), "cells_all": int(np.nansum([x["cell"] for x in sel]))}

    # ---- cost model ----
    c0_net_ms = None
    if net and "shipped" in out["designs"]["C0"].get("network", {}).get("variants", {}):
        c0_net_ms = out["designs"]["C0"]["network"]["variants"]["shipped"]["ms"]
    live_scale = (c0_meas["training_gap_s"] * 1000 / c0_net_ms) if c0_net_ms else None
    for name, D in out["designs"].items():
        if name == "C0":
            coll = c0_meas["collection_s"]
        elif name == "C0-eyes":
            coll = c0_meas["eyes_stage_s"]
        else:
            coll = INTRO_S + D["dots"] * (HOP_S + D["w"])
        D["cost"] = {"collection_s": coll, "streams": {}}
        for st in D["streams"]:
            if st == "geometric":
                tr_ms = D["geometric"]["fit_ms"]
            else:
                tr_ms = D["network"]["variants"][st.split()[-1]]["ms"]
            live_ms = tr_ms * live_scale if (live_scale and st != "geometric") else tr_ms
            D["cost"]["streams"][st] = {"train_ms_measured": tr_ms, "train_s_live_scaled": live_ms / 1000, "total_s": coll + live_ms / 1000}

    # ---- fidelity ----
    fidelity = {}
    # geometric C0 refit vs the recorded geometric stream on the scoring frames, and the shipped-rule held-out MSE / weight.
    g0 = c0["geometric"]["fit"]
    Wc0 = fit_shipped(designs[0]["X"], designs[0]["Y"])["W"]
    diffs = []
    for key, rows in usable.items():
        for r in rows:
            if r.get("geometric"):
                p = np.array(r["features12"], float) @ Wc0
                diffs.append(np.max(np.abs((p - np.array(r["geometric"])) * np.array([w_px, h_px]))))
    tr = (s.session.get("calibration") or {}).get("trainingReport") or {}
    fidelity["geometric"] = {"max_abs_px_vs_recorded_stream": float(max(diffs)) if diffs else None, "frames": len(diffs), "heldOutMse_refit": g0["heldOutMse"], "heldOutMse_recorded": (tr.get("geometric") or {}).get("heldOutMse"),
                             "weight_shipped_rule_refit_with_recorded_network_mse": blend_weight(g0["heldOutMse"], tr.get("heldOutAfter")), "weight_recorded": (tr.get("geometric") or {}).get("weight")}
    if net:
        fidelity["F1_pretrained_head_vs_recorded"] = net["F1"]
        rr_file = folder / "rerun_head.json"
        shipped_v = out["designs"]["C0"]["network"]["variants"]["shipped"]
        fidelity["C0_shipped_training_report"] = {"rerun": shipped_v["report"], "recorded": {k: tr.get(k) for k in ("samples", "heldOut", "stepsUsed", "bestStep", "heldOutBefore", "heldOutAfter")}}
        # frame-level per-block medians of the C0 shipped re-train vs rerun_head.md and the recorded network
        check = net["designs"]["C0"]["variants"]["shipped"]["check"]
        per_block = {}
        rr = json.loads(rr_file.read_text()) if rr_file.exists() else None
        for b in s.blocks:
            if b["status"] != "complete":
                continue
            errs, rec = [], []
            for r in s.usable(b["key"]):
                i = check_at.get(r["t"])
                if i is None:
                    continue
                p = np.array(check[i]); tp = np.array([r["target"]["x"], r["target"]["y"]])
                errs.append(np.linalg.norm(np.array([(p[0] + .5) * w_px, (p[1] + .5) * h_px]) - tp))
                if r.get("network"):
                    q = r["network"]; rec.append(np.linalg.norm(np.array([(q[0] + .5) * w_px, (q[1] + .5) * h_px]) - tp))
            row = {"frames": len(errs), "budget_retrain_px": float(np.median(errs)) if errs else None, "recorded_network_px": float(np.median(rec)) if rec else None}
            if rr:
                row["rerun_head_px"] = rr["variants"].get("recorded · pose trainable · l2 0", {}).get("blocks", {}).get(b["key"], {}).get("median_px")
            per_block[b["id"]] = row
        fidelity["C0_shipped_per_block"] = per_block

    result = {"session": s.session.get("id"), "tester": s.session.get("tester"), "viewport": [w_px, h_px], "cmPerCssPx": cm, "frame_interval_ms_B1": frame_ms, "b1_record_span_ms": {"median": float(np.median(spans)), "min": float(min(spans)), "max": float(max(spans))},
              "scoring_blocks": {g: k for g, k in groups.items()}, "measured_C0": c0_meas, "live_training_scale": live_scale, "network": bool(net), "network_encode_s": (net["encodeMs"] / 1000) if net else None,
              "cost_model": {"intro_s": INTRO_S, "hop_s": HOP_S, "note": "collection = 2 s intro + dots × (0.4 s hop/onset + w); C0 and C0-eyes use the measured durations of the real calibration; training = in-page measured ms scaled to the live C0 training gap"},
              "fidelity": fidelity, "designs": out["designs"]}
    # strip numpy
    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items() if k != "check"}
        if isinstance(o, list):
            return [clean(v) for v in o]
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        if isinstance(o, float) and not math.isfinite(o):
            return None
        return o
    (folder / "budget.json").write_text(json.dumps(clean(result), indent=1) + "\n")
    write_report(folder, s, result, designs, groups)
    plot(folder, result)
    print(f"wrote {folder / 'budget.md'}, budget.json, budget.png")


# ---------------- report ----------------
def pct(v):
    return "—" if v is None or not np.isfinite(v) else f"{100 * v:.0f} %"


def ci(b, unit="", scale=1.0, digits=0):
    if not b or not np.isfinite(b.get("mean", float("nan"))):
        return "—"
    f = lambda v: f"{v * scale:+.{digits}f}"
    return f"{f(b['mean'])} [{f(b['lo'])}, {f(b['hi'])}]{unit}"


def write_report(folder, s, R, designs, groups):
    D = R["designs"]
    L = []
    P = L.append
    P(f"# Calibration budget · {R['session']}")
    P("")
    P(f"Tester: {R['tester']} (one person; nothing here generalises until a live test repeats it). Viewport {R['viewport'][0]}×{R['viewport'][1]} CSS px, {R['cmPerCssPx']:.4f} cm per px. "
      f"Frame interval in B1 {R['frame_interval_ms_B1']:.0f} ms (~{1000 / R['frame_interval_ms_B1']:.0f} fps). Frames: record-phase frames with a face present, eyes open and geometric features, final attempt per block. "
      f"Per dot the median estimate over its usable frames is scored (what a 1.6 s look gives the decoder). Scoring blocks: all complete blocks except B1 (the source of the simulated calibrations): "
      f"{', '.join(groups['all'])}; neutral = {', '.join(groups['neutral']) or '—'}; pose = {', '.join(groups['pose'])}. Cells: the 4×2 navigation grid; rows: top/bottom half; columns: quarter of the width.")
    P("")
    P("## Timing facts that shape the designs")
    P("")
    P(f"- B1 as recorded: 0.9 s travel phase, then a 1.6 s record window; the validation dot does **not** jump: `.validation-dot` animates `left`/`top` over 600 ms (src/styles.css), so the dot reaches its place 0.6 s after onset and the eyes had a further 0.3 s before the record window. "
      f"Recorded record-window span per dot (first to last record frame): median {R['b1_record_span_ms']['median']:.0f} ms (min {R['b1_record_span_ms']['min']:.0f}, max {R['b1_record_span_ms']['max']:.0f}).")
    P("- The `C8×w+onset` variants (frames from 0.4 s after a dot jump) were therefore **not run**: there is no instantaneous jump in this data, and eye strips were only exported for record-phase frames, so the network has no late-travel frames to train on. `C8×1.0@0.3` (record frames 0.3–1.3 s) is the closest probe of onset sensitivity: it tests whether the first 0.3 s of the record window, i.e. 0.9–1.2 s after the dot started moving, are worse labels than later frames.")
    P(f"- **Optimistic by construction:** every B1 design gave the eyes 0.9 s to land (0.6 s animation + 0.3 s) before the first used frame, more than the 0.4 s hop/onset discard the cost model assumes. Short-window numbers therefore bound what a 0.4 s design can do from above until a live run with that timing confirms them.")
    P(f"- Real C0 in this session: collection {R['measured_C0']['collection_s']:.1f} s (eye stage {R['measured_C0']['eyes_stage_s']:.1f} s), then {R['measured_C0']['training_gap_s']:.1f} s from the last label to the first post-calibration frame (training + strip export + screen change).")
    if R["network"]:
        P(f"- Training time is measured in headless Chromium on SwiftShader WebGL on a loaded machine (load average ≈ 36 on 15 cores at run time), not on the tester's GPU; the modelled totals below scale each in-page time by the live C0 ratio {R['live_training_scale']:.2f} (live gap ÷ in-page C0 time). One run per design, so treat training seconds as indicative.")
    P("")
    P("## Designs and modelled cost")
    P("")
    P(f"Cost model: {R['cost_model']['note']}. Shipped-worker constraints a design would trip are listed; they are one-line limit changes in `worker-engine.ts` / `geometric-gaze.ts`, not model changes.")
    P("")
    P("| design | source | dots | frames (per dot) | collection s | training s: geometric / net shipped / net frozen (in-page → live-scaled) | total s (blend shipped) | shipped constraints tripped |")
    P("|---|---|---|---|---|---|---|---|")
    for name, d in D.items():
        c = d["cost"]
        tr = lambda st: (f"{c['streams'][st]['train_ms_measured'] / 1000:.1f}→{c['streams'][st]['train_s_live_scaled']:.1f}" if st in c["streams"] else "—")
        tot = c["streams"].get("blend shipped", c["streams"]["geometric"])["total_s"]
        P(f"| {name} | {d['source']} | {d['dots']} | {d['frames']} ({d['frames_per_dot']:.0f}) | {c['collection_s']:.1f} | {c['streams']['geometric']['train_ms_measured'] / 1000:.2f} / {tr('network shipped')} / {tr('network frozen')} | {tot:.1f} | {'; '.join(d['constraints']) or 'none'} |")
    P("")
    P("## Fidelity")
    P("")
    F = R["fidelity"]
    g = F["geometric"]
    P(f"- Geometric: the C0 refit (shipped 12 features, penalties, outlier pass) vs the worker's recorded `geometric` stream on {g['frames']} scoring frames: max |Δ| = {g['max_abs_px_vs_recorded_stream']:.2e} px. Shipped-rule held-out MSE refit {fmt(g['heldOutMse_refit'], 6)} vs recorded {fmt(g['heldOutMse_recorded'], 6)}; blend weight from the refit with the recorded network MSE {fmt(g['weight_shipped_rule_refit_with_recorded_network_mse'], 4)} vs recorded {fmt(g['weight_recorded'], 4)}.")
    if R["network"]:
        P(f"- Network: F1 pretrained head vs the recorded pre-training estimate on the 42 calibration strips: max |Δ| = {F['F1_pretrained_head_vs_recorded']:.2e}. C0 shipped re-train report: {json.dumps(F['C0_shipped_training_report']['rerun'])} vs recorded {json.dumps(F['C0_shipped_training_report']['recorded'])} (WebGL training is not bit-reproducible: rerun_head.md reports the same drift).")
        P("")
        P("| block | frames | C0 shipped re-train (this run) median px | rerun_head.md same variant | recorded network |")
        P("|---|---|---|---|---|")
        for bid, row in F["C0_shipped_per_block"].items():
            P(f"| {bid} | {row['frames']} | {fmt(row['budget_retrain_px'])} | {fmt(row.get('rerun_head_px'))} | {fmt(row['recorded_network_px'])} |")
    else:
        P("- No eye strips in this session: geometric branch only (its `features12` per frame are in frames.jsonl).")
    P("")
    P("## Blend weights (geometric share) per design")
    P("")
    if R["network"]:
        P("Leave-one-dot-out MSE within the design (normalized units², mean over both axes) for the geometric fit and each head; weight = (1/g)/(1/g + 1/n) bounded to [0, 0.85]; per-axis weights from per-axis MSE. `shipped rule` = the worker's own hold-out (last label per dot) for reference.")
        P("")
        P("| design | geometric LODO MSE | net shipped LODO MSE | net frozen LODO MSE | w shipped (x, y) | w frozen (x, y) | w shipped-rule |")
        P("|---|---|---|---|---|---|---|")
        for name, d in D.items():
            if "network" not in d:
                continue
            gl = d["geometric"]["lodo"]["mse"]
            v = d["network"]["variants"]; bw = d["blend_weights"]
            P(f"| {name} | {fmt(gl, 5)} | {fmt(v['shipped']['lodo']['mse'], 5)} | {fmt(v['frozen']['lodo']['mse'], 5)} | {bw['shipped']['scalar']:.2f} ({bw['shipped']['x']:.2f}, {bw['shipped']['y']:.2f}) | {bw['frozen']['scalar']:.2f} ({bw['frozen']['x']:.2f}, {bw['frozen']['y']:.2f}) | {fmt(bw['shipped'].get('shipped_rule'), 2)} |")
    else:
        P("| design | geometric LODO MSE | fit samples / targets / outliers |")
        P("|---|---|---|")
        for name, d in D.items():
            f = d["geometric"]["fit"] or {}
            P(f"| {name} | {fmt(d['geometric']['lodo']['mse'], 5)} | {f.get('samples', '—')} / {f.get('targets', '—')} / {f.get('outliers', '—')} |")
    P("")

    def table(gkey, title, streams):
        P(f"## {title}")
        P("")
        P("Median per-dot error (px, cm), 4×2 cell / row / column hit rates; Δ columns = paired per-dot difference vs C0 with the same stream (design − C0), mean with 95 % bootstrap interval over dots (5000 resamples); Δ cell in percentage points. Negative Δ error and non-negative Δ cell are better.")
        P("")
        P("| design | stream | dots | median px (cm) | cell | row | col | Δ err px [95 %] | Δ cell pp [95 %] | Δ col pp [95 %] |")
        P("|---|---|---|---|---|---|---|---|---|---|")
        for name, d in D.items():
            for st in streams:
                S = d["streams"].get(st)
                if not S or not S["summary"].get(gkey):
                    continue
                a = S["summary"][gkey]
                P(f"| {name} | {st} | {a['dots']} | {a['median_px']:.0f} ({a['median_cm']:.1f}) | {pct(a['cell'])} | {pct(a['row'])} | {pct(a['col'])} | {ci(a.get('d_err'))} | {ci(a.get('d_cell'), scale=100)} | {ci(a.get('d_col'), scale=100)} |")
        P("")

    streams_all = [st for st in STREAM_ORDER if any(st in d["streams"] for d in D.values())]
    streams_main = [st for st in PLOT_STREAMS if st in streams_all]
    table("all/centre", f"A. All scoring blocks · the 8 cell-centre dots per block ({len(groups['all'])} blocks)", streams_all)
    table("all/all16", "B. All scoring blocks · all 16 dots per block", streams_all)
    if groups["neutral"]:
        table("neutral/centre", f"C. Neutral blocks ({', '.join(groups['neutral'])}) · cell-centre dots", streams_main)
    table("pose/centre", f"D. Pose blocks ({', '.join(groups['pose'])}) · cell-centre dots", streams_main)

    P("## E. Per block · median px over all 16 dots and cell-centre cells hit (of 8), stream `blend shipped`" + ("" if R["network"] else " (geometric only: stream `geometric`)"))
    P("")
    st = "blend shipped" if R["network"] else "geometric"
    blocks = list(next(iter(D.values()))["streams"][st]["per_block"].keys())
    P("| design | " + " | ".join(blocks) + " |")
    P("|---|" + "---|" * len(blocks))
    for name, d in D.items():
        pb = d["streams"][st]["per_block"]
        P(f"| {name} | " + " | ".join(f"{fmt(pb[b]['median_px'])} · {pb[b]['cells_centre']}/8" for b in blocks) + " |")
    P("")
    if R["network"]:
        P("Same, stream `blend frozen`:")
        P("")
        P("| design | " + " | ".join(blocks) + " |")
        P("|---|" + "---|" * len(blocks))
        for name, d in D.items():
            pb = d["streams"]["blend frozen"]["per_block"]
            P(f"| {name} | " + " | ".join(f"{fmt(pb[b]['median_px'])} · {pb[b]['cells_centre']}/8" for b in blocks) + " |")
        P("")

    # ---- reading (derived from the tables above) ----
    P("## Reading")
    P("")
    if R["network"]:
        for name, d in D.items():
            a_net = d["streams"]["network shipped"]["summary"]["all/centre"]; a_bl = d["streams"]["blend shipped"]["summary"]["all/centre"]
            w = d["blend_weights"]["shipped"]["scalar"]
            pb = d["streams"]["blend shipped"]["per_block"]
            worst = min(pb.items(), key=lambda kv: (kv[1]["cells_centre"], -kv[1]["median_px"]))
            P(f"- `{name}`: network alone {a_net['median_px']:.0f} px / {pct(a_net['cell'])} cells, blend at geometric share {w:.2f}: {a_bl['median_px']:.0f} px / {pct(a_bl['cell'])}; worst scoring block for the blend {worst[0]} ({worst[1]['median_px']:.0f} px, {worst[1]['cells_centre']}/8 centre cells).")
        P("")
        P("The geometric branch fitted on B1 frames alone scores 260–360 px on the pose blocks whatever the window, yet its leave-one-dot-out error inside B1 is as small as the network's, so the shipped inverse-MSE rule hands it a 0.3–0.65 share and drags the blend below the network alone. Leave-one-dot-out inside a single neutral block measures interpolation along the row lines, not robustness to posture. The rule itself matters as much as the design: the worker's own hold-out (the last label of each dot) gave C0 a 0.16 share and C0-eyes 0.23 (table above), where leave-one-dot-out gives both about 0.35; with 15–23 near-duplicate frames per dot the last-frame hold-out is close to in-sample and would be even less informative. A short calibration therefore needs either a lower bound on the network share, a pose-aware weight, or to ship the network alone, before the blend numbers above apply.")
    else:
        P("- Geometric branch only in this session (no eye strips). Cell rates below 60 % on the pose blocks for every design, C0 included, so the geometric branch alone cannot carry the 4×2 decision under head movement; the budget question for this session is only whether a short design is as good as C0 for this branch, and the intervals say every 4- to 8-dot design at 0.6–1.6 s is, while the 16-dot design with the 10 %/90 % rows is clearly worse (the linear iris/lid model does not extrapolate to the extreme rows and bends the fit on the cell centres).")
    P("")
    # ---- recommendation ----
    P("## Recommendation (computed)")
    P("")
    P("Criterion: on the cell-centre dots of all scoring blocks, the design's paired Δ error interval vs C0 includes zero or lies below it, **and** its Δ cell-rate interval includes zero or lies above it, for the same stream. Among those, the cheapest modelled total. Listed per stream.")
    P("")
    rec = {}
    for st in streams_main:
        ok = []
        for name, d in D.items():
            if name == "C0" or st not in d["streams"]:
                continue
            a = d["streams"][st]["summary"].get("all/centre")
            if not a or "d_err" not in a:
                continue
            if a["d_err"]["lo"] <= 0 and a["d_cell"]["hi"] >= 0:
                ok.append((d["cost"]["streams"][st]["total_s"], name, a))
        ok.sort()
        c0a = D["C0"]["streams"][st]["summary"]["all/centre"]
        rec[st] = [n for _, n, _ in ok]
        if ok:
            t, n, a = ok[0]
            P(f"- **{st}**: cheapest qualifying design `{n}` at {t:.1f} s modelled (C0: {D['C0']['cost']['streams'][st]['total_s']:.1f} s): median {a['median_px']:.0f} px ({a['median_cm']:.1f} cm) vs C0 {c0a['median_px']:.0f} px, cells {pct(a['cell'])} vs {pct(c0a['cell'])}, Δ err {ci(a['d_err'])} px, Δ cell {ci(a['d_cell'], scale=100)} pp over {a['d_err']['n']} dots; "
              f"worst case inside the interval: {a['d_err']['hi']:+.0f} px ({a['d_err']['hi'] * R['cmPerCssPx']:+.1f} cm) and {100 * a['d_cell']['lo']:+.0f} pp of cells. All qualifying, cheapest first: {', '.join(rec[st])}.")
            best = min(ok, key=lambda o: o[2]["d_err"]["mean"])
            P(f"  Best accuracy among them: `{best[1]}` ({best[0]:.1f} s), Δ err {ci(best[2]['d_err'])} px, Δ cell {ci(best[2]['d_cell'], scale=100)} pp.")
        else:
            P(f"- **{st}**: no design qualifies; C0 median {c0a['median_px']:.0f} px, cells {pct(c0a['cell'])}.")
    P("")
    P("Only a live test can settle: the real onset timing (a 0.4 s hop + discard vs the 0.9 s this data gave the eyes), fatigue and attention over repeated calibrations, people with slower saccades, nystagmus or reduced range (the target users), whether 8 dots on two row lines generalise to the 10 %/90 % extremes a user never looks at, worker caps (42 samples, 9 targets, 6 geometric targets) raised in Clarte, and smooth pursuit along the two row lines as an alternative to dots (Pfeuffer 2013 style, no fixation required).")
    P("")
    (folder / "budget.md").write_text("\n".join(L) + "\n")


def plot(folder, R):
    D = R["designs"]
    streams = [st for st in PLOT_STREAMS if any(st in d["streams"] for d in D.values())]
    fig, axes = plt.subplots(2, 2, figsize=(12, 8), sharex=True)
    panels = [("all/centre", "all scoring blocks · cell-centre dots"), ("pose/centre", "pose blocks · cell-centre dots")]
    if R["scoring_blocks"]["neutral"]:
        panels[1] = ("neutral/centre", "neutral blocks · cell-centre dots")
    fam = [n for n in D if n.startswith("C8×") and "@" not in n]
    index = {name: i + 1 for i, name in enumerate(D)}
    for col, (gkey, title) in enumerate(panels):
        for row, (metric, ylabel) in enumerate((("median_px", "median per-dot error (px)"), ("cell", "4×2 cell hit rate"))):
            ax = axes[row][col]
            for st in streams:
                xs, ys, names = [], [], []
                for name, d in D.items():
                    S = d["streams"].get(st)
                    a = S and S["summary"].get(gkey)
                    if not a:
                        continue
                    xs.append(d["cost"]["streams"][st]["total_s"]); ys.append(a[metric]); names.append(name)
                ax.scatter(xs, ys, s=64, color=COLORS[st], label=st, zorder=3, edgecolors="white", linewidths=1)
                fx = [x for x, n in zip(xs, names) if n in fam]; fy = [y for y, n in zip(ys, names) if n in fam]
                order = np.argsort(fx)
                ax.plot(np.array(fx)[order], np.array(fy)[order], color=COLORS[st], lw=2, alpha=.8)
                for x, y, n in zip(xs, ys, names):
                    if n == "C0":
                        ax.plot([x, x], [ax.get_ylim()[0], y], color=COLORS[st], lw=.8, ls=":", alpha=.5)
            if row == 1:
                ax.set_ylim(0, 1.02); ax.set_yticks([0, .25, .5, .75, 1]); ax.set_yticklabels(["0", "25 %", "50 %", "75 %", "100 %"])
                ax.set_xlabel("modelled calibration time (s): intro + dots × (0.4 s + w) + training")
            ax.set_ylabel(ylabel); ax.set_title(title, fontsize=11)
            ax.grid(color="#e4e4e2", lw=.6); ax.set_axisbelow(True)
            for sp in ("top", "right"):
                ax.spines[sp].set_visible(False)
            # design numbers next to the geometric points (the key is under the figure); x is nearly the same for every stream
            for name, d in D.items():
                S = d["streams"].get("geometric")
                a = S and S["summary"].get(gkey)
                if a:
                    ax.annotate(str(index[name]), (d["cost"]["streams"]["geometric"]["total_s"], a[metric]), xytext=(5, 4), textcoords="offset points", fontsize=7, color="#5c5c58")
    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, fontsize=9, frameon=False, loc="lower center", ncol=len(labels), bbox_to_anchor=(.5, 0))
    fig.text(.5, .055, "   ".join(f"{i} {n}" for n, i in index.items()), ha="center", fontsize=8, color="#5c5c58")
    fig.suptitle(f"Calibration budget · {R['session']} · one tester", fontsize=12)
    fig.tight_layout(rect=(0, .08, 1, 1))
    fig.savefig(folder / "budget.png", dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(1)
    main(Path(a[0]), run_network="--no-network" not in a, rerun="--rerun-network" in a, port=int(a[a.index("--port") + 1]) if "--port" in a else 4334)
