import numpy as np
import pytest

from geometry import compute_spine_curvature, skeleton_longest_path

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


def _arc_with_base_points(radius_px=150.0, arc_deg=90.0, n_arc=None, n_base=None, base_len_px=90.0):
    """
    Returns the raw (u, v) point arrays for a straight rigid base (vertical
    segment, bottom of frame) followed by a circular arc of the given
    radius subtending arc_deg, tangent to the base at the join so the
    skeleton is continuous — plus the arc's true center/radius. Factored
    out of _arc_with_base_mask so noise can be injected onto the raw
    points before rasterizing to a mask.

    n_arc/n_base default to None, which picks enough samples that
    consecutive *rasterized* pixels are always 8-connected (step <= ~1px)
    regardless of radius_px/arc_deg/base_len_px — skeleton_longest_path
    walks true pixel adjacency (like a real cv2.ximgproc.thinning output
    would be), so an under-sampled parametric curve with >1px gaps between
    samples would fragment into disconnected components, unlike the old
    argsort-based ordering which never depended on connectivity.
    """
    if n_base is None:
        n_base = int(np.ceil(base_len_px)) + 1
    base_top_v = 500.0
    u_base = np.full(n_base, 300.0)
    v_base = base_top_v - np.linspace(0, base_len_px, n_base)

    # Circle center is horizontally offset from the tangent point by radius_px,
    # so the base (vertical, heading straight up) is tangent to the circle there.
    join_u, join_v = 300.0, v_base[-1]
    center_u = join_u + radius_px
    center_v = join_v

    if n_arc is None:
        arc_len_px = radius_px * np.radians(arc_deg)
        n_arc = int(np.ceil(arc_len_px)) + 1
    theta = np.linspace(np.pi, np.pi + np.radians(arc_deg), n_arc)
    u_arc = center_u + radius_px * np.cos(theta)
    v_arc = center_v + radius_px * np.sin(theta)

    u = np.concatenate([u_base, u_arc])
    v = np.concatenate([v_base, v_arc])
    return u, v, center_u, center_v, radius_px


def _arc_with_base_mask(radius_px=150.0, arc_deg=90.0, n_arc=None, n_base=None, base_len_px=90.0):
    """
    Straight rigid base (vertical segment, bottom of frame) followed by a
    circular arc of the given radius subtending arc_deg, tangent to the base
    at the join so the skeleton is continuous.
    """
    u, v, center_u, center_v, radius_px = _arc_with_base_points(
        radius_px=radius_px, arc_deg=arc_deg, n_arc=n_arc, n_base=n_base, base_len_px=base_len_px
    )
    return _mask_from_points(u, v), center_u, center_v, radius_px


def _inject_spur_noise(mask, u, v, spacing=12, spur_len=6, shape=(600, 600)):
    """
    Returns a copy of `mask` with short perpendicular tick spurs added at
    intervals along the given curve (u, v) — mimicking the small
    branch/spur artifacts cv2.ximgproc.thinning leaves at each bellows
    fold on a real corrugated PneuNet actuator — plus one disconnected
    noise blob far from the curve (mimicking a stray thresholded speck
    elsewhere in frame).
    """
    noisy = mask.copy()
    for i in range(spacing, len(u) - spacing, spacing):
        du = u[i + 1] - u[i - 1]
        dv = v[i + 1] - v[i - 1]
        norm = np.hypot(du, dv)
        if norm == 0:
            continue
        pu, pv = -dv / norm, du / norm  # unit vector perpendicular to local heading
        for s in range(1, spur_len + 1):
            su = int(round(u[i] + pu * s))
            sv = int(round(v[i] + pv * s))
            if 0 <= sv < shape[0] and 0 <= su < shape[1]:
                noisy[sv, su] = 255
    noisy[10:13, 10:13] = 255  # disconnected noise blob, far from the curve
    return noisy


