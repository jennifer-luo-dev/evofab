import numpy as np
from dataclasses import dataclass


@dataclass
class CurvatureResult:
    mean_curvature: float = 0.0  # 1/m
    bend_angle_deg: float = 0.0  # normalised for 66 mm actuator
    radius_mm: float = 0.0
    status: str = "IDLE"


def compute_spine_curvature(skeleton_mask: np.ndarray, ppm: float) -> CurvatureResult:
    """Fit a circle to the skeleton and return curvature metrics."""
    v, u = np.where(skeleton_mask > 0)
    ACTUATOR_LENGTH_M = 0.066  # 66 mm

    if len(u) < 30:
        return CurvatureResult(status="NO_TARGET")

    # Sort top-to-bottom, trim noisy tip pixels
    idx = np.argsort(v)[::-1]
    u_flex = u[idx][10:]
    v_flex = v[idx][10:]

    u_m, v_m = np.mean(u_flex), np.mean(v_flex)
    u_c, v_c = u_flex - u_m, v_flex - v_m
    A = np.column_stack([u_c, v_c, np.ones_like(u_c)])
    b_vec = u_c**2 + v_c**2

    try:
        C, _, _, _ = np.linalg.lstsq(A, b_vec, rcond=None)
        radius_px = np.sqrt(C[2] + (C[0] / 2) ** 2 + (C[1] / 2) ** 2)
        radius_m = radius_px / ppm
        k = 1.0 / radius_m
        angle_deg = np.degrees(k * ACTUATOR_LENGTH_M)

        return CurvatureResult(
            mean_curvature=k,
            bend_angle_deg=angle_deg,
            radius_mm=radius_m * 1000.0,
            status="TRACKING",
        )
    except Exception:
        return CurvatureResult(status="MATH_ERROR")
