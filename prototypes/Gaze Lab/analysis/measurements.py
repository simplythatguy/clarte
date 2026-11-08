#!/usr/bin/env python3
"""Cross-cutting measurements for a gaze-lab session.

Usage: .venv/bin/python -I analysis/measurements.py <session_dir>

M1  bias vs noise per axis, block and estimator: bias = mean signed error (estimate − target), noise = SD about it; px and cm.
M2  translation slope of the geometric branch: signed x error regressed on faceOrigin3D.x/z and y error on y/z across
    the translation blocks (B2-B7) together with the neutral block (B1); slope with 95 % CI and R².
M3  iris attenuation on the neutral block: per-eye iris y and upper-lid height (eye widths, from `gaze`) regressed on the
    dot's y (and jointly on the face-matrix pitch); the iris slope is compared with the rigid-sphere prediction
    (0.37 px/° from the brief, converted to eye widths with the eye width measured from landmarks.f32 corners 33/133 and
    362/263; and the distance-free form r_eye·π/180 / fissure width).
Gate learning-gate proxy: fraction of usable frames per block whose `pose` is within HEAD_LIMITS of the calibration
    reference pose (headDifference / near ported from src/core/head-position.ts, factor 1).

Frames: record-phase frames with a face present and eyes open (usable), final attempt per block, exactly as analyze.py;
calibration reference pose = mean pose over the accepted calibration label frames. Units: px = CSS pixels of the
recorded viewport, cm from the screen diagonal, camera px for eye widths, degrees from the face matrix.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import Session, fmt, head_angles  # noqa: E402
from rows import calibration_label_rows  # noqa: E402

ESTIMATORS = ("network", "geometric", "blend", "pointer")
TRANSLATION_BLOCKS = ("B1", "B2", "B3", "B4", "B5", "B6", "B7")
HEAD_LIMITS = {"translation": .12, "scale": .12, "roll": .12, "yawRatio": .10, "pitchRatio": .10}
RIGID_SPHERE_PX_PER_DEG = 0.37       # from the brief
EYEBALL_RADIUS_CM = 1.2              # rigid-sphere iris lever arm
PALPEBRAL_FISSURE_CM = 3.0           # typical corner-to-corner eye width, for the distance-free prediction
LANDMARK_FLOATS = 478 * 3
CORNERS = {"right": (33, 133), "left": (362, 263)}


# ---------------- ports of head-position.ts ----------------
def head_difference(current, reference):
    return {"x": (current["centerX"] - reference["centerX"]) / reference["span"], "y": (current["centerY"] - reference["centerY"]) / reference["span"],
            "scale": current["span"] / reference["span"] - 1,
            "roll": math.atan2(math.sin(current["roll"] - reference["roll"]), math.cos(current["roll"] - reference["roll"])),
            "yawRatio": current["yawRatio"] - reference["yawRatio"], "pitchRatio": current["pitchRatio"] - reference["pitchRatio"]}


def near(current, reference, factor=1.0):
    d = head_difference(current, reference)
    return (math.hypot(d["x"], d["y"]) <= HEAD_LIMITS["translation"] * factor and abs(d["scale"]) <= HEAD_LIMITS["scale"] * factor and abs(d["roll"]) <= HEAD_LIMITS["roll"] * factor
            and abs(d["yawRatio"]) <= HEAD_LIMITS["yawRatio"] * factor and abs(d["pitchRatio"]) <= HEAD_LIMITS["pitchRatio"] * factor)


def reference_pose(poses):
    """HeadPositionGuard.establishReference: plain means, circular mean for roll."""
    if not poses:
        return None
    mean = lambda k: float(np.mean([p[k] for p in poses]))
    roll = math.atan2(sum(math.sin(p["roll"]) for p in poses), sum(math.cos(p["roll"]) for p in poses))
    return {"centerX": mean("centerX"), "centerY": mean("centerY"), "span": mean("span"), "roll": roll, "yawRatio": mean("yawRatio"), "pitchRatio": mean("pitchRatio")}


# ---------------- regression helper ----------------
def linregress_ci(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if x.size < 4 or x.std() < 1e-12:
        return None
    r = stats.linregress(x, y)
    t = stats.t.ppf(0.975, x.size - 2)
    return {"slope": float(r.slope), "ci95": [float(r.slope - t * r.stderr), float(r.slope + t * r.stderr)], "intercept": float(r.intercept), "r2": float(r.rvalue ** 2), "n": int(x.size), "x_range": [float(x.min()), float(x.max())]}


def ols(X, y):
    """Multiple regression with intercept; returns coefficients, 95 % CIs and R²."""
    X = np.column_stack([np.ones(len(y)), np.asarray(X, float)]); y = np.asarray(y, float)
    m = np.isfinite(X).all(axis=1) & np.isfinite(y)
    X, y = X[m], y[m]
    n, k = X.shape
    if n <= k + 1:
        return None
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    s2 = resid @ resid / (n - k)
    try:
        cov = s2 * np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        return None
    se = np.sqrt(np.diag(cov)); t = stats.t.ppf(0.975, n - k)
    ss_tot = ((y - y.mean()) ** 2).sum()
    return {"coef": beta[1:].tolist(), "ci95": [[float(b - t * e), float(b + t * e)] for b, e in zip(beta[1:], se[1:])], "r2": float(1 - resid @ resid / ss_tot) if ss_tot > 0 else float("nan"), "n": int(n)}


def eye_widths_px(folder: Path, rows, camera):
    """Corner-to-corner eye width in camera pixels per usable frame from landmarks.f32 (normalized x,y × camera size)."""
    f = folder / "landmarks.f32"
    if not f.exists() or not camera:
        return {}
    data = np.memmap(f, dtype=np.float32, mode="r")
    n_rows = data.size // LANDMARK_FLOATS
    out = {}
    for r in rows:
        i = r.get("landmarkRow")
        if i is None or i >= n_rows:
            continue
        lm = np.asarray(data[i * LANDMARK_FLOATS:(i + 1) * LANDMARK_FLOATS]).reshape(478, 3)
        w = {}
        for eye, (a, b) in CORNERS.items():
            dx = (lm[a, 0] - lm[b, 0]) * camera["width"]; dy = (lm[a, 1] - lm[b, 1]) * camera["height"]
            w[eye] = float(math.hypot(dx, dy))
        out[r["t"]] = w
    return out


def main(folder: Path):
    s = Session(folder)
    synthetic = bool(s.session.get("demo")) or "e2e" in str(s.session.get("tester", "")).lower()
    keys = [b["key"] for b in s.blocks if s.usable(b["key"])]
    block_of = {b["key"]: b for b in s.blocks}
    cm = s.cm_per_px
    out = {"session": s.session.get("id"), "synthetic": synthetic, "cm_per_px": cm}
    L = [f"# Cross-cutting measurements · {s.session.get('id')}", ""]
    if synthetic:
        L += ["**Synthetic session**: the numbers only prove the code runs.", ""]
    L += [f"Frames: record-phase frames with a face present and eyes open (usable), final attempt per block; viewport {s.w}×{s.h} CSS px, {fmt(cm, 4)} cm per CSS px. Signed error = estimate − target.", ""]

    # M1 bias vs noise.
    L += ["## M1 Bias vs noise per axis (px, cm in brackets)", "", "Bias = mean signed error, noise = SD of the signed error about its mean, per estimator and block.", "",
          "| block | estimator | frames | bias x | noise x | bias y | noise y |", "|---|---|---|---|---|---|---|"]
    m1 = {}
    for k in keys:
        rows = s.usable(k); m1[k] = {}
        for name in ESTIMATORS:
            pairs = [(s.estimate_px(r, name), s.target_px(r)) for r in rows]
            d = np.array([p - t for p, t in pairs if p is not None and t is not None])
            if len(d) < 2:
                m1[k][name] = None; L.append(f"| {block_of[k]['id']} | {name} | {len(d)} | — | — | — | — |"); continue
            e = {"frames": int(len(d)), "bias_x_px": float(d[:, 0].mean()), "noise_x_px": float(d[:, 0].std(ddof=1)), "bias_y_px": float(d[:, 1].mean()), "noise_y_px": float(d[:, 1].std(ddof=1))}
            if cm:
                e.update({kk.replace("_px", "_cm"): v * cm for kk, v in list(e.items()) if kk.endswith("_px")})
            m1[k][name] = e
            c = (lambda v: f" ({v * cm:.1f})") if cm else (lambda v: "")
            L.append(f"| {block_of[k]['id']} | {name} | {e['frames']} | {e['bias_x_px']:+.0f}{c(e['bias_x_px'])} | {e['noise_x_px']:.0f}{c(e['noise_x_px'])} | {e['bias_y_px']:+.0f}{c(e['bias_y_px'])} | {e['noise_y_px']:.0f}{c(e['noise_y_px'])} |")
    out["m1"] = m1
    L.append("")

    # M2 translation slope (geometric branch).
    tkeys = [k for k in keys if block_of[k]["id"] in TRANSLATION_BLOCKS]
    pts = []
    for k in tkeys:
        for r in s.usable(k):
            p, t, o = s.estimate_px(r, "geometric"), s.target_px(r), r.get("faceOrigin3D")
            if p is None or t is None or not o or not o[2] > 0:
                continue
            pts.append((o[0] / o[2], o[1] / o[2], p[0] - t[0], p[1] - t[1], block_of[k]["id"]))
    m2 = {"blocks": [block_of[k]["id"] for k in tkeys], "frames": len(pts)}
    if pts:
        a = np.array([p[:4] for p in pts], float)
        m2["x_error_vs_origin_x_over_z"] = linregress_ci(a[:, 0], a[:, 2]); m2["y_error_vs_origin_y_over_z"] = linregress_ci(a[:, 1], a[:, 3])
    out["m2"] = m2
    L += ["## M2 Translation slope of the geometric branch", "",
          f"Per-frame signed geometric error (px) regressed on the eye midpoint's perspective ratio faceOrigin3D.x/z (y/z), unitless, over blocks {', '.join(m2['blocks']) or '—'} ({m2['frames']} frames). Slope in px per unit of x/z (a 10 cm shift at 60 cm is 0.167 units) with the 95 % CI and R²; a slope near 0 with a wide x-range means the geometric model cancels translation as designed.", ""]
    for axis, key in (("x", "x_error_vs_origin_x_over_z"), ("y", "y_error_vs_origin_y_over_z")):
        r = m2.get(key)
        L.append(f"- {axis}: " + (f"slope {r['slope']:+.0f} px/unit (95 % CI {r['ci95'][0]:+.0f}…{r['ci95'][1]:+.0f}), R² {r['r2']:.3f}, n {r['n']}, ratio range {r['x_range'][0]:+.3f}…{r['x_range'][1]:+.3f}" if r else "not enough frames or no spread in the ratio"))
    L.append("")

    # M3 iris attenuation on the neutral block.
    b1 = next((k for k in keys if block_of[k]["id"] == "B1"), None)
    m3 = {"block": "B1" if b1 else None}
    if b1:
        rows = [r for r in s.usable(b1) if r.get("gaze") and r.get("target")]
        widths = eye_widths_px(folder, rows, s.session.get("camera"))
        depth = float(np.median([r["faceOrigin3D"][2] for r in rows if r.get("faceOrigin3D")])) if rows else float("nan")
        deg_per_px = math.degrees(cm / depth) if cm and np.isfinite(depth) and depth > 0 else float("nan")
        m3.update({"frames": len(rows), "depth_cm_median": depth, "deg_per_px": deg_per_px})
        ew = {eye: float(np.median([w[eye] for w in widths.values()])) for eye in CORNERS} if widths else {}
        m3["eye_width_px_median"] = ew
        ty = np.array([r["target"]["y"] for r in rows], float)
        pitch = np.array([(head_angles(r.get("faceRt")) or (np.nan, np.nan))[1] for r in rows], float)
        feats = {}
        for eye in ("right", "left"):
            iris_y = np.array([r["gaze"][eye]["iris"][1] for r in rows], float); upper = np.array([r["gaze"][eye]["upper"] for r in rows], float)
            fi = linregress_ci(ty, iris_y); fu = linregress_ci(ty, upper); joint = ols(np.column_stack([ty, pitch]), iris_y)
            feats[eye] = {"iris_y_vs_dot_y": fi, "upper_vs_dot_y": fu, "iris_y_vs_dot_y_and_pitch": joint}
            if fi and np.isfinite(deg_per_px) and deg_per_px > 0:
                feats[eye]["iris_slope_eyewidths_per_deg"] = fi["slope"] / deg_per_px
                feats[eye]["iris_slope_ci95_eyewidths_per_deg"] = [c / deg_per_px for c in fi["ci95"]]
                feats[eye]["upper_slope_eyewidths_per_deg"] = fu["slope"] / deg_per_px if fu else None
                if ew.get(eye):
                    feats[eye]["rigid_sphere_pred_eyewidths_per_deg_from_0.37px"] = RIGID_SPHERE_PX_PER_DEG / ew[eye]
                    feats[eye]["measured_iris_px_per_deg"] = fi["slope"] / deg_per_px * ew[eye]
        m3["eyes"] = feats
        m3["rigid_sphere_pred_eyewidths_per_deg_distance_free"] = EYEBALL_RADIUS_CM * math.pi / 180 / PALPEBRAL_FISSURE_CM
        L += ["## M3 Iris attenuation (neutral block B1)", "",
              f"{len(rows)} usable B1 frames; eye width from landmarks.f32 corners (right 33/133, left 362/263) in camera px: right {fmt(ew.get('right'), 1)}, left {fmt(ew.get('left'), 1)}; median depth {fmt(depth, 1)} cm (faceOrigin3D.z, the tracker's scale) → {fmt(deg_per_px, 4)}° of gaze per CSS px of dot travel. Features are in eye widths (+y toward image bottom). Rigid-sphere prediction: {RIGID_SPHERE_PX_PER_DEG} px/° ÷ eye width (px) = eye widths/°, and the distance-free form r_eye·π/180 ÷ fissure width = {m3['rigid_sphere_pred_eyewidths_per_deg_distance_free']:.4f} eye widths/° (r_eye {EYEBALL_RADIUS_CM} cm, fissure {PALPEBRAL_FISSURE_CM} cm). The measured-to-predicted ratio is the attenuation (1 = the iris moves as a rigid sphere predicts; < 1 = landmarks under-report iris travel).", "",
              "| eye | iris y slope (ew/px, 95 % CI) | R² | iris slope ew/° | predicted ew/° (0.37 px/°) | ratio | upper lid slope ew/° | iris on dot y + pitch: coef dot (ew/px), coef pitch (ew/°), R² |", "|---|---|---|---|---|---|---|---|"]
        for eye, f in feats.items():
            fi, fu, j = f["iris_y_vs_dot_y"], f["upper_vs_dot_y"], f["iris_y_vs_dot_y_and_pitch"]
            pred = f.get("rigid_sphere_pred_eyewidths_per_deg_from_0.37px"); meas = f.get("iris_slope_eyewidths_per_deg")
            L.append(f"| {eye} | {fmt(fi['slope'] if fi else None, 6)} ({fmt(fi['ci95'][0] if fi else None, 6)}…{fmt(fi['ci95'][1] if fi else None, 6)}) | {fmt(fi['r2'] if fi else None, 3)} | {fmt(meas, 5)} | {fmt(pred, 5)} | {fmt(meas / pred if meas is not None and pred else None, 2)} | {fmt(f.get('upper_slope_eyewidths_per_deg'), 5)} | {fmt(j['coef'][0] if j else None, 6)}, {fmt(j['coef'][1] if j else None, 5)}, {fmt(j['r2'] if j else None, 3)} |")
        L.append("")
    else:
        L += ["## M3 Iris attenuation", "", "No neutral block (B1) with usable frames.", ""]
    out["m3"] = m3

    # Learning-gate proxy.
    cal_rows, corrected, src = calibration_label_rows(s)
    ref = reference_pose([r["pose"] for r in cal_rows if r.get("pose")])
    gate = {"reference": ref, "reference_frames": len([r for r in cal_rows if r.get("pose")]), "label_source": src, "blocks": {}}
    L += ["## Learning-gate proxy", "",
          f"Fraction of usable frames per block whose image-geometry pose (head-position.ts) is within HEAD_LIMITS {HEAD_LIMITS} of the calibration reference (mean pose over the {gate['reference_frames']} accepted calibration label frames, circular mean for roll). The app's guard only learns from selections while this holds, so this is the share of the block in which it would learn.", "",
          "| block | frames | within limits | median |Δx,y| (spans) | median |Δscale| | median |Δroll| (rad) | median |ΔyawRatio| | median |ΔpitchRatio| |", "|---|---|---|---|---|---|---|---|"]
    for k in keys:
        rows = [r for r in s.usable(k) if r.get("pose")]
        if not ref or not rows:
            gate["blocks"][k] = None; L.append(f"| {block_of[k]['id']} | {len(rows)} | — | — | — | — | — | — |"); continue
        diffs = [head_difference(r["pose"], ref) for r in rows]
        within = sum(1 for r in rows if near(r["pose"], ref)) / len(rows)
        g = {"frames": len(rows), "within": within, "median_abs_xy": float(np.median([math.hypot(d["x"], d["y"]) for d in diffs])), "median_abs_scale": float(np.median([abs(d["scale"]) for d in diffs])),
             "median_abs_roll": float(np.median([abs(d["roll"]) for d in diffs])), "median_abs_yaw": float(np.median([abs(d["yawRatio"]) for d in diffs])), "median_abs_pitch": float(np.median([abs(d["pitchRatio"]) for d in diffs]))}
        gate["blocks"][k] = g
        L.append(f"| {block_of[k]['id']} | {g['frames']} | {100 * within:.0f} % | {g['median_abs_xy']:.3f} | {g['median_abs_scale']:.3f} | {g['median_abs_roll']:.3f} | {g['median_abs_yaw']:.3f} | {g['median_abs_pitch']:.3f} |")
    L.append("")
    out["gate"] = gate
    (folder / "measurements.md").write_text("\n".join(L) + "\n")
    (folder / "measurements.json").write_text(json.dumps(out, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else str(o)) + "\n")
    print(f"wrote {folder / 'measurements.md'}, measurements.json")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