class TestComputeSpineCurvature:
    def test_straight_line_yields_near_zero_angle(self):
        mask = _straight_line_mask()
        result = compute_spine_curvature(mask, PPM)

        assert result.status in ("TRACKING", "MATH_ERROR")
        if result.status == "TRACKING":
            assert not np.isnan(result.bend_angle_deg)
            assert result.bend_angle_deg < 15.0

    def test_jittered_straight_line_yields_zero_angle(self):
        """Regression test: the Kasa (algebraic) circle fit is numerically
        ill-conditioned for near-collinear points — as little as ~0.4px of
        per-point jitter on an otherwise straight line used to make the fit
        converge on a small, wrong-radius circle (radius_px collapsing from
        ~700+ to ~44) and report a spurious ~103deg bend. The straightness
        check must catch this from the raw points' deviation from the
        start-end chord, not from that same unstable fit's own center
        offset (which does NOT reliably flag this case — confirmed by
        reproducing the bug before fixing it)."""
        n = 250
        v = np.arange(n).astype(float)
        rng = np.random.default_rng(0)
        u = np.full(n, 300.0) + rng.normal(0, 0.4, size=n)
        mask = _mask_from_points(u, v)

        result = compute_spine_curvature(mask, PPM)

        assert result.status == "TRACKING"
        assert result.bend_angle_deg < 5.0

    def test_straight_line_with_endpoint_curl_yields_zero_angle(self):
        """Small hooks/curls right at the skeleton's endpoints are a common
        cv2.ximgproc.thinning boundary artifact — shouldn't register as a
        real bend."""
        n = 250
        v = np.arange(n).astype(float)
        u = np.full(n, 300.0)
        for end in (0, -1):
            sign = 1 if end == 0 else -1
            for k in range(1, 5):
                idx = k if end == 0 else n - 1 - k
                u[idx] += sign * 6 * np.sin(k / 4 * np.pi / 2)
        mask = _mask_from_points(u, v)

        result = compute_spine_curvature(mask, PPM)

        assert result.status == "TRACKING"
        assert result.bend_angle_deg < 5.0

    def test_arc_with_rigid_base_recovers_known_angle(self):
        mask, center_u, center_v, radius_px = _arc_with_base_mask(
            radius_px=150.0, arc_deg=90.0
        )
        result = compute_spine_curvature(mask, PPM)

        assert result.status == "TRACKING"
        assert not np.isnan(result.bend_angle_deg)
        assert abs(result.bend_angle_deg - 90.0) < 8.0

    def test_too_short_skeleton_returns_no_target(self):
        mask = _mask_from_points(np.full(10, 300.0), np.arange(10))
        result = compute_spine_curvature(mask, PPM)

        assert result.status == "NO_TARGET"

    def test_arc_with_spur_noise_recovers_known_angle(self):
        """Same arc as test_arc_with_rigid_base_recovers_known_angle, but
        with bellows-fold-style spurs and a disconnected noise blob added —
        confirms skeleton_longest_path pruning (used internally) keeps the
        fit within the same tolerance as the clean case."""
        u, v, center_u, center_v, radius_px = _arc_with_base_points(radius_px=150.0, arc_deg=90.0)
        mask = _mask_from_points(u, v)
        noisy = _inject_spur_noise(mask, u, v)

        result = compute_spine_curvature(noisy, PPM)

        assert result.status == "TRACKING"
        assert not np.isnan(result.bend_angle_deg)
        assert abs(result.bend_angle_deg - 90.0) < 8.0


class TestSkeletonLongestPath:
    def test_drops_spurs_and_disconnected_noise(self):
        u, v, _, _, _ = _arc_with_base_points(radius_px=150.0, arc_deg=90.0)
        mask = _mask_from_points(u, v)
        noisy = _inject_spur_noise(mask, u, v)

        path = skeleton_longest_path(noisy)
        path_set = set(map(tuple, path.tolist()))

        # The disconnected noise blob must be fully excluded.
        assert not any(10 <= pu < 13 and 10 <= pv < 13 for pu, pv in path_set)

        # Every returned pixel should sit close to the true curve — not on
        # one of the injected perpendicular spurs.
        true_curve = np.stack([np.round(u).astype(int), np.round(v).astype(int)], axis=1)
        for pu, pv in path_set:
            dists = np.hypot(true_curve[:, 0] - pu, true_curve[:, 1] - pv)
            assert dists.min() <= 2.0

        # Most of the true curve should still be recovered despite the
        # spurs and noise blob competing for pixels. Compare against the
        # *rasterized* clean pixel count, not len(u) — dense oversampling
        # means many raw (u, v) samples collapse onto the same pixel.
        clean_pixel_count = int(np.count_nonzero(mask))
        assert len(path) >= clean_pixel_count - 20


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
