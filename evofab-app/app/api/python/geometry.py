import numpy as np
from collections import deque
from dataclasses import dataclass, field
from typing import Tuple


ACTUATOR_LENGTH_M = 0.066  # 66 mm


@dataclass
class CurvatureResult:
    mean_curvature: float = 0.0  # 1/m
    bend_angle_deg: float = 0.0  # Normalized for 66mm
    radius_mm: float = 0.0
    status: str = "IDLE"
    center_px: Tuple[int, int] = field(default_factory=lambda: (0, 0))
    radius_px: float = 0.0


def _skeleton_neighbors(coords: set) -> dict:
    """8-connected adjacency dict over a set of (u, v) skeleton pixels."""
    neighbors_of = {}
    for (u, v) in coords:
        neighbors_of[(u, v)] = [
            (u + du, v + dv)
            for du in (-1, 0, 1)
            for dv in (-1, 0, 1)
            if (du, dv) != (0, 0) and (u + du, v + dv) in coords
        ]
    return neighbors_of


def _largest_connected_component(coords: set, neighbors_of: dict) -> set:
    """Splits the pixel set into 8-connected components and returns only
    the largest, so disconnected noise blobs elsewhere in the mask can't
    be mistaken for part of the spine before the longest-path search even
    starts."""
    unvisited = set(coords)
    largest: set = set()
    while unvisited:
        start = next(iter(unvisited))
        comp = {start}
        queue = deque([start])
        unvisited.discard(start)
        while queue:
            node = queue.popleft()
            for nbr in neighbors_of[node]:
                if nbr in unvisited:
                    unvisited.discard(nbr)
                    comp.add(nbr)
                    queue.append(nbr)
        if len(comp) > len(largest):
            largest = comp
    return largest


def _bfs_farthest(start: Tuple[int, int], neighbors_of: dict):
    """BFS from `start` over `neighbors_of`; returns (farthest node
    reached, parent map) — the parent map lets the caller walk the path
    back to `start`."""
    visited = {start: None}
    queue = deque([start])
    last = start
    while queue:
        node = queue.popleft()
        last = node
        for nbr in neighbors_of[node]:
            if nbr not in visited:
                visited[nbr] = node
                queue.append(nbr)
    return last, visited


def skeleton_longest_path(skeleton_mask: np.ndarray) -> np.ndarray:
    """
    Reduces a (possibly noisy/branched) binary skeleton mask to the single
    longest simple path through it, as an (N, 2) array of (u, v) pixel
    coordinates (order not guaranteed to be end-to-end meaningful — callers
    that care about direction should re-sort, e.g. by v).

    cv2.ximgproc.thinning on a corrugated PneuNet mask produces small
    spurs/branches at each bellows fold, not a clean single-pixel
    centerline — confirmed on a real capture that feeding those raw,
    unordered, branchy pixels straight into the circle fit (previously
    just np.where + argsort(v), no pruning) systematically pulled the
    fitted circle's center to the point where the drawn arc curved the
    opposite way from the actuator's actual visible bend. A clean
    single-path extraction removes that bias.

    Two steps:
    1. Connected components over the 8-connected pixel graph, keeping
       only the largest — drops disconnected noise blobs outright.
    2. Two-pass BFS ("tree diameter"): BFS from any pixel in that
       component to find the farthest pixel A, then BFS from A to find
       the farthest pixel B — the path A-to-B is the longest path. Exact
       for tree-shaped (cycle-free) skeletons, true for any single
       solid-blob mask without holes, and it naturally drops short spurs
       since a spur is always shorter than continuing along the main
       trunk.

    Returns an empty (0, 2) array if fewer than 2 pixels are set.
    """
    ys, xs = np.where(skeleton_mask > 0)
    if len(xs) < 2:
        return np.empty((0, 2), dtype=int)

    coords = set(zip(xs.tolist(), ys.tolist()))
    neighbors_of = _skeleton_neighbors(coords)

    component = _largest_connected_component(coords, neighbors_of)
    if len(component) < 2:
        return np.empty((0, 2), dtype=int)

    component_neighbors = {n: [nb for nb in neighbors_of[n] if nb in component] for n in component}

    any_start = next(iter(component))
    far_a, _ = _bfs_farthest(any_start, component_neighbors)
    far_b, parents = _bfs_farthest(far_a, component_neighbors)

    path = []
    node = far_b
    while node is not None:
        path.append(node)
        node = parents[node]
    path.reverse()

    return np.array(path, dtype=int)


def compute_spine_curvature(skeleton_mask: np.ndarray, ppm: float) -> CurvatureResult:
    path = skeleton_longest_path(skeleton_mask)

    if len(path) < 30:  # Lowered threshold for smaller device
        return CurvatureResult(status="NO_TARGET")

    u, v = path[:, 0], path[:, 1]

    # Trim the rigid base lead-in (fixed offset, not geometrically detected).
    idx = np.argsort(v)[::-1]
    u_flex = u[idx][10:]
    v_flex = v[idx][10:]

    # Least Squares Circle Fit
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

        # Straightness gate: the algebraic (Kasa) circle fit above is
        # numerically unstable for near-straight point sets — as the true
        # radius goes to infinity, tiny pixel-level noise (thinning
        # quantization, corrugation-fold jitter) gets amplified into a
        # spuriously small fitted radius. Confirmed on a real rig: three
        # captures of the same static, visually-straight actuator gave
        # wildly different bend angles (52/82/63 deg) from this fit alone,
        # despite the underlying point noise being consistent across shots
        # — a tell that the fit was amplifying noise, not measuring a real
        # bend. Compare the circle fit's own RMS residual against a plain
        # straight-line fit through the same points: a genuine bend (real
        # actuation capture) fits a circle far better than a line (residual
        # ratio ~0.24 on a real actuated capture); noise on a straight
        # actuator does not (ratio ~2-4 on three independent real captures)
        # — the "best" circle is no better than just a line. Below that
        # break-even point, report zero curvature instead of a
        # noise-amplified reading. center_px/radius_px are left as the raw
        # fit (still a reasonable, harmless annotation of the point spread)
        # since only the numeric curvature readout is untrustworthy here.
        dist = np.hypot(u_flex - center_u, v_flex - center_v)
        resid_circle = float(np.sqrt(np.mean((dist - radius_px) ** 2)))

        pts = np.column_stack([u_flex, v_flex]).astype(float)
        centered = pts - pts.mean(axis=0)
        cov = np.cov(centered.T)
        evals, evecs = np.linalg.eigh(cov)
        normal = evecs[:, np.argmin(evals)]
        resid_line = float(np.sqrt(np.mean((centered @ normal) ** 2)))

        if resid_circle >= resid_line:
            return CurvatureResult(
                mean_curvature=0.0,
                bend_angle_deg=0.0,
                radius_mm=radius_m * 1000.0,
                status="TRACKING",
                center_px=(int(round(center_u)), int(round(center_v))),
                radius_px=radius_px,
            )

        # Calculate K (1/m)
        k = 1.0 / radius_m

        # Bend angle: curvature * arc length (radians), not a geometric
        # endpoint-to-endpoint angle — assumes the flex region fit corresponds
        # to the actuator's known real length (ACTUATOR_LENGTH_M).
        angle_rad = k * ACTUATOR_LENGTH_M
        angle_deg = float(np.degrees(angle_rad))

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
