"""Simple-mode (default `/`) session: hit rate on the 8 navigation quadrants, candidate vs baseline.

Usage: .venv/bin/python -I analysis/quadrants.py sessions/<id>

Session: `mode: simple` in session.json. Calibration = Q8 (8 quadrant-centre dots, ~20 s) trained twice on the same frames:
  candidate = shadow worker, pose rows frozen, limits 200/24/8, geometric share of the blend capped at 0.2 (`quick.*` on every row)
  baseline  = primary worker, same limits, shipped training and shipped blend rule (`rawNormPog` / `network` on every row)
Trials: `rounds` × 8, one quadrant highlighted with a dot at its centre, 0.9 s settle, 1.5 s record (then 0.4 s feedback).
Frames: record-phase frames of a trial's final attempt with a face present and eyes open, exactly the app's filter; px = CSS px of
the recorded viewport. Decision per trial and stream: the per-axis median of the usable frames' estimates, then the quadrant whose
rectangle contains it (a point in a gap or margin selects the nearest rectangle), as the app decides. Streams: candidate blend,
candidate network, baseline blend, baseline network. Row = top/bottom, column = 1..4 of the decided quadrant.
Paired difference = candidate − baseline hit per trial (same kind of stream), mean with a 95 % bootstrap interval over trials
(5000 resamples, seed 7). Two-row variant: top/bottom by the person's own boundary (midpoint of the mean estimated y over the
top-row and the bottom-row calibration frames of the same stream; both workers were untrained then, so the pretrained head's
estimate is what exists), combined with the nearest column of the quadrant decision; a second boundary from the test frames'
own row means is listed as an optimistic reference. Head displacement = median |faceOrigin3D − calibration pose| (cm) over the
trial's usable frames, with the calibration pose the median faceOrigin3D over the Q8 label frames; hit rate per displacement bin.
Writes quadrants.md, quadrants.json and quadrants.png (hit rate per quadrant, candidate and baseline) into the session folder.

Free-look sessions (`settings.test: free`, the default since 2026-11-07) have no target, so no hit rate: the person looked where
they liked and a 2 s dwell on the candidate's live quadrant selected it. For those the script lists the selections (quadrant,
time, dwell, how long the green border took to appear, head displacement over the dwell, and what each stream's median over the
dwell would have chosen), how long the blue mark sat on each quadrant, and how often it moved; quadrants.md and quadrants.json only.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

N_BOOT = 5000
STREAMS = {
    "candidate blend": lambda r: (r.get("quick") or {}).get("rawNormPog"),
    "candidate network": lambda r: (r.get("quick") or {}).get("network"),
    "baseline blend": lambda r: r.get("rawNormPog"),
    "baseline network": lambda r: r.get("network"),
}
PAIRS = [("candidate blend", "baseline blend"), ("candidate network", "baseline network")]
BINS = [(0, 1), (1, 2), (2, 4), (4, 8), (8, float("inf"))]


def finite2(p):
    return isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def rect_distance(p, r):
    dx = max(0.0, r["x"] - p[0], p[0] - (r["x"] + r["width"]))
    dy = max(0.0, r["y"] - p[1], p[1] - (r["y"] + r["height"]))
    return math.hypot(dx, dy)


def nearest_quadrant(p, quadrants):
    best, best_d = quadrants[0]["id"], float("inf")
    for q in quadrants:
        d = rect_distance(p, q["rect"])
        if d < best_d:
            best, best_d = q["id"], d
    return best


def usable(r):
    return r.get("phase") == "record" and r.get("facePresent") and r.get("eyeState") == "open"


def boot_mean(d, rng):
    d = np.asarray([x for x in d if x is not None], float)
    if d.size < 2:
        return {"mean": float(d.mean()) if d.size else None, "lo": None, "hi": None, "n": int(d.size)}
    idx = rng.integers(0, d.size, size=(N_BOOT, d.size))
    means = d[idx].mean(axis=1)
    return {"mean": float(d.mean()), "lo": float(np.percentile(means, 2.5)), "hi": float(np.percentile(means, 97.5)), "n": int(d.size)}


def pct(v):
    return "—" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{math.floor(100 * v + .5)} %"  # round half up, as the app does


def pp(b):
    if not b or b["mean"] is None:
        return "—"
    if b["lo"] is None:
        return f"{100 * b['mean']:+.0f} pp (n={b['n']})"
    return f"{100 * b['mean']:+.0f} [{100 * b['lo']:+.0f}, {100 * b['hi']:+.0f}] pp (n={b['n']})"


def call(b):
    if not b or b.get("lo") is None:
        return "no call"
    return "candidate better" if b["lo"] > 0 else "candidate worse" if b["hi"] < 0 else "no call"


def main(folder: Path):
    session = json.loads((folder / "session.json").read_text())
    if session.get("mode") != "simple":
        print("not a simple-mode session (open http://127.0.0.1:4330/ without ?mode=research)")
        return
    rows = [json.loads(l) for l in (folder / "frames.jsonl").read_text().splitlines() if l.strip()]
    if (session.get("settings") or {}).get("test") == "free":
        free_look(folder, session, rows)
        return
    w, h = session["viewport"]["width"], session["viewport"]["height"]
    cm = (session.get("screen") or {}).get("cmPerCssPx")
    quadrants = sorted(session["quadrants"], key=lambda q: q["id"])
    to_px = lambda p: (float((p[0] + .5) * w), float((p[1] + .5) * h))  # noqa: E731
    trials = sorted(session["trials"], key=lambda t: t["index"])
    cal = session.get("calibration") or {}
    rng = np.random.default_rng(7)

    # Calibration frames: Q8 label rows, with the pretrained estimates of each stream and the head pose.
    label_rows = [r for r in rows if r.get("block") == "Q8" and r.get("phase") == "quick:label" and r.get("facePresent") and r.get("eyeState") == "open"]
    origins = np.array([r["faceOrigin3D"] for r in label_rows if r.get("faceOrigin3D") and len(r["faceOrigin3D"]) == 3], float)
    pose = np.median(origins, axis=0) if len(origins) else None
    cal_boundary = {}
    for name, get in STREAMS.items():
        ys = {"top": [], "bottom": []}
        for r in label_rows:
            p = get(r)
            if finite2(p) and r.get("target"):
                ys["top" if r["target"]["y"] < h / 2 else "bottom"].append(to_px(p)[1])
        cal_boundary[name] = (float(np.mean(ys["top"])) + float(np.mean(ys["bottom"]))) / 2 if ys["top"] and ys["bottom"] else None

    # Per trial: usable frames of the final attempt, per-stream median and decision.
    by_trial = {}
    for r in rows:
        t = r.get("trial")
        if r.get("screen") == "test" and t and usable(r):
            by_trial.setdefault(t["index"], []).append(r)
    per_trial = []
    for t in trials:
        frs = [r for r in by_trial.get(t["index"], []) if r["trial"]["attempt"] == t.get("attempts", 1)]
        q = quadrants[t["quadrant"]]
        est, dec = {}, {}
        for name, get in STREAMS.items():
            pts = [to_px(p) for p in (get(r) for r in frs) if finite2(p)]
            if pts:
                m = np.median(np.array(pts), axis=0)
                est[name] = [float(m[0]), float(m[1])]
                dec[name] = nearest_quadrant(m, quadrants)
            else:
                est[name], dec[name] = None, None
        disp = None
        if pose is not None:
            ds = [float(np.linalg.norm(np.array(r["faceOrigin3D"]) - pose)) for r in frs if r.get("faceOrigin3D") and len(r["faceOrigin3D"]) == 3]
            disp = float(np.median(ds)) if ds else None
        per_trial.append({"index": t["index"], "round": t["round"], "quadrant": t["quadrant"], "row": q["row"], "column": q["column"], "attempts": t.get("attempts"),
                          "frames": len(frs), "estimate": est, "decision": dec, "hit": {n: (None if d is None else d == t["quadrant"]) for n, d in dec.items()},
                          "displacementCm": disp, "shown": t.get("shown"), "appDecision": t.get("decision")})

    def rate(values):
        v = [x for x in values if x is not None]
        return (sum(v) / len(v)) if v else None

    overall, per_quadrant, rows_cols = {}, {}, {}
    for name in STREAMS:
        hits = [t["hit"][name] for t in per_trial]
        row_ok = [None if t["decision"][name] is None else quadrants[t["decision"][name]]["row"] == t["row"] for t in per_trial]
        col_ok = [None if t["decision"][name] is None else quadrants[t["decision"][name]]["column"] == t["column"] for t in per_trial]
        overall[name] = {"hit": rate(hits), "decided": sum(1 for x in hits if x is not None), "trials": len(per_trial), "row": rate(row_ok), "column": rate(col_ok)}
        rows_cols[name] = {"row": rate(row_ok), "column": rate(col_ok)}
        per_quadrant[name] = [rate([t["hit"][name] for t in per_trial if t["quadrant"] == q["id"]]) for q in quadrants]

    paired = {}
    for a, b in PAIRS:
        d = [(float(t["hit"][a]) - float(t["hit"][b])) for t in per_trial if t["hit"][a] is not None and t["hit"][b] is not None]
        paired[f"{a} − {b}"] = boot_mean(d, rng)

    # Two-row variant: row by a personal y boundary, column from the quadrant decision.
    def two_row(name, boundary):
        hits = []
        for t in per_trial:
            e = t["estimate"][name]
            if e is None or boundary is None:
                hits.append(None)
                continue
            row = 1 if e[1] >= boundary else 0
            col = quadrants[t["decision"][name]]["column"]
            hits.append(row * 4 + col == t["quadrant"])
        return rate(hits), hits
    test_boundary = {}
    for name in STREAMS:
        top = [t["estimate"][name][1] for t in per_trial if t["estimate"][name] and t["row"] == 0]
        bottom = [t["estimate"][name][1] for t in per_trial if t["estimate"][name] and t["row"] == 1]
        test_boundary[name] = (float(np.mean(top)) + float(np.mean(bottom))) / 2 if top and bottom else None
    two_rows = {name: {"calibrationBoundaryPx": cal_boundary[name], "hitCalibrationBoundary": two_row(name, cal_boundary[name])[0],
                       "testBoundaryPx": test_boundary[name], "hitTestBoundary": two_row(name, test_boundary[name])[0], "fixedMidlinePx": h / 2, "hitFixedMidline": two_row(name, h / 2)[0]} for name in STREAMS}
    two_row_paired = {}
    for a, b in PAIRS:
        ha, hb = two_row(a, cal_boundary[a])[1], two_row(b, cal_boundary[b])[1]
        two_row_paired[f"{a} − {b}"] = boot_mean([float(x) - float(y) for x, y in zip(ha, hb) if x is not None and y is not None], rng)

    bins = []
    for lo, hi in BINS:
        sel = [t for t in per_trial if t["displacementCm"] is not None and lo <= t["displacementCm"] < hi]
        bins.append({"bin": f"{lo}–{hi if hi != float('inf') else '∞'} cm", "trials": len(sel), **{name: rate([t["hit"][name] for t in sel]) for name in STREAMS}})

    result = session.get("result") or {}
    cand, base = cal.get("candidate") or {}, cal.get("baseline") or {}
    out = {"session": folder.name, "tester": session.get("tester"), "viewport": [w, h], "cmPerCssPx": cm, "rounds": session.get("settings", {}).get("rounds"), "feedback": session.get("settings", {}).get("feedback"),
           "calibration": {"wallMs": cal.get("wallMs"), "labels": cal.get("labels"), "pauses": cal.get("pauses"), "calibrationPoseCm": pose.tolist() if pose is not None else None,
                           "candidate": {"init": cand.get("init"), "trainingReport": cand.get("trainingReport"), "error": cand.get("error")},
                           "baseline": {"init": base.get("init"), "trainingReport": base.get("trainingReport"), "error": base.get("error")}},
           "appResult": result, "overall": overall, "perQuadrant": per_quadrant, "paired": paired, "twoRow": two_rows, "twoRowPaired": two_row_paired, "displacementBins": bins, "trials": per_trial}

    L = [f"# Quadrant test · {folder.name}", "",
         f"Tester: {session.get('tester', '?')}. Viewport {w}×{h} CSS px" + (f", {cm:.4f} cm per px" if cm else "") + f". {len(per_trial)} trials ({session.get('settings', {}).get('rounds')} rounds × 8 quadrants), "
         f"feedback {'on' if session.get('settings', {}).get('feedback') else 'off'}. Frames: record-phase frames of each trial's final attempt with a face present and eyes open. Decision: the quadrant "
         "containing (or nearest to) the per-axis median of the frames' estimates, as the app decides. Hit = decided quadrant is the highlighted one; row = top/bottom right; column = one of four right. "
         f"Paired Δ = candidate − baseline hit per trial, mean with a 95 % bootstrap interval over trials ({N_BOOT} resamples).", "",
         "## Calibration (Q8, both models on the same frames)", "",
         "| model | worker | labels | network held-out MSE before → after (best/steps) | geometric held-out | blend share | error |", "|---|---|---|---|---|---|---|"]
    for label, m, flags in [("candidate", cand, "pose rows frozen, limits 200/24/8, geometric share ≤ 0.2"), ("baseline", base, "limits 200/24/8, shipped training, shipped blend rule")]:
        rep = m.get("trainingReport") or {}
        g = rep.get("geometric") or {}
        L.append(f"| {label} | {flags} | {rep.get('samples', '—')} | {rep.get('heldOutBefore', float('nan')):.4f} → {rep.get('heldOutAfter', float('nan')):.4f} ({rep.get('bestStep', '—')}/{rep.get('stepsUsed', '—')}) | "
                 f"{'—' if g.get('heldOutMse') is None else f'{g['heldOutMse']:.4f}'} | {'—' if not isinstance(g.get('weight'), (int, float)) else f'{g['weight']:.2f}'} | {m.get('error') or '—'} |")
    wall = cal.get("wallMs")
    L += ["", f"Calibration wall time (intro → both trained): {'—' if wall is None else f'{wall / 1000:.1f} s'}; labels accepted: candidate {cal.get('labels', {}).get('candidate')}, baseline {cal.get('labels', {}).get('baseline')}"
          + (f"; calibration pose (median faceOrigin3D) x {pose[0]:+.1f} y {pose[1]:+.1f} z {pose[2]:.1f} cm" if pose is not None else "") + ".", "",
          "## Hit rate", "", "| stream | hit | row | column | decided / trials |", "|---|---|---|---|---|"]
    for name, o in overall.items():
        L.append(f"| {name} | {pct(o['hit'])} | {pct(o['row'])} | {pct(o['column'])} | {o['decided']} / {o['trials']} |")
    L += ["", "Per quadrant (row-major, top row first):", ""]
    for name in STREAMS:
        pq = per_quadrant[name]
        L.append(f"- {name}: " + " · ".join(f"Q{i + 1} {pct(v)}" for i, v in enumerate(pq)))
    L += ["", "## Paired candidate − baseline", ""]
    for k, b in paired.items():
        L.append(f"- {k}: {pp(b)} → **{call(b)}**")
    L += ["", "## Two-row variant (row by the person's own boundary, column from the quadrant decision)", "",
          "| stream | boundary from calibration frames (px) | hit | boundary from test frames (px, optimistic) | hit | fixed midline hit |", "|---|---|---|---|---|---|"]
    for name, t in two_rows.items():
        L.append(f"| {name} | {'—' if t['calibrationBoundaryPx'] is None else f'{t['calibrationBoundaryPx']:.0f}'} | {pct(t['hitCalibrationBoundary'])} | {'—' if t['testBoundaryPx'] is None else f'{t['testBoundaryPx']:.0f}'} | {pct(t['hitTestBoundary'])} | {pct(t['hitFixedMidline'])} |")
    L.append("")
    for k, b in two_row_paired.items():
        L.append(f"- Two-row, calibration boundary, {k}: {pp(b)} → **{call(b)}**")
    L += ["", "The calibration-frame boundary uses the pretrained head's estimates (both workers were untrained during Q8), so it is a boundary of the untrained model; "
          "the test-frame boundary uses the trained streams on the test frames themselves and is therefore optimistic.", "",
          "## Hit rate vs head displacement from the calibration pose", "", "| displacement | trials | " + " | ".join(STREAMS) + " |", "|---|---|" + "---|" * len(STREAMS)]
    for b in bins:
        L.append(f"| {b['bin']} | {b['trials']} | " + " | ".join(pct(b[name]) for name in STREAMS) + " |")
    L += ["", "## Per trial", "", "| # | round | target | frames | " + " | ".join(f"{n} → hit" for n in STREAMS) + " | displacement cm | app showed |", "|---|---|---|---|" + "---|" * len(STREAMS) + "---|---|"]
    for t in per_trial:
        cells = " | ".join(f"{'—' if t['decision'][n] is None else 'Q' + str(t['decision'][n] + 1)} {'' if t['hit'][n] is None else ('✓' if t['hit'][n] else '✗')}" for n in STREAMS)
        shown = t.get("shown") or {}
        L.append(f"| {t['index'] + 1} | {t['round']} | Q{t['quadrant'] + 1} | {t['frames']} | {cells} | {'—' if t['displacementCm'] is None else f'{t['displacementCm']:.1f}'} | "
                 f"{'—' if shown.get('quadrant') is None else 'Q' + str(shown['quadrant'] + 1) + (' ✓' if shown.get('correct') else ' ✗')} |")
    L += ["", f"App result (candidate blend, live): {result.get('correct', '—')}/{result.get('total', '—')}.", ""]
    (folder / "quadrants.md").write_text("\n".join(L) + "\n")

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
    (folder / "quadrants.json").write_text(json.dumps(clean(out), indent=1))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(1, 2, figsize=(10, 3.6))
        for ax, name in zip(axes, ["candidate blend", "baseline blend"]):
            grid = np.array([[np.nan if v is None else v for v in per_quadrant[name][r * 4:(r + 1) * 4]] for r in range(2)], float)
            im = ax.imshow(grid, vmin=0, vmax=1, cmap="Blues")
            for r in range(2):
                for c in range(4):
                    v = grid[r, c]
                    ax.text(c, r, "—" if np.isnan(v) else pct(v), ha="center", va="center", color="#1b1b1b" if np.isnan(v) or v < .6 else "white", fontsize=11)
            ax.set_xticks(range(4)); ax.set_xticklabels([f"col {i + 1}" for i in range(4)]); ax.set_yticks([0, 1]); ax.set_yticklabels(["top", "bottom"])
            o = overall[name]
            ax.set_title(f"{name} · hit {pct(o['hit'])} ({o['decided']} trials)", fontsize=10)
        fig.colorbar(im, ax=axes, fraction=.025, pad=.02, label="hit rate")
        fig.suptitle(f"Quadrant hit rate · {session.get('tester', '')} · calibration {'—' if wall is None else f'{wall / 1000:.0f} s'}", fontsize=10)
        fig.savefig(folder / "quadrants.png", dpi=130, bbox_inches="tight")
    except Exception as e:  # plotting is optional
        print("plot skipped:", e)
    print("wrote", folder / "quadrants.md", folder / "quadrants.json", folder / "quadrants.png")
    print(" · ".join(f"{name} {pct(o['hit'])}" for name, o in overall.items()))


def free_look(folder: Path, session, rows):
    w, h = session["viewport"]["width"], session["viewport"]["height"]
    quadrants = sorted(session["quadrants"], key=lambda q: q["id"])
    free = session.get("free") or {}
    selections = free.get("selections") or []
    to_px = lambda p: (float((p[0] + .5) * w), float((p[1] + .5) * h))  # noqa: E731
    name = lambda q: "—" if q is None else f"Q{q + 1} ({'top' if q < 4 else 'bottom'} {q % 4 + 1})"  # noqa: E731
    label_rows = [r for r in rows if r.get("block") == "Q8" and r.get("phase") == "quick:label" and r.get("faceOrigin3D") and len(r["faceOrigin3D"]) == 3]
    pose = np.median(np.array([r["faceOrigin3D"] for r in label_rows], float), axis=0) if label_rows else None
    look = [r for r in rows if r.get("block") == "F" and r.get("phase") != "paused"]
    ok = lambda r: r.get("facePresent") and r.get("eyeState") == "open"  # noqa: E731
    per_selection = []
    for i, sel in enumerate(selections):
        window = [r for r in look if sel["dwellStartedAt"] <= r["t"] <= sel["at"] and ok(r)]
        decided = {}
        for stream, get in STREAMS.items():
            pts = [to_px(get(r)) for r in window if finite2(get(r))]
            decided[stream] = nearest_quadrant((float(np.median([p[0] for p in pts])), float(np.median([p[1] for p in pts]))), quadrants) if pts else None
        moved = [float(np.linalg.norm(np.array(r["faceOrigin3D"], float) - pose)) for r in window if pose is not None and r.get("faceOrigin3D") and len(r["faceOrigin3D"]) == 3]
        per_selection.append({"index": i, "quadrant": sel["quadrant"], "seconds": (sel["at"] - free["startedAt"]) / 1000 if free.get("startedAt") is not None else None,
                              "dwellMs": sel["at"] - sel["dwellStartedAt"], "shownAfterMs": sel["shownAt"] - sel["at"], "frames": len(window),
                              "headDisplacementCm": float(np.median(moved)) if moved else None, "streams": decided})
    durations = {q["id"]: 0.0 for q in quadrants}
    durations[None] = 0.0
    changes = 0
    for a, b in zip(look, look[1:]):
        if b["t"] - a["t"] < 1000:  # a pause or a stall is not time on a quadrant
            durations[a.get("point")] = durations.get(a.get("point"), 0.0) + (b["t"] - a["t"]) / 1000
        if a.get("point") != b.get("point"):
            changes += 1
    total = sum(durations.values())
    usable = sum(1 for r in look if ok(r))
    out = {"session": session.get("id"), "test": "free", "dwell": free.get("dwell"), "dwellAtStart": free.get("dwellAtStart"), "toggles": free.get("toggles"), "pauses": free.get("pauses"), "frames": len(look), "usableFrames": usable,
           "lookSeconds": total, "markSeconds": {name(k): v for k, v in durations.items()}, "markChanges": changes,
           "agreement": {stream: (sum(1 for s in per_selection if s["streams"][stream] == s["quadrant"]) / len(per_selection) if per_selection else None) for stream in STREAMS},
           "selections": per_selection, "appResult": session.get("result")}
    L = [f"# Free look · {session.get('id')}", "",
         f"Tester: {session.get('tester', '?')}. Viewport {w}×{h} CSS px. {len(selections)} selections over {total:.0f} s of looking ({free.get('pauses', 0)} pauses); "
         f"{usable} of {len(look)} frames usable (face, eyes open). The blue mark moved {changes} times. Dwell rules: {json.dumps(free.get('dwell'))}; "
         f"dwell {'on' if free.get('dwellAtStart', True) else 'off'} at the start, switched {len(free.get('toggles') or [])} times (rows with phase `look` had dwell off).", "",
         "No target in free look, so no hit rate: each row is what the app selected; the stream columns say which quadrant the median of that stream over the dwell would have chosen.", "",
         "| # | selected | at | dwell | border after | head moved | " + " | ".join(STREAMS) + " |", "|---|---|---|---|---|---|" + "---|" * len(STREAMS)]
    for row in per_selection:
        at = "—" if row["seconds"] is None else f"{row['seconds']:.1f} s"
        head = "—" if row["headDisplacementCm"] is None else f"{row['headDisplacementCm']:.1f} cm"
        L.append(f"| {row['index'] + 1} | {name(row['quadrant'])} | {at} | {row['dwellMs']:.0f} ms | {row['shownAfterMs']:.0f} ms | {head} | "
                 + " | ".join(name(row["streams"][stream]) for stream in STREAMS) + " |")
    L += ["", "## Where the blue mark sat", "", "| quadrant | seconds | share |", "|---|---|---|"]
    for k, v in durations.items():
        L.append(f"| {name(k)} | {v:.1f} | {pct(v / total if total else None)} |")
    (folder / "quadrants.md").write_text("\n".join(L) + "\n")
    (folder / "quadrants.json").write_text(json.dumps(out, indent=1, default=lambda o: o.item() if isinstance(o, np.generic) else None))
    print("wrote", folder / "quadrants.md", folder / "quadrants.json")
    print(f"free look: {len(selections)} selections, {total:.0f} s, mark moved {changes} times")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
