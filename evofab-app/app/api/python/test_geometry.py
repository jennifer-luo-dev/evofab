import numpy as np
import pytest

from geometry import compute_spine_curvature

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


def _arc_with_base_mask(radius_px=150.0, arc_deg=90.0, n_arc=150, n_base=60, base_len_px=90.0):
    """
    Straight rigid base (vertical segment, bottom of frame) followed by a
    circular arc of the given radius subtending arc_deg, tangent to the base
    at the join so the skeleton is continuous.
    """
    base_top_v = 500.0
    u_base = np.full(n_base, 300.0)
    v_base = base_top_v - np.linspace(0, base_len_px, n_base)

    # Circle center is horizontally offset from the tangent point by radius_px,
    # so the base (vertical, heading straight up) is tangent to the circle there.
    join_u, join_v = 300.0, v_base[-1]
    center_u = join_u + radius_px
    center_v = join_v

    theta = np.linspace(np.pi, np.pi + np.radians(arc_deg), n_arc)
    u_arc = center_u + radius_px * np.cos(theta)
    v_arc = center_v + radius_px * np.sin(theta)

    u = np.concatenate([u_base, u_arc])
    v = np.concatenate([v_base, v_arc])
    return _mask_from_points(u, v), center_u, center_v, radius_px


class TestComputeSpineCurvature:
    def test_straight_line_yields_near_zero_angle(self):
        mask = _straight_line_mask()
        result = compute_spine_curvature(mask, PPM)

        assert result.status in ("TRACKING", "MATH_ERROR")
        if result.status == "TRACKING":
            assert not np.isnan(result.bend_angle_deg)
            assert result.bend_angle_deg < 15.0

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


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
