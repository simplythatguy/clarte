"""Unit tests for the pure parts of analysis/rows.py, headvector.py and measurements.py.

Run: .venv/bin/python -I -m unittest discover -s analysis/tests -p "test_*.py"
"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import headvector as hv  # noqa: E402
import rows  # noqa: E402
from measurements import head_difference, near, reference_pose  # noqa: E402


class RowsTests(unittest.TestCase):
    def test_row_of_ny_and_columns(self):
        self.assertEqual(rows.row_of_ny(-0.25), "top"); self.assertEqual(rows.row_of_ny(0.4), "bottom"); self.assertIsNone(rows.row_of_ny(0))
        b = rows.column_boundaries(1280)
        self.assertEqual(b, [320, 640, 960])
        self.assertEqual([rows.column_of_x(x, b) for x in (10, 500, 700, 1200)], [0, 1, 2, 3])
        # A personal column map (estimated x = 800·nx + 640) moves the boundaries with the fitted line.
        self.assertEqual(rows.column_boundaries(1280, (800, 640)), [440, 640, 840])

    def test_lda_and_logistic_boundaries(self):
        rng = np.random.default_rng(1)
        top = rng.normal(200, 30, 200); bottom = rng.normal(600, 30, 200)
        self.assertAlmostEqual(rows.midpoint_boundary(top, bottom), (top.mean() + bottom.mean()) / 2)
        self.assertAlmostEqual(rows.lda_boundary(top, bottom), (top.mean() + bottom.mean()) / 2, places=6)  # equal priors → midpoint
        # Unequal priors shift the LDA boundary toward the rarer class.
        shifted = rows.lda_boundary(top, bottom[:50])
        self.assertGreater(shifted, (top.mean() + bottom[:50].mean()) / 2)
        logistic = rows.logistic_boundary(np.concatenate([top, bottom]), [0] * 200 + [1] * 200)
        self.assertAlmostEqual(logistic, 400, delta=15)
        self.assertTrue(math.isnan(rows.lda_boundary([1], [2, 3])))
        d = rows.dprime(top, bottom)
        self.assertAlmostEqual(d, 400 / 30, delta=1.5)

    def test_boundary_tracker_follows_a_drift(self):
        # Stream alternating between two rows; after 30 s the rows shift down by 150 px: the boundary must follow and the
        # decisions stay right, with no decision inside the dead zone.
        tracker = rows.BoundaryTracker(200, 600)
        t, correct, total = 0.0, 0, 0
        for i in range(2400):  # 30 fps × 80 s
            t = i / 30
            shift = 150 if t >= 30 else 0
            row = "top" if (int(t) // 2) % 2 == 0 else "bottom"  # look at a row for 2 s at a time
            y = (200 if row == "top" else 600) + shift + np.random.default_rng(i).normal(0, 20)
            decision, boundary, _ = tracker.update(t, y)
            if t > 50:
                total += 1; correct += decision == row
        self.assertGreater(tracker.boundary, 500)  # 400 → ~550 after the shift
        self.assertLess(tracker.boundary, 600)
        self.assertGreater(correct / total, 0.9)
        self.assertAlmostEqual(tracker.dead_zone, 0.1 * (tracker.means[1] - tracker.means[0]))

    def test_tracker_dead_zone_keeps_previous_decision(self):
        tracker = rows.BoundaryTracker(200, 600)  # samples 1 s apart so the 400 ms median sees one value at a time
        self.assertEqual(tracker.update(0.0, 100)[0], "top")
        self.assertEqual(tracker.update(1.0, 400)[0], "top")  # inside ±40 px of 400: no change
        self.assertEqual(tracker.update(2.0, 700)[0], "bottom")
        # Integration: within 400 ms the median of [700, 100] is 400 → inside the dead zone → the decision holds.
        self.assertEqual(tracker.update(2.2, 100)[0], "bottom")

    def test_recovery_time(self):
        times = [i / 10 for i in range(60)]
        correct = [False] * 20 + [True] * 40  # wrong for 2 s, then right
        self.assertAlmostEqual(rows.recovery_time(times, correct, 0.0), 3.9, delta=0.15)  # 2 s window must be >90 % right
        self.assertIsNone(rows.recovery_time(times, [False] * 60, 0.0))
        self.assertIsNone(rows.recovery_time(times[:5], [True] * 5, 0.0))  # window never spans the horizon

    def test_row_accuracy(self):
        acc, n = rows.row_accuracy([100, 700, 100, 700], ["top", "bottom", "bottom", None], 400)
        self.assertEqual((acc, n), (2 / 3, 3))


class HeadVectorTests(unittest.TestCase):
    def test_euler_roundtrip_and_head_vector_on_known_rotation(self):
        # eulerToMatrix(pitch, yaw, roll) = Rz(roll)·Ry(yaw)·Rx(pitch), but matrixToEuler names the rotation about y
        # "pitch" and the rotation about x "yaw" (asin(−m20), atan2(m21, m22)): the upstream pair is not inverse, it
        # swaps the first two names, which is why getHeadVector maps (pitch, yaw) → (−yaw, pitch). The port keeps that.
        for p, y, r in ((10, -20, 5), (-7, 33, -12), (0, 0, 0)):
            self.assertTrue(np.allclose(hv.matrix_to_euler(hv.euler_to_matrix(p, y, r)), (y, p, r), atol=1e-9))
        # getHeadVector on a pure yaw about y by +20°: pitch = asin(−R[2,0]) = 20°, yaw = roll = 0 → h = (−0, 20°, 0) → x = sin 20°, z = −cos 20°.
        R = hv.euler_to_matrix(0, 20, 0)
        M = np.eye(4); M[:3, :3] = R
        v = hv.get_head_vector(M)
        self.assertTrue(np.allclose(v, [math.sin(math.radians(20)), 0, -math.cos(math.radians(20))], atol=1e-12))
        self.assertAlmostEqual(np.linalg.norm(v), 1.0)
        # Pitch about x by +10° (chin up in camera coords, y up): matrixToEuler yaw = atan2(R[2,1], R[2,2]) = 10° → h_pitch = −10° → y = −sin 10°.
        R = hv.euler_to_matrix(10, 0, 0); M = np.eye(4); M[:3, :3] = R
        self.assertAlmostEqual(hv.get_head_vector(M)[1], -math.sin(math.radians(10)), places=12)

    def test_translation_indices_on_a_known_column_major_matrix(self):
        R = hv.euler_to_matrix(5, -15, 2)
        t = np.array([1.5, 18.0, -64.0])
        M = np.eye(4); M[:3, :3] = R; M[:3, 3] = t
        data = M.T.reshape(-1)  # column-major flattening, as MediaPipe delivers it
        lay = hv.translation_layout(data)
        self.assertTrue(np.allclose(lay["t_colmajor"], t))
        self.assertEqual(lay["zeros_colmajor_hyp"], 0.0); self.assertEqual(lay["last"], 1.0)
        self.assertGreater(lay["zeros_rowmajor_hyp"], 1.0)
        self.assertLess(lay["orthonormality_colmajor"], 1e-12)
        # The column-major read recovers R; the row-major read (as shipped) gives Rᵀ.
        self.assertTrue(np.allclose(hv.translate_matrix(data, read="column-major")[:3, :3], R))
        self.assertTrue(np.allclose(hv.translate_matrix(data, read="row-major")[:3, :3], R.T))
        # With the column-major read the head vector is the forward axis (third column) with z negated.
        fwd = R[:, 2]
        self.assertTrue(np.allclose(hv.head_vector_from_face_rt(data, "column-major"), [fwd[0], fwd[1], -fwd[2]], atol=1e-9))
        # The shipped row-major read on a pure yaw flips the sign of x relative to the forward axis.
        Ry = hv.euler_to_matrix(0, 20, 0); My = np.eye(4); My[:3, :3] = Ry
        rm = hv.head_vector_from_face_rt(My.T.reshape(-1), "row-major"); cm = hv.head_vector_from_face_rt(My.T.reshape(-1), "column-major")
        self.assertAlmostEqual(rm[0], -cm[0], places=12)

    def test_head_vector_angles(self):
        yaw, pitch = hv.head_vector_angles([math.sin(math.radians(15)), 0, -math.cos(math.radians(15))])
        self.assertAlmostEqual(yaw, 15); self.assertAlmostEqual(pitch, 0)
        self.assertIsNone(hv.head_vector_angles([0, 0, 0]))


class GateTests(unittest.TestCase):
    def test_head_difference_and_near(self):
        ref = {"centerX": .5, "centerY": .3, "span": .1, "roll": 0.0, "yawRatio": 0.0, "pitchRatio": 0.4}
        same = dict(ref)
        self.assertTrue(near(same, ref))
        moved = {**ref, "centerX": .5 + .13 * .1}  # 0.13 spans > 0.12
        self.assertFalse(near(moved, ref)); self.assertAlmostEqual(head_difference(moved, ref)["x"], .13)
        turned = {**ref, "yawRatio": .11}
        self.assertFalse(near(turned, ref)); self.assertTrue(near({**ref, "yawRatio": .09}, ref))
        wrapped = {**ref, "roll": math.pi - .01}
        self.assertAlmostEqual(abs(head_difference({**ref, "roll": -math.pi + .01}, wrapped)["roll"]), .02, places=9)
        r = reference_pose([{**ref, "roll": .1}, {**ref, "roll": -.1}])
        self.assertAlmostEqual(r["roll"], 0.0); self.assertAlmostEqual(r["span"], .1)


if __name__ == "__main__":
    unittest.main()
