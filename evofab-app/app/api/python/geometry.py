import numpy as np
from dataclasses import dataclass, field
from typing import Tuple


ACTUATOR_LENGTH_M = 0.066  # 66 mm


@dataclass
class CurvatureResult:
    mean_curvature: float = 0.0  # 1/m
    bend_angle_deg: float = 0.0
    radius_mm: float = 0.0
    status: str = "IDLE"
    center_px: Tuple[int, int] = field(default_factory=lambda: (0, 0))
    radius_px: float = 0.0


def _trim_rigid_base(u_sorted: np.ndarray, v_sorted: np.ndarray,
                      window: int = 5, straightness_thresh_deg: float = 3.0) -> int:
    """
    Find the index where the skeleton stops being straight (i.e. where the
    flexible region begins), by checking local heading angle over a sliding
    window against the initial heading. Returns the number of leading points
    to drop as the rigid base. Returns 0 if the skeleton is too short to
    evaluate or no bend is detected.
    """
    n = len(u_sorted)
    if n < 2 * window + 1:
        return 0

    headings = []
    for i in range(n - window):
        du = u_sorted[i + window] - u_sorted[i]
        dv = v_sorted[i + window] - v_sorted[i]
        headings.append(np.degrees(np.arctan2(dv, du)))
    headings = np.array(headings)

    base_heading = headings[0]
    deviation = np.abs(headings - base_heading)

    bends = np.where(deviation > straightness_thresh_deg)[0]
    return int(bends[0]) if len(bends) > 0 else 0


def compute_spine_curvature(skeleton_mask: np.ndarray, ppm: float) -> CurvatureResult:
    """Fit a circle to the skeleton and return curvature metrics + pixel-space circle."""
    v, u = np.where(skeleton_mask > 0)

    if len(u) < 30:
        return CurvatureResult(status="NO_TARGET")

    idx = np.argsort(v)[::-1]
    u_sorted = u[idx]
    v_sorted = v[idx]

    trim = _trim_rigid_base(u_sorted, v_sorted)
    u_flex = u_sorted[trim:]
    v_flex = v_sorted[trim:]

    u_m, v_m = np.mean(u_flex), np.mean(v_flex)
    u_c, v_c = u_flex - u_m, v_flex - v_m
    A = np.column_stack([u_c, v_c, np.ones_like(u_c)])
    b_vec = u_c**2 + v_c**2

    try:
        C, _, _, _ = np.linalg.lstsq(A, b_vec, rcond=None)
        radius_px = float(np.sqrt(C[2] + (C[0] / 2) ** 2 + (C[1] / 2) ** 2))
        center_u = float(C[0] / 2 + u_m)
        center_v = float(C[1] / 2 + v_m)
        radius_m = radius_px / ppm
        k = 1.0 / radius_m

        u_start, v_start = u_flex[0], v_flex[0]
        u_end, v_end = u_flex[-1], v_flex[-1]
        chord_px = float(np.hypot(u_end - u_start, v_end - v_start))

        # A near-straight skeleton makes the Kasa fit degenerate: with the
        # points (nearly) collinear, the fitted center lands almost exactly
        # on the line through the endpoints, so the endpoint-angle formula
        # below would read ~180 deg instead of ~0. Measure how far the
        # fitted center sits off that line (relative to the radius) and
        # treat a near-zero offset as effectively straight.
        center_offset_px = abs(
            (u_end - u_start) * (center_v - v_start) - (v_end - v_start) * (center_u - u_start)
        ) / chord_px if chord_px > 0 else 0.0

        if radius_px <= 0 or center_offset_px < 0.1 * radius_px:
            angle_deg = 0.0
        else:
            theta_start = np.arctan2(v_start - center_v, u_start - center_u)
            theta_end = np.arctan2(v_end - center_v, u_end - center_u)
            theta_start, theta_end = np.unwrap([theta_start, theta_end])
            angle_deg = float(np.degrees(np.abs(theta_end - theta_start)))

        return CurvatureResult(
            mean_curvature=k,
            bend_angle_deg=angle_deg,
            radius_mm=radius_m * 1000.0,
            status="TRACKING",
            center_px=(int(round(center_u)), int(round(center_v))),
            radius_px=radius_px,
        )
    except Exception:
        return CurvatureResult(status="MATH_ERROR")
