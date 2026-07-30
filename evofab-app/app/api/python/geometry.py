import numpy as np
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Tuple


ACTUATOR_LENGTH_M = 0.066  # 66 mm

# Max perpendicular deviation (px) of the flex-region points from the
# straight start-end chord for the arc to be classified as effectively
# straight (bend_angle_deg=0). See compute_spine_curvature: the Kasa
# (algebraic) circle fit is numerically ill-conditioned for near-collinear
# points — empirically, ~2px of realistic noise (thinning boundary jitter,
# mild lens distortion) on a visibly straight line can make it converge on
# a small, wrong-radius circle. Checking the raw points against the chord
# directly, rather than the fit's own center offset, is what actually
# catches this reliably.
STRAIGHT_DEVIATION_PX = 3.0


@dataclass
class CurvatureResult:
    mean_curvature: float = 0.0  # 1/m
    bend_angle_deg: float = 0.0
    radius_mm: float = 0.0
    status: str = "IDLE"
    center_px: Tuple[int, int] = field(default_factory=lambda: (0, 0))
    radius_px: float = 0.0
    # Already np.unwrap()-ed (continuous, not wrapped to (-180, 180]) angles
    # in degrees from center_px to the start/end of the fitted arc — the
    # single source of truth for where the arc actually is. Callers drawing
    # it (e.g. main.py's cv2.ellipse) should use these directly rather than
    # recomputing angles from raw skeleton pixels with plain arctan2, which
    # has no notion of "the short way around" across the +/-180 seam and can
    # draw the wrong-side arc when the true sweep straddles it.
    theta_start_deg: float = 0.0
    theta_end_deg: float = 0.0


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
    the largest, so disconnected noise blobs elsewhere in the mask (not
    spurs attached to the main tree, but separate specks) can't be
    mistaken for part of the spine before the longest-path search even
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
    longest simple path through it, as an ordered (N, 2) array of (u, v)
    pixel coordinates walked from one end to the other.

    Two steps:
    1. Connected components over the 8-connected pixel graph, keeping
       only the largest — drops disconnected noise blobs outright
       (separate specks elsewhere in the mask), before any path search.
    2. Two-pass BFS ("tree diameter"): BFS from any pixel in that
       component to find the farthest pixel A, then BFS from A to find
       the farthest pixel B — the path A-to-B is the longest path. Exact
       for tree-shaped (cycle-free) skeletons, true for any single
       solid-blob mask without holes (the case here), and it naturally
       drops short spurs (e.g. thinning artifacts at PneuNet bellows
       folds) since a spur is always shorter than continuing along the
       main trunk.

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


def compute_spine_curvature(skeleton_mask: np.ndarray, ppm: float,
                             base_tip_px: Optional[Tuple[int, int]] = None) -> CurvatureResult:
    """Fit a circle to the skeleton and return curvature metrics + pixel-space circle.

    base_tip_px, if given, is the segmentation-detected point where the
    actuator physically emerges from its clamp (analyzer.detect_base). It
    replaces the geometric straightness trim (_trim_rigid_base) as the
    known start of the flexible arc, since the mask is already restricted
    to the base-connected component upstream — there's no rigid lead-in
    segment left to infer. Without it, _trim_rigid_base is used as before
    (e.g. for direct/test calls with no base detection wired in).
    """
    path = skeleton_longest_path(skeleton_mask)

    if len(path) < 30:
        return CurvatureResult(status="NO_TARGET")

    u_sorted = path[:, 0].astype(np.float64)
    v_sorted = path[:, 1].astype(np.float64)

    if base_tip_px is not None:
        # Orient the walked path so index 0 is the end nearer the known
        # base tip, whichever BFS endpoint that turned out to be — robust
        # to bends that fold back in v, unlike the old argsort(v) order.
        d_first = np.hypot(u_sorted[0] - base_tip_px[0], v_sorted[0] - base_tip_px[1])
        d_last = np.hypot(u_sorted[-1] - base_tip_px[0], v_sorted[-1] - base_tip_px[1])
        if d_last < d_first:
            u_sorted, v_sorted = u_sorted[::-1], v_sorted[::-1]
        u_flex = u_sorted
        v_flex = v_sorted
    else:
        # No known base tip: preserve the prior convention (rigid base
        # nearer the bottom of frame / larger v) by orienting the walked
        # path the same way the old v-descending sort did, then trimming
        # the straight lead-in as before.
        if v_sorted[0] < v_sorted[-1]:
            u_sorted, v_sorted = u_sorted[::-1], v_sorted[::-1]
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

        if base_tip_px is not None:
            u_start, v_start = base_tip_px
        else:
            u_start, v_start = u_flex[0], v_flex[0]
        u_end, v_end = u_flex[-1], v_flex[-1]
        chord_px = float(np.hypot(u_end - u_start, v_end - v_start))

        # Direct straightness check: how far the flex points themselves
        # deviate (perpendicular to the start-end chord) from a straight
        # line — independent of the circle fit's own center estimate.
        # A near-straight skeleton makes the Kasa fit numerically
        # ill-conditioned: even ~2px of realistic noise (thinning boundary
        # jitter, mild lens distortion) on a visibly straight line can
        # make it converge on a small, wrong-radius circle whose center
        # sits nowhere near the chord (confirmed empirically) — so judging
        # straightness from that same fit's center offset is circular and
        # unreliable. Checking the raw points against the chord directly
        # is the robust version of the same idea.
        if chord_px > 0:
            chord_dx, chord_dy = (u_end - u_start) / chord_px, (v_end - v_start) / chord_px
            perp_dev = np.abs((u_flex - u_start) * chord_dy - (v_flex - v_start) * chord_dx)
            max_dev_px = float(perp_dev.max())
        else:
            max_dev_px = 0.0

        # Unwrapped once here, so this is the only place either the
        # bend-angle number or anything drawing the arc (main.py) needs to
        # reason about the +/-180 seam.
        theta_start = np.arctan2(v_start - center_v, u_start - center_u)
        theta_end = np.arctan2(v_end - center_v, u_end - center_u)
        theta_start, theta_end = np.unwrap([theta_start, theta_end])

        if radius_px <= 0 or max_dev_px < STRAIGHT_DEVIATION_PX:
            angle_deg = 0.0
        else:
            angle_deg = float(np.degrees(np.abs(theta_end - theta_start)))

        return CurvatureResult(
            mean_curvature=k,
            bend_angle_deg=angle_deg,
            radius_mm=radius_m * 1000.0,
            status="TRACKING",
            center_px=(int(round(center_u)), int(round(center_v))),
            radius_px=radius_px,
            theta_start_deg=float(np.degrees(theta_start)),
            theta_end_deg=float(np.degrees(theta_end)),
        )
    except Exception:
        return CurvatureResult(status="MATH_ERROR")
