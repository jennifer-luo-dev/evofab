# analyzer.py
# Deterministic OpenCV vision pipeline for PneuNet actuator characterization:
# masks the actuator (depth-gated or brightness-thresholded) and extracts its
# spine via skeletonization for curvature analysis.

import cv2
import numpy as np


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
