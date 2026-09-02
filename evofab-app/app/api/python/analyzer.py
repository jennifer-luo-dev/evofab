# analyzer.py
# Deterministic OpenCV vision pipeline for PneuNet actuator characterization.
#
# The actuator is a white silicone PneuNet clamped into a bright-green 3D-
# printed holder, with its base rigidly continuous with that holder. The
# holder is the one thing in frame that is reliably segmentable on colour
# alone (vivid, saturated green — nothing else in the rig is), so it is the
# anchor:
#
#   1. Segment the green holder (HSV).
#   2. Measure the holder's distance from the aligned depth frame.
#   3. Find the actuator as the white blob that emerges from the holder's
#      free end AND sits at roughly the holder's distance — this is what
#      rejects the white clutter behind the rig (a chair, filament spools)
#      that brightness thresholding alone locks onto.
#   4. Union holder + actuator into ONE connected region and skeletonize it,
#      so the spine is a single connected line from the clamped base out to
#      the actuator tip (geometry.compute_spine_curvature then fits only the
#      flexible span, using the holder mask as the rigid-base cutoff).

import cv2
import numpy as np

# HSV bounds for the green holder. Wide on hue, permissive on saturation/
# value so shadowed green still counts — the holder is the only saturated
# green object in the rig, so a loose gate is safe here.
_GREEN_LO = np.array([35, 60, 40])
_GREEN_HI = np.array([90, 255, 255])

# How far (metres) an actuator pixel's depth may deviate from the measured
# holder distance and still count as "part of the actuator". The actuator
# base is continuous with the holder and it only reaches ~66 mm, so its
# whole body stays within a narrow slab about the holder's distance; the
# background clutter this rejects is >= 0.3 m further back.
_DEPTH_SLAB_M = 0.12


