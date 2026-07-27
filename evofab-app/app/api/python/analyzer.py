# analyzer.py
# Deterministic OpenCV vision pipeline for PneuNet actuator characterization:
# masks the actuator (depth-gated or brightness-thresholded) and extracts its
# spine via skeletonization for curvature analysis. Actuator segmentation is
# anchored to the rigid black clamp base (detect_base/segment_actuator),
# detected fresh every frame, so it can't lock onto disconnected background
# reflections or a stale/fixed camera position.

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

# detect_base's dark-blob heuristics for the rigid clamp. Tuned to the
# clamp's expected size/shape at typical working distance — recalibrate
# BASE_AREA_PX_MIN/MAX (and, if the clamp's real proportions differ,
# BASE_ASPECT_RATIO) if the camera's working distance changes significantly.
BASE_AREA_PX_MIN = 2000
BASE_AREA_PX_MAX = 150000
BASE_ASPECT_RATIO = 2.0     # clamp's expected long/short bounding-rect side ratio
BASE_ASPECT_TOLERANCE = 0.6  # accepts long/short in [BASE_ASPECT_RATIO +/- this]
# A free-standing clamp shouldn't touch the frame's left/right/bottom edges —
# floor/table-shadow regions (the observed false-positive) routinely do.
BASE_BORDER_MARGIN_PX = 5
# How close (px) actual actuator-mask pixels must come to a candidate's
# tip_px to confirm it's really attached to that candidate, not a
# coincidentally clamp-shaped dark blob elsewhere in frame.
BASE_TIP_ADJACENCY_PX = 20
_BASE_MAX_BRIGHTNESS = 60  # dark matte clamp vs. the bright PneuNet body/foil

# Temporal sanity thresholds (see segment_actuator) — a legitimate frame-to-
# frame camera nudge shouldn't move the base by anywhere near this much.
_BASE_AREA_JUMP_RATIO = 0.4
_BASE_ANGLE_JUMP_DEG = 20.0


@dataclass
class BaseDetection:
    """One frame's rigid-clamp-base detection. Always computed fresh from
    the current frame — never derived from a cached/fixed pixel position."""
    found: bool = False
    contour: Optional[np.ndarray] = None
    bbox: Optional[Tuple[int, int, int, int]] = None  # (x, y, w, h)
    tip_px: Optional[Tuple[int, int]] = None
    angle_deg: float = 0.0  # base's own long-axis orientation, mod 180
    area_px: float = 0.0
    warning: Optional[str] = None


@dataclass
class ActuatorSegmentation:
    """Result of base-anchored actuator segmentation (segment_actuator)."""
    status: str = "IDLE"  # NO_BASE | NO_TARGET | OK
    mask: Optional[np.ndarray] = None
    base: Optional[BaseDetection] = None


