#!/usr/bin/env python3
"""Head-vector layout test for a gaze-lab session.

Usage: .venv/bin/python -I analysis/headvector.py <session_dir>

The worker's `getHeadVector` reads MediaPipe's 16-value face transformation matrix through `translateMatrix`, which
fills an ml-matrix as data[i * columns + j] (a row-major read). MediaPipe delivers the matrix column-major (the
translation sits at indices 12-14). This script (a) shows which indices hold the translation and which triple is the
[0 0 0 1] row, (b) ports translateMatrix → matrixToEuler → pyrToVector → getHeadVector from
vendor/webeyetrack/local/utils/mathUtils.ts and recomputes the head vector from the recorded raw `faceRt` with both
reads, reporting which one reproduces the recorded `headVector`, (c) correlates both head-vector angle readings with
`pose.yawRatio` / `pose.pitchRatio` and the geometric `forward` axis across the head-turn blocks, and (d) writes
headvector.md + headvector.json with a one-line verdict.

Frames: every frame with a 16-value finite `faceRt` and a `headVector` for (a)/(b); for (c) the usable record-phase
frames (face present, eyes open, final attempt) of B8-B11 when present, otherwise of every kept block. Units: cm for
translations (MediaPipe's metric scale), degrees for angles, unitless Pearson r.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import Session, fmt, median  # noqa: E402

HEAD_TURN_BLOCKS = ("B8", "B9", "B10", "B11")


# ---------------- faithful ports of mathUtils.ts ----------------
def translate_matrix(data, rows=4, columns=4, read="row-major"):
    """mathUtils.translateMatrix: M(i, j) = data[i * columns + j]. `read='column-major'` is the corrected read
    M(i, j) = data[j * rows + i], i.e. what MediaPipe's column-major layout actually means."""
    d = np.asarray(data, float)
    if read == "row-major":
        return d.reshape(rows, columns)
    return d.reshape(columns, rows).T


def matrix_to_euler(m, degrees=True):
    """mathUtils.matrixToEuler on a 3×3: pitch = asin(−m[2,0]), yaw = atan2(m[2,1], m[2,2]), roll = atan2(m[1,0], m[0,0])."""
    pitch = math.asin(max(-1.0, min(1.0, -m[2, 0])))
    yaw = math.atan2(m[2, 1], m[2, 2])
    roll = math.atan2(m[1, 0], m[0, 0])
    if degrees:
        return tuple(math.degrees(v) for v in (pitch, yaw, roll))
    return pitch, yaw, roll


def euler_to_matrix(pitch, yaw, roll, degrees=True):
    """mathUtils.eulerToMatrix: R = Rz(roll) · Ry(yaw) · Rx(pitch)."""
    if degrees:
        pitch, yaw, roll = (math.radians(v) for v in (pitch, yaw, roll))
    cp, sp, cy, sy, cr, sr = math.cos(pitch), math.sin(pitch), math.cos(yaw), math.sin(yaw), math.cos(roll), math.sin(roll)
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return rz @ ry @ rx


def pyr_to_vector(pitch, yaw, roll):
    """mathUtils.pyrToVector (radians): spherical → Cartesian, then a roll rotation about z."""
    x = math.cos(pitch) * math.sin(yaw)
    y = math.sin(pitch)
    z = -math.cos(pitch) * math.cos(yaw)
    cr, sr = math.cos(roll), math.sin(roll)
    return np.array([cr * x - sr * y, sr * x + cr * y, z])


def get_head_vector(tf_matrix):
    """mathUtils.getHeadVector on a 4×4 ml-matrix-like array: Euler from the 3×3 block, reorder (−yaw, pitch, roll), unit vector."""
    pitch, yaw, roll = matrix_to_euler(tf_matrix[:3, :3], degrees=False)
    return pyr_to_vector(-yaw, pitch, roll)


def head_vector_from_face_rt(data, read="row-major"):
    return get_head_vector(translate_matrix(data, read=read))


def head_vector_angles(v):
    """Yaw/pitch (deg) of a head vector in the camera frame (x right, y up, z toward the viewer): the vector points
    away from the camera (z < 0 at rest), so yaw = atan2(x, −z) is positive toward +x and pitch = asin(y) positive upward."""
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    if not n > 1e-9:
        return None
    v = v / n
    return math.degrees(math.atan2(v[0], -v[2])), math.degrees(math.asin(max(-1.0, min(1.0, v[1]))))