class ActuatorAnalyzer:
    """Deterministic green-holder-anchored vision for PneuNet characterization."""

    def __init__(self, z_min=0.30, z_max=2.50, threshold=200):
        """z_min/z_max (metres) bracket the plausible distance of the holder
        (and therefore the actuator) from the camera — a sanity window, not a
        tight gate: the actual per-pixel actuator depth gate is
        `measured_holder_distance +/- _DEPTH_SLAB_M`, clipped to [z_min,
        z_max]. threshold is the 8-bit brightness cutoff that separates the
        white PneuNet from everything darker. All three are overridden per
        machine from machine_classification_model (z_min_m / z_max_m /
        threshold); the defaults only need to be in the right ballpark for
        the current rig."""
        self.z_min = z_min
        self.z_max = z_max
        self.threshold = threshold
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    # ------------------------------------------------------------------
    # Green holder
    # ------------------------------------------------------------------

    def detect_holder(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Largest green (HSV-gated) blob, returned as a filled uint8 mask.
        Empty mask if no green region is found."""
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        green = cv2.inRange(hsv, _GREEN_LO, _GREEN_HI)
        green = cv2.morphologyEx(green, cv2.MORPH_OPEN, self.kernel)
        green = cv2.morphologyEx(green, cv2.MORPH_CLOSE,
                                 cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        contours, _ = cv2.findContours(green, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask = np.zeros(green.shape, np.uint8)
        if not contours:
            return mask
        cv2.drawContours(mask, [max(contours, key=cv2.contourArea)], -1, 255, thickness=cv2.FILLED)
        return mask

    @staticmethod
    def _holder_free_end(holder_mask: np.ndarray, white_mask: np.ndarray) -> np.ndarray:
        """The point on the holder's principal axis where the actuator comes
        out. The holder has two ends; the free (actuator) end is whichever
        one has more white (actuator) pixels nearby, falling back to the end
        higher in the frame."""
        ys, xs = np.where(holder_mask > 0)
        pts = np.column_stack([xs, ys]).astype(np.float64)
        mean = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - mean, full_matrices=False)
        proj = (pts - mean) @ vt[0]
        end_a = pts[np.argmin(proj)]
        end_b = pts[np.argmax(proj)]

        def white_near(pt, r=40):
            y0, y1 = int(pt[1] - r), int(pt[1] + r)
            x0, x1 = int(pt[0] - r), int(pt[0] + r)
            y0, x0 = max(0, y0), max(0, x0)
            patch = white_mask[y0:y1, x0:x1]
            return int(cv2.countNonZero(patch)) if patch.size else 0

        wa, wb = white_near(end_a), white_near(end_b)
        if wa != wb:
            return end_a if wa > wb else end_b
        return end_a if end_a[1] < end_b[1] else end_b  # higher in frame

    # ------------------------------------------------------------------
    # Holder distance + actuator
    # ------------------------------------------------------------------

    def holder_distance_m(self, holder_mask: np.ndarray, depth_m: np.ndarray) -> float | None:
        """Median depth (metres) over the holder mask, eroded first so the
        estimate isn't pulled by depth bleed at the silhouette edge. Returns
        None if there's no valid depth on the holder or the value is outside
        [z_min, z_max]."""
        eroded = cv2.erode(holder_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
        if cv2.countNonZero(eroded) < 50:
            eroded = holder_mask
        d = depth_m[eroded > 0]
        d = d[d > 0]
        if d.size < 30:
            return None
        z = float(np.median(d))
        if not (self.z_min <= z <= self.z_max):
            return None
        return z

    def segment_actuator(self, frame_bgr: np.ndarray, depth_m: np.ndarray | None = None) -> dict:
        """Green-holder-anchored segmentation.

        Returns a dict with:
          status        — "OK" | "NO_HOLDER" | "NO_ACTUATOR"
          holder_mask   — filled uint8 mask of the green holder (rigid base)
          spine_mask    — filled uint8 mask of holder + actuator as ONE
                          connected region (feed to extract_spine)
          base_px       — (x, y) of the holder's free end (actuator root)
          holder_distance_mm — measured holder distance, or None

        depth_m, if given, must be per-pixel depth in METRES already aligned
        to frame_bgr (camera_orbbec_service.py returns depth software-aligned
        to colour). It is used to (a) measure the holder distance and (b)
        gate actuator pixels to that distance +/- _DEPTH_SLAB_M — without it
        the actuator is taken on brightness + holder-adjacency alone.
        """
        out = {"status": "NO_HOLDER", "holder_mask": None, "spine_mask": None,
               "base_px": None, "holder_distance_mm": None}

        holder_mask = self.detect_holder(frame_bgr)
        if cv2.countNonZero(holder_mask) < 200:
            return out
        out["holder_mask"] = holder_mask

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        _, white = cv2.threshold(gray, self.threshold, 255, cv2.THRESH_BINARY)
        white = cv2.morphologyEx(white, cv2.MORPH_OPEN, self.kernel)
        white[cv2.dilate(holder_mask, self.kernel) > 0] = 0  # holder itself isn't the actuator

        base = self._holder_free_end(holder_mask, white)
        out["base_px"] = (int(round(base[0])), int(round(base[1])))

        z_holder = None
        if depth_m is not None:
            z_holder = self.holder_distance_m(holder_mask, depth_m)
            if z_holder is not None:
                out["holder_distance_mm"] = round(z_holder * 1000.0, 1)

        # Actuator candidate: the white contour whose outline passes closest
        # to the holder's free end (the actuator is physically continuous
        # with it), among contours of a sane size.
        contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best, best_gap = None, None
        for c in contours:
            if cv2.contourArea(c) < 150:
                continue
            gap = -cv2.pointPolygonTest(c, (float(base[0]), float(base[1])), True)
            if best_gap is None or gap < best_gap:
                best_gap, best = gap, c
        if best is None or best_gap > 60:
            out["status"] = "NO_ACTUATOR"
            return out

        actuator = np.zeros(white.shape, np.uint8)
        cv2.drawContours(actuator, [best], -1, 255, thickness=cv2.FILLED)

        # Distance slab: keep only actuator pixels within _DEPTH_SLAB_M of the
        # holder — this is what drops the white background (chair, spools)
        # that the chosen contour may bleed into when the actuator is bent
        # back against it. Clipped to [z_min, z_max]. Skipped when depth is
        # unavailable or the holder distance couldn't be trusted.
        if z_holder is not None:
            lo = max(self.z_min, z_holder - _DEPTH_SLAB_M)
            hi = min(self.z_max, z_holder + _DEPTH_SLAB_M)
            in_slab = ((depth_m >= lo) & (depth_m <= hi)).astype(np.uint8) * 255
            # dilate the slab slightly: aligned depth still has a few-pixel
            # ragged edge and holes on a thin object, and eroding the
            # actuator here would fragment its skeleton.
            in_slab = cv2.dilate(in_slab, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
            gated = cv2.bitwise_and(actuator, in_slab)
            if cv2.countNonZero(gated) > 150:
                actuator = gated

        # One connected region: holder + actuator, bridged across the small
        # clamp seam, then the single connected component containing the
        # holder's free end.
        unified = cv2.bitwise_or(holder_mask, actuator)
        unified = cv2.morphologyEx(unified, cv2.MORPH_CLOSE,
                                   cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
        n, labels = cv2.connectedComponents(unified)
        if n > 2:
            keep = labels[out["base_px"][1], out["base_px"][0]]
            if keep == 0:  # free-end pixel fell just outside — take the largest instead
                keep = 1 + int(np.argmax([np.count_nonzero(labels == i) for i in range(1, n)]))
            unified = np.uint8(labels == keep) * 255

        out["spine_mask"] = unified
        out["status"] = "OK"
        return out

    # ------------------------------------------------------------------
    # Spine
    # ------------------------------------------------------------------

    def extract_spine(self, mask: np.ndarray) -> np.ndarray:
        """Thinning (skeletonization) to the neutral bending axis. Requires
        opencv-contrib-python; returns zeros (callers get NO_TARGET) if the
        ximgproc module isn't available."""
        try:
            return cv2.ximgproc.thinning(mask)
        except AttributeError:
            return np.zeros_like(mask)