def detect_base(frame: np.ndarray, roi: Optional[Tuple[int, int, int, int]] = None,
                 depth_scale: float = 0.001,
                 prev_center_px: Optional[Tuple[float, float]] = None,
                 actuator_mask: Optional[np.ndarray] = None) -> BaseDetection:
    """
    Locate the rigid black clamp base in the current frame via brightness
    thresholding (dark blob) or depth-gating if given a real depth frame —
    same auto-detect-by-value-range convention as ActuatorAnalyzer.generate_mask.
    Nothing here is cached between calls; every call re-detects from scratch,
    since the camera can shift slightly frame to frame.

    `roi` restricts the search to a (x, y, w, h) sub-region if provided
    (e.g. a caller-supplied hint), else the full frame is searched.

    `prev_center_px` (full-frame coords), if given, is used only to break
    ties among multiple candidates that all pass filtering — whichever is
    closest wins. This does not restrict the search itself (every candidate
    in the searched region is still found and filtered independently each
    call). Without it, exactly one candidate must survive filtering or this
    returns found=False rather than guessing among several.

    `actuator_mask`, if given, cross-checks the chosen candidate: real
    actuator-mask pixels must exist near its tip_px, or it's rejected as a
    mismatched false positive (see BASE_TIP_ADJACENCY_PX).
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

    if roi is not None:
        rx, ry, rw, rh = roi
        search = gray[ry:ry + rh, rx:rx + rw]
    else:
        rx, ry = 0, 0
        search = gray

    if search.size == 0:
        return BaseDetection(found=False)

    if np.max(search) > 255:
        # Real depth values (mm) — no separately-calibrated depth range for
        # the base exists, so this reuses the actuator's own z-gate as a
        # stand-in (base sits inline with the actuator at roughly the same
        # depth). Currently unexercised in practice: the Orbbec bridge
        # (camera_orbbec_service.py) doesn't expose a depth stream, so
        # generate_mask's depth branch is dormant too — see main.py's PPM
        # comment.
        depth_m = search * depth_scale
        dark_mask = cv2.inRange(depth_m, 0.30, 0.60)  # type: ignore
    else:
        # Standard 8-bit grayscale: the clamp is a dark, low-brightness
        # matte blob against the bright actuator and the reflective foil.
        _, dark_mask = cv2.threshold(search, _BASE_MAX_BRIGHTNESS, 255, cv2.THRESH_BINARY_INV)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, kernel)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    search_h, search_w = search.shape[:2]

    candidates = []
    for c in contours:
        area = cv2.contourArea(c)
        if not (BASE_AREA_PX_MIN <= area <= BASE_AREA_PX_MAX):
            continue

        bx, by, bw, bh = cv2.boundingRect(c)
        if (bx <= BASE_BORDER_MARGIN_PX
                or bx + bw >= search_w - BASE_BORDER_MARGIN_PX
                or by + bh >= search_h - BASE_BORDER_MARGIN_PX):
            # Touches the left/right/bottom search-region edge — a
            # free-standing clamp shouldn't; floor/table-shadow regions
            # (the observed false positive) routinely do.
            continue

        (_, _), (rw_, rh_), _ = cv2.minAreaRect(c)
        if rw_ <= 0 or rh_ <= 0:
            continue
        long_side, short_side = max(rw_, rh_), min(rw_, rh_)
        aspect = long_side / short_side
        if abs(aspect - BASE_ASPECT_RATIO) > BASE_ASPECT_TOLERANCE:
            continue

        candidates.append((c, area))

    if not candidates:
        return BaseDetection(found=False)

    if prev_center_px is not None:
        def _dist2_to_prev(item):
            cand, _ = item
            cbx, cby, cbw, cbh = cv2.boundingRect(cand)
            ccx, ccy = cbx + cbw / 2.0 + rx, cby + cbh / 2.0 + ry
            return (ccx - prev_center_px[0]) ** 2 + (ccy - prev_center_px[1]) ** 2

        best, best_area = min(candidates, key=_dist2_to_prev)
    else:
        # No prior frame to disambiguate against — only proceed if exactly
        # one candidate survived filtering, rather than guessing among
        # several equally-plausible blobs.
        if len(candidates) != 1:
            return BaseDetection(found=False)
        best, best_area = candidates[0]

    if roi is not None:
        best = best + np.array([[rx, ry]], dtype=best.dtype)

    x, y, w, h = cv2.boundingRect(best)

    # Principal axis via a robust line fit, not minAreaRect's angle (whose
    # convention/range varies across OpenCV versions).
    vx, vy, x0, y0 = cv2.fitLine(best, cv2.DIST_L2, 0, 0.01, 0.01).flatten()
    angle_deg = float(np.degrees(np.arctan2(vy, vx)) % 180.0)

    # Tip = the axis-extreme end nearer image-top (away from the cable),
    # not just the topmost contour pixel — the base may sit at an angle, so
    # the true axis endpoint isn't necessarily the min-row point overall.
    pts = best.reshape(-1, 2).astype(np.float64)
    t = (pts[:, 0] - x0) * vx + (pts[:, 1] - y0) * vy
    p_min = pts[np.argmin(t)]
    p_max = pts[np.argmax(t)]
    tip = p_min if p_min[1] <= p_max[1] else p_max
    tip_px = (int(round(tip[0])), int(round(tip[1])))

    if actuator_mask is not None:
        mh, mw = actuator_mask.shape[:2]
        ay0 = max(0, tip_px[1] - BASE_TIP_ADJACENCY_PX)
        ay1 = min(mh, tip_px[1] + BASE_TIP_ADJACENCY_PX + 1)
        ax0 = max(0, tip_px[0] - BASE_TIP_ADJACENCY_PX)
        ax1 = min(mw, tip_px[0] + BASE_TIP_ADJACENCY_PX + 1)
        if not np.any(actuator_mask[ay0:ay1, ax0:ax1] > 0):
            # Clamp-shaped and otherwise plausible, but nothing actuator-
            # colored is actually attached to it at the tip — a mismatched
            # pair, not a real base/actuator detection.
            return BaseDetection(found=False)

    return BaseDetection(
        found=True,
        contour=best,
        bbox=(x, y, w, h),
        tip_px=tip_px,
        angle_deg=angle_deg,
        area_px=float(best_area),
    )


class ActuatorAnalyzer:
    """
    Deterministic vision for PneuNet characterization.
    Supports both real Depth Gating and Brightness Thresholding (MSMF Fallback).
    """
    def __init__(self, z_min=0.40, z_max=0.55, threshold=200):
        """Configures depth-gating bounds (metres) and the brightness threshold fallback."""
        self.z_min = z_min
        self.z_max = z_max
        self.threshold = threshold
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        # Previous frame's base detection. Used for the temporal sanity
        # check, and as a tiebreak hint (its bbox center) when detect_base
        # finds multiple equally-plausible candidates this frame — never
        # used to restrict detect_base's search region itself.
        self._last_base: Optional[BaseDetection] = None

    def generate_mask(self, frame: np.ndarray, depth_scale: float = 0.001) -> np.ndarray:
        """
        Isolates the actuator by either depth-gating or brightness-thresholding.
        Auto-detects which mode based on input range.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        if np.max(gray) > 255:
            # Real depth values (mm): gate to z_min–z_max metres
            depth_meters = gray * depth_scale
            mask = cv2.inRange(depth_meters, self.z_min, self.z_max)  # type: ignore
        else:
            # Standard 8-bit grayscale: isolate white PneuNet from dark holder
            _, mask = cv2.threshold(gray, self.threshold, 255, cv2.THRESH_BINARY)

        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self.kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self.kernel)
        return mask

    def segment_actuator(self, frame: np.ndarray, depth_scale: float = 0.001,
                          min_pixels: int = 30) -> ActuatorSegmentation:
        """
        Base-anchored actuator segmentation: detect_base() locates the rigid
        clamp fresh this frame, then the raw brightness/depth actuator mask
        (generate_mask, unchanged) is restricted to only the connected
        component touching the base tip. This structurally rules out
        background reflections or other disconnected bright blobs — they
        can't be mistaken for the actuator regardless of size, since they
        aren't attached to the base.

        Returns status="NO_BASE" if no clamp is found this frame (no
        whole-frame fallback — that's the failure mode this replaces).
        Returns status="NO_TARGET" if the base is found but no actuator
        mask is connected to its tip, or that component is too small.
        """
        # Computed before detect_base so it can cross-check the chosen base
        # candidate against real actuator-mask pixels near its tip (see
        # BASE_TIP_ADJACENCY_PX) — this runs even when no base ends up
        # found, unlike before.
        raw_mask = self.generate_mask(frame, depth_scale=depth_scale)

        prev_center_px = None
        if self._last_base is not None and self._last_base.found and self._last_base.bbox is not None:
            px, py, pw, ph = self._last_base.bbox
            prev_center_px = (px + pw / 2.0, py + ph / 2.0)

        base = detect_base(frame, prev_center_px=prev_center_px, actuator_mask=raw_mask)
        base.warning = self._check_temporal_consistency(base)
        self._last_base = base

        if not base.found:
            return ActuatorSegmentation(status="NO_BASE", base=base)

        num_labels, labels = cv2.connectedComponents(raw_mask)
        if num_labels <= 1:  # only background — no actuator-mask pixels at all
            return ActuatorSegmentation(status="NO_TARGET", base=base)

        tx, ty = base.tip_px
        _, _, bw, bh = base.bbox
        # Seed radius scales with the detected base's own size, so it still
        # reaches the adjoining actuator pixels if the camera is closer/
        # farther than usual.
        seed_r = max(15, min(bw, bh) // 2)
        h, w = raw_mask.shape[:2]
        y0, y1 = max(0, ty - seed_r), min(h, ty + seed_r + 1)
        x0, x1 = max(0, tx - seed_r), min(w, tx + seed_r + 1)
        seed_labels = labels[y0:y1, x0:x1]
        seed_labels = seed_labels[seed_labels > 0]

        if seed_labels.size == 0:
            return ActuatorSegmentation(status="NO_TARGET", base=base)

        seed_label = int(np.bincount(seed_labels).argmax())
        connected_mask = np.where(labels == seed_label, 255, 0).astype(np.uint8)

        if int(np.count_nonzero(connected_mask)) < min_pixels:
            return ActuatorSegmentation(status="NO_TARGET", base=base)

        return ActuatorSegmentation(status="OK", mask=connected_mask, base=base)

    def _check_temporal_consistency(self, base: BaseDetection) -> Optional[str]:
        """
        Light-touch sanity check: small frame-to-frame camera drift is
        expected and fine. Only flag a warning if area or orientation jumps
        far more than drift alone would explain — a likely false positive
        (shadow, foil glare) rather than the real clamp. Never rejects the
        frame outright.
        """
        prev = self._last_base
        if prev is None or not prev.found or not base.found:
            return None

        messages = []
        if prev.area_px > 0:
            area_ratio = abs(base.area_px - prev.area_px) / prev.area_px
            if area_ratio > _BASE_AREA_JUMP_RATIO:
                messages.append(f"base area jumped {area_ratio:.0%} frame-to-frame")

        # Circular distance mod 180 (angle_deg has no inherent direction).
        raw_delta = (base.angle_deg - prev.angle_deg) % 180.0
        angle_delta = min(raw_delta, 180.0 - raw_delta)
        if angle_delta > _BASE_ANGLE_JUMP_DEG:
            messages.append(f"base orientation shifted {angle_delta:.1f} deg frame-to-frame")

        return "; ".join(messages) if messages else None

    def extract_spine(self, mask: np.ndarray) -> np.ndarray:
        """
        Uses thinning (skeletonization) to find the neutral bending axis.
        Requires opencv-contrib-python. Falls back to an empty mask if unavailable.
        """
        try:
            return cv2.ximgproc.thinning(mask)
        except AttributeError:
            # opencv-contrib not installed — return zeros so callers get NO_TARGET
            return np.zeros_like(mask)
