import numpy as np
import pytest

from geometry import ACTUATOR_LENGTH_M, compute_spine_curvature

PPM = 100.0  # pixels per metre for synthetic masks


def _mask_from_points(u, v, shape=(600, 600)):
    mask = np.zeros(shape, dtype=np.uint8)
    u = np.clip(np.round(u).astype(int), 0, shape[1] - 1)
    v = np.clip(np.round(v).astype(int), 0, shape[0] - 1)
    mask[v, u] = 255
    return mask


def _straight_line_mask(n=200, spacing=1.0):
    v = np.arange(n) * spacing
    u = np.full(n, 300.0)
    return _mask_from_points(u, v)


def _arc_mask(radius_px=300.0, arc_deg=60.0, n=None, shape=(600, 600)):
    """A single circular arc (no separate rigid-base segment) — the
    algorithm doesn't distinguish base/tip, it just trims the first 10
    points after sorting by v.

    n defaults to None, which picks enough samples that consecutive
    *rasterized* pixels are always 8-connected (step <= ~1px) regardless
    of radius_px/arc_deg — compute_spine_curvature walks true pixel
    adjacency (skeleton_longest_path), so an under-sampled parametric
    curve with >1px gaps between samples would fragment into disconnected
    components and only the largest fragment would be used."""
    center_u, center_v = 300.0, 300.0 + radius_px
    half = np.radians(arc_deg / 2)
    if n is None:
        arc_len_px = radius_px * np.radians(arc_deg)
        n = int(np.ceil(arc_len_px)) + 1
    theta = np.linspace(-np.pi / 2 - half, -np.pi / 2 + half, n)
    u = center_u + radius_px * np.cos(theta)
    v = center_v + radius_px * np.sin(theta)
    return _mask_from_points(u, v, shape)


def _inject_spur_noise(mask, u, v, spacing=12, spur_len=6, shape=(600, 600)):
    """Returns a copy of `mask` with short perpendicular tick spurs added at
    intervals along the given curve (u, v) — mimicking the small
    branch/spur artifacts cv2.ximgproc.thinning leaves at each bellows fold
    on a real corrugated PneuNet actuator."""
    noisy = mask.copy()
    for i in range(spacing, len(u) - spacing, spacing):
        du = u[i + 1] - u[i - 1]
        dv = v[i + 1] - v[i - 1]
        norm = np.hypot(du, dv)
        if norm == 0:
            continue
        pu, pv = -dv / norm, du / norm
        for s in range(1, spur_len + 1):
            su = int(round(u[i] + pu * s))
            sv = int(round(v[i] + pv * s))
            if 0 <= sv < shape[0] and 0 <= su < shape[1]:
                noisy[sv, su] = 255
    return noisy


class TestComputeSpineCurvature:
    def test_straight_line_yields_near_zero_angle(self):
        mask = _straight_line_mask()
        result = compute_spine_curvature(mask, PPM)

        assert result.status in ("TRACKING", "MATH_ERROR")
        if result.status == "TRACKING":
            assert not np.isnan(result.bend_angle_deg)
            assert result.bend_angle_deg < 15.0

    def test_arc_recovers_known_radius_and_consistent_angle(self):
        radius_px = 300.0
        mask = _arc_mask(radius_px=radius_px, arc_deg=60.0)
        result = compute_spine_curvature(mask, PPM)

        assert result.status == "TRACKING"
        assert not np.isnan(result.bend_angle_deg)

        radius_m_expected = radius_px / PPM
        assert abs(result.radius_mm - radius_m_expected * 1000.0) < radius_m_expected * 1000.0 * 0.05

        # bend_angle_deg = degrees(mean_curvature * ACTUATOR_LENGTH_M) — the
        # actual (not geometric-arc-angle) definition this pipeline uses.
        expected_angle = np.degrees(result.mean_curvature * ACTUATOR_LENGTH_M)
        assert abs(result.bend_angle_deg - expected_angle) < 1e-6

    def test_arc_with_spur_noise_recovers_similar_center(self):
        """Regression test: on a real capture, branchy/spurred skeleton
        pixels (bellows-fold thinning artifacts) fed unpruned into the
        circle fit pulled the fitted center to the point where the drawn
        arc curved the OPPOSITE way from the actuator's real visible bend
        — not just a minor accuracy loss. skeleton_longest_path (pruning to
        the single longest connected path before fitting) must keep the
        fitted center close to the clean-arc case despite spur noise."""
        radius_px = 300.0
        center_u, center_v = 300.0, 300.0 + radius_px
        arc_deg = 60.0
        half = np.radians(arc_deg / 2)
        arc_len_px = radius_px * np.radians(arc_deg)
        n = int(np.ceil(arc_len_px)) + 1
        theta = np.linspace(-np.pi / 2 - half, -np.pi / 2 + half, n)
        u = center_u + radius_px * np.cos(theta)
        v = center_v + radius_px * np.sin(theta)

        clean_mask = _mask_from_points(u, v)
        clean_result = compute_spine_curvature(clean_mask, PPM)
        assert clean_result.status == "TRACKING"

        noisy_mask = _inject_spur_noise(clean_mask, u, v)
        noisy_result = compute_spine_curvature(noisy_mask, PPM)

        assert noisy_result.status == "TRACKING"
        # Fitted center should stay close to the clean-arc fit's center —
        # not just "some circle", but the SAME side/shape of circle.
        dist = np.hypot(
            noisy_result.center_px[0] - clean_result.center_px[0],
            noisy_result.center_px[1] - clean_result.center_px[1],
        )
        assert dist < 0.1 * radius_px
        assert abs(noisy_result.radius_mm - clean_result.radius_mm) < 0.1 * clean_result.radius_mm

    def test_noisy_straight_line_does_not_report_spurious_curvature(self):
        """Regression test: on a real rig, the algebraic (Kasa) circle fit
        is numerically unstable for near-straight point sets — small
        per-pixel jitter (thinning quantization, corrugation-fold noise)
        got amplified into a spuriously small fitted radius. Three real
        captures of the same static, visually-straight actuator gave wildly
        different bend angles (52/82/63 deg) purely from this instability.
        A small deterministic zigzag perturbation (mimicking corrugation
        jitter) on an otherwise-straight line must not produce a large
        reported bend angle."""
        n = 200
        v = np.arange(n, dtype=float)
        # Deterministic zigzag (triangle wave, +/-2px amplitude, period 20px)
        # mimicking corrugation-fold jitter — well under a 1px/row slope so
        # the rasterized mask stays 8-connected, unlike a sharper alternation.
        period = 20.0
        frac = (v % period) / period
        triangle = 4.0 * np.abs(frac - 0.5) - 1.0  # in [-1, 1]
        u = 300.0 + 2.0 * triangle
        mask = _mask_from_points(u, v)
        result = compute_spine_curvature(mask, PPM)

        assert result.status == "TRACKING"
        assert result.bend_angle_deg < 15.0
        assert result.mean_curvature < 5.0

    def test_too_short_skeleton_returns_no_target(self):
        mask = _mask_from_points(np.full(10, 300.0), np.arange(10))
        result = compute_spine_curvature(mask, PPM)

        assert result.status == "NO_TARGET"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