def translation_layout(data):
    """Which triple is the translation: column-major ⇒ indices 12-14 and data[3], data[7], data[11] = 0, data[15] = 1;
    row-major ⇒ indices 3/7/11 and data[12..14] = 0."""
    d = np.asarray(data, float)
    R_cm = translate_matrix(d, read="column-major")[:3, :3]
    R_rm = translate_matrix(d, read="row-major")[:3, :3]
    orth = lambda R: float(np.abs(R.T @ R - np.eye(3)).max())
    return {"t_colmajor": d[[12, 13, 14]].tolist(), "t_rowmajor": d[[3, 7, 11]].tolist(), "zeros_colmajor_hyp": float(np.abs(d[[3, 7, 11]]).max()),
            "zeros_rowmajor_hyp": float(np.abs(d[[12, 13, 14]]).max()), "last": float(d[15]), "orthonormality_colmajor": orth(R_cm), "orthonormality_rowmajor": orth(R_rm),
            "det_colmajor": float(np.linalg.det(R_cm)), "det_rowmajor": float(np.linalg.det(R_rm))}


def pearson(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = np.isfinite(a) & np.isfinite(b)
    if m.sum() < 3 or a[m].std() < 1e-12 or b[m].std() < 1e-12:
        return float("nan"), int(m.sum())
    return float(np.corrcoef(a[m], b[m])[0, 1]), int(m.sum())


def main(folder: Path):
    s = Session(folder)
    synthetic = bool(s.session.get("demo")) or "e2e" in str(s.session.get("tester", "")).lower()
    frames = [r for r in s.rows if r.get("faceRt") and len(r["faceRt"]) == 16 and all(np.isfinite(r["faceRt"])) and r.get("headVector") and len(r["headVector"]) == 3]
    out = {"session": s.session.get("id"), "synthetic": synthetic, "frames_with_faceRt": len(frames)}
    L = [f"# Head-vector layout test · {s.session.get('id')}", ""]
    if synthetic:
        L += ["**Synthetic session**: the layout and the port are proven on these numbers; the correlations in (c) are not meaningful (a photo or synthetic stream does not turn its head).", ""]
    if not frames:
        L += ["No frames with a 16-value faceRt and a headVector; nothing to test.", ""]
        (folder / "headvector.md").write_text("\n".join(L) + "\n"); (folder / "headvector.json").write_text(json.dumps(out, indent=1) + "\n")
        print("no faceRt frames"); return

    # (a) translation indices.
    lay = [translation_layout(r["faceRt"]) for r in frames]
    t_cm = np.array([l["t_colmajor"] for l in lay]); t_rm = np.array([l["t_rowmajor"] for l in lay])
    a = {"translation_colmajor_median_cm": np.median(t_cm, axis=0).tolist(), "translation_rowmajor_median": np.median(t_rm, axis=0).tolist(),
         "abs_z_colmajor_range_cm": [float(np.abs(t_cm[:, 2]).min()), float(np.abs(t_cm[:, 2]).max())],
         "max_abs_of_indices_3_7_11": float(max(l["zeros_colmajor_hyp"] for l in lay)), "max_abs_of_indices_12_14": float(max(l["zeros_rowmajor_hyp"] for l in lay)),
         "index_15": float(np.median([l["last"] for l in lay])), "max_orthonormality_error": float(max(l["orthonormality_colmajor"] for l in lay)),
         "det_median": float(np.median([l["det_colmajor"] for l in lay]))}
    z_ok = 40 <= abs(a["translation_colmajor_median_cm"][2]) <= 90
    column_major = a["max_abs_of_indices_3_7_11"] < 1e-6 and abs(a["index_15"] - 1) < 1e-6 and a["max_abs_of_indices_12_14"] > 1e-3
    a["layout"] = "column-major" if column_major else ("row-major" if a["max_abs_of_indices_12_14"] < 1e-6 and a["max_abs_of_indices_3_7_11"] > 1e-3 else "undetermined")
    out["a_translation"] = a
    L += ["## (a) Which indices hold the translation", "",
          f"Over {len(frames)} frames with a face matrix: indices 12-14 (column-major hypothesis) median = ({', '.join(fmt(v, 2) for v in a['translation_colmajor_median_cm'])}) cm, |z| range {fmt(a['abs_z_colmajor_range_cm'][0], 1)}-{fmt(a['abs_z_colmajor_range_cm'][1], 1)} cm{' (within the expected 40-90 cm)' if z_ok else ' (outside 40-90 cm: MediaPipe\'s metric scale, or a synthetic matrix)'}; indices 3/7/11 (row-major hypothesis) median = ({', '.join(fmt(v, 4) for v in a['translation_rowmajor_median'])}), max |value| {a['max_abs_of_indices_3_7_11']:.1e}; index 15 = {fmt(a['index_15'], 3)}. The 3×3 block is the same nine numbers under both reads (transposed), so orthonormality cannot tell them apart: max |RᵀR − I| = {a['max_orthonormality_error']:.1e}, median det = {fmt(a['det_median'], 4)}. The [0 0 0 1] row lives at indices 3/7/11/15, so the layout is **{a['layout']}** and the translation is at 12-14.", ""]

    # (b) which read reproduces the recorded head vector.
    rec = np.array([r["headVector"] for r in frames], float)
    hv_rm = np.array([head_vector_from_face_rt(r["faceRt"], "row-major") for r in frames])
    hv_cm = np.array([head_vector_from_face_rt(r["faceRt"], "column-major") for r in frames])
    d_rm = np.abs(hv_rm - rec).max(axis=1); d_cm = np.abs(hv_cm - rec).max(axis=1)
    fwd = np.array([[r["faceRt"][8], r["faceRt"][9], -r["faceRt"][10]] for r in frames])  # third column, z negated
    b = {"max_abs_diff_rowmajor_read": float(d_rm.max()), "median_abs_diff_rowmajor_read": float(np.median(d_rm)), "max_abs_diff_colmajor_read": float(d_cm.max()),
         "median_abs_diff_colmajor_read": float(np.median(d_cm)), "max_abs_diff_colmajor_vs_forward_axis_zneg": float(np.abs(hv_cm - fwd).max()),
         "median_abs_component_diff_between_reads": float(np.median(np.abs(hv_cm - hv_rm), axis=0).max())}
    shipped_read = "row-major" if b["max_abs_diff_rowmajor_read"] < 1e-5 and b["max_abs_diff_rowmajor_read"] < b["max_abs_diff_colmajor_read"] else ("column-major" if b["max_abs_diff_colmajor_read"] < 1e-5 else "neither")
    b["shipped_read"] = shipped_read
    out["b_port"] = b
    L += ["## (b) Which read reproduces the recorded headVector", "",
          f"Port of translateMatrix → matrixToEuler → (−yaw, pitch, roll) → pyrToVector, applied to the raw faceRt. Row-major read (as shipped: M(i,j) = data[4i+j]): max |Δ| vs the recorded headVector = {b['max_abs_diff_rowmajor_read']:.2e} (median {b['median_abs_diff_rowmajor_read']:.2e}). Column-major read (M(i,j) = data[4j+i]): max |Δ| = {b['max_abs_diff_colmajor_read']:.2e} (median {b['median_abs_diff_colmajor_read']:.2e}). The shipped path used the **{shipped_read}** read. With the column-major read the head vector equals the face's forward axis (third column) with z negated to within {b['max_abs_diff_colmajor_vs_forward_axis_zneg']:.1e}; the two reads differ by a median {b['median_abs_component_diff_between_reads']:.3f} per component, i.e. the shipped vector is the third *row* of the rotation and carries yaw and pitch with the opposite sign (to first order).", ""]

    # (c) correlations with pose ratios and the geometric forward axis over the head-turn blocks.
    keys = [bl["key"] for bl in s.blocks if bl["id"] in HEAD_TURN_BLOCKS and s.usable(bl["key"])]
    scope = "B8-B11"
    if not keys:
        keys = [bl["key"] for bl in s.blocks if s.usable(bl["key"])]; scope = "all kept blocks (no head-turn block present)"
    rows = [r for k in keys for r in s.usable(k) if r.get("faceRt") and len(r["faceRt"]) == 16 and r.get("pose") and r.get("headVector")]
    c = {"scope": scope, "frames": len(rows), "blocks": keys}
    if rows:
        ang_rec = [head_vector_angles(r["headVector"]) for r in rows]
        ang_cor = [head_vector_angles(head_vector_from_face_rt(r["faceRt"], "column-major")) for r in rows]
        yaw_rec = [a[0] if a else np.nan for a in ang_rec]; pitch_rec = [a[1] if a else np.nan for a in ang_rec]
        yaw_cor = [a[0] if a else np.nan for a in ang_cor]; pitch_cor = [a[1] if a else np.nan for a in ang_cor]
        yaw_ratio = [r["pose"]["yawRatio"] for r in rows]; pitch_ratio = [r["pose"]["pitchRatio"] for r in rows]
        # Geometric forward: gaze.forward = [m8, −m9] (image axes, +y down); its yaw/pitch as head-position.ts defines them.
        fwd_yaw, fwd_pitch = [], []
        for r in rows:
            m = r["faceRt"]; n = math.hypot(m[8], m[9], m[10])
            fwd_yaw.append(math.degrees(math.atan2(m[8] / n, m[10] / n))); fwd_pitch.append(math.degrees(math.asin(max(-1, min(1, m[9] / n)))))
        table = {}
        for label, series in (("shipped (recorded headVector)", (yaw_rec, pitch_rec)), ("corrected (column-major read)", (yaw_cor, pitch_cor))):
            ry, ny = pearson(series[0], yaw_ratio); rp, np_ = pearson(series[1], pitch_ratio)
            fy, _ = pearson(series[0], fwd_yaw); fp, _ = pearson(series[1], fwd_pitch)
            table[label] = {"yaw_vs_pose_yawRatio_r": ry, "pitch_vs_pose_pitchRatio_r": rp, "yaw_vs_forward_yaw_r": fy, "pitch_vs_forward_pitch_r": fp, "n": ny,
                            "yaw_range_deg": [float(np.nanmin(series[0])), float(np.nanmax(series[0]))], "pitch_range_deg": [float(np.nanmin(series[1])), float(np.nanmax(series[1]))]}
        c["correlations"] = table
        c["pose_yawRatio_range"] = [float(min(yaw_ratio)), float(max(yaw_ratio))]; c["pose_pitchRatio_range"] = [float(min(pitch_ratio)), float(max(pitch_ratio))]
        sign = lambda v: "—" if not np.isfinite(v) else ("+" if v > 0 else "−")
        L += ["## (c) Sign agreement with pose ratios and the geometric forward axis", "",
              f"Scope: {scope}, {len(rows)} usable frames (record phase, face present, eyes open, final attempt). Head-vector yaw = atan2(x, −z), pitch = asin(y) in degrees; pose.yawRatio = nose offset toward image right in eye spans, pose.pitchRatio = nose offset toward image bottom (so a *negative* r with pitchRatio is the expected sign for a pitch-up-positive angle); forward yaw/pitch from the face matrix's third column as head-position.ts reads it (+yaw toward image right, +pitch up). Pose yawRatio range {fmt(c['pose_yawRatio_range'][0], 3)}…{fmt(c['pose_yawRatio_range'][1], 3)}, pitchRatio range {fmt(c['pose_pitchRatio_range'][0], 3)}…{fmt(c['pose_pitchRatio_range'][1], 3)}; a range narrower than ~0.05 means nobody turned their head and r is noise.", "",
              "| head vector | yaw range (°) | r(yaw, pose.yawRatio) | r(pitch, pose.pitchRatio) | r(yaw, forward yaw) | r(pitch, forward pitch) | n |", "|---|---|---|---|---|---|---|"]
        for label, v in table.items():
            L.append(f"| {label} | {fmt(v['yaw_range_deg'][0], 1)}…{fmt(v['yaw_range_deg'][1], 1)} | {fmt(v['yaw_vs_pose_yawRatio_r'], 3)} ({sign(v['yaw_vs_pose_yawRatio_r'])}) | {fmt(v['pitch_vs_pose_pitchRatio_r'], 3)} ({sign(v['pitch_vs_pose_pitchRatio_r'])}) | {fmt(v['yaw_vs_forward_yaw_r'], 3)} ({sign(v['yaw_vs_forward_yaw_r'])}) | {fmt(v['pitch_vs_forward_pitch_r'], 3)} ({sign(v['pitch_vs_forward_pitch_r'])}) | {v['n']} |")
        L.append("")
        L.append("Expected on a real head turn: the corrected vector correlates positively with pose.yawRatio and forward yaw and negatively with pose.pitchRatio (positively with forward pitch); the shipped vector shows the opposite signs.")
        L.append("")
    else:
        L += ["## (c) Sign agreement", "", "No usable frames with pose and face matrix in scope.", ""]
    out["c_correlations"] = c

    # (d) verdict.
    layout_part = f"faceRt is {a['layout']} (translation at 12-14, |z| median {fmt(abs(a['translation_colmajor_median_cm'][2]), 1)} cm)"
    if shipped_read == "row-major":
        verdict = f"{layout_part}; the recorded headVector is reproduced by the row-major read (max |Δ| {b['max_abs_diff_rowmajor_read']:.1e}), so the shipped head vector is the rotation's third row and flips the sign of yaw and pitch relative to the face's forward axis"
    elif shipped_read == "column-major":
        verdict = f"{layout_part}; the recorded headVector is reproduced by the column-major read (max |Δ| {b['max_abs_diff_colmajor_read']:.1e}), i.e. it is the face's forward axis with z negated"
    else:
        verdict = f"{layout_part}; the recorded headVector matches neither read (row-major max |Δ| {b['max_abs_diff_rowmajor_read']:.1e}, column-major {b['max_abs_diff_colmajor_read']:.1e}) — a synthetic stream that builds its own vector, not the worker's getHeadVector"
    verdict += "; correlations are not meaningful on a synthetic session." if synthetic else "."
    out["verdict"] = verdict
    L += ["## (d) Verdict", "", verdict, ""]
    (folder / "headvector.md").write_text("\n".join(L) + "\n")
    (folder / "headvector.json").write_text(json.dumps(out, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else str(o)) + "\n")
    print(f"wrote {folder / 'headvector.md'}, headvector.json · {verdict}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
